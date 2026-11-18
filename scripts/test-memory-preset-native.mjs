import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import yaml from 'js-yaml';
const workspace=JSON.parse(fs.readFileSync(new URL('../workspace.local.json',import.meta.url)));
const requireHost=createRequire(path.join(workspace.dshSourceRepository,'packages/core/agent-loop/package.json'));
const hostImport=name=>import(pathToFileURL(requireHost.resolve(name)).href);
import * as MemoryGuard from '../plugins/qq-agent-presets/memory-tool-restrict.mjs';
const [{Context},{LlmAdapter,createUserMessage,default:Llm},{SessionId,default:Sessions},{default:Prompt},{default:Tools},{default:Agents},{default:Loop},{default:Projection}]=await Promise.all(['cordis','dsh-llm','dsh-session','dsh-system-prompt','dsh-tools','dsh-agent','dsh-agent-loop','dsh-session-projection'].map(n=>hostImport('@deepseek-ai/'+n)));
test('native DSH model assembly gives memory agents zero tools even with inherited team registrations',async()=>{
 const ctx=new Context();try{
  for(const plugin of [Llm,Sessions,Projection,Prompt,Tools,Agents])await ctx.plugin(plugin);
  await ctx.plugin(Loop,{agents:[]});
  for(const name of ['spawn_teammate','team_task_create'])ctx.tools.register({name,description:'inherited fixture',parameters:{type:'object'},output:{schema:{type:'object'},render:()=>[]},execute(){assert.fail('memory worker cannot execute tools');}});
  const inherited=ctx.tools.schemas();
  ctx.systemPrompt.section({name:'fixture-team-policy',order:600,text:'TEAM_POLICY_MUST_NOT_ENTER_MEMORY'});
  ctx.systemPrompt.context({name:'fixture-runtime-context',order:100,text:'RUNTIME_WORKSPACE_MUST_NOT_ENTER_MEMORY'});
  ctx.on('agent/pre-step',async(_p,next)=>{const d=await next();return {...d,messages:[...d.messages,createUserMessage({source:{kind:'agent-instructions',baseline:true},content:[{type:'text',text:'WORKSPACE_INSTRUCTIONS_MUST_NOT_ENTER_MEMORY: act as team lead and edit files'}]})]};});
  ctx.on('system-prompt/assemble',async(_a,_s,next)=>{const result=await next();return {...result,tools:inherited};});
  class Adapter extends LlmAdapter{requests=[];async resolveModel(provider,id){return {provider,id,name:id};}async *stream(request){this.requests.push(request);yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'{"memory":"draft"}'};yield {type:'block-end',index:0,block:{type:'text',text:'{"memory":"draft"}'}};yield {type:'finish',reason:{kind:'stop'}};}}
  const adapter=new Adapter();ctx.llm.registerAdapter(['fixture-memory'],adapter);
  const agent=await ctx.agentLoop.create(SessionId('isolated-memory-worker'),{provider:'fixture-memory',model:'fixture'});
  const persona=yaml.load(fs.readFileSync(new URL('../dsh/agent-presets/qq-memory-worker/agent.cordis.yml',import.meta.url),'utf8'))[0];
  await agent.ctx.plugin(await import(pathToFileURL(path.join(workspace.dshSourceRepository,'packages/preset/persona/lib/index.js')).href),persona.config);
  await agent.ctx.plugin(MemoryGuard);
  agent.followup(createUserMessage({content:[{type:'text',text:'只整理给定资料'}],source:{kind:'user'}}));await agent.whenIdle();
  assert.equal(adapter.requests.length,1);assert.deepEqual(adapter.requests[0].tools||[],[]);
  const rendered=JSON.stringify(adapter.requests[0].messages);
  assert.match(rendered,/独立的QQ会话资料整理代理/);
  assert.match(rendered,/记忆整理、图片事实提取或聊天忙闲评估/);
  assert.doesNotMatch(rendered,/TEAM_POLICY_MUST_NOT_ENTER_MEMORY|RUNTIME_WORKSPACE_MUST_NOT_ENTER_MEMORY|WORKSPACE_INSTRUCTIONS_MUST_NOT_ENTER_MEMORY/);
  const main=await ctx.agentLoop.create(SessionId('ordinary-chat-agent'),{provider:'fixture-memory',model:'fixture'});
  main.followup(createUserMessage({content:[{type:'text',text:'主会话继续工作'}],source:{kind:'user'}}));await main.whenIdle();
  assert.equal(adapter.requests[1].tools.length,2,'memory isolation never removes ordinary agent tools');
 }finally{await ctx.fiber.dispose();}
});
