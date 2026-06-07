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
  async queue(batch: MessageBatch<SyncEvent>, env: Env): Promise<void> {
    const db = dbClient(env);

    for (const msg of batch.messages) {
      try {
        const { type, payload } = msg.body;

        switch (type) {
          case 'user.created':
            await db.upsert('users', {
              id: payload.id as string,
              email: payload.email as string,
            }, 'id');
            break;

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
