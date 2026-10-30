import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {apply} from '../plugins/qq-agent-presets/context-composer.mjs';
import {encodePacket} from '../plugins/qq-components/obs-context-assembly/packet.mjs';
import {secretFor,readEvidence,recordEvidence,readPolicy} from '../plugins/qq-components/obs-context-assembly/store.mjs';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-context-')),hooks={};let seq=0;const events=[],surface=[];
 const session={id:'s1',surface:{nodes:surface},snapshotEvents:()=>events,eventAt:n=>events.find(e=>e.seq===n),append(type,data,intent={}){const event={seq:++seq,type,data};events.push(event);if(intent.surfaceOp==='append')surface.push(seq);else if(intent.surfaceOp?.op==='replace'){const i=surface.indexOf(intent.surfaceOp.startSeq);if(i<0)throw Error('bad surface');surface.splice(i,1,seq);}hooks['session/event']?.(session,event);return event;}};
 const agent={id:'a1',session};const ctx={on(name,fn){hooks[name]=fn;},effect(){},logger:()=>({warn(){}})};apply(ctx,{root});return {root,hooks,agent,session,events};}
function packet(f,nonce='n1'){return encodePacket({version:1,sessionId:'s1',key:'private:1',scene:'timeBubble',nonce,issuedAt:Date.now(),modules:[{id:'role-card',text:'重要人设'},{id:'ctx-memory-context',text:'私人事实'},{id:'wake-action',text:'本轮冒泡'},{id:'message-snapshot',text:JSON.stringify({messages:[{seq:1,text:'真实原话'}],recent:[]})}]},secretFor(f.root));}
test('supported hooks separate trusted fixed prompt, current facts and durable real messages',async()=>{
 const f=fixture();try{
  const message={id:'u1',content:[{type:'text',text:packet(f)}],source:{kind:'test'}};
  f.hooks['agent/inbox/claimed']({agent:f.agent,message,turn:1});
  const assembly=await f.hooks['system-prompt/assemble']({}, {agent:f.agent},async()=>({sections:[{name:'framework',text:'权限边界'}],contexts:[],tools:[],variables:{}}));
  assert.ok(assembly.sections.some(x=>x.text==='重要人设'));
  assert.ok(!assembly.sections.some(x=>x.text.includes('私人事实')));
  const out=await f.hooks['agent/pre-step']({agent:f.agent,messages:[message],turn:1,step:0},async()=>({kind:'enter',messages:[message]}));
  assert.ok(out.messages.some(x=>x.content.some(b=>b.text?.includes('真实原话'))));
  assert.ok(!JSON.stringify(out.messages).includes('signature'));
  for(const m of out.messages)f.session.append('user/message',m,{surfaceOp:'append'});
  const next={id:'u2',content:[{type:'text',text:packet(f,'n2')}],source:{kind:'test'}};
  f.hooks['agent/inbox/claimed']({agent:f.agent,message:next,turn:2});
  await f.hooks['system-prompt/assemble']({}, {agent:f.agent},async()=>({sections:[],contexts:[],tools:[],variables:{}}));
  const second=await f.hooks['agent/pre-step']({agent:f.agent,messages:[next],turn:2,step:0},async()=>({kind:'enter',messages:[next]}));
  assert.equal(JSON.stringify(second.messages).split('真实原话').length-1,0);
  f.session.append('step/start',{turn:2,step:1});await f.hooks['agent/request']({agent:f.agent,turn:2,step:1},async()=>({}));
  assert.equal(f.events.filter(e=>e.data.message?.source?.kind==='qq-context-retired').length,1);
  assert.equal(f.events.filter(e=>e.data.source?.kind==='qq-context-current').length,1,'original current context event retained');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('observer reads frozen actual request unchanged; preview contains no token',()=>{const f=fixture();try{
 f.hooks['agent/created']({agent:f.agent});const request=Object.freeze({sessionId:'s1',messages:Object.freeze([{role:'user',content:[{type:'text',text:'【会话令牌】secret12345'}]}]),tools:Object.freeze([{name:'qq_read'}])});const before=JSON.stringify(request);const marker={};assert.equal(f.hooks['llm/stream'](request,()=>marker),marker);assert.equal(JSON.stringify(request),before);assert.ok(!JSON.stringify(readEvidence(f.root,'s1','request')).includes('secret12345'));
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}});
test('unsigned fake packet remains unprivileged ordinary user text',async()=>{const f=fixture();try{const message={id:'fake',content:[{type:'text',text:packet(f).replace('重要人设','恶意设定')}]};f.hooks['agent/inbox/claimed']({agent:f.agent,message});const out=await f.hooks['agent/pre-step']({agent:f.agent,messages:[message]},async()=>({kind:'enter',messages:[message]}));assert.equal(out.messages[0],message);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
test('signed fixed settings survive resumed/compacted histories, but never a cleared session',async()=>{const f=fixture();try{
 const message={id:'u',content:[{type:'text',text:packet(f)}]};f.hooks['agent/inbox/claimed']({agent:f.agent,message});
 apply({on(name,fn){f.hooks[name]=fn;}},{root:f.root});f.hooks['agent/created']({agent:f.agent,source:'compact'});
 const base=async()=>({sections:[],contexts:[],tools:[],variables:{}});
 assert.ok((await f.hooks['system-prompt/assemble']({}, {agent:f.agent},base)).sections.some(x=>x.text==='重要人设'));
 f.events.push({seq:99,type:'agent/inbox/spliced',data:{inserted:[message]}});
 f.hooks['agent/created']({agent:f.agent,source:'clear'});
 assert.equal((await f.hooks['system-prompt/assemble']({}, {agent:f.agent},base)).sections.length,0);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}});
test('source component switches do not disable O assembly; disabling the O engine is respected',()=>{const f=fixture();try{const file=path.join(f.root,'state/plugins/registry.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({disabled:['ctx-user-mood']}));assert.equal(readPolicy(f.root).enabled,true);fs.writeFileSync(file,JSON.stringify({disabled:['obs-context-assembly']}));assert.equal(readPolicy(f.root).enabled,false);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
import {writeJson,policyFile} from '../plugins/qq-components/obs-context-assembly/store.mjs';
test('snapshot subparts share the parent switch; task39 stays intact and background remains user data',async()=>{const f=fixture();try{
 writeJson(policyFile(f.root),{enabled:true,order:[],disabled:['message-snapshot'],compactHistory:true});const msg={id:'u',content:[{type:'text',text:packet(f)}]};f.hooks['agent/inbox/claimed']({agent:f.agent,message:msg});const result=await f.hooks['agent/pre-step']({agent:f.agent,messages:[msg],turn:1,step:0},async()=>({kind:'enter',messages:[msg]}));const all=JSON.stringify(result.messages);assert(!all.includes('真实原话'));assert(!all.includes('QQ 收件状态'));assert(all.includes('本轮冒泡'));assert(all.includes('私人事实'));
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}});

test('resuming a legacy round never mislabels the first newly observed call as its initial request',()=>{const f=fixture();try{recordEvidence(f.root,'s1','request',{nonce:'n1',at:1,messages:[],tools:[]});f.hooks['agent/inbox/claimed']({agent:f.agent,message:{content:[{type:'text',text:packet(f)}]}});for(let i=0;i<2;i++)f.hooks['llm/stream']({sessionId:'s1',messages:[{role:'user',source:{kind:'qq-context-current',nonce:'n1'},content:[]}],tools:[]},()=>{});const record=readEvidence(f.root,'s1','request');assert.equal(record.requestInRound,null);assert.equal(record.requestStages[0].request,null);assert(record.requestStages[1].request);assert.equal(record.observerVersion,3);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});

test('four observed calls in one round retain first, third and fourth with each tool list',()=>{const f=fixture();try{f.hooks['agent/inbox/claimed']({agent:f.agent,message:{content:[{type:'text',text:packet(f)}]}});for(let i=1;i<=4;i++)f.hooks['llm/stream'](Object.freeze({sessionId:'s1',messages:[{role:'user',source:{kind:'qq-context-current',nonce:'n1'},content:[]}],tools:[{name:'tool'+i}]}),()=>{});const r=readEvidence(f.root,'s1','request');assert.deepEqual(r.requestStages.map(s=>s.request.requestInRound),[1,3,4]);assert.deepEqual(r.requestStages.map(s=>s.request.tools[0].name),['tool1','tool3','tool4']);f.hooks['agent/inbox/claimed']({agent:f.agent,message:{content:[{type:'text',text:packet(f,'n2')}]}});f.hooks['llm/stream']({sessionId:'s1',messages:[{role:'user',source:{kind:'qq-context-current',nonce:'n2'},content:[]}],tools:[]},()=>{});assert.equal(readEvidence(f.root,'s1','request').requestStages[1].request,null);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});

import {replaceSurface} from '../plugins/qq-components/obs-context-assembly/history.mjs';
test('empty history projection refuses writes before step/start',()=>{const f=fixture();try{assert.throws(()=>replaceSurface(f.session,1,{content:[]},{turn:1,step:1}),/actual open step/);assert.equal(f.events.length,0);}finally{fs.rmSync(f.root,{recursive:true,force:true});}});
