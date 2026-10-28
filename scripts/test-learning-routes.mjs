import test from 'node:test';import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
async function withBridge(run){
 const h=await bridgeHarness({config:{slang:{enabled:true,learnerPreset:'qq-learning'}}});h.setMode('reserved2');h.setReady(true);h.setPresets(['standard','qq-chat','qq-chat-v2','qq-learning']);
 const st=h.getSocialV2State('group:456'),server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const request=async(route,{body,token=st.agentToken}={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/'+route+(body?'':'?key=group:456'),{method:body?'POST':'GET',headers:{'x-console-token':'fixture-console-token','x-agent-token':token,'content-type':'application/json'},...(body?{body:JSON.stringify({key:'group:456',...body})}:{})});return {status:r.status,data:await r.json()};};
 try{await run(h,request);}finally{await new Promise(r=>server.close(r));await h.close();}
}
test('alias HTTP submission accepts unbound suspects and the query returns them',()=>withBridge(async(h,request)=>{
 const r=await request('alias/submit',{body:{alias:'候选猫',note:'你去问问候选猫'}});assert.equal(r.data.result.ok,true);
 const q=await request('alias/query');assert.ok(q.data.entries.some(x=>x.alias==='候选猫'&&x.qq===''));
}));
test('term routes bind scope and candidate status on the server, enforce tokens and tool switches',()=>withBridge(async(h,request)=>{
 let r=await request('term/submit',{body:{term:'撤离路线',topic:'三角洲行动',status:'confirmed',sourceKey:'group:789',summary:'玩法知识'}});
 assert.equal(r.status,200);const list=await h.pluginHost.callTool('term_list',{});assert.equal(list.result.entries[0].status,'candidate');assert.equal(list.result.entries[0].sourceKey,'group:456');
 assert.equal((await request('term/query')).data.entries.length,0);
 assert.equal((await request('term/query',{token:'bad'})).status,403);
 h.cfg.socialV2.tools.termSubmit=false;assert.equal((await request('term/submit',{body:{term:'测试'}})).status,403);
}));
test('shared learning transport serializes requests and captures a turn ending before prompt acknowledgement',()=>withBridge(async(h)=>{
 assert.equal(typeof h.taskCaps.learningPrompt,'function');let n=0,inFlight=0,max=0;
 h.api.sessions.prompt=async p=>{
   const turn=++n;inFlight++;max=Math.max(max,inFlight);await new Promise(r=>setTimeout(r,10));
   for(const [type,data] of [['turn/start',{turn}],['assistant/message',{turn,message:{content:[{type:'text',text:JSON.stringify({turn})}]}}],['turn/end',{turn,reason:{kind:'completed'}}]])
     await h.queueDshEnvelope({payload:{type:'session/event',sessionId:p.sessionId,event:{type,data}}});
   inFlight--;return {result:{ok:true,value:{}}};
 };
 const results=await Promise.all([h.taskCaps.learningPrompt('one'),h.taskCaps.learningPrompt('two')]);
 assert.equal(max,1);assert.deepEqual(results.map(JSON.parse),[{turn:1},{turn:2}]);assert.equal(h.calls.created.length,1);
}));
test('alias submission never exposes another group evidence or manual notes',()=>withBridge(async(h,request)=>{
 await h.pluginHost.callTool('alias_submit',{alias:'测试猫',qq:'10608',key:'group:789',note:'B_GROUP_PRIVATE_EVIDENCE'});
 const r=await request('alias/submit',{body:{alias:'测试猫',qq:'10608',note:'A_GROUP_CONTEXT'}});
 assert.equal(r.status,200);assert.doesNotMatch(JSON.stringify(r.data),/B_GROUP_PRIVATE_EVIDENCE|group:789|evidence/);
}));
test('agent requests cannot approve learning candidates through the generic plugin endpoint',()=>withBridge(async h=>{
 const st=h.getSocialV2State('group:456');const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 try{
   const entry=(await h.pluginHost.callTool('alias_submit',{alias:'待审核',qq:'10608',key:'group:456'})).result.entry;
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/plugins/call',{method:'POST',headers:{'content-type':'application/json','x-console-token':'fixture-console-token','x-agent-token':st.agentToken,'x-agent-call':'1'},body:JSON.stringify({tool:'alias_confirm',input:{id:entry.id}})});
   assert.equal(response.status,403);assert.equal((await h.pluginHost.callTool('alias_list',{})).result.entries[0].status,'candidate');
 }finally{await new Promise(r=>server.close(r));}
}));
test('generic learning cannot inherit the legacy chat persona even when its saved preset was qq-chat',async()=>{
 const h=await bridgeHarness({config:{slang:{enabled:false,learnerPreset:'qq-chat'}}});h.setMode('reserved2');h.setReady(true);h.setPresets(['qq-chat','qq-learning']);
 h.api.sessions.prompt=async p=>{for(const [type,data] of [['turn/start',{turn:1}],['assistant/message',{turn:1,message:{content:[{type:'text',text:'{}'}]}}],['turn/end',{turn:1,reason:{kind:'completed'}}]])await h.queueDshEnvelope({payload:{type:'session/event',sessionId:p.sessionId,event:{type,data}}});return {result:{ok:true,value:{}}};};
 try{await h.taskCaps.learningPrompt('read-only learning',{key:'*'});assert.equal(h.calls.created[0].agentPreset,'qq-learning');}finally{await h.close();}
});
test('a queued learning request rechecks its group permission when it actually dispatches',()=>withBridge(async h=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let count=0;
 h.api.sessions.prompt=async p=>{count++;entered();await gate;for(const [type,data] of [['turn/start',{turn:1}],['assistant/message',{turn:1,message:{content:[{type:'text',text:'{}'}]}}],['turn/end',{turn:1,reason:{kind:'completed'}}]])await h.queueDshEnvelope({payload:{type:'session/event',sessionId:p.sessionId,event:{type,data}}});return {result:{ok:true,value:{}}};};
 const first=h.taskCaps.learningPrompt('public',{key:'*'});await started;
 const second=h.taskCaps.learningPrompt('group data',{key:'group:456'});h.cfg.allow.groups=[];release();await first;
 await assert.rejects(second,/允许|撤销|权限/);assert.equal(count,1);
}));
