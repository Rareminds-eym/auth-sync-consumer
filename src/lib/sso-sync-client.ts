/**
 * SSO sync client — pushes auth-db events to the Skillpassport SSO sync API
 * (`POST /sync/<entity>` with a plain `Bearer` secret and `{ action, data }`).
 */

import type { SyncResult } from './sync-result';

export type SsoAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'role_changed'
  | 'status_changed'
  | 'removed'
  | 'cancelled'
  | 'expired';

async function syncEndpoint(
  baseUrl: string,
  path: string,
  action: SsoAction,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      body: JSON.stringify({ action, data }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`,
      },
    });
  } catch (err) {
    return { success: false, retryable: true, error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) {
    // Read the body once (Response bodies are single-use) and try to parse it.
    const text = await res.text();
    let errorMessage = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
      errorMessage = body?.error?.message || errorMessage;
    } catch {
      errorMessage = text || errorMessage;
    }
    // 4xx (client) errors are non-retryable; everything else may recover on retry.
    const retryable = res.status !== 400;
    return { success: false, retryable, error: errorMessage };
  }
  return { success: true };
}

export function syncUser(
  baseUrl: string,
  action: SsoAction,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/user', action, data, secret);
}

export function syncOrg(
  baseUrl: string,
  action: SsoAction,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/org', action, data, secret);
}

export function syncMembership(
  baseUrl: string,
  action: SsoAction,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/membership', action, data, secret);
}

export function syncSubscription(
  baseUrl: string,
  action: SsoAction,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/subscription', action, data, secret);
}

export function syncFaculty(
  baseUrl: string,
  action: SsoAction,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/faculty', action, data, secret);
}
