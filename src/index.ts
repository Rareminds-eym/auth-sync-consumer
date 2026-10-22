/**
 * Auth Sync Consumer Worker
 * Consumes sync events from SSO and LTE queues and syncs them to Skillpassport
 * via HTTP fetch. Each queue is routed to its own pipeline:
 *   - SSO (auth-db-sync-queue)  -> SSO sync API, ordered by FK dependency
 *   - LTE (lte-db-sync-queue)   -> LTE internal API, sequential
 */

import type { SyncEvent } from './handlers/types';
import { processMessagesInOrder } from './handlers/message-router';
import { processSsoMessage, processLteBatch } from './handlers/event-processor';
import { runLearningMaintenance } from './learning-maintenance';

export interface Env {
  LEARNING_MAINTENANCE_QUEUE?: Queue<{type:'learning.maintenance'}>;
  LTE_APP_URL?: string;
  LTE_CATALOG_SYNC_SECRET?: string;
  SKILLPASSPORT_SYNC_URL: string;
  SYNC_API_SECRET: string;
  LTE_INTERNAL_SECRET: string;
  REVIEW_DLQ_BUCKET?: R2Bucket;
}

export default {
  async scheduled(_event: ScheduledController,env:Env,ctx:ExecutionContext):Promise<void>{
    ctx.waitUntil(runLearningMaintenance(env));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok' });
    }
    return new Response('Not Found', { status: 404 });
  },

  async queue(batch: MessageBatch<SyncEvent>, env: Env): Promise<void> {
    // Handle dead letter queues (any queue ending in -dlq)
    if (batch.queue.endsWith('-dlq')) {
      for (const msg of batch.messages) {
        if (batch.queue.startsWith('lte')||batch.queue.startsWith('learning-maintenance')) {
          if (!env.REVIEW_DLQ_BUCKET) {
            msg.retry();
            continue;
          }
          try {
            await env.REVIEW_DLQ_BUCKET.put(
              `${batch.queue.startsWith('lte')?'lte-review-dlq':'learning-maintenance-dlq'}/${msg.id}.json`,
              JSON.stringify(
                {
                  queue: batch.queue,
                  messageId: msg.id,
                  body: msg.body,
                  archivedAt: new Date().toISOString(),
                },
                (_key, value) => {
                  if (value instanceof ArrayBuffer)
                    return {
                      type: 'Buffer',
                      data: Array.from(new Uint8Array(value)),
                    };
                  if (ArrayBuffer.isView(value))
                    return {
                      type: 'Buffer',
                      data: Array.from(
                        new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
                      ),
                    };
                  return value;
                }
              ),
              { httpMetadata: { contentType: 'application/json' } }
            );
            msg.ack();
          } catch {
            msg.retry();
          }
          continue;
        }
        console.error(`[DLQ:${batch.queue}] Unrecoverable message:`, JSON.stringify(msg.body));
        msg.ack();
      }
      return;
    }

    if(batch.queue.startsWith('learning-maintenance')){
      for(const msg of batch.messages){
        try{
          if((msg.body as {type:string})?.type!=='learning.maintenance')throw new Error('Invalid learning maintenance message');
          await runLearningMaintenance(env,true);msg.ack();
        }catch{msg.retry();}
      }
      return;
    }

    const baseUrl = env.SKILLPASSPORT_SYNC_URL;

    // LTE pipeline: dedicated queue + internal API + its own secret.
    if (batch.queue.startsWith('lte')) {
      await processLteBatch([...batch.messages], baseUrl, env.LTE_INTERNAL_SECRET);
      return;
    }

    // SSO pipeline: auth-db sync queue, ordered by FK dependency.
    await processMessagesInOrder(
      [...batch.messages],
      baseUrl,
      env.SYNC_API_SECRET,
      processSsoMessage
    );
  },
};
