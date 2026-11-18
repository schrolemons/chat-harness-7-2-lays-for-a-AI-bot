// Policy consumes transport facts only. Seeing a receipt index or a memory
// candidate never grants permission to reply to an unadmitted message.
const maintenance=new Set(['memoryWrite','selfReview','selfOptimize','userFeedbackReview','slangLearn']);
const independent=new Set(['reminder','milkStock','newsShare','taskDone','scheduledContact']);
export function validateContextSend({agent,reason='',pending=[],groupContext=[],targetIncomplete=false,requiredSeqs=[],selectedSeqs=[]}={}){
  if(!agent)return {ok:true};
  const base=String(reason).split(':')[0];
  if(maintenance.has(base))return {ok:false,reason:'maintenance_send_forbidden',hint:'当前是维护/记忆整理回合，只能读取和整理资料，禁止所有QQ发送；新来信留给聊天回合处理。'};
  // Required inputs still form an ordered queue. Optional historical context
  // is advisory and never adds another mandatory read or reply gate.
  const selectedThrough = selectedSeqs.length ? Math.max(...selectedSeqs) : Infinity;
  if(targetIncomplete||!independent.has(base)&&pending.some(m=>m.required&&!m.complete&&m.seq<=selectedThrough))return {ok:false,reason:'message_context_pending',hint:'所答必要消息的完整正文或关键引用尚未进入当前回合。按需读取该消息详情；不能从收件索引或片段猜测。无关历史不要求补读或补答。'};
  const selected=selectedSeqs.filter(seq=>requiredSeqs.includes(seq));
  // Order semantic groups by their first required source. A later same-meaning
  // fragment may join that group even when another person's input is between.
  if(selected.length&&requiredSeqs.some(seq=>seq<Math.min(...selected)&&!selected.includes(seq)))return {ok:false,reason:'required_reply_order',hint:'按每份完整语义最早的必答seq排序；同义补充可合并为一次回复，即使中间有其他群友发言。不要跳过尚未处理的更早语义组，普通背景不形成补答队列。'};
  return {ok:true};
}
