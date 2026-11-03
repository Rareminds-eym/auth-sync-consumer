export async function runLearningMaintenance(env:{LTE_APP_URL?:string;LTE_CATALOG_SYNC_SECRET?:string;SKILLPASSPORT_SYNC_URL?:string;LEARNING_MAINTENANCE_QUEUE?:Queue<{type:'learning.maintenance'}>},notificationsOnly=false):Promise<void>{
 const secret=env.LTE_CATALOG_SYNC_SECRET;
 if((!notificationsOnly&&!env.LTE_APP_URL)||!env.SKILLPASSPORT_SYNC_URL||!secret||secret.length<32)throw new Error('Learning maintenance requires LTE_APP_URL and LTE_CATALOG_SYNC_SECRET');
 const targets=[...(!notificationsOnly?[{path:'/api/v1/internal/learning/maintenance',base:env.LTE_APP_URL!}]:[]),{path:'/api/internal/learning/maintenance',base:env.SKILLPASSPORT_SYNC_URL}];
 const results=await Promise.allSettled(targets.map(async({path,base})=>{
 const url=new URL(path,base);
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Learning maintenance requires HTTPS');
 const body=notificationsOnly?JSON.stringify({task:'notifications'}):'{}',timestamp=String(Date.now());
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`POST\n${path}\n${timestamp}\n${body}`));
 const response=await fetch(url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(55000),body,headers:{'Content-Type':'application/json','x-lte-timestamp':timestamp,'x-lte-signature':[...new Uint8Array(signature)].map(v=>v.toString(16).padStart(2,'0')).join('')}});
 if(!response.ok)throw new Error(`Learning maintenance failed (${response.status})`);
 if(path==='/api/internal/learning/maintenance'){
  const result=await response.json() as {notifications?:{hasMore?:boolean}};
  if(result.notifications?.hasMore===true){
   if(!env.LEARNING_MAINTENANCE_QUEUE)throw new Error('Learning continuation queue is not configured; cron will recover backlog');
   await env.LEARNING_MAINTENANCE_QUEUE.send({type:'learning.maintenance'});
  }
 }
 }));
 if(results.some(r=>r.status==='rejected'))throw new Error('One or more learning maintenance services failed; retry on next scheduled run');
}
