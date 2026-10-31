import {compactFailedToolHistory} from '../qq-components/obs-context-assembly/failure-history.mjs';
import {splitMessageSnapshot} from '../qq-components/obs-context-assembly/message-snapshot.mjs';
import {previewRequestMessage,previewRequestBlocks,previewRequestToolResults} from '../qq-components/obs-context-assembly/request-view.mjs';
import {observeModuleDelivery} from '../qq-components/obs-context-assembly/knowledge.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {compileModules} from '../qq-components/obs-context-assembly/policy.mjs';
import {decodePacket} from '../qq-components/obs-context-assembly/packet.mjs';
import {readPolicy,secretFor,recordEvidence,readEvidence,writeJson,evidenceFile} from '../qq-components/obs-context-assembly/store.mjs';
import {replaceSurface} from '../qq-components/obs-context-assembly/history.mjs';
import {refillContext,contextParts,withoutSessionCredentials,retireDialogueTasks,CONTEXT_STATE_RULE,SESSION_CREDENTIAL_RULE} from '../qq-components/obs-context-assembly/refill.mjs';
import {prioritizeChatExpression} from '../qq-components/obs-context-assembly/chat-expression.mjs';
import {refreshContextPacket} from './context-refresh.mjs';
import {installSendFailureGuard} from '../qq-components/ctx-chat-reply-shape/request-guard.mjs';
export const name='qq-context-composer';
const OWN='qq-context-current';
function texts(message){return (message?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');}
function messageText(text,source,id=randomUUID()){return {id,role:'user',content:[{type:'text',text}],source};}
function knownSeqs(session){const seen=new Set();for(const e of session.snapshotEvents()){const source=e?.data?.source?.kind==='qq-context-stable'?e.data.source.baseSource:e?.data?.source;if(e?.type==='user/message'&&source?.kind==='qq-context-dialogue')for(const n of source.seqs||[])seen.add(n);}return seen;}
function knownDialogueSeqs(session){const seen=new Set();for(const event of session.snapshotEvents()){const source=event?.data?.source?.kind==='qq-context-stable'?event.data.source.baseSource:event?.data?.source;if(event?.type==='user/message'&&source?.kind==='qq-context-dialogue')for(const seq of source.dialogueSeqs||[])seen.add(seq);}return seen;}
function retireCurrent(session,position,replace=replaceSurface){for(const seq of [...session.surface.nodes]){const e=session.eventAt(seq);if(e?.type==='user/message'&&[OWN,'qq-context-update','qq-context-latest','qq-context-task'].includes(e.data.source?.kind))replace(session,seq,{...e.data,content:[],source:{...e.data.source,kind:'qq-context-retired'}},position);}}
export function apply(ctx,config={}) {
 installSendFailureGuard(ctx);
 const root=config.root||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const secret=secretFor(root),states=new Map(),agents=new Map(),resumeIds=new Set(),tombstones=new Map(),activities=new Map();
 const activityFor=agent=>{
  if(activities.has(agent.session.id))return activities.get(agent.session.id);
  const saved=readEvidence(root,agent.session.id,'activity');
  if(saved?.active&&saved.pid===process.pid&&saved.agentId===agent.id){const activity={...saved,fresh:false};activities.set(agent.session.id,activity);return activity;}
  return null;
 };
 // One actual idle -> running activity may contain several turns and context batches.
 ctx.on('agent/status',({agent,status})=>{
  if(!agent?.session?.id)return;
  try{
   if(status==='running'){
    const activity={id:randomUUID(),active:true,startedAt:Date.now(),pid:process.pid,agentId:agent.id};
    recordEvidence(root,agent.session.id,'activity',activity);activities.set(agent.session.id,{...activity,fresh:true});
   }else if(status==='idle'){
    const activity=activityFor(agent);if(activity){const ended={...activity,active:false,endedAt:Date.now(),fresh:false};activities.set(agent.session.id,ended);recordEvidence(root,agent.session.id,'activity',ended);}
   }
  }catch{/* Observation must never affect the agent driver. */}
 });
 // pre-step runs before step/start. Null developer projections must wait for
 // the real step boundary so native persistent-log restoration stays valid.
 const replaceBeforeStep=(session,seq,message,position)=>{
  if(!message.content.every(x=>x.type==='text'&&!x.text.trim()))return replaceSurface(session,seq,message,position);
  if(!tombstones.has(session.id))tombstones.set(session.id,new Map());tombstones.get(session.id).set(seq,message);
 };
 ctx.on('agent/request',async({agent,turn,step},next)=>{
  const session=agent?.session;if(session){const queued=tombstones.get(session.id);tombstones.delete(session.id);for(const [seq,message] of queued||[]){if(session.surface.nodes.includes(seq))replaceSurface(session,seq,message,{turn,step});}}
  if(session)compactFailedToolHistory(session,{turn,step},replaceSurface,{keep:2});
  return next();
 });
 const ready=agent=>{if(!agent?.session?.id)return;agents.set(agent.session.id,agent);try{recordEvidence(root,agent.session.id,'consumer',{sessionId:agent.session.id,pid:process.pid,at:Date.now(),version:3});}catch{/* No readiness acknowledgement: bridge keeps its working fallback. */}};
 ctx.on('agent/created',({agent,source})=>{ready(agent);states.delete(agent.session.id);if(['resume','compact'].includes(source))resumeIds.add(agent.session.id);else{resumeIds.delete(agent.session.id);states.set(agent.session.id,null);try{fs.rmSync(evidenceFile(root,agent.session.id,'packet'),{force:true});}catch{}}});
 ctx.on('agent/disposed',({agent})=>{const activity=activityFor(agent);if(activity?.active)try{recordEvidence(root,agent.session.id,'activity',{...activity,active:false,endedAt:Date.now(),fresh:false});}catch{}activities.delete(agent.session.id);agents.delete(agent.session.id);states.delete(agent.session.id);resumeIds.delete(agent.session.id);tombstones.delete(agent.session.id);});
 ctx.on('agent/inbox/claimed',({agent,message})=>{
  ready(agent);
  const packet=decodePacket(texts(message),secret,agent.session.id);
  if(!packet)return;
  const old=states.get(agent.session.id);
  if(old?.nonce===packet.nonce)return;
  states.set(agent.session.id,{...packet,envelope:texts(message),compiled:compileModules(prioritizeChatExpression(packet.modules,readPolicy(root)),readPolicy(root),packet.scene)});
  // A signed local checkpoint survives compaction without promoting a summary
  // into authoritative instructions. Clear/startup never reuse this checkpoint.
  try{writeJson(evidenceFile(root,agent.session.id,'packet'),{envelope:texts(message)});}catch{/* Current admission stays valid even if its optional checkpoint cannot persist. */}
 });
 // Rehydrate from original durable inbox events when an existing session is resumed.
 function stateFor(agent){
  let state=states.get(agent.session.id);if(states.has(agent.session.id))return state;
  if(resumeIds.has(agent.session.id)){const envelope=readEvidence(root,agent.session.id,'packet')?.envelope,packet=decodePacket(envelope,secret,agent.session.id);if(packet){state={...packet,envelope,compiled:compileModules(prioritizeChatExpression(packet.modules,readPolicy(root)),readPolicy(root),packet.scene)};states.set(agent.session.id,state);return state;}}
  for(const e of agent.session.snapshotEvents().toReversed()){
   const candidates=e.type==='user/message'?[e.data]:e.type==='agent/inbox/spliced'?e.data.inserted||[]:[];
   for(const m of candidates){const packet=decodePacket(texts(m),secret,agent.session.id);if(packet){state={...packet,envelope:texts(m),compiled:compileModules(prioritizeChatExpression(packet.modules,readPolicy(root)),readPolicy(root),packet.scene)};states.set(agent.session.id,state);return state;}}
  }
  states.set(agent.session.id,null);return null;
 }
 ctx.on('system-prompt/assemble',async(_assembly,scope,next)=>{
  const result=await next(),agent=scope.agent;
  if(!agent)return result;
  const state=stateFor(agent);if(!state||!readPolicy(root).enabled)return result;
  state.compiled=compileModules(prioritizeChatExpression(state.modules,readPolicy(root)),readPolicy(root),state.scene);
  const fixed=state.compiled.selected.filter(x=>x.placement==='fixed');
  // Preserve all framework sections/permissions. Only signed administrator-owned
  // role/background sources become instruction sections; memory stays user data.
  const boundaryNames=new Set(['harness:identity','deployment:persona-prefix']);
  return {...result,sections:[...result.sections.filter(x=>boundaryNames.has(x.name)),...fixed.map(x=>({name:'whale:'+x.id,text:x.text,interpolate:false})),{name:'whale:context-state-policy',text:CONTEXT_STATE_RULE+'\n'+SESSION_CREDENTIAL_RULE,interpolate:false},...result.sections.filter(x=>!boundaryNames.has(x.name))]};
 });
 ctx.on('agent/pre-step',async(payload,next)=>{
  const decision=await next();if(decision.kind!=='enter')return decision;
  const {agent}=payload,state=stateFor(agent),policy=readPolicy(root);
  if(!state)return decision;
  const position={turn:payload.turn,step:payload.step};state.requestPosition=position;state.currentInputMessageIds=[];
  for(const seq of [...agent.session.surface.nodes]){const event=agent.session.eventAt(seq);if(event?.type==='user/message'&&event.data?.source?.projectionRepair==='pre-step-empty-v1')replaceBeforeStep(agent.session,seq,{...event.data,content:[]},position);}
  if(!policy.enabled){retireCurrent(agent.session,position,replaceBeforeStep);return {...decision,startsRequestSeries:true};}
  try{
   const fresh=await (config.refresh||refreshContextPacket)({root,sessionId:agent.session.id,envelope:state.envelope,secret,signal:payload.signal});
   if(fresh?.modules){state.modules=fresh.modules;state.contextRefresh={status:'fresh',at:Date.now()};}
   else throw Error('刷新没有返回组件资料');
  }catch(error){if(payload.signal?.aborted)throw error;state.modules=withoutSessionCredentials(state.modules);state.contextRefresh={status:'stale',at:Date.now(),reason:String(error.message||error).slice(0,160)};}
  state.compiled=compileModules(prioritizeChatExpression(state.modules,readPolicy(root)),policy,state.scene);
  let entered=false;const seen=knownSeqs(agent.session),seenDialogue=knownDialogueSeqs(agent.session),messages=[];
  for(const message of decision.messages){
   const packet=decodePacket(texts(message),secret,agent.session.id);
   if(!packet){messages.push(message);if(message.source?.kind==='user')state.currentInputMessageIds.push(message.id);continue;}
   entered=true;
   const selectedSnapshot=state.compiled.selected.find(x=>x.id==='message-snapshot');
   const split=selectedSnapshot?splitMessageSnapshot(selectedSnapshot.text):null,rows=split?.records||[];
   const fresh=rows.filter(x=>{if(Number.isSafeInteger(x.dialogueSeq)){if(seenDialogue.has(x.dialogueSeq))return false;seenDialogue.add(x.dialogueSeq);}if(!Number.isSafeInteger(x.seq))return true;if(seen.has(x.seq))return false;seen.add(x.seq);return true;});
   const messageData=fresh.length?'【新增 QQ 消息数据】\n'+JSON.stringify(fresh):'';
   state.appliedModules=state.compiled.modules.map(row=>row.id==='message-snapshot'&&split?{...row,parts:[split.parts[0],{...split.parts[1],text:messageData}]}:row);
   const nonText=(message.content||[]).filter(block=>block.type!=='text');
   if(fresh.length||nonText.length){state.currentInputMessageIds.push(message.id);messages.push({...message,content:[...(messageData?[{type:'text',text:messageData}]:[]),...nonText],source:{kind:'qq-context-dialogue',key:packet.key,nonce:packet.nonce,reason:packet.scene,taskSeparated:true,seqs:fresh.map(x=>x.seq).filter(Number.isSafeInteger),dialogueSeqs:fresh.map(x=>x.dialogueSeq).filter(Number.isSafeInteger)}});}
  }
  retireCurrent(agent.session,position,replaceBeforeStep);
  retireDialogueTasks(agent.session,position,replaceBeforeStep);
  const refill=refillContext({session:agent.session,compiled:state.compiled,key:state.key,nonce:state.nonce,scene:state.scene,position,messages});
  state.contextUpdates=refill.updates;
  state.appliedModules=(state.appliedModules||state.compiled.modules).map(old=>{
   const row=state.compiled.modules.find(x=>x.id===old.id)||old;
   if(row.id==='message-snapshot'&&old.parts)return {...row,parts:old.parts};
   const parts=contextParts(row);
   return parts.stable&&parts.current?{...row,parts:[{id:'stable',name:'稳定行为规则',text:parts.stable},{id:'current',name:'当前状态与风格',text:parts.current}]}:row;
  });
  return {...decision,messages:refill.messages,...(entered?{startsRequestSeries:true}:{})};
 });
 // Observer only: loop requests are frozen and must reconstruct from durable events.
 ctx.on('llm/stream',(options,next)=>{
  const agent=agents.get(options.sessionId);if(!agent)return next();
  try {
  const state=states.get(options.sessionId);
  const observedNonce=(options.messages||[]).findLast(m=>[OWN,'qq-context-update','qq-context-latest','qq-context-dialogue'].includes(m.source?.kind))?.source?.nonce;
  const aligned=!observedNonce||observedNonce===state?.nonce;
  const messages=(options.messages||[]).map((m,index)=>({id:m.id||'request:'+index,name:(m.role||'消息')+' '+(index+1),role:m.role,isError:m.isError,triggerReason:m.source?.reason,taskSeparated:m.source?.taskSeparated,source:m.source?.kind||'DSH 会话历史',contentBlocks:previewRequestBlocks(m),currentInput:state?.currentInputMessageIds?.includes(m.id)||false,text:previewRequestMessage(m),contextUpdates:m.source?.updates,contextSegments:['qq-context-update','qq-context-latest'].includes(m.source?.kind)?(m.source.ranges||[]).map(r=>({id:r.id,text:previewRequestMessage(m).slice(r.start,r.end)})):undefined,wrappedSource:m.source?.baseSource?.kind,toolCalls:(m.content||[]).filter(b=>b.type==='tool-call').map(b=>({id:b.id,name:b.name})),toolResults:previewRequestToolResults(m),contextNonce:m.source?.nonce,chars:JSON.stringify(m).length}));
  const activity=activityFor(agent);let processingCount;
  if(activity?.active){
   const previous=readEvidence(root,options.sessionId,'request');
   processingCount=previous?.processingId===activity.id?Number.isSafeInteger(previous.requestInRound)?previous.requestInRound+1:null:activity.fresh?1:null;
   activity.fresh=false;
  }else if(state&&aligned){
   if(state.requestCount===undefined){const previous=readEvidence(root,options.sessionId,'request');state.requestCount=previous?.nonce===(observedNonce||state.nonce)?Number.isSafeInteger(previous.requestInRound)?previous.requestInRound:null:0;}
   if(state.requestCount!==null)state.requestCount++;
  }
  recordEvidence(root,options.sessionId,'request',{layoutVersion:4,contextRefresh:state?.contextRefresh,contextUpdates:state?.contextUpdates,turn:state?.requestPosition?.turn,step:state?.requestPosition?.step,processingId:activity?.active?activity.id:undefined,processingStartedAt:activity?.active?activity.startedAt:undefined,requestInRound:activity?.active?processingCount:aligned?state?.requestCount:undefined,requestId:randomUUID(),sessionId:options.sessionId,key:state?.key,at:Date.now(),scene:state?.scene,nonce:observedNonce||state?.nonce,moduleEvidenceVersion:1,observerVersion:7,modules:observeModuleDelivery(aligned?(state?.appliedModules||state?.compiled?.modules||[]):[],options.messages),messages,toolCount:options.tools?.length||0,toolChars:JSON.stringify(options.tools||[]).length,messageChars:JSON.stringify(options.messages||[]).length,tools:(options.tools||[]).map(x=>({...x,chars:JSON.stringify(x).length}))});
  }catch{/* Observation failures must not interrupt a model request. */}
  return next();
 });
}
