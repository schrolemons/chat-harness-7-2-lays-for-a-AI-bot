import fs from'node:fs';import path from'node:path';import{bridgeHarness}from'./audit-bridge-harness.mjs';
const root=JSON.parse(fs.readFileSync('workspace.local.json')).runtimeRoot,dir=path.join(root,'state/audits/fast-chat-20261113'),files={};
for(const file of['plugins/qq-components/life-scheduler/index.js','plugins/qq-components/ctx-context-lifecycle/index.js','plugins/qq-components/life-history-context/index.js','plugins/qq-components/obs-context-assembly/refill.mjs','plugins/qq-components/ctx-chat-topic-drive/opening-topic.mjs'])files[file]=fs.readFileSync(path.join(dir,'before/source',file),'utf8');
const rows=[];
for(const [kind,overrides]of[['before',files],['after',{}]]){
 const h=await bridgeHarness({files:overrides,config:{socialV2:{dailyDiary:{hour:0,minute:0}}}});let server;
 try{h.setMode('reserved2');const now=Date.now(),day=h.pluginHost.callService('memory','diaryTargetDay',{now}).day,key='private:123';h.getSocialV2State(key);h.pluginHost.callService('memory','write',{key,text:'【日记】\nAPI_DIARY_FIXTURE'});
  server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/daily-diary?token=fixture-console-token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'sendNow',key,day})}),value=await r.json();
  rows.push({kind,status:r.status,pending:value.pending,requestId:h.getSocialV2State(key).diaryRequestedId||'',job:h.pluginHost.callService('memory','workerStatus',{key})});
 }finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await h.close();}
}
fs.writeFileSync(path.join(dir,'notification-baseline.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
