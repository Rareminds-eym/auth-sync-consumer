/**
 * Database Client for Skillpassport (Supabase REST API)
 * Handles upsert, update, and delete operations with timeouts
 */

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const DB_TIMEOUT_MS = 10_000;

export interface DbClient {
  upsert(table: string, body: Record<string, unknown>, onConflict: string): Promise<void>;
  update(table: string, filter: Record<string, string>, body: Record<string, unknown>): Promise<void>;
  remove(table: string, filter: Record<string, string>): Promise<void>;
  select<T = Record<string, unknown>>(table: string, filter: Record<string, string>, columns?: string): Promise<T[]>;
  base: string;
  headers: Record<string, string>;
  withTimeout(): { signal: AbortSignal; clear: () => void };
}

export function dbClient(env: Env): DbClient {
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

  async function update(
    table: string,
    filter: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<void> {
    const qs = Object.entries(filter)
      .map(([col, expr]) => `${encodeURIComponent(col)}=${encodeURIComponent(expr)}`)
      .join('&');
    const { signal, clear } = withTimeout();
    try {
      const res = await fetch(`${base}/${table}?${qs}`, {
        method: 'PATCH',
        signal,
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`update failed [${res.status}]: ${text}`);
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

  async function select<T = Record<string, unknown>>(
    table: string,
    filter: Record<string, string>,
    columns?: string,
  ): Promise<T[]> {
    const qs = Object.entries(filter)
      .map(([col, expr]) => `${encodeURIComponent(col)}=${encodeURIComponent(expr)}`)
      .join('&');
    const cols = columns ? `&select=${encodeURIComponent(columns)}` : '';
    const { signal, clear } = withTimeout();
    try {
      const res = await fetch(`${base}/${table}?${qs}${cols}`, {
        method: 'GET',
        signal,
        headers,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`select failed [${res.status}]: ${text}`);
      }
      return res.json() as Promise<T[]>;
    } finally {
      clear();
    }
  }

  return { upsert, update, remove, select, base, headers, withTimeout };
}
