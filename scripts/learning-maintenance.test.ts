import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {runLearningMaintenance} from '../src/learning-maintenance';
import worker from '../src/index';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const env={LTE_APP_URL:'https://lte.invalid',SKILLPASSPORT_SYNC_URL:'https://sp.invalid',LTE_CATALOG_SYNC_SECRET:'x'.repeat(32)};
test('backlog schedules an immediate durable continuation',async()=>{
 const messages:unknown[]=[];let requestedBody='';
 globalThis.fetch=async(_url,init)=>{requestedBody=String(init?.body);return Response.json({ok:true,notifications:{hasMore:true}});};
 await runLearningMaintenance({...env,LEARNING_MAINTENANCE_QUEUE:{send:async(body:unknown)=>{messages.push(body);}} as never},true);
 assert.deepEqual(messages,[{type:'learning.maintenance'}]);assert.deepEqual(JSON.parse(requestedBody),{task:'notifications'});
});
test('missing continuation binding is reported rather than claiming backlog completion',async()=>{
 globalThis.fetch=async()=>Response.json({notifications:{hasMore:true}});
 await assert.rejects(runLearningMaintenance(env,true));
});
test('notification queue acknowledges only after successful continuation processing',async()=>{
 globalThis.fetch=async()=>Response.json({notifications:{hasMore:false}});let ack=0,retry=0;
 const batch={queue:'learning-maintenance',messages:[{body:{type:'learning.maintenance'},ack:()=>ack++,retry:()=>retry++}]};
 await worker.queue(batch as never,env as never);assert.equal(ack,1);assert.equal(retry,0);
 globalThis.fetch=async()=>{throw new Error('Network unavailable');};
 await worker.queue(batch as never,env as never);assert.equal(ack,1);assert.equal(retry,1);
});
