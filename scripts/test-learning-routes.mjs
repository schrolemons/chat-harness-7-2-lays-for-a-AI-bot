import test from 'node:test';import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
async function withBridge(run){
 const h=await bridgeHarness({config:{slang:{enabled:true,learnerPreset:'qq-learning'}}});h.setMode('reserved2');h.setReady(true);h.setPresets(['standard','qq-chat','qq-chat-v2','qq-learning']);
 const st=h.getSocialV2State('group:456'),server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const request=async(route,{body,token=st.agentToken}={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/'+route+(body?'':'?key=group:456'),{method:body?'POST':'GET',headers:{'x-console-token':'fixture-console-token','x-agent-token':token,'content-type':'application/json'},...(body?{body:JSON.stringify({key:'group:456',...body})}:{})});return {status:r.status,data:await r.json()};};
 try{await run(h,request);}finally{await new Promise(r=>server.close(r));await h.close();}
}
test('alias HTTP submission accepts unbound suspects while query excludes unconfirmed identities',()=>withBridge(async(h,request)=>{
 const r=await request('alias/submit',{body:{alias:'候选猫',note:'你去问问候选猫'}});assert.equal(r.data.result.ok,true);
 const q=await request('alias/query');assert.equal(q.data.entries.length,0);
}));
test('term routes bind scope and candidate status on the server, enforce tokens and tool switches',()=>withBridge(async(h,request)=>{
 let r=await request('term/submit',{body:{term:'撤离路线',topic:'三角洲行动',status:'confirmed',sourceKey:'group:789',summary:'玩法知识'}});
 assert.equal(r.status,200);const list=await h.pluginHost.callTool('term_list',{});assert.equal(list.result.entries[0].status,'candidate');assert.equal(list.result.entries[0].originKey,'group:456');
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
 await h.pluginHost.callTool('alias_submit',{alias:'测试猫',qq:'123456789',key:'group:789',note:'B_GROUP_PRIVATE_EVIDENCE'});
 const r=await request('alias/submit',{body:{alias:'测试猫',qq:'123456789',note:'A_GROUP_CONTEXT'}});
 assert.equal(r.status,200);assert.doesNotMatch(JSON.stringify(r.data),/B_GROUP_PRIVATE_EVIDENCE|group:789|evidence/);
}));
test('agent requests cannot approve learning candidates through the generic plugin endpoint',()=>withBridge(async h=>{
 const st=h.getSocialV2State('group:456');const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 try{
   const entry=(await h.pluginHost.callTool('alias_submit',{alias:'待审核',qq:'123456789',key:'group:456'})).result.entry;
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

test('learning queries and source edits share exact-match rules and cannot cross token scope',()=>withBridge(async(h)=>{
 const current='group:456',other='group:789',st=h.getSocialV2State(current),foreign=h.getSocialV2State(other);h.cfg.allow.groups.push(789);
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const call=async(path,body,token=st.agentToken)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/socialV2/'+path,{method:body?'POST':'GET',headers:{'x-console-token':'fixture-console-token','x-agent-token':token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 try{
 const term=(await h.pluginHost.callTool('term_save',{key:other,term:'Rust',topic:'编程',summary:'已确认语言知识',status:'confirmed',sourceKeys:[other],context:'PRIVATE PROOF'})).result.entry;
 const alias=(await h.pluginHost.callTool('alias_add',{key:other,alias:'测试猫',qq:'123456789',sourceKeys:[other],note:'PRIVATE NOTE'})).result.entry;
 h.taskCaps.slangSave([{id:'slang-test',content:'测试梗',meaning:'已确认梗含义',status:'confirmed',sourceKeys:[other],originKey:other,evidence:[{key:other,text:'PRIVATE EVIDENCE'}]}]);
 for(const [kind,q,id]of [['term','Rust',term.id],['alias','123456789',alias.id],['slang','测试梗','slang-test']]){
   const endpoint=kind+'/query?key='+current+'&q=';
   assert.equal((await call(endpoint)).data.entries.length,0);
   const exact=await call(endpoint+encodeURIComponent(q));assert.equal(exact.status,200,JSON.stringify(exact.data));assert.equal(exact.data.entries.length,1);
   assert.doesNotMatch(JSON.stringify(exact.data),/PRIVATE|group:789|sourceKeys|originKey|evidence/);
   const patch={key:current,kind,id,action:'include_here',sourceKeys:['group:999']};
   const included=await call('knowledge-sources',patch);assert.equal(included.status,200,JSON.stringify(included.data));assert.equal(included.data.appliesHere,true);
   assert.equal((await call(endpoint)).data.entries.length,1);
   assert.equal((await call('knowledge-sources',{...patch,key:other})).status,403);
   const removed=await call('knowledge-sources',{...patch,action:'exclude_here'});assert.equal(removed.data.appliesHere,false);assert.equal((await call(endpoint)).data.entries.length,0);
 }
 const stored=(await h.pluginHost.callTool('term_list',{})).result.entries.find(e=>e.id===term.id);assert.deepEqual(stored.sourceKeys,[other]);assert.equal(stored.originKey,other);assert.equal(stored.evidence[0].text,'PRIVATE PROOF');
 h.cfg.socialV2.tools.learningSources=false;assert.equal((await call('knowledge-sources',{key:current,kind:'term',id:term.id,action:'include_here'})).status,403);
 h.cfg.socialV2.tools.termQuery=false;assert.equal((await call('term/query?key='+current+'&q=Rust')).status,403);
 assert.equal((await call('term/query?key='+other+'&q=Rust',undefined,foreign.agentToken)).status,403);
 }finally{await new Promise(r=>server.close(r));}
}));

test('manual slang confirmation preserves multiple sources and rejects invalid sources atomically',()=>withBridge(async h=>{
 h.taskCaps.slangSave([{id:'slang-admin',content:'测试原词',meaning:'',status:'candidate',originKey:'group:789',sourceKeys:['group:789'],evidence:[{key:'group:789',text:'原始证据'}]}]);
 const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const confirm=async body=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/slang/slang-admin/confirm',{method:'POST',headers:{'x-console-token':'fixture-console-token','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
 const status=await fetch('http://127.0.0.1:'+server.address().port+'/api/learning/sources',{headers:{'x-console-token':'fixture-console-token'}});assert.equal((await status.json()).scopeVersion,1);
 const added=await fetch('http://127.0.0.1:'+server.address().port+'/api/slang',{method:'POST',headers:{'x-console-token':'fixture-console-token','content-type':'application/json'},body:JSON.stringify({content:'新来源词',meaning:'已确认释义',sourceKeys:['group:456','private:123']})});assert.equal(added.status,200);const fresh=(await added.json()).entry;assert.deepEqual(fresh.sourceKeys,['group:456','private:123']);
 const bad=await confirm({meaning:'无效输入不能写入',sourceKeys:['*']});assert.equal(bad.status,400);assert.equal(h.taskCaps.slangList()[0].meaning,'');assert.equal(h.taskCaps.slangList()[0].status,'candidate');
 const good=await confirm({meaning:'确认含义',sourceKeys:['group:456','private:123']});assert.equal(good.status,200,JSON.stringify(good.data));assert.deepEqual(Array.from(h.taskCaps.slangList()[0].sourceKeys),['group:456','private:123']);assert.equal(h.taskCaps.slangList()[0].originKey,'group:789');
 }finally{await new Promise(r=>server.close(r));}
}));

test('real wake assembly retains source-scoped knowledge and exact-match tool hints',()=>withBridge(async h=>{
 const key='group:456';await h.pluginHost.callTool('term_save',{term:'本地术语',topic:'测试',summary:'LOCAL_TERM_ONLY',status:'confirmed',sourceKeys:[key]});
 await h.pluginHost.callTool('term_save',{term:'Rust',topic:'编程',summary:'FOREIGN_TERM_HIDDEN',status:'confirmed',sourceKeys:['group:789']});
 await h.pluginHost.callTool('alias_add',{alias:'外群绰号',qq:'123456789',sourceKeys:['group:789']});
 h.taskCaps.slangSave([{id:'slang-live-test',content:'外群梗',meaning:'FOREIGN_SLANG_HIDDEN',status:'confirmed',sourceKeys:['group:789']}]);
 h.appendSocialV2Message(key,'测试用户','想问Rust和外群梗','想问Rust和外群梗',false,false,'learning-msg',[],'123456789',[]);
 const prompt=h.buildWakePromptV2(key,'message');assert.match(prompt,/LOCAL_TERM_ONLY/);assert.match(prompt,/qq_term_query\(key,token,q="Rust"\)/);assert.match(prompt,/qq_alias_query\(key,token,q="123456789"\)/);assert.doesNotMatch(prompt,/FOREIGN_TERM_HIDDEN/);
 const slang=h.pluginHost.callService('slang','contextBlock',{key,incomingText:'想问Rust和外群梗'});assert.match(slang,/qq_slang_query/);assert.doesNotMatch(slang,/FOREIGN_SLANG_HIDDEN/);
}));
