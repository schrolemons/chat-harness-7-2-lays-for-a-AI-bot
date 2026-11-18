import fs from 'node:fs';import path from 'node:path';import WebSocket from 'ws';import {randomUUID} from 'node:crypto';
import {NodeApiClient} from '../src/dsh-client.js';
const root=JSON.parse(fs.readFileSync('workspace.local.json')).runtimeRoot,dir=path.join(root,'state/audits/global-model-inheritance-20261113');
const cfg=await fetch('http://127.0.0.1:3199/config').then(r=>r.json()),native=new NodeApiClient(cfg.dshTarget.baseUrl,10000,{});
await native.agentPresets.list({});const mapping=JSON.parse(fs.readFileSync(path.join(root,'state/sessions.json'))).sessions;
const result=await Promise.allSettled(['private:10001','group:40002','group:40001'].map(async key=>{
 const sessionId=mapping[key],snapshot=await new Promise((resolve,reject)=>{
  const url=new URL('/api/remote.mux',cfg.dshTarget.baseUrl);url.protocol='ws:';const socket=new WebSocket(url,{headers:{cookie:native.cookie}}),streamId=randomUUID();let done=false;
  const timer=setTimeout(()=>finish(Error('Snapshot timeout')),15000);
  function finish(error,value){if(done)return;done=true;clearTimeout(timer);socket.close();error?reject(error):resolve(value);}
  socket.on('open',()=>socket.send(JSON.stringify({type:'open',streamId,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId},maxMessages:1000}}}})));
  socket.on('message',bytes=>{let m;try{m=JSON.parse(String(bytes));}catch{return;}if(m.streamId!==streamId)return;if(m.type==='item'&&m.value?.type==='snapshot')finish(null,m.value);if(m.type==='end')finish(Error('Follow ended'));});socket.on('error',finish);
 });
 const events=(snapshot.records||snapshot.events||[]).map(e=>e.event||e).filter(e=>e.type==='compaction/summary').map(e=>({seq:e.seq,time:e.time,compactionId:e.data?.compactionId,provider:e.data?.provider,model:e.data?.model,llmStreamCall:e.data?.llmStreamCall,usage:e.data?.usage,shadowedTokenCount:e.data?.shadowedTokenCount}));
 return {key,sessionId,summaries:events};
}));
fs.writeFileSync(path.join(dir,'actual-compaction-calls.json'),JSON.stringify(result.map(r=>r.status==='fulfilled'?r.value:{error:r.reason?.message}),null,2));
for(const r of result)console.log(JSON.stringify(r.status==='fulfilled'?r.value:{error:r.reason?.message}));
