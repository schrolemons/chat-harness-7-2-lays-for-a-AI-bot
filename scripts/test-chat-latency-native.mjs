import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {apply} from '../plugins/qq-agent-presets/context-composer.mjs';
import {encodePacket} from '../plugins/qq-components/obs-context-assembly/packet.mjs';
import {secretFor} from '../plugins/qq-components/obs-context-assembly/store.mjs';
import {readFailureRun} from '../plugins/qq-components/obs-context-assembly/failure-runs.mjs';
const workspace=JSON.parse(fs.readFileSync(new URL('../workspace.local.json',import.meta.url)));
const req=createRequire(path.join(workspace.dshSourceRepository,'packages/core/agent-loop/package.json'));
const load=name=>import(pathToFileURL(req.resolve('@deepseek-ai/'+name)).href);
const [{Context},{LlmAdapter,createUserMessage,default:Llm},{SessionId,Session,default:Sessions},{default:Prompt},{defineContentToolFixture,default:Tools},{default:Agents},{default:Loop},{default:Projection}]=await Promise.all(['cordis','dsh-llm','dsh-session','dsh-system-prompt','dsh-tools','dsh-agent','dsh-agent-loop','dsh-session-projection'].map(load));

test('a tool round receives bridge-observed topic changes in its next native request without a QQ read',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-live-inbound-')),ctx=new Context();let arrived=false;
 try{
  for(const p of[Llm,Sessions,Projection,Prompt,Tools,Agents])await ctx.plugin(p);await ctx.plugin(Loop,{agents:[]});
  const modules=()=>[{id:'role-card',text:'原角色保持'},{id:'wake-action',text:'回应现在正在谈的内容，旧消息不是新任务'},{id:'message-snapshot',text:JSON.stringify({messages:[{seq:1,dialogueSeq:1,text:'之前聊预算池',bodyComplete:true},...(arrived?[{seq:2,dialogueSeq:2,text:'现在换话题：乌龙茶',bodyComplete:true}]:[])],recent:[]})}];
  apply(ctx,{root,refresh:async()=>({modules:modules()})});
  ctx.tools.register(defineContentToolFixture({name:'fixture_local_update',description:'local observation only',parameters:{},execute:()=>{arrived=true;return[{type:'text',text:'本地入站已到达'}];}}));
  class Adapter extends LlmAdapter{requests=[];async resolveModel(provider,id){return{provider,id,name:id};}async *stream(request){this.requests.push(request);const block=this.requests.length===1?{type:'tool-call',id:'observe',name:'fixture_local_update',arguments:'{}'}:{type:'text',text:'现在聊乌龙茶'};yield{type:'block-start',index:0,blockType:block.type};yield{type:'block-end',index:0,block};yield{type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};}}
  const adapter=new Adapter();ctx.llm.registerAdapter(['fixture'],adapter);const agent=await ctx.agentLoop.create(SessionId('live-topic'),{provider:'fixture',model:'fixture'});
  agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:encodePacket({version:1,sessionId:agent.id,key:'group:123',scene:'message',nonce:'live',issuedAt:Date.now(),modules:modules()},secretFor(root))}]}));await agent.whenIdle();
  assert.equal(adapter.requests.length,2);const next=adapter.requests[1].messages,text=JSON.stringify(next);assert.equal(text.split('现在换话题：乌龙茶').length-1,1);assert(next.findIndex(m=>m.role==='tool')<next.findIndex(m=>m.source?.kind==='qq-context-dialogue'&&JSON.stringify(m).includes('乌龙茶')));
  assert.deepEqual(Session.create(agent.id,structuredClone(agent.session.snapshotEvents())).deriveMessages(),agent.session.deriveMessages());assert.equal(agent.session.snapshotEvents().findLast(e=>e.type==='turn/end').data.reason.kind,'completed');
 }finally{await ctx.fiber.dispose();fs.rmSync(root,{recursive:true,force:true});}
});

