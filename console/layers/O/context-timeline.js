import {capturedToolResults} from './context-records.js';
const short=name=>String(name||'').split('__').at(-1);
export function timelineEntries(entries){
 const groups=['system','stable','history','arrivals','unknown','dynamic'];
 return [...entries].sort((a,b)=>{
  const group=groups.indexOf(a.region)-groups.indexOf(b.region);if(group)return group;
  if(a.region==='arrivals'){
   if((a.kind==='task'||b.kind==='task')&&a.kind!==b.kind)return a.kind==='task'?-1:1;
   if(a.kind==='qq'&&b.kind==='qq')return Number.isSafeInteger(a.seq)&&Number.isSafeInteger(b.seq)?a.seq-b.seq:a.displaySeq-b.displaySeq;
  }
  return a.position-b.position||(a.kind==='qq'&&b.kind==='qq'?a.displaySeq-b.displaySeq:0);
 });
}
const purposes={qq_memory_append:'更新会话记忆',qq_memory_update:'整理会话记忆',qq_mood:'调整心情',qq_slang_learn:'学习黑话',qq_report_message_receipts:'更新收件回执',qq_mark_read:'标记已读',qq_get_unread_messages:'读取待处理消息',qq_get_recent_messages:'回查聊天记录',qq_wait_for_messages:'等待新消息',qq_wait_for_quiet:'等待对方说完',qq_send_message:'发送 QQ 消息',qq_reply:'引用回复',qq_send_sticker:'发送表情'};
export function timelinePreview(row){
 if(['qq','quote','delivery','forwarded'].includes(row.kind))return row.text||'';
 if(row.kind==='call')return (row.toolCalls||[]).map(call=>purposes[short(call.name)]||'调用 '+short(call.name)).join(' · ');
 if(row.kind==='result'){
  const results=capturedToolResults(row),failed=row.isError||results.some(result=>result.isError||result.data?.ok===false||result.data?.error)||/^Error\s*[:：]/.test(row.text||'');
  if(failed)return '工具返回失败 · '+String(results.find(result=>result.data?.error)?.data.error||row.text||'查看返回详情').replace(/\s+/g,' ').slice(0,160);
  return '工具已返回 · 点击查看执行结果';
 }
 if(row.kind==='assistant')return String(row.text||'无文本输出').split('\n').filter(line=>!/^\s*\{.*"type"\s*:\s*"tool-/.test(line)).join(' ').replace(/\s+/g,' ').slice(0,140);
 return String(row.text||'无文本内容').replace(/\s+/g,' ').slice(0,120);
}
export function timelineFamily(row){return ['qq','quote','delivery','forwarded'].includes(row.kind)?'message':['call','result','registry','definition'].includes(row.kind)?'tool':'context';}
export function receiptSequence(row){return Number.isSafeInteger(row.seq)&&row.seq>0?row.seq:null;}
export function messageIsOutgoing(row){return row.kind==='delivery'&&row.verified===true||row.record?.isSelf===true;}
export function messageActor(row){if(messageIsOutgoing(row))return 'AI助手';const value=row.record?.sender||row.sender||row.record?.userId;if(value&&typeof value==='object')return value.card||value.nickname||value.name||value.user_id||'用户';return value||'用户';}
