/**
 * HMAC-based service token / user claim signing for the Skillpassport LTE
 * internal API. Kept separate from the SSO sync client: LTE authentication is
 * a distinct protocol (a short-lived signed service token + a signed user
 * claim sent as headers) rather than a plain `Bearer` secret.
 */

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeJson(obj: unknown): string {
  return b64urlEncode(encoder.encode(JSON.stringify(obj)));
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

/**
 * Sign a short-lived service token authorising `action` on the LTE app.
 */
export async function generateServiceToken(secret: string, action: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'svc' });
  const payload = encodeJson({ app: 'lte', actions: [action], iat: now, exp: now + 60 });
  const data = `${header}.${payload}`;
  const sig = await hmacSign(secret, data);
  return `${data}.${sig}`;
}

/**
 * Sign a short-lived user claim binding the sync to `userId`.
 */
export async function generateUserClaim(secret: string, userId: string): Promise<{ claim: string; sig: string }> {
  const now = Math.floor(Date.now() / 1000);
  const claim = encodeJson({ sub: userId, exp: now + 60 });
  const sig = await hmacSign(secret, claim);
  return { claim, sig };
}