test('native DSH survives three identical tool failures; content-only reduction replays',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-failure-')),ctx=new Context();
 try{
  for(const p of [Llm,Sessions,Projection,Prompt,Tools,Agents])await ctx.plugin(p);await ctx.plugin(Loop,{agents:[]});apply(ctx,{root});
  ctx.tools.register(defineContentToolFixture({name:'fixture_profile_get',description:'fixture',parameters:{},execute:()=>[{type:'text',text:'Error: expected string, received number at userId'}]}));
  class Adapter extends LlmAdapter{n=0;async resolveModel(provider,id){return {provider,id,name:id};}async *stream(){this.n++;const block=this.n<=3?{type:'tool-call',id:'fail-'+this.n,name:'fixture_profile_get',arguments:'{}'}:{type:'text',text:'已发现参数错误，停止原样重试'};yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:this.n<=3?'tool-calls':'stop'}};}}
  const adapter=new Adapter();ctx.llm.registerAdapter(['fixture'],adapter);const agent=await ctx.agentLoop.create(SessionId('failure-run'),{provider:'fixture',model:'fixture'});
  agent.followup(createUserMessage({content:[{type:'text',text:'测试重复工具错误'}],source:{kind:'user'}}));await agent.whenIdle();
  assert.equal(adapter.n,4,'fourth request still runs rather than surface replacement aborting');
  const events=agent.session.snapshotEvents(),end=events.findLast(e=>e.type==='turn/end');assert.equal(end.data.reason.kind,'completed');
  const messages=agent.session.deriveMessages(),result=messages.find(m=>m.role==='tool');assert.equal(readFailureRun(result).count,3);
  assert.deepEqual(Session.create(agent.id,events).deriveMessages(),messages);assert.equal(events.filter(e=>e.type==='tool/result'&&e.data.message.content[0]?.text==='Error: expected string, received number at userId').length,3,'original attempts remain in journal');
 }finally{await ctx.fiber.dispose();fs.rmSync(root,{recursive:true,force:true});}
});

test('native QQ history retires old internal narration while preserving actual dialogue and tool pairs',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-narration-')),ctx=new Context();
 try{
  for(const p of [Llm,Sessions,Projection,Prompt,Tools,Agents])await ctx.plugin(p);await ctx.plugin(Loop,{agents:[]});apply(ctx,{root,refresh:async()=>null});
  ctx.tools.register(defineContentToolFixture({name:'mcp__snowluma__qq_send_message',description:'isolated; sends nothing',parameters:{},execute:()=>[{type:'text',text:'{"ok":true,"sent":1}'}]}));
  class Adapter extends LlmAdapter{requests=[];call=true;async resolveModel(provider,id){return {provider,id,name:id};}async *stream(request){this.requests.push(request);const block=this.call?{type:'tool-call',id:'call-'+this.requests.length,name:'mcp__snowluma__qq_send_message',arguments:'{}'}:{type:'text',text:'内部复盘长文-'+this.requests.length};this.call=!this.call;const index=block.type==='tool-call'?1:0;if(index){yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'调用前说明，混合文字与工具'}};}yield {type:'block-start',index,blockType:block.type};yield {type:'block-end',index,block};yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};}}
  const adapter=new Adapter();ctx.llm.registerAdapter(['fixture'],adapter);const agent=await ctx.agentLoop.create(SessionId('narration'),{provider:'fixture',model:'fixture'});
  for(let n=1;n<=5;n++){
   const envelope=encodePacket({version:1,sessionId:agent.id,key:'private:10001',scene:'message',nonce:'n'+n,issuedAt:Date.now(),modules:[{id:'role-card',text:'原始人设不改'},{id:'wake-action',text:'回应当前消息'},{id:'message-snapshot',text:JSON.stringify({messages:[{seq:n,dialogueSeq:n,text:'真实用户原文-'+n}],recent:[]})}]},secretFor(root));
   agent.followup(createUserMessage({content:[{type:'text',text:envelope}],source:{kind:'user'}}));await agent.whenIdle();
  }
  const events=agent.session.snapshotEvents(),messages=agent.session.deriveMessages(),text=JSON.stringify(messages);
  for(let n=1;n<=5;n++)assert(text.includes('真实用户原文-'+n));
  assert(!text.includes('内部复盘长文-2'));assert(!text.includes('内部复盘长文-8'));assert(text.includes('内部复盘长文-10'),'current turn narration remains intact');
  assert(events.some(e=>JSON.stringify(e).includes('内部复盘长文-2')),'original narration remains recoverable');
  assert.equal(messages.filter(m=>m.role==='tool').length,5);assert.equal(messages.flatMap(m=>m.content||[]).filter(b=>b.type==='tool-call').length,5);
  assert.equal(messages.filter(m=>m.role==='assistant'&&m.content?.some(b=>b.type==='text'&&b.text==='调用前说明，混合文字与工具')).length,5,'mixed text/tool messages preserve the native provider stream');
  assert(events.filter(e=>e.type==='assistant/message').every(e=>e.sourceEventSeqs===undefined),'assistant events never cite sourceEventSeqs');
  assert.deepEqual(Session.create(agent.id,events).deriveMessages(),messages);
 }finally{await ctx.fiber.dispose();fs.rmSync(root,{recursive:true,force:true});}
});
