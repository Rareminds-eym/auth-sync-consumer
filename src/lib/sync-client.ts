import { Fetcher } from '@cloudflare/workers-types';

export type SyncResult =
  | { success: true }
  | { success: false; retryable: boolean; error: string };

async function syncEndpoint(
  binding: Fetcher,
  path: string,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  const res = await binding.fetch(`https://internal${path}`, {
    method: 'POST',
    body: JSON.stringify({ action, data }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.json() as { error?: { code?: string; message?: string } };
    const error = body?.error;
    if (res.status === 404) return { success: false, retryable: true, error: error?.message || 'Not found' };
    if (res.status === 400) return { success: false, retryable: false, error: error?.message || 'Bad request' };
    if (res.status === 409) return { success: false, retryable: true, error: error?.message || 'Conflict' };
    return { success: false, retryable: true, error: error?.message || 'Unknown error' };
  }
  return { success: true };
}

export function syncUser(
  binding: Fetcher,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  return syncEndpoint(binding, '/sync/user', action, data);
}

export function syncOrg(
  binding: Fetcher,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  return syncEndpoint(binding, '/sync/org', action, data);
}

export function syncMembership(
  binding: Fetcher,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  return syncEndpoint(binding, '/sync/membership', action, data);
}

export function syncSubscription(
  binding: Fetcher,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  return syncEndpoint(binding, '/sync/subscription', action, data);
}
