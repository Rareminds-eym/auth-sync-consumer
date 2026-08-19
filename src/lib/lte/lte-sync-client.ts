/**
 * LTE sync client — pushes lte-db events to the Skillpassport internal LTE API
 * (`POST /api/internal/lte/v1`). Authentication is a signed service token plus
 * a signed user claim (see ./hmac-token), not the SSO Bearer secret.
 */

import type { SyncResult } from '../sync-result';
import { generateServiceToken, generateUserClaim } from './hmac-token';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function syncLte(
  baseUrl: string,
  payload: Record<string, unknown>,
  secret: string
): Promise<SyncResult> {
  let res: Response;
  const requestId = crypto.randomUUID();
  const rawUserId = payload.userId ?? payload.user_id;
  const userId = typeof rawUserId === 'string' ? rawUserId.trim() : '';

  if (!userId || !UUID_REGEX.test(userId)) {
    return { success: false, retryable: false, error: `Invalid or missing userId in LTE payload: ${String(rawUserId)}` };
  }

  try {
    const serviceToken = await generateServiceToken(secret, 'lte:sync');
    const { claim, sig } = await generateUserClaim(secret, userId);

    res = await fetch(`${baseUrl}/api/internal/lte/v1`, {
      method: 'POST',
      body: JSON.stringify({ action: 'lte:sync', requestId, payload }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceToken}`,
        'X-Lte-Claim': claim,
        'X-Lte-Sig': sig,
      },
    });
  } catch (err) {
    return { success: false, retryable: true, error: `LTE fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  let body: { ok?: boolean; error?: { code?: string; message?: string } } | null = null;
  try {
    body = (await res.json()) as { ok?: boolean; error?: { code?: string; message?: string } };
  } catch {
    // Fallback for non-JSON body
  }

  if (!res.ok) {
    const errorMessage = body?.error?.message || `HTTP ${res.status}`;
    const retryable = res.status !== 400 && res.status !== 401 && res.status !== 403;
    return { success: false, retryable, error: errorMessage };
  }

  if (body && body.ok === false) {
    const errorCode = body.error?.code || 'GATEWAY_ERROR';
    const errorMessage = body.error?.message || 'Gateway operation failed';
    const nonRetryableCodes = ['NOT_FOUND', 'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'VALIDATION_ERROR'];
    const retryable = !nonRetryableCodes.includes(errorCode);
    return { success: false, retryable, error: `[${errorCode}] ${errorMessage}` };
  }

  return { success: true };
}
