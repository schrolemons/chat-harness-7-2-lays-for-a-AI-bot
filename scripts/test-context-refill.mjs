import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {apply} from '../plugins/qq-agent-presets/context-composer.mjs';
import {compileModules} from '../plugins/qq-components/obs-context-assembly/policy.mjs';
import {prioritizeChatExpression} from '../plugins/qq-components/obs-context-assembly/chat-expression.mjs';
import {createPlugin} from '../plugins/qq-components/obs-context-assembly/index.js';
import {encodePacket,decodePacket} from '../plugins/qq-components/obs-context-assembly/packet.mjs';
import {secretFor,readEvidence} from '../plugins/qq-components/obs-context-assembly/store.mjs';
import {contextParts,retireDialogueTasks} from '../plugins/qq-components/obs-context-assembly/refill.mjs';
test('owned historical bridge task is removed from the projection, never from raw log or arbitrary user text',()=>{
 const text='【QQ 回合 private】\n历史桥接指令\n【新增 QQ 消息数据】\n[{"seq":1,"text":"用户原文"}]';
 const entries=[{seq:1,type:'user/message',data:{id:'owned',source:{kind:'qq-context-dialogue',seqs:[1]},content:[{type:'text',text}]}},{seq:2,type:'user/message',data:{id:'ordinary',source:{kind:'user'},content:[{type:'text',text}]}}],before=JSON.stringify(entries),changes=[];
 const session={surface:{nodes:[1,2]},eventAt:seq=>entries.find(row=>row.seq===seq)};retireDialogueTasks(session,{},(_session,seq,message)=>changes.push({seq,message}));
 assert.equal(changes.length,1);assert.equal(changes[0].seq,1);assert(!changes[0].message.content[0].text.includes('历史桥接指令'));assert(changes[0].message.content[0].text.includes('用户原文'));assert.equal(JSON.stringify(entries),before);
});

const rows=(mood='60',schedule='周五写报告')=>[
 {id:'role-card',text:'原始角色卡'},
 {id:'session-background',text:'稳定用户背景'},
 {id:'ctx-context-dynamics',text:'当前心情='+mood},
 {id:'life-schedule-reminder',text:schedule},
 {id:'wake-action',text:'处理来信'},
 {id:'message-snapshot',text:JSON.stringify({messages:[{seq:1,text:'原始来信'}],recent:[]})},
];

