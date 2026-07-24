/**
 * Auth Sync Consumer Worker
 * Consumes sync events from SSO and syncs them to Skillpassport via HTTP fetch
 */

import { SyncEvent } from './handlers/types';
import { processMessagesInOrder } from './handlers/message-router';
import { processMessage } from './handlers/event-processor';

export interface Env {
  SKILLPASSPORT_SYNC_URL: string;
  SYNC_API_SECRET: string;
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

    const baseUrl = env.SKILLPASSPORT_SYNC_URL;
    await processMessagesInOrder([...batch.messages], baseUrl, env.SYNC_API_SECRET, processMessage);
  },
};

