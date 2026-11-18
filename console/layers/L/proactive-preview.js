import {api,esc} from '../../shared/api.js';
import {registerPageLoader} from '../../shared/page-loaders.js';
const time = value => value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—';
const number=value=>Number.isFinite(value)?String(Math.round(value*100)/100):'—';
const sources = {default:'默认中性值（尚无 AI 评估）',ai:'AI 评估','sleep-expired':'旧睡眠评估已到期','evidence-expired':'旧评估过期，当前使用中性值','incoming-after-sleep':'睡眠评估后已收到真实来信，当前使用中性值',activity:'旧活动评分（待重新评估）',purpose:'旧发送评分（待重新评估）'};
const reviews={'sleep-end-unconfirmed':'起床边界未确认，待复核','sleep-evidence-expired':'旧睡眠依据已到期，待复核','current-quiet-plan':'当前仍有免打扰约定','confirmed-working-window':'当前处于已确认工作时段','sleep-period-active':'仍在本次睡眠有效期内','availability-evidence-expired':'旧评估已过期，不作为今天忙闲依据','new-incoming-after-sleep':'之后已有真实私聊来信，旧睡眠判断不再沿用'};
const phases={scheduled:'等待主动检查',accepted:'已授予主动机会，执行中',idle:'尚未排定主动检查'};
const reasons={busy:'正在处理当前回合',quiet:'当前免打扰',paused:'已暂停',budget:'主动发送预算限制',model_budget:'上游模型额度耗尽（同时影响来信回复），暂缓请求',rate:'主动发送频率限制',curfew:'主动开口宵禁',not_allowed:'未授权会话',transport:'QQ连接未就绪',private_passive_only:'私聊仅被动模式',disabled:'主动开口已关闭',pending_purpose:'正在等待已有事项处理',invalid_policy:'主动策略参数无效'};
let inflight=false;
export function renderProactivePreview(conversations=[]){
 return conversations.map(row=>{
  const p=row.proactive;
  if(!p)return '<div class="runtime-preview"><b>'+esc(row.key)+'</b><p>主动组件未启用或判定不可用</p></div>';
  const interval=p.effectiveInterval,isPrivate=String(row.key).startsWith('private:'),historical=p.review?.required||['evidence-expired','sleep-expired','incoming-after-sleep'].includes(p.source);
  const awake=p.conversationAwake===true?'已有活跃回合：接收、回复或等待中':p.conversationAwake===false?(isPrivate?'当前无活跃回合；私聊来信直接进入处理':'当前无活跃回合；群聊来信使用主动概率与唤醒加成'):'运行进程尚未提供会话状态';
  return '<div class="runtime-preview"><b>'+esc(row.key)+'</b><dl class="runtime-facts">'
   +'<dt>当前会话</dt><dd>'+esc(awake)+'</dd>'
   +(p.lastIncomingDecision&&!isPrivate?'<dt>最近群聊来信</dt><dd>'+esc((p.lastIncomingDecision.phase==='conversation'?'会话中：不抽签，继续接收':'开启会话：p='+Math.round(p.lastIncomingDecision.baseProbability*100)+'% + q='+Math.round(p.lastIncomingDecision.extraProbability*100)+'% → '+Math.round(p.lastIncomingDecision.probability*100)+'% · '+(p.lastIncomingDecision.accepted?'通过':'未通过'))+' · '+time(p.lastIncomingDecision.at))+'</dd>':'')
   +'<dt>静默主动阶段</dt><dd>'+esc(p.stage??'—')+'</dd><dt>无人来信时的冒泡概率</dt><dd>'+esc(p.effectiveProbability==null?'—':(p.effectiveProbability*100).toFixed(1)+'%')+'</dd>'
   +'<dt>聊天意愿（用户忙闲）</dt><dd>'+esc(p.willingness??'—')+' / 100 · '+esc(sources[p.source]||p.source||'未知来源')+'</dd>'
   +'<dt>上次 AI 评估'+(historical?'（历史）':'')+'</dt><dd>'+esc(p.lastAI?time(p.lastAI.at)+' 当时的评估：'+p.lastAI.value+' · '+p.lastAI.reason:'尚无 AI 评估')+'</dd>'
   +'<dt>评估有效性</dt><dd>'+esc((p.review?(reviews[p.review.reason]||(p.review.required?'依据不足':'当前有效')):p.lastAI?'当前有效':'使用默认中性值')+(p.availabilityCheck?.phase==='scheduled'?'；后台重新评估已排队':p.availabilityCheck?.phase==='running'?'；后台正在重新评估':p.availabilityCheck?.phase==='failed'?'；后台评估失败，保留安全回退值':''))+'</dd>'
   +'<dt>最近真实来信</dt><dd>'+esc(time(p.lastIncomingAt))+'</dd><dt>最近正文或媒体送达</dt><dd>'+esc(time(p.lastDeliveredAt))+'</dd>'
   +'<dt>按当前状态计算的检查区间</dt><dd>'+esc(interval?number(interval.minMinutes)+'–'+number(interval.maxMinutes)+' 分钟':'—')+'</dd>'
   +'<dt>下次判定</dt><dd>'+esc(p.scheduledJob?time(p.scheduledJob.at):p.nextAt?'保留计划 '+time(p.nextAt)+'（当前未排队）':'当前未排定')+'</dd>'
   +'<dt>实际调度任务</dt><dd>'+esc(p.scheduledJob?(p.scheduledJob.busy?'正在执行':'已排队')+' · '+time(p.scheduledJob.at):p.phase==='scheduled'?'尚未确认调度器中存在对应任务':'当前无主动检查任务')+'</dd>'
   +'<dt>主动开口阻断 / 暂停</dt><dd>'+esc((row.paused?'已暂停':reasons[p.blockedReason]||p.blockedReason||'无')+(p.modelAvailability?.blocked?'；'+p.modelAvailability.provider+' 最早允许重试 '+time(p.modelAvailability.retryAt)+'（额度恢复时刻未知）':''))+'</dd>'
   +'<dt>当前状态</dt><dd>'+esc(p.blockedReason?'主动检查受阻':p.scheduledJob?.busy?'主动检查执行中':p.phase==='scheduled'&&!p.scheduledJob?'持有计划，当前未排队':phases[p.phase]||p.phase||'—')+'</dd>'
   +(p.lastFinishedReason?'<dt>上轮结束原因</dt><dd>'+esc(time(p.lastFinishedAt)+' · '+(p.lastFinishedReason==='no-send'?'上轮未发言':p.lastFinishedReason))+'</dd>':'')
   +'<dt>状态读取时间</dt><dd>'+esc(time(p.observedAt))+'</dd></dl></div>';
 }).join('')||'<p class="meta">暂无会话</p>';
}
async function refreshProactivePreview() {
  const root=document.getElementById('proactivePreview');
  if(inflight||!root)return;
  inflight=true;
  try {
    const response=await api('/api/socialV2/states');
    if(response.ok===false)throw Error(response.error||'读取失败');
    root.innerHTML=renderProactivePreview(response.conversations||[]);
  }catch(error){root.textContent='读取失败：'+error.message;}finally{inflight=false;}
}
export function initialize(){
 document.getElementById('proactivePreviewRefresh').addEventListener('click',refreshProactivePreview);
 registerPageLoader('setting-l-1',refreshProactivePreview);
 setInterval(()=>{const root=document.getElementById('proactivePreview');if(root&&root.offsetParent!==null&&document.visibilityState==='visible')void refreshProactivePreview();},5000);
}
