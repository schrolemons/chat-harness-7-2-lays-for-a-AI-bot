import {capturedToolResults} from './context-records.js';
import {messageBodyParts} from './context-message-body.js';
const short=name=>String(name||'').split('__').at(-1),parse=text=>{try{return typeof text==='string'?JSON.parse(text):text;}catch{return null;}};
export const TEXT_SEND_TOOLS=new Set(['qq_send_message','qq_send_burst','qq_reply','qq_send_group_message','qq_send_private_message','private_followup_send']);
const readTools=new Set(['qq_get_recent_messages','qq_get_unread_messages','qq_get_my_recent_messages','qq_wait_for_messages','qq_wait_for_quiet']);
const successful=payload=>payload?.data&&!payload.isError&&payload.data.ok!==false&&!payload.data.error;
export function deliveryTarget(request,args,data,name){return data.key||args.key||args.conversationId||(args.groupId?'group:'+args.groupId:['private_followup_send','qq_send_private_message'].includes(name)&&args.userId?'private:'+args.userId:request.key);}
export function toolCallArgs(message,id){for(const line of String(message.text||'').split('\n')){const block=parse(line);if(block?.type==='tool-call'&&block.id===id)return parse(block.arguments)||{};}return {};}
export function extractToolDeliveries(request,messages){
 const items=[];
 for(const origin of messages)for(const call of origin.toolCalls||[]){
  const name=short(call.name);if(!TEXT_SEND_TOOLS.has(name))continue;
  const returned=messages.find(row=>(row.toolResults||[]).some(result=>result.toolCallId===call.id));if(!returned)continue;
  const payload=capturedToolResults(returned).find(row=>row.toolCallId===call.id),data=payload?.data;if(!data||payload.isError||data.ok===false||data.error||data.queued===true)continue;
  const args=toolCallArgs(origin,call.id);let bodies=args.messages??args.text??args.message;
  if(typeof bodies==='string'&&name!=='private_followup_send'){
   const trimmed=bodies.trim(),parsed=parse(trimmed);
   if(trimmed.startsWith('"')&&typeof parsed==='string')bodies=parsed;
   else if(['qq_send_message','qq_send_burst'].includes(name)&&trimmed.startsWith('[')&&Array.isArray(parsed))bodies=parsed;
  }
  bodies=Array.isArray(bodies)?bodies:[bodies];bodies=bodies.filter(value=>typeof value==='string'&&value.trim());if(!bodies.length)continue;
  const sent=Number(data.sent),success=data.sent!==undefined?Number.isSafeInteger(sent)&&sent===bodies.length&&!Number(data.failed):bodies.length===1&&(data.success===true||data.status==='ok'&&data.retcode===0);if(!success)continue;
  const targetKey=deliveryTarget(request,args,data,name),sourceKey=data.fromKey||args.fromKey||args.groupKey||request.key;
  for(const[index,text]of bodies.entries())items.push({key:'delivery:'+call.id+':'+index,kind:'delivery',region:'history',position:returned.position+.01+index/10000,name:'bot QQ 消息（发送回执）',text,targetKey,sourceKey,crossSession:!!sourceKey&&!!targetKey&&sourceKey!==targetKey,quoted:data.quoted||null,quoteMessageId:args.replyToMessageId||args.messageId,verified:true,callId:call.id,callPosition:origin.position,resultPosition:returned.position,messageId:bodies.length===1?data.message_id||data.messageId:undefined,source:'已确认的发送工具回执',effectiveComponents:[],withdrawnComponents:[]});
 }
 return items;
}
export function extractForwardMessages(request,messages){
 const items=[];
 for(const origin of messages)for(const call of origin.toolCalls||[]){
  const name=short(call.name);if(!['qq_get_forward_msg','qq_get_message_detail'].includes(name)&&!readTools.has(name))continue;
  const returned=messages.find(row=>(row.toolResults||[]).some(result=>result.toolCallId===call.id)),payload=returned?capturedToolResults(returned).find(row=>row.toolCallId===call.id):null,data=payload?.data;if(!successful(payload))continue;
  const args=toolCallArgs(origin,call.id),sourceKey=data.fromKey||data.key||args.key||request.key;
  // Current-session readers are already projected with their real receipt seq by processingEntries.
  if((readTools.has(name)||name==='qq_get_message_detail')&&sourceKey===request.key)continue;
  const groups=name==='qq_get_forward_msg'?[{id:data.id||args.id,messages:data.messages},...(data.nestedPreviews||[]).filter(row=>!row.error)]:[{messages:data.info?[data.info]:data.message?[data.message]:data.messages||data.newMessages}];
  let index=0;
  for(const group of groups)for(const row of Array.isArray(group.messages)?group.messages:[]){
   const parts=messageBodyParts(row),text=parts.text||(typeof row?.content==='string'?row.content:'');if(!text&&!parts.quoted)continue;
   items.push({key:'forwarded:'+call.id+':'+index,kind:'forwarded',region:'history',position:returned.position+.001+index++/10000,name:name==='qq_get_forward_msg'?'合并转发内消息':'QQ 消息（工具读取）',text,quoted:parts.quoted,sender:row.sender||row.userId,at:row.at,record:row,messageId:row.messageId||row.message_id,originalSeq:Number.isSafeInteger(row.seq)?row.seq:undefined,originalMessageSeq:row.messageSeq,forwardId:group.id,textTruncated:row.textTruncated===true||data.textTruncated===true,sourceKey:row.sourceKey||sourceKey,targetKey:request.key,crossSession:sourceKey!==request.key,source:'工具返回的转发/查询消息',callId:call.id,resultPosition:returned.position,effectiveComponents:[],withdrawnComponents:[]});
  }
 }
 return items;
}
