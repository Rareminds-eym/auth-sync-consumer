import { RetryableError } from '../handlers/retry-classifier';

/** A reference cannot choose destination data, roles, plans, mail policy or URLs. */
export function candidateReference(payload: unknown): payload is { operationId: string; sourceHash: string; emailPolicy: 'forbidden' } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const body = payload as Record<string, unknown>;
  return Object.keys(body).length === 3 && body.emailPolicy === 'forbidden' &&
    typeof body.operationId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.operationId) &&
    typeof body.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(body.sourceHash);
}
export async function deliverCandidateProjection(baseUrl: string, secret: string, payload: unknown, fetcher: typeof fetch = fetch): Promise<void> {
  if (!candidateReference(payload) || !secret) throw new RetryableError('Candidate projection reference unavailable');
  let base: URL;
  try { base = new URL(baseUrl); } catch { throw new RetryableError('Candidate projection destination unavailable'); }
  // Configuration is an origin, never a path prefix or a URL with query/fragment.
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname))))
    throw new RetryableError('Candidate projection destination unavailable');
  let response: Response;
  try {
    response = await fetcher(new URL('/sync/zoho-candidate', base).href, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify({ action: 'project', data: payload }) });
  } catch { throw new RetryableError('Candidate projection transport unavailable'); }
  // Poison/configuration failures must be retained for the DLQ, never ACKed as success.
  if (!response.ok) throw new RetryableError('Candidate projection not confirmed');
  let result: unknown;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing confirmation');
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); throw new Error('Confirmation exceeds limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    result = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new RetryableError('Candidate projection not confirmed'); }
  const value = result as { success?: unknown; data?: { completed?: unknown; operationId?: unknown; sourceHash?: unknown; emailPolicy?: unknown } } | null;
  if (value?.success !== true || value.data?.completed !== true || value.data.operationId !== payload.operationId ||
      value.data.sourceHash !== payload.sourceHash || value.data.emailPolicy !== 'forbidden') throw new RetryableError('Candidate projection not confirmed');
}