test('refill keeps identity stable and credentials current without repeating bootstrap background',()=>{
 const split=contextParts({id:'ctx-context-session',text:'【你的身份】小鲸鱼\n\n【会话令牌】local-token\n\n【此刻状态】未读2条'});
 assert.match(split.stable,/你的身份/);assert(!split.stable.includes('local-token'));assert.match(split.current,/会话令牌.*local-token/);assert.match(split.current,/未读2条/);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-bootstrap-refill-'));try{
  const owner=createPlugin({root,config:{},capabilities:{refreshContextModules:()=>({modules:[{id:'ctx-context-session',text:'【你的身份】小鲸鱼\n\n稳定用户背景\n\n【此刻状态】未读2条'}]})}}).services.contextAssembly;
  owner.compose({key:'private:1',sessionId:'s1',scene:'bootstrap',modules:rows(),fallback:''});const capture=readEvidence(root,'private:1');
  const envelope=encodePacket({...capture,version:1,issuedAt:Date.now()},secretFor(root));const result=owner.refresh({sessionId:'s1',envelope});
  const fresh=decodePacket(result.envelope,secretFor(root),'s1');assert(!fresh.modules.find(row=>row.id==='ctx-context-session').text.includes('稳定用户背景'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
function fixture(refresh){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-refill-')),hooks={},events=[],nodes=[];let seq=0,step=0;
 const session={id:'s1',surface:{nodes},snapshotEvents:()=>events,eventAt:n=>events.find(e=>e.seq===n),append(type,data,intent={}){
  const event={seq:++seq,type,data};events.push(event);
  if(intent.surfaceOp==='append')nodes.push(seq);else if(intent.surfaceOp?.op==='replace'){const i=nodes.indexOf(intent.surfaceOp.startSeq);assert(i>=0);nodes.splice(i,1,seq);}return event;
 }};
 const agent={id:'a1',session};apply({on(n,fn){hooks[n]=fn;}},{root,refresh});hooks['agent/created']({agent});
 const envelope=(modules=rows(),nonce='n1')=>encodePacket({version:1,key:'private:1',sessionId:'s1',nonce,scene:'message',issuedAt:Date.now(),modules},secretFor(root));
 const messages=()=>nodes.map(n=>session.eventAt(n)).flatMap(e=>e.type==='user/message'?[e.data]:[]);
 const admit=async packet=>{
  const input=packet?[{id:'u'+step,role:'user',content:[{type:'text',text:packet}]}]:[];
  for(const message of input)hooks['agent/inbox/claimed']({agent,message});
  const out=await hooks['agent/pre-step']({agent,turn:1,step},async()=>({kind:'enter',messages:input}));
  session.append('step/start',{turn:1,step});await hooks['agent/request']({agent,turn:1,step},async()=>({}));
  for(const m of out.messages)session.append('user/message',m,{surfaceOp:'append'});step++;return out;
 };
 return {root,hooks,agent,session,envelope,messages,admit,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('refill keeps current mood out of system, unwinds old voice promotion, and marks stable user data',()=>{
 const old=[{id:'role-card',text:'原始角色卡\n\n当前声音',chatExpressionBaseText:'原始角色卡'},
  {id:'ctx-context-dynamics',text:'变化记录',chatExpression:{kind:'selected-admin-style',text:'当前声音'}}];
 const result=compileModules(prioritizeChatExpression(old));
 assert.equal(result.selected.find(r=>r.id==='role-card').text,'原始角色卡');
 assert.match(result.selected.find(r=>r.id==='ctx-context-dynamics').text,/当前声音/);
 assert.equal(compileModules(rows()).selected.find(r=>r.id==='session-background').placement,'stable');
});

test('latest state appears once at the tail; superseded state stays only in the durable log',async()=>{
 let current=rows();const f=fixture(async()=>({modules:current}));try{
  await f.admit(f.envelope());
  assert.equal(f.messages()[0].source.kind,'qq-context-stable');
  await f.admit();assert.equal(f.messages().filter(m=>m.source.kind==='qq-context-latest').length,1);
  const call=f.session.append('assistant/message',{id:'call',role:'assistant',content:[{type:'tool-call',id:'c1',name:'qq_mood'}]},{surfaceOp:'append'});
  const result=f.session.append('tool/result',{id:'result',content:[{type:'tool-result',toolCallId:'c1'}]},{surfaceOp:'append'});
  current=rows('80');await f.admit();
  const visible=f.messages(),tail=visible.at(-1);assert.equal(tail.source.kind,'qq-context-latest');
  assert.match(tail.content[0].text,/当前心情=80/);assert.match(tail.content[0].text,/周五写报告/);
  assert(!JSON.stringify(visible).includes('当前心情=60'));
  assert.equal(visible.filter(m=>m.source.kind==='qq-context-latest').length,1);
  assert.equal(visible.flatMap(m=>m.content).filter(b=>b.text?.includes('原始来信')).length,1);
  assert(f.session.surface.nodes.includes(call.seq));assert(f.session.surface.nodes.includes(result.seq));assert(f.session.surface.nodes.indexOf(result.seq)<f.session.surface.nodes.at(-1));
  assert(f.session.snapshotEvents().some(e=>e.data.content?.some(b=>b.text?.includes('当前心情=60'))),'old mood remains in original events');
  current=rows('80','');await f.admit();assert(!f.messages().at(-1).content[0].text.includes('life-schedule-reminder'));
 }finally{f.close();}
});
test('bridge task occupies one replaceable slot while QQ and native tools remain durable',async()=>{
 const f=fixture(async()=>({modules:rows()}));try{
  await f.admit(f.envelope());let visible=f.messages();assert.equal(visible.filter(message=>message.source.kind==='qq-context-task').length,1);
  const dialogue=visible.find(message=>message.source.kind==='qq-context-dialogue'||message.source.baseSource?.kind==='qq-context-dialogue');assert(dialogue);assert(!dialogue.content.some(block=>block.text?.includes('处理来信')));
  const call=f.session.append('assistant/message',{id:'task-test-call',role:'assistant',content:[{type:'tool-call',id:'keep-call',name:'fixture'}]},{surfaceOp:'append'});
  const result=f.session.append('tool/result',{id:'task-test-result',role:'tool',toolCallId:'keep-call',content:[{type:'text',text:'工具原始返回'}]},{surfaceOp:'append'});
  await f.admit();visible=f.messages();assert.equal(visible.filter(message=>message.source.kind==='qq-context-task').length,1);assert.equal(visible.filter(message=>message.source.kind==='qq-context-latest').length,1);assert(f.session.surface.nodes.includes(call.seq));assert(f.session.surface.nodes.includes(result.seq));
  assert.equal(visible.reduce((count,message)=>count+message.content.filter(block=>block.text?.includes('处理来信')).length,0),1);assert(f.session.snapshotEvents().filter(event=>event.data.source?.kind==='qq-context-task').length>=2);
 }finally{f.close();}
});

test('refill restores latest state after resume and reports unavailable refresh without losing context',async()=>{
 const f=fixture(async()=>{throw Error('offline');});try{
  await f.admit(f.envelope());await f.admit();assert(f.messages().some(m=>m.content.some(b=>b.text?.includes('当前心情=60'))));
  f.hooks['llm/stream']({sessionId:'s1',messages:f.messages(),tools:[]},()=>{});
  assert.equal(readEvidence(f.root,'s1','request').contextRefresh.status,'stale');
 }finally{f.close();}
});

test('refill refresh requires the current signed session packet and only returns its own modules',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-refresh-'));try{
  let reads=0;const owner=createPlugin({root,config:{},runtime:{},capabilities:{refreshContextModules(){reads++;return {modules:[{id:'ctx-context-dynamics',text:'新心情'}]};}}}).services.contextAssembly;
  owner.compose({key:'private:1',sessionId:'s1',scene:'message',modules:rows(),fallback:'fallback'});
  const capture=readEvidence(root,'private:1');const signed=encodePacket({...capture,issuedAt:Date.now(),version:1},secretFor(root));
  assert.equal(typeof owner.refresh,'function');
  assert.equal(owner.refresh({sessionId:'other',envelope:signed}).ok,false);assert.equal(reads,0);
  assert.equal(owner.refresh({sessionId:'s1',envelope:signed.replace('原始角色卡','伪造')}).ok,false);assert.equal(reads,0);
  const output=owner.refresh({sessionId:'s1',envelope:signed});assert.equal(output.ok,true);assert.equal(reads,1);
  const packet=decodePacket(output.envelope,secretFor(root),'s1');assert.equal(packet.nonce,capture.nonce);assert.equal(packet.modules.find(r=>r.id==='ctx-context-dynamics').text,'新心情');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('each idle-to-active turn refreshes the token at the tail and refresh failure withdraws it',async()=>{
 let token='first-token',offline=false;const current=()=>[...rows(),{id:'ctx-context-session',text:'【你的身份】QQ助手\n\n【会话令牌】'+token+'\n\n【此刻状态】当前回合'}];
 const f=fixture(async()=>{if(offline)throw Error('refresh offline');return {modules:current()};});try{
  await f.admit(f.envelope(current()));assert.match(f.messages().at(-1).content[0].text,/first-token/);
  token='second-token';await f.admit(f.envelope(current(),'n2'));
  assert.doesNotMatch(JSON.stringify(f.messages()),/first-token/);assert.match(f.messages().at(-1).content[0].text,/second-token/);
  offline=true;await f.admit();assert.doesNotMatch(JSON.stringify(f.messages()),/first-token|second-token/);
  token='third-token';offline=false;await f.admit();assert.match(f.messages().at(-1).content[0].text,/third-token/);
  assert.doesNotMatch(JSON.stringify(f.messages()),/first-token|second-token/);
 }finally{f.close();}
});
