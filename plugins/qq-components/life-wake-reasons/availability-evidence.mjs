const DAY=86400000,OFFSET=8*3600000;
const KINDS=new Set(['sleep','busy','available','other']);
const iso=s=>typeof s==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
export function validAssessment(a,now){
  return a===undefined || !!a&&typeof a==='object'&&!Array.isArray(a)&&KINDS.has(a.kind)
    &&(a.untilISO===undefined || a.kind==='sleep'&&iso(a.untilISO)&&Date.parse(a.untilISO)>now);
}
// Compatibility only: classify the model's recorded evidence, never infer a
// human's current activity from an unanswered message or the wall clock.
function sleepAssessment(s){
  const a=s.lastAI?.assessment;
  if(a)return a.kind==='sleep';
  const reason=String(s.lastAI?.reason||'');
  return /准备睡|睡觉|入睡|晚安|要睡|去睡/.test(reason)
    && !/没睡|没打算睡|不睡|不想睡|睡不着|失眠|开会|加班|工作|论文|午睡|补觉/.test(reason);
}
const minute=t=>t&&Number.isInteger(t.hour)&&t.hour>=0&&t.hour<24&&Number.isInteger(t.minute)&&t.minute>=0&&t.minute<60?t.hour*60+t.minute:null;
const confirmed=r=>r&&r.exact!=='大致'&&!/不规律|不固定|不确定|没有固定|未确定|可能|观察|推测|猜测|假设|建议|希望|提醒|\d{4}[-年]/.test(String(r.text||''));
function occurrenceAfter(at,m){const base=Math.floor((at+OFFSET)/DAY)*DAY-OFFSET+m*60000;return base>at?base:base+DAY;}
function appliesOn(r,at){
  const text=String(r.text||''),day=new Date(at+OFFSET).getUTCDay();
  if(/工作日/.test(text))return !/周末/.test(text)&&day>=1&&day<=5;
  if(/周末/.test(text))return day===0||day===6;
  const names={'日':0,'天':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6},days=[];
  for(const m of text.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])(?:[至到~～-](?:周|星期|礼拜)?([一二三四五六日天]))?/g)){
    let n=names[m[1]];days.push(n);if(m[2])for(let i=0;n!==names[m[2]]&&i<7;i++){n=(n+1)%7;days.push(n);}
  }
  return days.length?days.includes(day):!/(?:周|星期|礼拜)/.test(text);
}
export function resolveSleepAvailability({key,state:s,now,baseline,callService}){
  if(!s.lastAI||!sleepAssessment(s)||!Number.isFinite(s.lastAI.at))return s;
  if(s.availabilityRecovery?.assessmentAt===s.lastAI.at)return s;
  const review=(reason,extra={})=>({...s,review:{required:true,reason,assessmentAt:s.lastAI.at,...extra}});
  if(!/^private:[1-9]\d*$/.test(String(key)))return s;
  const call=(service,method,payload)=>{try{const v=callService?.(service,method,payload);return v&&typeof v.then!=='function'?v:null;}catch{return null;}};
  const plan=call('availability','getPlan',{key});
  if(plan?.quietNow===true)return review('current-quiet-plan');
  if(Number(s.lastIncomingAt)>s.lastAI.at){
    return {...s,willingness:baseline,source:'incoming-after-sleep',availabilityRecovery:{assessmentAt:s.lastAI.at,at:now,source:'actual-private-incoming',previousValue:s.willingness,value:baseline},review:{required:true,reason:'new-incoming-after-sleep'}};
  }
  const routines=call('profileStore','availabilityRoutine',{key})||{};
  const currentMinute=Math.floor(((now+OFFSET)%DAY+DAY)%DAY/60000);
  const working=(routines.work||[]).some(r=>{
    const a=minute(r.start),b=minute(r.end);
    const dayAt=a!==null&&b!==null&&a>b&&currentMinute<b?now-DAY:now;
    return confirmed(r)&&appliesOn(r,dayAt)&&a!==null&&b!==null&&a!==b&&(a<b?currentMinute>=a&&currentMinute<b:currentMinute>=a||currentMinute<b);
  });
  if(working)return review('confirmed-working-window');
  let boundary,source;
  const explicit=s.lastAI.assessment?.untilISO;
  if(iso(explicit)){boundary=Date.parse(explicit);source='explicit-sleep-end';}
  else{
    const wakes=(routines.wake||[]).filter(r=>{const m=minute(r.end||r.start);return m!==null&&appliesOn(r,occurrenceAfter(s.lastAI.at,m));});
    const times=wakes.filter(confirmed).map(r=>minute(r.end||r.start)).filter(n=>n!==null);
    if(wakes.length!==times.length||new Set(times).size!==1)return review('sleep-end-unconfirmed');
    boundary=occurrenceAfter(s.lastAI.at,times[0]);source='confirmed-personal-wake';
  }
  if(now<boundary)return {...s,review:{required:false,reason:'sleep-period-active',boundary}};
  const value=Math.max(s.willingness,baseline);
  return {...s,willingness:value,source:'sleep-expired',
    availabilityRecovery:{assessmentAt:s.lastAI.at,at:now,boundary,source,previousValue:s.willingness,value},
    review:{required:true,reason:'sleep-evidence-expired',boundary}};
}
export function resolveAvailabilityEvidence(input){
  const s=resolveSleepAvailability(input),{key,now,baseline,callService}=input;
  // A one-off meeting/night comment is not evidence of availability days later.
  // Private sleep retains its stronger, user-confirmed boundary requirements.
  if(!s.lastAI||!Number.isFinite(s.lastAI.at)||now-s.lastAI.at<DAY
    ||s.availabilityRecovery?.assessmentAt===s.lastAI.at
    ||(/^private:/.test(String(key))&&sleepAssessment(s)))return s;
  let plan;try{plan=callService?.('availability','getPlan',{key});}catch{}
  if(plan?.quietNow===true)return s;
  return {...s,willingness:baseline,source:'evidence-expired',
    availabilityRecovery:{assessmentAt:s.lastAI.at,at:now,source:'stale-assessment',previousValue:s.willingness,value:baseline},
    review:{required:true,reason:'availability-evidence-expired'}};
}
export function availabilityReviewText(a){
  if(!a?.review?.required)return '';
  if(['evidence-expired','incoming-after-sleep'].includes(a.source))return '【聊天可用度】'+new Date(a.lastAI.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 的临时评估'+(a.source==='incoming-after-sleep'?'已被之后的真实私聊来信取代':'已过期')+'，当前使用中性值'+a.willingness+'/100。旧评估中的相对日期、没来信或忙碌描述不是今天事实。这不证明对方一直有空，已有免打扰仍有效；本轮有真实来信就先回复，不为复核先加一次模型调用。本人当前明确表达忙闲或给出新约定时，在正文发送成功后用 qq_set_wake_config 的 chatWillingness、reason、availabilityAssessment 登记新依据；没有新证据无需反复评估，不从未回复推断忙碌或冷落。';
  return '【聊天可用度复核】上次评估 '+a.lastAI.value+'/100，依据：'+String(a.lastAI.reason).slice(0,300)+'。'
    +(a.source==='evidence-expired'?'该次临时忙碌/群聊时段评估已超过24小时，暂回中性值待复核；这不证明对方现在有空，已有免打扰约定继续有效。':a.source==='sleep-expired'?'该段睡眠依据已到已确认的结束边界，不再沿用旧睡眠降分；当前可用度不证明对方现在有空。':'该睡眠评估不能无限沿用；起床边界未确认或当前仍有忙碌/免打扰依据。')
    +'结合本轮真实来信、本人确认作息和最新约定复核；没有证据不要声称已醒或有空，不从未回复推断忙碌。需要更新时用 qq_set_wake_config 的 chatWillingness、reason、availabilityAssessment 登记类型和用户明确给出的结束时间；仍在休息或忙碌就保留低值。免打扰和发送限制仍生效，不因复核额外发送问候。';
}
