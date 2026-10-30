import {splitMessageSnapshot} from '../qq-components/obs-context-assembly/message-snapshot.mjs';
import {previewRequestMessage} from '../qq-components/obs-context-assembly/request-view.mjs';
import {observeModuleDelivery} from '../qq-components/obs-context-assembly/knowledge.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {compileModules} from '../qq-components/obs-context-assembly/policy.mjs';
import {decodePacket} from '../qq-components/obs-context-assembly/packet.mjs';
import {readPolicy,secretFor,recordEvidence,readEvidence,writeJson,evidenceFile} from '../qq-components/obs-context-assembly/store.mjs';
import {planHistoryReplacements,replaceSurface} from '../qq-components/obs-context-assembly/history.mjs';
export const name='qq-context-composer';
const OWN='qq-context-current';
function texts(message){return (message?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');}
function messageText(text,source,id=randomUUID()){return {id,role:'user',content:[{type:'text',text}],source};}
function knownSeqs(session){const seen=new Set();for(const seq of session.surface.nodes){const e=session.eventAt(seq);if(e?.type==='user/message'&&e.data.source?.kind==='qq-context-dialogue')for(const n of e.data.source.seqs||[])seen.add(n);}return seen;}
function retireCurrent(session,position,replace=replaceSurface){for(const seq of [...session.surface.nodes]){const e=session.eventAt(seq);if(e?.type==='user/message'&&e.data.source?.kind===OWN)replace(session,seq,{...e.data,content:[],source:{...e.data.source,kind:'qq-context-retired'}},position);}}
export function apply(ctx,config={}) {
 const root=config.root||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const secret=secretFor(root),states=new Map(),agents=new Map(),resumeIds=new Set(),tombstones=new Map();
 // pre-step runs before step/start. Null developer projections must wait for
 // the real step boundary so native persistent-log restoration stays valid.
 const replaceBeforeStep=(session,seq,message,position)=>{
  if(!message.content.every(x=>x.type==='text'&&!x.text.trim()))return replaceSurface(session,seq,message,position);
  if(!tombstones.has(session.id))tombstones.set(session.id,new Map());tombstones.get(session.id).set(seq,message);
 };
 ctx.on('agent/request',async({agent,turn,step},next)=>{
  const session=agent?.session;if(session){const queued=tombstones.get(session.id);tombstones.delete(session.id);for(const [seq,message] of queued||[]){if(session.surface.nodes.includes(seq))replaceSurface(session,seq,message,{turn,step});}}
  return next();
 });
 const ready=agent=>{if(!agent?.session?.id)return;agents.set(agent.session.id,agent);try{recordEvidence(root,agent.session.id,'consumer',{sessionId:agent.session.id,pid:process.pid,at:Date.now(),version:3});}catch{/* No readiness acknowledgement: bridge keeps its working fallback. */}};
 ctx.on('agent/created',({agent,source})=>{ready(agent);states.delete(agent.session.id);if(['resume','compact'].includes(source))resumeIds.add(agent.session.id);else{resumeIds.delete(agent.session.id);states.set(agent.session.id,null);try{fs.rmSync(evidenceFile(root,agent.session.id,'packet'),{force:true});}catch{}}});
 ctx.on('agent/disposed',({agent})=>{agents.delete(agent.session.id);states.delete(agent.session.id);resumeIds.delete(agent.session.id);tombstones.delete(agent.session.id);});
 ctx.on('agent/inbox/claimed',({agent,message})=>{
  ready(agent);
  const packet=decodePacket(texts(message),secret,agent.session.id);
  if(!packet)return;
  const old=states.get(agent.session.id);
  if(old?.nonce===packet.nonce)return;
  states.set(agent.session.id,{...packet,compiled:compileModules(packet.modules,readPolicy(root),packet.scene)});
  // A signed local checkpoint survives compaction without promoting a summary
  // into authoritative instructions. Clear/startup never reuse this checkpoint.
  try{writeJson(evidenceFile(root,agent.session.id,'packet'),{envelope:texts(message)});}catch{/* Current admission stays valid even if its optional checkpoint cannot persist. */}
 });
 // Rehydrate from original durable inbox events when an existing session is resumed.
 function stateFor(agent){
  let state=states.get(agent.session.id);if(states.has(agent.session.id))return state;
  if(resumeIds.has(agent.session.id)){const packet=decodePacket(readEvidence(root,agent.session.id,'packet')?.envelope,secret,agent.session.id);if(packet){state={...packet,compiled:compileModules(packet.modules,readPolicy(root),packet.scene)};states.set(agent.session.id,state);return state;}}
  for(const e of agent.session.snapshotEvents().toReversed()){
   const candidates=e.type==='user/message'?[e.data]:e.type==='agent/inbox/spliced'?e.data.inserted||[]:[];
   for(const m of candidates){const packet=decodePacket(texts(m),secret,agent.session.id);if(packet){state={...packet,compiled:compileModules(packet.modules,readPolicy(root),packet.scene)};states.set(agent.session.id,state);return state;}}
  }
  states.set(agent.session.id,null);return null;
 }
 ctx.on('system-prompt/assemble',async(_assembly,scope,next)=>{
  const result=await next(),agent=scope.agent;
  if(!agent)return result;
  const state=stateFor(agent);if(!state||!readPolicy(root).enabled)return result;
  state.compiled=compileModules(state.modules,readPolicy(root),state.scene);
  const fixed=state.compiled.selected.filter(x=>x.placement==='fixed');
  // Preserve all framework sections/permissions. Only signed administrator-owned
  // role/background sources become instruction sections; memory stays user data.
  const boundaryNames=new Set(['harness:identity','deployment:persona-prefix']);
  return {...result,sections:[...result.sections.filter(x=>boundaryNames.has(x.name)),...fixed.map(x=>({name:'whale:'+x.id,text:x.text,interpolate:false})),...result.sections.filter(x=>!boundaryNames.has(x.name))]};
 });
 ctx.on('agent/pre-step',async(payload,next)=>{
  const decision=await next();if(decision.kind!=='enter')return decision;
  const {agent}=payload,state=stateFor(agent),policy=readPolicy(root);
  if(!state)return decision;
  const position={turn:payload.turn,step:payload.step};state.requestPosition=position;
  for(const seq of [...agent.session.surface.nodes]){const event=agent.session.eventAt(seq);if(event?.type==='user/message'&&event.data?.source?.projectionRepair==='pre-step-empty-v1')replaceBeforeStep(agent.session,seq,{...event.data,content:[]},position);}
  if(!policy.enabled){retireCurrent(agent.session,position,replaceBeforeStep);return {...decision,startsRequestSeries:true};}
  if(policy.compactHistory){for(const op of planHistoryReplacements(agent.session.snapshotEvents(),agent.session.surface.nodes))replaceBeforeStep(agent.session,op.seq,op.message,position);}
  let entered=false;const seen=knownSeqs(agent.session),messages=[];
  for(const message of decision.messages){
   const packet=decodePacket(texts(message),secret,agent.session.id);
   if(!packet){messages.push(message);continue;}
   entered=true;
   const selectedSnapshot=state.compiled.selected.find(x=>x.id==='message-snapshot');
   const split=selectedSnapshot?splitMessageSnapshot(selectedSnapshot.text):null,rows=split?.records||[];
   const fresh=rows.filter(x=>{if(!Number.isSafeInteger(x.seq))return true;if(seen.has(x.seq))return false;seen.add(x.seq);return true;});
   const action=packet.modules.find(x=>x.id==='wake-action')?.text||packet.scene;
   const messageData=fresh.length?'【新增 QQ 消息数据】\n'+JSON.stringify(fresh):'';
   state.appliedModules=state.compiled.modules.map(row=>row.id==='message-snapshot'&&split?{...row,parts:[split.parts[0],{...split.parts[1],text:messageData}]}:row);
   const text='【QQ 回合 '+packet.scene+'】\n'+action+(fresh.length?'\n【新增 QQ 消息数据】\n'+JSON.stringify(fresh):'\n本轮无新增 QQ 消息。');
   messages.push({...message,content:[{type:'text',text},...(message.content||[]).filter(x=>x.type!=='text')],source:{kind:'qq-context-dialogue',key:packet.key,nonce:packet.nonce,seqs:fresh.map(x=>x.seq).filter(Number.isSafeInteger)}});
  }
  if(!entered)return decision;
  retireCurrent(agent.session,position,replaceBeforeStep);
  const selected=state.compiled.selected.filter(x=>x.placement!=='fixed'&&x.id!=='wake-action');
  const current=selected.map(x=>{
   if(x.id!=='message-snapshot')return x.text;
   return splitMessageSnapshot(x.text)?.backgroundText||'';
  }).join('\n\n');
  messages.unshift(messageText(current,{kind:OWN,key:state.key,nonce:state.nonce}));
  return {...decision,messages,startsRequestSeries:true};
 });
 // Observer only: loop requests are frozen and must reconstruct from durable events.
 ctx.on('llm/stream',(options,next)=>{
  const agent=agents.get(options.sessionId);if(!agent)return next();
  try {
  const state=states.get(options.sessionId);
  const observedNonce=(options.messages||[]).findLast(m=>m.source?.kind===OWN)?.source?.nonce;
  const aligned=!observedNonce||observedNonce===state?.nonce;
  const messages=(options.messages||[]).map((m,index)=>({id:m.id||'request:'+index,name:(m.role||'消息')+' '+(index+1),role:m.role,source:m.source?.kind||'DSH 会话历史',text:previewRequestMessage(m),toolCalls:(m.content||[]).filter(b=>b.type==='tool-call').map(b=>({id:b.id,name:b.name})),toolResults:(m.content||[]).filter(b=>b.type==='tool-result').map(b=>({toolCallId:b.toolCallId,name:b.name})),contextNonce:m.source?.nonce,chars:JSON.stringify(m).length}));
  if(state&&aligned){
   if(state.requestCount===undefined){const previous=readEvidence(root,options.sessionId,'request');state.requestCount=previous?.nonce===(observedNonce||state.nonce)?Number.isSafeInteger(previous.requestInRound)?previous.requestInRound:null:0;}
   if(state.requestCount!==null)state.requestCount++;
  }
  recordEvidence(root,options.sessionId,'request',{turn:state?.requestPosition?.turn,step:state?.requestPosition?.step,requestInRound:aligned?state?.requestCount:undefined,requestId:randomUUID(),sessionId:options.sessionId,key:state?.key,at:Date.now(),scene:state?.scene,nonce:observedNonce||state?.nonce,moduleEvidenceVersion:1,observerVersion:3,modules:observeModuleDelivery(aligned?(state?.appliedModules||state?.compiled?.modules||[]):[],options.messages),messages,toolCount:options.tools?.length||0,toolChars:JSON.stringify(options.tools||[]).length,messageChars:JSON.stringify(options.messages||[]).length,tools:(options.tools||[]).map(x=>({...x,chars:JSON.stringify(x).length}))});
  }catch{/* Observation failures must not interrupt a model request. */}
  return next();
 });
}
