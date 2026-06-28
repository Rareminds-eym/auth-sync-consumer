export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface SyncEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

const DB_TIMEOUT_MS = 10_000;

function dbClient(env: Env) {
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };

  function withTimeout(): { signal: AbortSignal; clear: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DB_TIMEOUT_MS);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }

  async function upsert(
    table: string,
    body: Record<string, unknown>,
    onConflict: string,
  ): Promise<void> {
    const { signal, clear } = withTimeout();
    try {
      const qs = `?on_conflict=${encodeURIComponent(onConflict)}`;
      const res = await fetch(`${base}/${table}${qs}`, {
        method: 'POST',
        signal,
        headers: {
          ...headers,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`upsert failed [${res.status}]: ${text}`);
      }
    } finally {
      clear();
    }
  }

  async function remove(
    table: string,
    filter: Record<string, string>,
  ): Promise<void> {
    const qs = Object.entries(filter)
      .map(([col, expr]) => `${encodeURIComponent(col)}=${encodeURIComponent(expr)}`)
      .join('&');
    const { signal, clear } = withTimeout();
    try {
      const res = await fetch(`${base}/${table}?${qs}`, {
        method: 'DELETE',
        signal,
        headers,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`delete failed [${res.status}]: ${text}`);
      }
    } finally {
      clear();
    }
  }

  return { upsert, remove };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok' });
    }
    return new Response('Not Found', { status: 404 });
  },

  async queue(batch: MessageBatch<SyncEvent>, env: Env): Promise<void> {
    const db = dbClient(env);

    for (const msg of batch.messages) {
      try {
        const { type, payload } = msg.body;

        switch (type) {
          case 'user.created':
          case 'user.updated': {
            if (!payload.id) {
              console.error(`[auth-sync-consumer] Missing user ID in ${type} event. Payload:`, payload);
              break; // Breaks switch, proceeds to msg.ack()
            }
            const userMetadata = (payload.user_metadata as Record<string, unknown>) ?? {};
            
            const updatePayload: Record<string, unknown> = {
              id: payload.id as string,
              email: payload.email as string,
              user_metadata: userMetadata,
            };

            if (userMetadata.first_name !== undefined) {
              updatePayload.firstName = userMetadata.first_name;
            }
            if (userMetadata.last_name !== undefined) {
              updatePayload.lastName = userMetadata.last_name;
            }

            await db.upsert('users', updatePayload, 'id');
            console.log(`[auth-sync-consumer] Successfully synced ${type} for user ${payload.id}`);
            break;
          }

          case 'user.email_verified':
            break;

          case 'user.deleted':
            await db.remove('users', { id: `eq.${payload.user_id as string}` });
            break;

          case 'organization.created':
            await db.upsert('organizations', {
              id: payload.id as string,
              name: payload.name as string,
            }, 'id');
            break;

          case 'membership.created':
          case 'membership.role_changed': {
            const roles = (payload.roles as string[]) || ['member'];
            await db.upsert('organization_members', {
              user_id: payload.user_id as string,
              organization_id: payload.organization_id as string,
              role: roles[0] || 'member',
              status: (payload.status as string) || 'active',
              updated_at: new Date().toISOString(),
            }, 'user_id,organization_id');
            // Also set the user's primary organizationId so college admin
            // endpoints (curriculum, attendance, etc.) can resolve it.
            await db.upsert('users', {
              id: payload.user_id as string,
              organizationId: payload.organization_id as string,
            }, 'id');
            break;
          }

          case 'membership.removed':
            await db.remove('organization_members', {
              user_id: `eq.${payload.user_id as string}`,
              organization_id: `eq.${payload.organization_id as string}`,
            });
            break;

          default:
            console.warn(JSON.stringify({ msg: '[auth-sync] Unknown event type', type }));
        }

        msg.ack();
      } catch (err) {
        console.error(JSON.stringify({
          msg: '[auth-sync] Failed to process message',
          error: err instanceof Error ? err.message : String(err),
          body: msg.body,
        }));
        msg.retry();
      }
    }
  },
};
