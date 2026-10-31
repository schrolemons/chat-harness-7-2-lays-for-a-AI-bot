// Uses the local DSH runtime libraries with a scripted adapter: no API/QQ/network call.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {apply} from '../plugins/qq-agent-presets/context-composer.mjs';
import {encodePacket} from '../plugins/qq-components/obs-context-assembly/packet.mjs';
import {secretFor,readEvidence} from '../plugins/qq-components/obs-context-assembly/store.mjs';
const workspace=JSON.parse(fs.readFileSync(new URL('../workspace.local.json',import.meta.url)));
const require=createRequire(path.join(workspace.dshSourceRepository,'packages/core/agent-loop/package.json'));
const load=specifier=>import(pathToFileURL(require.resolve(specifier)).href);
const [{Context},{default:AgentRegistry},{default:AgentLoop},{default:LlmRuntime,LlmAdapter,createUserMessage},{default:SessionStore,SessionId,Session},{default:SystemPrompt},{default:ToolRuntime,defineContentToolFixture},{default:Projection}]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-agent-loop','@deepseek-ai/dsh-llm','@deepseek-ai/dsh-session','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-session-projection'].map(load));
const {assertReleasedV4Relationships}=await import(pathToFileURL(path.join(workspace.dshSourceRepository,'packages/session/session-format-v3-to-v4/lib/index.js')).href);
const {KNOWN_SESSION_EVENT_TYPES}=await load('@deepseek-ai/dsh-session');
class Adapter extends LlmAdapter{requests=[];toolOnce=false;async resolveModel(provider,id){return {provider,id,name:id,systemPromptUpdate:'in-history'};}async *stream(options){this.requests.push(options);if(this.toolOnce){this.toolOnce=false;yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block:{type:'tool-call',id:'fixture-call-'+this.requests.length,name:'fixture_update_context',arguments:'{}'}};yield {type:'finish',reason:{kind:'tool-calls'}};return;}yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'ok'};yield {type:'block-end',index:0,block:{type:'text',text:'ok'}};yield {type:'finish',reason:{kind:'stop'}};}}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-real-dsh-context-')),ctx=new Context(),persistenceCtx=new Context();let persistedEvents=0;
const {default:NativePersistence}=await import(pathToFileURL(path.join(workspace.dshSourceRepository,'packages/session/session-persistence-jsonl/lib/index.js')).href);
try{
 await persistenceCtx.plugin(NativePersistence,{root:path.join(root,'persisted'),compression:'zstd'});
 for(const plugin of [LlmRuntime,SessionStore,Projection,SystemPrompt,ToolRuntime,AgentRegistry])await ctx.plugin(plugin);
 let dynamicModules=null;
 await ctx.plugin(AgentLoop,{agents:[]});apply(ctx,{root,refresh:async()=>dynamicModules?{modules:dynamicModules}:null});
 const adapter=new Adapter();ctx.llm.registerAdapter(['fixture-context'],adapter);
 const agent=await ctx.agentLoop.create(SessionId('context-admission'),{provider:'fixture-context',model:'fixture'});
 let reconstructed=0;
 ctx.on('llm/stream',(request,next)=>{if(request.sessionId===agent.id){assert.deepEqual(Session.create(agent.id,agent.session.snapshotEvents()).deriveMessages(),request.messages,'dispatch-time durable replay equals frozen model request');reconstructed++;}return next();});
 for(let i=1;i<=3;i++){
  const body={version:1,sessionId:agent.session.id,key:'private:21001',scene:'timeBubble',nonce:'n'+i,issuedAt:Date.now(),modules:[{id:'role-card',text:'固定双形态设定，一份保留。'},{id:'session-background',text:'特别背景，一份保留。'},{id:'ctx-user-mood',text:'本轮心情 '+i},{id:'wake-action',text:'第 '+i+' 次主动开口'},{id:'message-snapshot',text:JSON.stringify({messages:[{seq:1,text:'不应重复的真实用户消息'}],recent:[],unreadCount:0})}]};
  agent.followup(createUserMessage({content:[{type:'text',text:encodePacket(body,secretFor(root))}],source:{kind:'user'}}));await agent.whenIdle();
  assert.equal(adapter.requests.length,i,'each round reaches scripted provider once');
  assertReleasedV4Relationships({header:agent.session.header,events:agent.session.snapshotEvents(),inheritedEventCount:0},KNOWN_SESSION_EVENT_TYPES);
  const persistence=persistenceCtx.sessionPersistence,write=i===1?await persistence.create(agent.session.header):await persistence.open(agent.id,'write');
  try{await write.append(agent.session.snapshotEvents().slice(persistedEvents));persistedEvents=agent.session.snapshotEvents().length;}finally{await write.close();}
  const read=await persistence.open(agent.id,'read');try{assert.deepEqual((await read.read()).events,agent.session.snapshotEvents(),'native compressed log reopens with identical events');}finally{await read.close();}
  const request=adapter.requests.at(-1),serialized=JSON.stringify(request.messages);
  assert.equal(serialized.split('固定双形态设定').length-1,1);assert.equal(serialized.split('特别背景').length-1,1);
  assert.equal(serialized.split('不应重复的真实用户消息').length-1,1);assert.equal(serialized.split('本轮心情').length-1,1,'only latest state enters model input');
  assert.ok(!serialized.includes('signature'));assert.ok(serialized.includes('本轮心情 '+i));
  assert.ok(!request.messages.some(m=>m.role==='user'&&m.content.length===0),'no empty provider user turns');
 }
 const original=agent.session.snapshotEvents().filter(e=>e.type==='agent/inbox/spliced'&&e.data.inserted?.some(m=>JSON.stringify(m).includes('signature')));assert.equal(original.length,3,'all raw signed inputs remain in original log');
 assert.equal(readEvidence(root,agent.id,'request').nonce,'n3');
 assert.equal(reconstructed,3);
 ctx.tools.register(defineContentToolFixture({name:'fixture_update_context',description:'隔离测试：更新心情并撤回日程',parameters:{},async execute(){dynamicModules=dynamicModules.map(row=>row.id==='ctx-context-dynamics'?{...row,text:'当前心情=80，完整形态示范'}:row.id==='life-schedule-reminder'?{...row,text:''}:row.id==='ctx-context-session'?{...row,text:'【你的身份】QQ助手\n\n【会话令牌】rotated-test-token'}:row);return [{type:'text',text:'已更新心情并取消日程'}];}}));
 for(const kind of ['private','group']){
  const subject=await ctx.agentLoop.create(SessionId('refill-'+kind),{provider:'fixture-context',model:'fixture'});
  dynamicModules=[{id:'role-card',text:'不可改写的原始角色'},{id:'session-background',text:'稳定用户资料'},
   {id:'ctx-context-dynamics',text:'当前心情=60，完整形态示范'},{id:'life-schedule-reminder',text:'明天写报告'},
   {id:'ctx-context-session',text:'【你的身份】QQ助手\n\n【会话令牌】initial-test-token'},
   {id:'wake-action',text:'处理模拟来信'},{id:'message-snapshot',text:JSON.stringify({messages:[{seq:7,text:'请更改心情与日程'}],recent:[]})}];
  const input=nonce=>createUserMessage({content:[{type:'text',text:encodePacket({version:1,key:kind+':100001',sessionId:subject.id,nonce,scene:'message',modules:dynamicModules,issuedAt:Date.now()},secretFor(root))}],source:{kind:'user'}});
  const start=adapter.requests.length;adapter.toolOnce=true;subject.followup(input('first'));await subject.whenIdle();
  assert.equal(adapter.requests.length,start+2,'tool chain performs two model requests');
  const last=adapter.requests.at(-1),toolIndex=last.messages.findIndex(m=>m.role==='tool'),updateIndex=last.messages.findLastIndex(m=>m.source?.kind==='qq-context-latest');
  assert(toolIndex>=0&&updateIndex>toolIndex,'fresh dynamic state follows the complete tool result');
  assert(last.messages.at(updateIndex).content[0].text.includes('rotated-test-token'));assert(!JSON.stringify(last.messages).includes('initial-test-token'));assert(!JSON.stringify(last.messages.filter(m=>m.source?.kind==='qq-context-stable')).includes('rotated-test-token'));
  assert(last.messages.at(updateIndex).content[0].text.includes('当前心情=80'));assert(!last.messages.at(updateIndex).content[0].text.includes('周五写报告'));
  assert(!JSON.stringify(last.messages.filter(m=>m.role==='system')).includes('当前心情='));
  assert.deepEqual(Session.create(subject.id,subject.session.snapshotEvents()).deriveMessages(),last.messages.concat(subject.session.deriveMessages().slice(last.messages.length)),'native session remains replayable after tool loop');
  subject.followup(input('second'));await subject.whenIdle();assert.equal(adapter.requests.length,start+3);
  const next=adapter.requests.at(-1),updates=next.messages.filter(m=>m.source?.kind==='qq-context-latest');
  assert.equal(updates.length,1,'one complete latest snapshot replaces previous snapshots');
  assert.equal(JSON.stringify(next.messages).split('请更改心情与日程').length-1,1,'same QQ seq is never admitted twice');
  dynamicModules=dynamicModules.map(row=>row.id==='message-snapshot'?{...row,text:JSON.stringify({messages:[{seq:8,text:'工具之后的第二条来信'}],recent:[]})}:row);subject.followup(input('third'));await subject.whenIdle();
  const timeline=adapter.requests.at(-1).messages,oldChat=timeline.findIndex(row=>row.source?.kind==='qq-context-dialogue'&&JSON.stringify(row).includes('请更改心情与日程')),call=timeline.findIndex(row=>(row.content||[]).some(block=>block.type==='tool-call')),returned=timeline.findIndex(row=>row.role==='tool'),newChat=timeline.findIndex(row=>row.source?.kind==='qq-context-dialogue'&&JSON.stringify(row).includes('工具之后的第二条来信'));
  assert(oldChat>=0&&oldChat<call&&call<returned&&returned<newChat,'actual messages keep QQ → memory/state tool call → result → next QQ; never group all tools separately');
  assertReleasedV4Relationships({header:subject.session.header,events:subject.session.snapshotEvents(),inheritedEventCount:0},KNOWN_SESSION_EVENT_TYPES);
 }
 console.log('PASS real DSH admission: 11 requests across private/group, interleaved QQ/tool history, tool-result-before-state-update, latest-only tail, stable prefix, no duplicate QQ text; durable replay and native compressed log reopen identical; zero network calls');
}finally{await ctx.fiber.dispose();await persistenceCtx.fiber.dispose();fs.rmSync(root,{recursive:true,force:true});}
