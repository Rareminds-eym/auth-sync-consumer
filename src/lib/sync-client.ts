export type SyncResult =
  | { success: true }
  | { success: false; retryable: boolean; error: string };

async function syncEndpoint(
  baseUrl: string,
  path: string,
  action: string,
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
    let errorMessage = 'Unknown error';
    try {
      const body = await res.json() as { error?: { code?: string; message?: string } };
      errorMessage = body?.error?.message || `HTTP ${res.status}`;
    } catch {
      const text = await res.text();
      errorMessage = text || `HTTP ${res.status}`;
    }
    if (res.status === 404) return { success: false, retryable: true, error: errorMessage };
    if (res.status === 400) return { success: false, retryable: false, error: errorMessage };
    if (res.status === 409) return { success: false, retryable: true, error: errorMessage };
    return { success: false, retryable: true, error: errorMessage };
  }
  return { success: true };
}

export function syncUser(
  baseUrl: string,
  action: string,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/user', action, data, secret);
}

export function syncOrg(
  baseUrl: string,
  action: string,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/org', action, data, secret);
}

export function syncMembership(
  baseUrl: string,
  action: string,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/membership', action, data, secret);
}

export function syncSubscription(
  baseUrl: string,
  action: string,
  data: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  return syncEndpoint(baseUrl, '/sync/subscription', action, data, secret);
}
