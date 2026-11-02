const engagementURL=new URL('../plugins/qq-components/ctx-chat-reply-shape/engagement.mjs',import.meta.url);engagementURL.search=new URL(import.meta.url).search;
const {engagementFactors}=await import(engagementURL.href);
// Pure solver owned by ctx-chat-reply-shape. Runtime consumers carry its frozen result.
export const DEFAULT_REPLY_SHAPE = Object.freeze({maxMessagesNormal:3,maxMessagesCasual:3,maxMessagesSerious:3,longIncomingChars:60,
  intervalMinMs:1500,intervalMaxMs:3000,longGapProbability:0.1,longGapMinMs:4000,longGapMaxMs:8000,maxSendPerMinute:8,maxSendPerHour:100,maxMessageChars:500});
export const REPLY_PLAN_SCHEMA = Object.freeze(Object.fromEntries(Object.keys(DEFAULT_REPLY_SHAPE).map(k=>[k,
  k.startsWith('maxMessages')?{min:1,max:20}:k==='longIncomingChars'?{min:20,max:500}:k==='longGapProbability'?{min:0,max:1}:k==='maxMessageChars'?{min:1,max:4000}:{min:0,max:3600000}])));
export function replyPolicy(raw={}) {
  return Object.fromEntries(Object.entries(DEFAULT_REPLY_SHAPE).map(([k,v])=>{
    const rule=REPLY_PLAN_SCHEMA[k],n=raw[k];
    return [k,typeof n==='number'&&Number.isFinite(n)?Math.max(rule.min,Math.min(rule.max,n)):v];
  }));
}
export function validateReplyPolicy(raw={}) {
  const errors=[];
  for(const [k,{min,max}] of Object.entries(REPLY_PLAN_SCHEMA)) if(typeof raw[k]!=='number'||!Number.isFinite(raw[k])||raw[k]<min||raw[k]>max||(k!=='longGapProbability'&&!Number.isInteger(raw[k])))errors.push('无效发送参数：'+k);
  if(raw.intervalMaxMs<raw.intervalMinMs)errors.push('intervalMaxMs 不能小于 intervalMinMs');
  if(raw.longGapMaxMs<raw.longGapMinMs||raw.longGapMinMs<raw.intervalMinMs)errors.push('长间隔范围无效');
  return {ok:errors.length===0,errors};
}
const SERIOUS=/(报错|异常|崩溃|bug|修复|代码|部署|配置|token|密钥|密码|隐私|权限|日志|数据库|接口|服务器|作业|论文|考试|课程|讲座|面试|合同|医院|生病|发烧|法律|借钱|退款|赔偿|难受|难过|好累|烦死|想哭|压力好大|不想活|失眠|焦虑|心情不好)/i;
export function planReplyShape({key,turnId='',incomingText='',mood={},willingness=100,config={},now=Date.now(),referenceMode='off',agent=true,taskExempt=false}={}) {
  const p=replyPolicy(config),t=String(incomingText).trim();
  const serious=SERIOUS.test(t)||t.length>p.longIncomingChars;
  const casual=!serious&&(mood?.welcomeBurstActive===true||t.length<=6||/(哈哈|嘿嘿|笑死|贴贴|好耶)/.test(t));
  const kind=serious?'serious':casual?'casual':'normal';
  const maxMessages=p['maxMessages'+kind[0].toUpperCase()+kind.slice(1)];
  const engagement=engagementFactors(mood,willingness);
  const scaleRate=n=>n>0?Math.max(1,Math.ceil(Number((n*engagement.factor).toFixed(12)))):0;
  const maxSendPerMinute=scaleRate(p.maxSendPerMinute),maxSendPerHour=scaleRate(p.maxSendPerHour);
  const detailLevel=engagement.detailLevel;
  const styleInstruction=mood?.enabled===false?'':String(mood?.styleInstruction||'');
  const line='【回复节奏】'+(kind==='serious'?'准确回答实际问题，必要信息保持完整':'闲聊先接住眼前一句，通常一两句短话就够')+'；每个完整用户语义内容的文字、图片、语音和表情合计最多 '+maxMessages+' 条，每条最多 '+p.maxMessageChars+' 字。不同内容分别计数，同一内容跨工具调用仍共用次数；没有请求批次总条数上限。先根据已实际读到的完整来信声明语义分组，发送时选择对应 contentId；已回应的内容不复述、不凑满条数。经可信来源核实且已获准开始的任务执行与结果汇报免除发送频率和分条额度；任务启动仍须遵守费用与低频准入。';
  return Object.freeze({...p,key,turnId,agent,kind,maxMessages,maxParts:maxMessages,maxSendPerMinute,maxSendPerHour,taskExempt:taskExempt===true,hourlyLimit:maxSendPerHour,minIntervalMs:p.intervalMinMs,detailLevel,styleInstruction,engagement,willingness,line:line+' 可用深度：'+detailLevel+'（不是闲聊篇幅要求）；语气依当前形态和示范。',createdAt:now,
    delayPlan:Object.freeze({min:p.intervalMinMs,max:p.intervalMaxMs,longProbability:p.longGapProbability,longMin:p.longGapMinMs,longMax:p.longGapMaxMs})});
}
