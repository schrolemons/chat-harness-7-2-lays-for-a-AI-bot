import {compactFailedToolHistory} from '../qq-components/obs-context-assembly/failure-history.mjs';
const snapshotURL=new URL('../qq-components/obs-context-assembly/message-snapshot.mjs',import.meta.url);snapshotURL.search=new URL(import.meta.url).search;
const {splitMessageSnapshot}=await import(snapshotURL.href);
import {orderProjectedDialogue} from '../qq-components/obs-context-assembly/dialogue-order.mjs';
import {historyBackfillRows} from '../qq-components/obs-context-assembly/history-backfill.mjs';
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
function knownSeqs(session){const seen=new Set();for(const id of session.surface.nodes){const e=session.eventAt(id),source=e?.data?.source?.kind==='qq-context-stable'?e.data.source.baseSource:e?.data?.source;if(e?.type==='user/message'&&source?.kind==='qq-context-dialogue')for(const n of source.seqs||[])seen.add(n);}return seen;}
function knownDialogueSeqs(session){const seen=new Set();for(const id of session.surface.nodes){const event=session.eventAt(id),source=event?.data?.source?.kind==='qq-context-stable'?event.data.source.baseSource:event?.data?.source;if(event?.type==='user/message'&&source?.kind==='qq-context-dialogue')for(const seq of source.dialogueSeqs||[])seen.add(seq);}return seen;}
function projectDialogue(message,packet,snapshot,seen,seenDialogue){
 const split=snapshot?splitMessageSnapshot(snapshot.text):null;
 const fresh=(split?.records||[]).filter(row=>{
  if(Number.isSafeInteger(row.dialogueSeq)){if(seenDialogue.has(row.dialogueSeq))return false;seenDialogue.add(row.dialogueSeq);}
  if(Number.isSafeInteger(row.seq)){if(seen.has(row.seq))return false;seen.add(row.seq);}
  return true;
 });
 const messageData=fresh.length?'【新增 QQ 消息数据】\n'+JSON.stringify(fresh):'';
 const content=[...(messageData?[{type:'text',text:messageData}]:[]),...(message.content||[]).filter(block=>block.type!=='text')];
 return {split,messageData,message:content.length?{...message,content,source:{kind:'qq-context-dialogue',key:packet.key,nonce:packet.nonce,reason:packet.scene,taskSeparated:true,seqs:fresh.map(row=>row.seq).filter(Number.isSafeInteger),dialogueSeqs:fresh.map(row=>row.dialogueSeq).filter(Number.isSafeInteger)}}:null};
}
function retireCurrent(session,position,replace=replaceSurface){for(const seq of [...session.surface.nodes]){const e=session.eventAt(seq);if(e?.type==='user/message'&&[OWN,'qq-context-update','qq-context-latest','qq-context-task'].includes(e.data.source?.kind))replace(session,seq,{...e.data,content:[],source:{...e.data.source,kind:'qq-context-retired'}},position);}}
export function apply(ctx,config={}) {
 installSendFailureGuard(ctx);
 const root=config.root||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const secret=secretFor(root),states=new Map(),agents=new Map(),resumed=new Set(),tombstones=new Map(),activities=new Map();
 const isPlainInput=message=>message.role==='user'&&(!message.source?.kind||message.source.kind==='user');
 function acceptPacket(agent,packet,envelope){
  const old=states.get(agent.session.id);
  if(old?.nonce===packet.nonce)return old;
  const policy=readPolicy(root);
  const state={...packet,envelope,compiled:compileModules(prioritizeChatExpression(packet.modules,policy),policy,packet.scene)};
  states.set(agent.session.id,state);
  return state;
 }
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
    states.delete(agent.session.id);
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
  if(session)compactFailedToolHistory(session,{turn,step},replaceSurface);
  return next();
 });
 const ready=agent=>{if(!agent?.session?.id)return;agents.set(agent.session.id,agent);try{recordEvidence(root,agent.session.id,'consumer',{sessionId:agent.session.id,pid:process.pid,at:Date.now(),version:3});}catch{/* No readiness acknowledgement: bridge keeps its working fallback. */}};
 ctx.on('agent/created',({agent,source})=>{
  ready(agent);states.delete(agent.session.id);
  if(source==='resume'||source==='compact')resumed.add(agent.session.id);
  else{
   resumed.delete(agent.session.id);
   try{fs.rmSync(evidenceFile(root,agent.session.id,'packet'),{force:true});}catch{}
  }
 });
 ctx.on('agent/disposed',({agent})=>{const activity=activityFor(agent);if(activity?.active)try{recordEvidence(root,agent.session.id,'activity',{...activity,active:false,endedAt:Date.now(),fresh:false});}catch{}activities.delete(agent.session.id);agents.delete(agent.session.id);states.delete(agent.session.id);resumed.delete(agent.session.id);tombstones.delete(agent.session.id);});
 ctx.on('agent/inbox/claimed',({agent,message})=>{
  ready(agent);
  const envelope=texts(message),packet=decodePacket(envelope,secret,agent.session.id);
  if(packet){
   acceptPacket(agent,packet,envelope);
   try{writeJson(evidenceFile(root,agent.session.id,'packet'),{envelope});}catch{}
  }
  else if(isPlainInput(message))states.delete(agent.session.id);
 });
 ctx.on('system-prompt/assemble',async(_assembly,scope,next)=>{
  const result=await next(),agent=scope.agent;
  if(!agent)return result;
  const policy=readPolicy(root);
  if(!policy.enabled)return result;
  const state=states.get(agent.session.id);
  // A checkpoint may restore fixed settings. It cannot authorize a turn task.
  const saved=!state&&resumed.has(agent.session.id)
   ?decodePacket(readEvidence(root,agent.session.id,'packet')?.envelope,secret,agent.session.id):null;
  const source=state||saved;
  if(!source)return result;
  const compiled=compileModules(prioritizeChatExpression(source.modules,policy),policy,source.scene);
  if(state)state.compiled=compiled;
  const fixed=compiled.selected.filter(x=>x.placement==='fixed'&&x.id!=='wake-action');
  // Preserve all framework sections/permissions. Only signed administrator-owned
  // role/background sources become instruction sections; memory stays user data.
  const boundaryNames=new Set(['harness:identity','deployment:persona-prefix']);
  return {...result,sections:[...result.sections.filter(x=>boundaryNames.has(x.name)),...fixed.map(x=>({name:'whale:'+x.id,text:x.text,interpolate:false})),{name:'whale:context-state-policy',text:CONTEXT_STATE_RULE+'\n'+SESSION_CREDENTIAL_RULE,interpolate:false},...result.sections.filter(x=>!boundaryNames.has(x.name))]};
 });
 ctx.on('agent/pre-step',async(payload,next)=>{
  const decision=await next();if(decision.kind!=='enter')return decision;
  const {agent}=payload,policy=readPolicy(root);
  const position={turn:payload.turn,step:payload.step};
  const inputs=decision.messages.map(message=>({message,packet:decodePacket(texts(message),secret,agent.session.id)}));
  const latest=inputs.findLast(({message,packet})=>packet||isPlainInput(message));
  let state=states.get(agent.session.id);
  if(latest?.packet)state=acceptPacket(agent,latest.packet,texts(latest.message));
  else if(latest||state?.requestPosition?.turn!==position.turn){
   states.delete(agent.session.id);state=undefined;
  }
  if(!state||!policy.enabled){
   retireCurrent(agent.session,position,replaceBeforeStep);
   retireDialogueTasks(agent.session,position,replaceBeforeStep);
   if(!inputs.some(({packet})=>packet))return decision;
   const seen=knownSeqs(agent.session),seenDialogue=knownDialogueSeqs(agent.session);
   const messages=inputs.flatMap(({message,packet})=>{
    if(!packet)return [message];
    const projected=projectDialogue(message,packet,packet.modules.find(row=>row.id==='message-snapshot'),seen,seenDialogue).message;
    return projected?[projected]:[];
   });
   return {...decision,messages,startsRequestSeries:true};
  }
  state.requestPosition=position;state.currentInputMessageIds=[];
  for(const seq of [...agent.session.surface.nodes]){const event=agent.session.eventAt(seq);if(event?.type==='user/message'&&event.data?.source?.projectionRepair==='pre-step-empty-v1')replaceBeforeStep(agent.session,seq,{...event.data,content:[]},position);}
  try{
   const fresh=await (config.refresh||refreshContextPacket)({root,sessionId:agent.session.id,envelope:state.envelope,secret,signal:payload.signal});
   if(fresh?.modules){state.modules=fresh.modules;state.contextRefresh={status:'fresh',at:Date.now()};}
   else throw Error('刷新没有返回组件资料');
  }catch(error){if(payload.signal?.aborted)throw error;state.modules=withoutSessionCredentials(state.modules);state.contextRefresh={status:'stale',at:Date.now(),reason:String(error.message||error).slice(0,160)};}
  state.compiled=compileModules(prioritizeChatExpression(state.modules,readPolicy(root)),policy,state.scene);
  let entered=false;const seen=knownSeqs(agent.session),seenDialogue=knownDialogueSeqs(agent.session),messages=[];
  for(const {message,packet} of inputs){
   if(!packet){messages.push(message);if(message.source?.kind==='user')state.currentInputMessageIds.push(message.id);continue;}
   entered=true;
   const current=packet.nonce===state.nonce;
   const snapshot=(current?state.compiled.selected:packet.modules).find(row=>row.id==='message-snapshot');
   const projected=projectDialogue(message,packet,snapshot,seen,seenDialogue);
   if(current&&projected.split)state.appliedModules=state.compiled.modules.map(row=>row.id==='message-snapshot'?{...row,parts:[projected.split.parts[0],{...projected.split.parts[1],text:projected.messageData}]}:row);
   if(projected.message){state.currentInputMessageIds.push(message.id);messages.push(projected.message);}
  }
  const backfill=historyBackfillRows({session:agent.session,messages,key:state.key,seen,seenDialogue});
  if(backfill.length)messages.push(messageText('【历史 QQ 消息数据】\n'+JSON.stringify(backfill),{kind:'qq-context-dialogue',key:state.key,nonce:state.nonce,reason:'local-history-backfill',seqs:backfill.map(row=>row.seq).filter(Number.isSafeInteger),dialogueSeqs:backfill.map(row=>row.dialogueSeq).filter(Number.isSafeInteger)}));
  retireCurrent(agent.session,position,replaceBeforeStep);
  retireDialogueTasks(agent.session,position,replaceBeforeStep);
  const refill=refillContext({session:agent.session,compiled:state.compiled,key:state.key,nonce:state.nonce,scene:state.scene,position,messages});
  orderProjectedDialogue({session:agent.session,messages:refill.messages,position,replace:replaceBeforeStep});
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
  const messages=(options.messages||[]).map((m,index)=>({id:m.id||'request:'+index,name:(m.role||'消息')+' '+(index+1),role:m.role,isError:m.isError,failureRun:m.source?.failureRun,triggerReason:m.source?.reason,taskSeparated:m.source?.taskSeparated,source:m.source?.kind||'DSH 会话历史',contentBlocks:previewRequestBlocks(m),currentInput:state?.currentInputMessageIds?.includes(m.id)||false,text:previewRequestMessage(m),contextUpdates:m.source?.updates,contextSegments:['qq-context-update','qq-context-latest'].includes(m.source?.kind)?(m.source.ranges||[]).map(r=>({id:r.id,text:previewRequestMessage(m).slice(r.start,r.end)})):undefined,wrappedSource:m.source?.baseSource?.kind,toolCalls:(m.content||[]).filter(b=>b.type==='tool-call').map(b=>({id:b.id,name:b.name})),toolResults:previewRequestToolResults(m),contextNonce:m.source?.nonce,chars:JSON.stringify(m).length}));
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
