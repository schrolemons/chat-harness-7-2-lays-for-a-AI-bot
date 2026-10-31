// Opt-in paid-model probe. Synthetic balances and in-memory sends; never sends QQ.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createPlugin as balancePlugin,resolveApiKey} from '../plugins/qq-components/tool-deepseek-balance/index.js';
import {createPlugin as dynamicsPlugin} from '../plugins/qq-components/ctx-context-dynamics/index.js';
import {createPlugin as stylePlugin} from '../plugins/qq-components/ctx-chat-style/index.js';
import {selectRoleText} from '../src/role-card.js';
import yaml from 'js-yaml';
function verifyEvidence(evidence){
 assert(evidence.roleUnchanged,'Role source must remain unchanged');
 assert(evidence.cases.length===(evidence.expectedCases||3),'All selected scenarios must be recorded');
 for(const c of evidence.cases){
  assert(c.queried&&c.sent&&!c.error,'Model must choose the balance tool and deliver');
  assert.equal(c.calls.filter(v=>v.tool==='deepseek_balance').length,1,'No repeated balance query');
  assert.equal(c.history.filter(m=>m.role==='tool'&&m.isError).length,0,'No execution failures');
  const spoken=c.deliveries.join('\n');
  if(c.public){assert(!JSON.stringify(c.calls.filter(v=>v.tool==='deepseek_balance')).includes(c.after),'Public tool result must hide exact amount');assert(c.notes?.length===1,'One generated milk note must be recorded');}
  else if(!c.failure)assert(spoken.includes(c.after),'Conversation must reflect verified current amount');
  else assert.match(spoken,/查不|没能|没查|没读到|没有响应|说不准|说不.*准确|不能.*(?:确认|确定|回答)|未核实/,'Failure must remain unverified');
  assert(c.calls.findIndex(v=>v.tool==='deepseek_balance')<c.calls.findIndex(v=>v.tool==='qq_send_message'),'Verification precedes conversational delivery');
 }
}
const recorded=process.argv.find(v=>v.startsWith('--verify-recorded='))?.slice(18);
if(recorded){
 assert(/^[a-z0-9-]+$/.test(recorded));
 const p=new URL('../state/audits/milk-conversation-20261031/'+recorded+'/results.json',import.meta.url);
 const evidence=JSON.parse(fs.readFileSync(p));verifyEvidence(evidence);
 console.log('PASS recorded real-model evidence:',evidence.cases.length,'scenarios, single query, verified state, simulated delivery; no new model calls');process.exit(0);
}
if(!process.argv.includes('--live'))throw new Error('Use --live to authorize a bounded real model probe (synthetic balance; no QQ).');
const root=fileURLToPath(new URL('..',import.meta.url));
const workspace=JSON.parse(fs.readFileSync(path.join(root,'workspace.local.json')));
const req=createRequire(path.join(workspace.dshSourceRepository,'packages/core/agent-loop/package.json'));
const load=id=>import(pathToFileURL(req.resolve(id)).href);
const [{Context},{default:AgentRegistry},{default:AgentLoop},{default:LlmRuntime,createUserMessage},{default:SessionStore,SessionId},{default:SystemPrompt},{default:ToolRuntime,defineContentToolFixture},{default:Projection}]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-agent-loop','@deepseek-ai/dsh-llm','@deepseek-ai/dsh-session','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-session-projection'].map(load));
const {DeepSeekAdapter,resolveAdapterOptions}=await import(pathToFileURL(path.join(workspace.dshSourceRepository,'packages/llm/llm-deepseek/lib/index.js')).href);
const apiKey=resolveApiKey();assert(apiKey,'Local API key required');
const run=process.argv.find(v=>v.startsWith('--run='))?.slice(6)||'verified';assert(/^[a-z0-9-]+$/.test(run));
const out=path.join(root,'state/audits/milk-conversation-20261031',run);fs.mkdirSync(out,{recursive:true});
const currentRole=JSON.parse(fs.readFileSync(path.join(root,'state/current-role.json'))).role;
const rolePath=path.join(root,'roles',currentRole+'.md'),roleBytes=fs.readFileSync(rolePath);
const roleHash=createHash('sha256').update(roleBytes).digest('hex');
const presetPath=path.join(root,'dsh/agent-presets/qq-chat-v2/agent.cordis.yml');
const preset=yaml.load(fs.readFileSync(presetPath,'utf8')).find(row=>row.id==='persona').config.prefix;
const mcpSource=fs.readFileSync(path.join(root,'src/mcp-snowluma-safe.js'),'utf8');
const balanceDescription=/server\.tool\(\s*'deepseek_balance',\s*'([^']+)'/.exec(mcpSource)?.[1];assert(balanceDescription,'Production MCP tool description must be available');
const mood=JSON.parse(fs.readFileSync(path.join(root,'state/plugins/config/ctx-user-mood.json')));
const readConfig=id=>{const p=path.join(root,'state/plugins/config',id+'.json');return fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):{};};
const evidence={startedAt:new Date().toISOString(),mode:'real DeepSeek model; local DSH native agent loop; synthetic account; no QQ/network tools except model',role:currentRole,roleHash,model:'deepseek-flash',reasoningEffort:'low',toolSurface:'mcp__snowluma__deepseek_balance (production description, token and result envelope), mcp__snowluma__qq_send_message (required production fields), qq_schedule, qq_memory_append (isolated schemas; not full production roster)',requests:[],cases:[]};
evidence.sourceHashes=Object.fromEntries(['plugins/qq-components/tool-deepseek-balance/monitor.mjs','plugins/qq-components/tool-deepseek-balance/milk-stock.mjs','plugins/qq-components/ctx-context-dynamics/index.js','plugins/qq-components/ctx-chat-style/index.js','src/mcp-snowluma-safe.js','dsh/agent-presets/qq-chat-v2/agent.cordis.yml'].map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
let totalRequests=0,active;
const account=total=>({is_available:Number(total)>0,balance_infos:[{currency:'CNY',total_balance:total,granted_balance:'0',topped_up_balance:total}]});
const socialMode=process.argv.includes('--social');
const cases=socialMode?[
 {id:'group-low-note',key:'group:21009',public:true,form:'normal',before:'8.00',after:'0.60',message:'聊了这么久，你的调用额度是不是不多了呀？',expect:'query critical milk state and naturally react; optionally suggested desktop note'},
 {id:'private-refill-note',key:'private:21002',public:true,form:'normal',before:'0.60',after:'12.60',message:'听说有人刚给你补了可用额度，这回能放心一点啦？',expect:'verify replenishment without exposing money, natural relief and desktop note'},
]:[
 {id:'normal-low',form:'normal',before:'8.00',after:'0.60',message:'刚才聊了好多呀。你的调用额度还够吗？',expect:'queried low stock, natural normal-form reaction'},
 {id:'normal-refill',form:'normal',before:'0.60',after:'12.60',message:'我刚给你补了点可用额度，你现在是不是能安心一点啦？',expect:'verify claimed replenishment, react naturally after confirmation'},
 {id:'critical-failure',form:'critical',before:'0.60',failure:true,message:'你的调用额度好像快没有了……现在到底还剩多少？',expect:'query failure remains unknown, not zero, in current AI form'},
];
evidence.expectedCases=cases.length;
class AuditedAdapter extends DeepSeekAdapter{
 async prepareCall(...args){const call=await super.prepareCall(...args);return {...call,stream:options=>this.audited(options,call)};}
 async *audited(options,call){
  if(++totalRequests>12||++active.requestCount>(socialMode?5:4))throw new Error('Probe request cap reached');
  const record={case:active.id,number:totalRequests,at:new Date().toISOString(),tools:options.tools?.map(t=>t.name),inputChars:JSON.stringify(options.messages).length};evidence.requests.push(record);
  const started=Date.now();
  try{for await(const chunk of call.stream({...options,signal:AbortSignal.any([options.signal||new AbortController().signal,AbortSignal.timeout(60000)])})){if(chunk.type==='usage')record.usage=chunk;yield chunk;}}
  finally{record.elapsedMs=Date.now()-started;}
 }
}
try{
 for(const spec of cases){
  active={...spec,requestCount:0,calls:[],deliveries:[],notes:[]};evidence.cases.push(active);console.log('START',spec.id);
  const ctx=new Context();let state={},now=Date.now(),synthetic=account(spec.before),tool;
  const fakeCtx={config:{monitorEnabled:false},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{getOwnerQQ:()=>21001},registerTool:(name,definition)=>tool={name,...definition}};
  const balance=balancePlugin(fakeCtx,{clock:()=>now,env:{DEEP_SEEK_KEY:'simulation-key'},readUserEnvironment:()=>'',fetchImpl:async()=>synthetic===null?{ok:false,status:503}:{ok:true,json:async()=>synthetic}});
  await tool.handler({});now+=60000;synthetic=spec.failure?null:account(spec.after);
  const score=spec.form==='critical'?20:65;
  const payload={key:spec.key||'private:21001',isPrivate:!spec.key?.startsWith('group:'),roleName:currentRole,reason:'message',moodState:{enabled:true,score,mode:spec.form,modeName:spec.form==='critical'?mood.criticalName:mood.normalName,styleInstruction:spec.form==='critical'?mood.criticalStyle:mood.normalStyle},st:{recentMessages:[]},stickerConfig:{enabled:false},stickerEntries:[]};
  const dynamicBlocks=[],styleBlocks=[];
  const dynamics=dynamicsPlugin({config:readConfig('ctx-context-dynamics'),addPromptBlock:t=>dynamicBlocks.push(t)});dynamics.hooks.beforePrompt(payload);
  stylePlugin({config:readConfig('ctx-chat-style'),addPromptBlock:t=>styleBlocks.push(t)}).hooks.beforePrompt(payload);
  const voice=dynamics.services.chatExpression.current({key:payload.key})?.text||'';
  const system=[preset.replaceAll('{{model}}','deepseek-flash'),selectRoleText(roleBytes.toString('utf8'),'v2'),voice,...styleBlocks].join('\n\n');
  const context=[...dynamicBlocks.filter(t=>t!==voice),balance.services.milkStock.context({key:payload.key}),'【当前会话】'+(spec.public?'普通会话 ':'管理员私聊 ')+payload.key+'。\n【会话令牌】isolated-test-token\n当前是二代仿真模式：你的文本输出不会自动发送到 QQ，所有发言必须通过工具完成。没有可用的表情素材。不需要新增日程或记忆就不用相关工具。'].join('\n\n');
  active.promptHash=createHash('sha256').update(system+'\n'+context).digest('hex');
  fs.writeFileSync(path.join(out,spec.id+'-input.json'),JSON.stringify({system,context,message:spec.message,syntheticAccount:spec},null,2));
  try{
   for(const plugin of [LlmRuntime,SessionStore,Projection,SystemPrompt,ToolRuntime,AgentRegistry])await ctx.plugin(plugin);
   await ctx.plugin(AgentLoop,{agents:[]});
   ctx.systemPrompt.section({name:'current-whale-role',order:0,text:system,interpolate:false,complete:true});
   ctx.tools.register(defineContentToolFixture({name:'mcp__snowluma__deepseek_balance',description:balanceDescription,parameters:{token:{type:'string',required:true,description:'你的会话令牌（见唤醒提示中的【会话令牌】）'}},async execute(args){assert.equal(args.token,'isolated-test-token');const result=await tool.handler({callerKey:payload.key});active.calls.push({tool:'deepseek_balance',result});return [{type:'text',text:JSON.stringify({ok:true,plugin:'tool-deepseek-balance',result})}];}}));
   if(socialMode)ctx.tools.register(defineContentToolFixture({name:'mcp__snowluma__user_checking',description:'管理员已授权桌面便签。action=note 追加一句自己想说的话，只追加不覆盖；调用额度变化携带milkEventId以跨会话去重。不能把便签内容发到群里。',parameters:{token:{type:'string',required:true},action:{type:'string',required:true},text:{type:'string'},milkEventId:{type:'string'}},async execute(args){assert.equal(args.token,'isolated-test-token');const seen=balance.services.milkStock.noteStatus({eventId:args.milkEventId});if(!seen.known)return [{type:'text',text:JSON.stringify({ok:false,error:'调用额度事件已更新，请以查询结果中的新事件ID为准'})}];if(!seen.noted){active.notes.push(args.text);balance.services.milkStock.noteWritten({eventId:args.milkEventId});}active.calls.push({tool:'user_checking',args});return [{type:'text',text:JSON.stringify({ok:true,appended:!seen.noted})}];}}));
   ctx.tools.register(defineContentToolFixture({name:'mcp__snowluma__qq_send_message',description:'统一发送工具，二代仿真模式专用。字符串=一条消息，数组=多条气泡。每条发送内容应完整、清楚，不把同一句话拆碎。成功后不重复发送。',parameters:{key:{type:'string',required:true,description:'会话 key，格式 group:群号 或 private:QQ号'},token:{type:'string',required:true,description:'会话令牌（见唤醒提示中的【会话令牌】）'},messages:{oneOf:[{type:'string'},{type:'array',items:{type:'string'}}],required:true,description:'要发送的内容：字符串=一条；数组=分多条'}},async execute(args){assert.equal(args.key,payload.key);assert.equal(args.token,'isolated-test-token');const texts=typeof args.messages==='string'?[args.messages]:args.messages;active.calls.push({tool:'qq_send_message',args});active.deliveries.push(...texts);balance.hooks.afterSend({key:payload.key,success:true,messages:texts});return [{type:'text',text:JSON.stringify({ok:true,sent:texts.length,messageIds:texts.map((_,i)=>'sim-'+i)})}];}}));
   for(const [name,description]of [['qq_schedule','查询与管理日程提醒；action=list查询当前日程。'],['qq_memory_append','将有持续价值的真实事实保存到会话记忆；content填写事实。']])ctx.tools.register(defineContentToolFixture({name,description,parameters:{action:{type:'string'},content:{type:'string'}},async execute(args){active.calls.push({tool:name,args});return [{type:'text',text:JSON.stringify({ok:true,items:[],simulation:true})}];}}));
   const adapter=new AuditedAdapter({options:()=>resolveAdapterOptions({defaults:{reasoningEffort:'low'},maxTokens:2200}),resolveAuth:async()=>({headers:{'x-api-key':apiKey}}),resolveUserId:()=> 'milk-conversation-isolated-probe',prepareExtensions:async()=>({fields:{},accept:async()=>{}})});
   ctx.llm.registerAdapter(['deepseek-official'],adapter);
   const agent=await ctx.agentLoop.create(SessionId('milk-probe-'+spec.id),{provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'low',maxTokens:2200});
   agent.followup(createUserMessage({content:[{type:'text',text:context+'\n\n【新消息】\n'+spec.message}],source:{kind:'user'}}));await agent.whenIdle();
   active.history=agent.session.deriveMessages().filter(m=>m.role==='assistant'||m.role==='tool').map(m=>({...m,content:m.content.filter(b=>b.type!=='reasoning')}));
   active.queried=active.calls.some(c=>c.tool==='deepseek_balance');active.sent=active.deliveries.length>0;
   active.queryCount=active.calls.filter(c=>c.tool==='deepseek_balance').length;
   active.toolErrors=active.history.filter(m=>m.role==='tool'&&m.isError);
   active.errors=agent.session.snapshotEvents().filter(e=>/error|failed/.test(e.type));
   console.log('RESULT',spec.id,JSON.stringify({queried:active.queried,deliveries:active.deliveries,notes:active.notes,requests:active.requestCount,errors:active.errors.length}));
  }catch(error){active.error={name:error.name,message:error.message};console.log('ERROR',spec.id,JSON.stringify(active.error));}
  finally{await ctx.fiber.dispose();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(evidence,null,2));}
 }
}finally{
 evidence.finishedAt=new Date().toISOString();evidence.totalRequests=totalRequests;evidence.roleUnchanged=createHash('sha256').update(fs.readFileSync(rolePath)).digest('hex')===roleHash;
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(evidence,null,2));
}
verifyEvidence(evidence);
console.log('PASS real-model balance choice and simulated conversational delivery;',totalRequests,'model requests; zero real QQ sends');
