// Causes require durable trigger metadata or explicit message references, never adjacency.
import {dialogueParts,capturedToolResults,toolMessageRows} from './context-records.js';
const short=name=>String(name||'').split('__').at(-1);
const periodic=new Map(Object.entries({proactiveCheck:'静默后主动检查',replyCheck:'回复后检查',timeBubble:'定时冒泡',milkStock:'API预算告警',reminder:'日程提醒',memoryWrite:'后台记忆整理',newsShare:'主动分享',scheduledContact:'约定时间联系',slangLearn:'后台黑话整理'}));
const incoming=new Map(Object.entries({message:'收到新消息',private:'收到私聊消息',probability:'群聊来信通过唤醒判定',atMention:'群聊中被 @',nameMention:'群聊中被叫到名字',question:'收到提问',keyword:'来信命中关键词',reply:'收到引用回复',poke:'收到戳一戳'}));
const correctiveReads=new Set(['qq_get_unread_messages','qq_get_recent_messages','qq_get_message_detail']);
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
const array=value=>Array.isArray(value)?value:[];
function argumentsFor(message,call){
 for(const line of String(message.text||'').split('\n')){const block=parse(line);if(block?.type==='tool-call'&&block.id===call.id)return parse(block.arguments)||{};}
 return {};
}
function sourceOrigin(kind,title,sources,messages){
 const positions=[...new Set(sources.flatMap(source=>messages.filter(row=>row.id===source.id).map(row=>row.position)))];
 const eventSeqs=[...new Set(sources.map(row=>row.eventSeq).filter(Number.isSafeInteger))];
 return {kind,title,positions,eventSeqs};
}
function recordOrigin(kind,title,references){
 const numbered=new Map(references.filter(row=>Number.isSafeInteger(row.record.dialogueSeq)&&row.record.dialogueSeq>0).map(row=>[row.record.dialogueSeq,row]));
 const records=[...numbered.values()].map(row=>({dialogueSeq:row.record.dialogueSeq,key:Number.isSafeInteger(row.record.seq)?'qq:'+row.record.seq:'qq:dialogue:'+row.record.dialogueSeq}));
 return {kind,title:records.length?records.map(row=>'对话序号 '+row.dialogueSeq).join('、'):title,dialogueSeqs:records.map(row=>row.dialogueSeq),records,positions:[...new Set(references.map(row=>row.position))],eventSeqs:[...new Set(references.map(row=>row.eventSeq).filter(Number.isSafeInteger))]};
}
function explicitRequest(call,args,record){
 const text=String(record.plain||record.text||'').trim(),name=short(call.name);
 if(record.isSelf===true||/^(?:不要|不用|别|无需|不需要|不必)/.test(text))return false;
 if(name==='qq_schedule'&&args.action==='list')return /^(?:(?:请|麻烦|帮我|给我|帮忙|能不能|可以).{0,8})?(?:查询|查查|查一下|查看|看看|列出|列一下).{0,8}(?:日程|安排|计划|待办)/.test(text)||/^(?:我)?(?:今天|明天|后天|这周|本周|今日)(?:我)?(?:都|还)?(?:有(?:什么|哪些)(?:事|安排|日程|计划|任务)|(?:要|该|需要)做(?:什么|哪些))/.test(text);
 // An explicit instruction naming a tool is also a traceable request.
 return new RegExp('^(?:请|麻烦|帮我|给我|帮忙).{0,8}(?:调用|使用)').test(text)&&text.includes(name);
}
export function generationOrigin(message,messages,request={}){
 const generation=message.provenance?.generation,calls=message.toolCalls||[];
 const nativeInputs=generation?.inputs||[],toolInputs=generation?.toolInputs||[];
 if(incoming.has(generation?.reason)){
  const requests=[];
  for(const row of messages.filter(row=>nativeInputs.some(input=>input.id===row.id)))for(const record of dialogueParts(row)?.records||[])for(const call of calls){
   const args=argumentsFor(message,call);if(args.key&&request.key&&args.key!==request.key)continue;
   if(explicitRequest(call,args,record))requests.push({record,position:row.position,eventSeq:row.provenance?.eventSeq});
  }
  if(requests.length)return recordOrigin('user-request','来源消息（对话序号未记录）',requests);
 }
 for(const call of calls){
  const name=short(call.name),required=toolInputs.filter(input=>correctiveReads.has(name)&&['message_context_pending','source_not_admitted'].includes(input.code)||name==='qq_reply_contents'&&input.code==='content_required');
  if(required.length)return sourceOrigin('tool-requirement',name==='qq_reply_contents'?'按工具要求补充分组':'按工具要求补齐来信内容',required,messages);
 }
 // A precise reference identifies the relevant upstream message even in older captures.
 const references=[];
 for(const call of calls){
  const args=argumentsFor(message,call);
  if(args.key&&request.key&&args.key!==request.key)continue;
  const ids=[args.messageId,args.message_id,args.replyToMessageId].filter(value=>value!==undefined).map(String);
  const seqs=[args.seq,...array(args.seqs),...array(args.receipts).map(row=>row?.seq),...array(args.groups).flatMap(row=>array(row?.seqs))].filter(Number.isSafeInteger);
  if(!ids.length&&!seqs.length)continue;
  for(const row of messages){
   if(row.position>=message.position)continue;
   const records=[...(dialogueParts(row)?.records||[]),...capturedToolResults(row).flatMap(result=>!result.data||result.isError||result.data?.ok===false||result.data?.key&&request.key&&result.data.key!==request.key?[]:toolMessageRows(short(result.name),result.data))];
   for(const record of records)if(record.isSelf!==true&&(seqs.includes(record.seq)||[record.messageId,record.message_id,record.id].some(id=>id!==undefined&&ids.includes(String(id)))))references.push({record,id:row.id,position:row.position,eventSeq:row.provenance?.eventSeq});
  }
 }
 if(references.length)return recordOrigin('message-reference',calls.some(call=>['qq_reply','qq_send_message'].includes(short(call.name)))?'回应指定来信':'处理指定来信',references);
 if(incoming.has(generation?.reason))return sourceOrigin('incoming',incoming.get(generation.reason),nativeInputs,messages);
 if(periodic.has(generation?.reason))return sourceOrigin('periodic',periodic.get(generation.reason),nativeInputs,messages);
 if(typeof generation?.reason==='string'&&generation.reason.trim())return sourceOrigin('recorded-trigger','触发类型：'+generation.reason,nativeInputs,messages);
 if(nativeInputs.some(row=>row.kind==='user'))return sourceOrigin('external-input','会话收到外部输入',nativeInputs,messages);
 return {kind:'unknown',title:calls.length?'调用原因未记录':'生成原因未记录',positions:[],eventSeqs:[]};
}
