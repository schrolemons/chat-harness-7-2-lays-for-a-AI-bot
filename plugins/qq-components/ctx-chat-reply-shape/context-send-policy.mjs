// Policy consumes transport facts only. Seeing a receipt index or a memory
// candidate never grants permission to reply to an unadmitted message.
const maintenance=new Set(['memoryWrite','selfReview','selfOptimize','userFeedbackReview','slangLearn']);
const independent=new Set(['reminder','milkStock','newsShare','taskDone','scheduledContact']);
export function validateContextSend({agent,reason='',pending=[],targetIncomplete=false}={}){
  if(!agent)return {ok:true};
  const base=String(reason).split(':')[0];
  if(maintenance.has(base))return {ok:false,reason:'maintenance_send_forbidden',hint:'当前是维护/记忆整理回合，只能读取和整理资料，禁止所有QQ发送；新来信留给聊天回合处理。'};
  if(targetIncomplete||!independent.has(base)&&pending.some(m=>m.required&&!m.complete))return {ok:false,reason:'message_context_pending',hint:'新来信的完整正文或引用尚未进入当前回合。先调用qq_get_unread_messages读取完整上下文（必要时读取消息详情），再结合引用关系回复；不要从记忆候选、收件索引或片段猜测并发送。'};
  return {ok:true};
}
