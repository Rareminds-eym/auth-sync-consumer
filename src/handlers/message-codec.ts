/**
 * Message codec — decodes raw queue message bodies into a `SyncEvent`.
 * Queue producers may enqueue the body as plain JSON, a JSON string, a base64
 * string, raw bytes (`data`), a sparse array-like object, or gzip-compressed
 * bytes. Normalise all of those to a structured event here so handlers only
 * ever work with one shape.
 */

import { SyncEvent } from './types';

export async function decodeEventBody(body: unknown): Promise<SyncEvent | null> {
  if (!body) return null;

  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as SyncEvent;
    } catch {
      try {
        const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
        return decodeEventBody(bytes.buffer);
      } catch {
        return null;
      }
    }
  }

  if (typeof body !== 'object') return null;

  if ('body' in body && (body as { body?: unknown }).body) {
    return decodeEventBody((body as { body: unknown }).body);
  }

  if ('type' in body && 'payload' in body) {
    return body as SyncEvent;
  }

  if ('data' in body && Array.isArray((body as { data?: unknown }).data)) {
    return decodeEventBody(new Uint8Array((body as { data: number[] }).data));
  }

  if (!(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body) && '0' in body && '1' in body) {
    const keys = Object.keys(body).filter((k) => !isNaN(Number(k))).map(Number).sort((a, b) => a - b);
    if (keys.length > 0) {
      const maxKey = keys[keys.length - 1]!;
      const uint8 = new Uint8Array(maxKey + 1);
      const obj = body as Record<string, number>;
      for (const k of keys) uint8[k] = obj[k]!;
      return decodeEventBody(uint8);
    }
  }

  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const buffer = (
      ArrayBuffer.isView(body)
        ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
        : body
    ) as ArrayBuffer;
    try {
      const stream = new Response(buffer).body!.pipeThrough(new DecompressionStream('gzip'));
      const text = await new Response(stream).text();
      return JSON.parse(text) as SyncEvent;
    } catch {
      try {
        const text = new TextDecoder().decode(buffer);
        return JSON.parse(text) as SyncEvent;
      } catch {
        return null;
      }
    }
  }

  return null;
}
