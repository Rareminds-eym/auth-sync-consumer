import { test,afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';
import { processLteMessage } from '../src/handlers/event-processor';
import { decodeEventBody } from '../src/handlers/message-codec';

const originalFetch=globalThis.fetch;
afterEach(()=>{ globalThis.fetch=originalFetch; });
const event={ type:'lte.review_completed',payload:{ learnerId:'00000000-0000-4000-8000-000000000001',eventId:'00000000-0000-4000-8000-000000000002' } };
function message(body:unknown) { const calls={ ack:0,retry:0 };return { id:'test-message',body,ack:()=>{ calls.ack++; },retry:()=>{ calls.retry++; },calls }; }

test('a successful review effect acknowledges its queue message',async()=>{
 globalThis.fetch=async()=>Response.json({ ok:true });const msg=message(event);
 await processLteMessage(msg as never,'https://example.test','local-test-key');
 assert.equal(msg.calls.ack,1);assert.equal(msg.calls.retry,0);
});
test('an incompatible schema or rejected effect is retained for replay',async()=>{
 globalThis.fetch=async()=>Response.json({ ok:false },{ status:400 });const msg=message(event);
 await processLteMessage(msg as never,'https://example.test','local-test-key');
 assert.equal(msg.calls.ack,0);assert.equal(msg.calls.retry,1);
});
test('network errors and malformed LTE messages cannot be silently acknowledged',async()=>{
 globalThis.fetch=async()=>{ throw new TypeError('offline'); };
 for (const body of [event,new Uint8Array([0,1,2]),{ type:'lte.review_future',payload:{} }]) {
  const msg=message(body);await processLteMessage(msg as never,'https://example.test','local-test-key');
  assert.equal(msg.calls.ack,0);assert.equal(msg.calls.retry,1);
 }
});
test('dead-letter archiving retains compressed bytes before acknowledging',async()=>{
 const compressed=await new Response(new Response(JSON.stringify(event)).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
 const msg=message(compressed);let archive='';
 await worker.queue({ queue:'lte-db-sync-dlq',messages:[msg] } as never,{ REVIEW_DLQ_BUCKET:{ put:async(_key:string,value:string)=>{ archive=value; } } } as never);
 assert.equal(msg.calls.ack,1);assert.deepEqual(await decodeEventBody(JSON.parse(archive).body),event);
});
test('dead-letter storage failure retries instead of losing the message',async()=>{
 const msg=message(event);
 await worker.queue({ queue:'lte-db-sync-dlq',messages:[msg] } as never,{ REVIEW_DLQ_BUCKET:{ put:async()=>{ throw new Error('storage offline'); } } } as never);
 assert.equal(msg.calls.ack,0);assert.equal(msg.calls.retry,1);
});
