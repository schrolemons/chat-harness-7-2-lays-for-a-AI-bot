import {describeSendRejection} from './send-rejection.mjs';
const SEND_TOOL=/^mcp__snowluma__qq_(?:reply|send_message|send_burst|send_sticker|send_image|send_file|send_voice|send_poke|send_private_message|send_group_message)$/;
const READ_TOOL=/^mcp__snowluma__qq_(?:wait_for_messages|wait_for_quiet|get_unread_messages|get_recent_messages)$/;
const plain=m=>(m?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
export function installSendFailureGuard(ctx){
 const sessions=new Map();const stateFor=id=>{if(!sessions.has(id))sessions.set(id,{turn:null,calls:new Map(),failures:0,lastError:'',grantedBatches:new Set()});return sessions.get(id);};
 ctx.on('session/event',(session,event)=>{
  if(!session?.id||!['turn/start','tool/call','tool/result'].includes(event?.type))return;
  const s=stateFor(session.id),d=event.data||{};if(s.turn!==d.turn){s.turn=d.turn;s.calls.clear();s.failures=0;s.lastError='';s.grantedBatches.clear();}
  if(event.type==='tool/call'){const send=SEND_TOOL.test(String(d.name||'')),read=READ_TOOL.test(String(d.name||''));if(send||read)s.calls.set(d.callId,{send,read});return;}
  if(event.type!=='tool/result')return;const call=s.calls.get(d.message?.toolCallId);if(!call)return;s.calls.delete(d.message.toolCallId);
  const value=plain(d.message);let result;try{result=JSON.parse(value);}catch{}
  if(call.read&&d.message.isError!==true){const batch=result?.replyBatch;if(result?.ok===true&&batch?.renewed===true&&typeof batch.id==='string'&&Number.isSafeInteger(batch.throughSeq)&&batch.throughSeq>0&&!s.grantedBatches.has(batch.id)){s.grantedBatches.add(batch.id);s.failures=0;s.lastError='';}return;}
  if(!call.send)return;
  if(Number(result?.sent)>0||result?.success===true||result?.ok===true||(d.message.isError!==true&&result?.ok!==false)){s.failures=0;s.lastError='';return;}
  const signature=describeSendRejection(value)?.code||String(result?.code||result?.error?.code||value.replace(/\d+/g,'#').slice(0,180));
  s.failures=signature===s.lastError?s.failures+1:1;s.lastError=signature;
 });
 ctx.on('agent/pre-step',(payload,next)=>{
  const s=sessions.get(payload.agent?.session?.id);
  if(payload.messages.length){const fresh=payload.messages.some(m=>m.role!=='tool'&&!m.toolCallId&&m.source?.kind!=='tool');if(s&&fresh){s.failures=0;s.lastError='';}return next();}
  if(s?.turn===payload.turn&&s.failures>=2){console.warn('[qq-send-guard] stopped repeated failed sends without new admitted input');return Promise.resolve({kind:'reject'});}
  return next();
 });
 ctx.on('agent/disposed',({agent})=>sessions.delete(agent?.session?.id));
}
