/**
 * Auth Sync Consumer Worker
 * Consumes sync events from SSO and syncs them to Skillpassport via HTTP service binding
 */

import { Fetcher } from '@cloudflare/workers-types';
import { SyncEvent } from './handlers/types';
import { processMessagesInOrder } from './handlers/message-router';
import { processMessage } from './handlers/event-processor';

export interface Env {
  SKILLPASSPORT_SYNC: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok' });
    }
    return new Response('Not Found', { status: 404 });
  },

  async queue(batch: MessageBatch<SyncEvent>, env: Env): Promise<void> {
    // Handle dead letter queue
    if (batch.queue === 'auth-db-sync-dlq') {
      for (const msg of batch.messages) {
        console.error(`[DLQ] Unrecoverable message:`, JSON.stringify(msg.body));
        msg.ack();
      }
      return;
    }

    const binding = env.SKILLPASSPORT_SYNC;
    // ponytail: batch.messages is readonly, spread to mutable array
    await processMessagesInOrder([...batch.messages], binding, processMessage);
  },
};
