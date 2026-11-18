import {describeSendRejection} from './send-rejection.mjs';
const SEND_TOOL=/^mcp__snowluma__qq_(?:reply|relay_image|send_message|send_burst|send_sticker|send_image|send_file|send_voice|send_poke|send_private_message|send_group_message)$/;
const READ_TOOL=/^mcp__snowluma__qq_(?:wait_for_messages|wait_for_quiet|get_unread_messages|get_recent_messages|reply_contents)$/;
const RECEIPT_TOOL=/^mcp__snowluma__qq_report_message_receipts$/;
const plain=m=>(m?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const validSeqs=seqs=>Array.isArray(seqs)&&seqs.length>0&&seqs.every(seq=>Number.isSafeInteger(seq)&&seq>0);
function repairedMissingContent(call,result,recovered){
 if(!call.declaration||!call.key||result?.key!==call.key||result?.ok!==true||!Array.isArray(result.contents))return null;
 return result.contents.find(c=>typeof c?.id==='string'&&/^content:[A-Za-z0-9_-]+$/.test(c.id)&&!recovered.has(c.id)&&validSeqs(c.seqs)&&c.taskPending!==true
  &&(c.kind==='chat'||c.kind==='task'&&c.taskExempt===true)
  &&call.groups?.some(g=>validSeqs(g?.seqs)&&g.seqs.every(seq=>c.seqs.includes(seq))&&(g.kind||'chat')===c.kind))?.id;
}
export function installSendFailureGuard(ctx){
 const sessions=new Map();const stateFor=id=>{if(!sessions.has(id))sessions.set(id,{turn:null,calls:new Map(),failures:0,deadlocks:0,seenInputs:new Set(),lastError:'',availableContents:new Set(),recoveredMissingContents:new Set()});return sessions.get(id);};
 ctx.on('session/event',(session,event)=>{
  if(!session?.id||!['turn/start','tool/call','tool/result'].includes(event?.type))return;
  const s=stateFor(session.id),d=event.data||{};if(s.turn!==d.turn){s.turn=d.turn;s.calls.clear();s.failures=0;s.deadlocks=0;s.lastError='';s.availableContents.clear();s.recoveredMissingContents.clear();}
  if(event.type==='tool/call'){const send=SEND_TOOL.test(String(d.name||'')),read=READ_TOOL.test(String(d.name||'')),receipt=RECEIPT_TOOL.test(String(d.name||''));let args;try{args=JSON.parse(d.arguments);}catch{}if(send||read||receipt)s.calls.set(d.callId,{send,read,receipt,contentId:args?.contentId,declaration:d.name==='mcp__snowluma__qq_reply_contents',key:args?.key,groups:args?.groups});return;}
  if(event.type!=='tool/result')return;const call=s.calls.get(d.message?.toolCallId);if(!call)return;s.calls.delete(d.message.toolCallId);
  const value=plain(d.message);let result;try{result=JSON.parse(value);}catch{}
  if((call.read||call.receipt)&&(d.message.isError===true||result?.ok===false)&&/仍有未完成的入站消息|没有对应的成功发送记录/.test(value)){s.deadlocks++;return;}
  if(call.read&&d.message.isError!==true){if(result?.ok===true&&Array.isArray(result.contents))for(const c of result.contents)if(c?.id)s.availableContents.add(c.id);const repaired=['REPLY_CONTENT_REQUIRED','TASK_GROUP_PENDING'].includes(s.lastError)&&repairedMissingContent(call,result,s.recoveredMissingContents);if(repaired){s.recoveredMissingContents.add(repaired);s.failures=0;s.lastError='';}return;}
  if(!call.send)return;
  if(Number(result?.sent)>0||result?.success===true||result?.ok===true||(d.message.isError!==true&&result?.ok!==false)){s.failures=0;s.deadlocks=0;s.lastError='';return;}
  const rejection=describeSendRejection(value);
  if(rejection?.code==='CONTENT_PART_LIMIT'&&call.contentId){s.availableContents.delete(call.contentId);if(s.availableContents.size){s.failures=0;s.lastError='';return;}}
  const signature=rejection?.code||String(result?.code||result?.error?.code||value.replace(/\d+/g,'#').slice(0,180));
  s.failures=signature===s.lastError?s.failures+1:1;s.lastError=signature;
 });
 ctx.on('agent/pre-step',(payload,next)=>{
  const sessionId=payload.agent?.session?.id,s=sessionId?stateFor(sessionId):null;
  let fresh=false;
  for(const m of payload.messages||[]){
   if(m.role&&m.role!=='user'||m.toolCallId||m.source?.kind==='qq-context-stable'&&!m.source.baseSource)continue;
   const source=m.source?.kind==='qq-context-stable'?m.source.baseSource:m.source,kind=String(source?.kind||'');
   if(kind==='qq-context-dialogue'){
    for(const seq of source.seqs||[])if(Number.isSafeInteger(seq)&&seq>0){const id=String(source.key)+':'+seq;if(s&&!s.seenInputs.has(id)){s.seenInputs.add(id);fresh=true;}}
    if(s)while(s.seenInputs.size>1024)s.seenInputs.delete(s.seenInputs.values().next().value);
   }else if(!kind||kind==='user')fresh=true;
  }
  if(s&&fresh){s.failures=0;s.deadlocks=0;s.lastError='';}
  if(s?.turn===payload.turn&&(s.failures>=2||s.deadlocks>=2)){console.warn('[qq-send-guard] stopped repeated failed operations without new admitted input');return Promise.resolve({kind:'reject'});}
  return next();
 });
 ctx.on('agent/disposed',({agent})=>sessions.delete(agent?.session?.id));
}
