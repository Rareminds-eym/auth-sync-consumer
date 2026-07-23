export type SyncResult =
  | { success: true }
  | { success: false; retryable: boolean; error: string };

async function syncEndpoint(
  baseUrl: string,
  path: string,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  const res = await fetch(`${baseUrl}${path}`, {
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
  baseUrl: string,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/user', action, data);
}

export function syncOrg(
  baseUrl: string,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/org', action, data);
}

export function syncMembership(
  baseUrl: string,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/membership', action, data);
}

export function syncSubscription(
  baseUrl: string,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/subscription', action, data);
}
