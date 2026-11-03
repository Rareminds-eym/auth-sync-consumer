import { generateServiceToken, generateUserClaim } from './hmac-token';

/** Any failed review effect is retryable and eventually archived, never acked
 * merely because the receiver rejects an unsupported event/schema version. */
export async function syncReview(
  baseUrl: string,
  type: string,
  payload: Record<string, unknown>,
  secret: string
): Promise<void> {
  const learnerId = payload.learnerId;
  if (typeof learnerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(learnerId))
    throw new Error('Invalid review subject');
  const token = await generateServiceToken(secret, 'review:apply');
  const { claim, sig } = await generateUserClaim(secret, learnerId);
  const response = await fetch(`${baseUrl}/api/internal/lte/v1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Lte-Claim': claim,
      'X-Lte-Sig': sig,
    },
    body: JSON.stringify({
      action: 'review:apply',
      requestId: crypto.randomUUID(),
      payload: { type, event: payload },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json()) as { ok?: boolean };
  if (!response.ok || result.ok !== true)
    throw new Error(`Review effect rejected (${response.status})`);
}
