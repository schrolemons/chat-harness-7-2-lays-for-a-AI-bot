import {api,esc} from '../../shared/api.js';
import {registerPageLoader} from '../../shared/page-loaders.js';
const time = value => value ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '—';
const sources = {default:'默认值（尚无 AI 评估）',ai:'AI 评估',activity:'真实活动调整',purpose:'目的发送调整'};
async function refreshProactivePreview() {
  const root=document.getElementById('proactivePreview');
  try {
    const response=await api('/api/socialV2/states');
    if(response.ok===false)throw Error(response.error||'读取失败');
    root.innerHTML=(response.conversations||[]).map(row=>{
      const p=row.proactive;
      if(!p)return '<div class="runtime-preview"><b>'+esc(row.key)+'</b><p>主动组件未启用或判定不可用</p></div>';
      const interval=p.effectiveInterval;
      return '<div class="runtime-preview"><b>'+esc(row.key)+'</b><dl class="runtime-facts">'
        + '<dt>静默阶段</dt><dd>'+esc(p.stage??'—')+'</dd><dt>有效概率</dt><dd>'+esc(p.effectiveProbability==null?'—':(p.effectiveProbability*100).toFixed(1)+'%')+'</dd>'
        + '<dt>聊天意愿</dt><dd>'+esc(p.willingness??'—')+' / 100 · '+esc(sources[p.source]||p.source||'未知来源')+'</dd>'
        + '<dt>上次 AI 评估</dt><dd>'+esc(p.lastAI ? p.lastAI.value+' · '+p.lastAI.reason+' · '+time(p.lastAI.at) : '尚无 AI 评估')+'</dd>'
        + '<dt>实际检验区间</dt><dd>'+esc(interval ? interval.minMinutes+'–'+interval.maxMinutes+' 分钟' : '—')+'</dd>'
        + '<dt>下次判定</dt><dd>'+esc(time(p.nextAt))+'</dd><dt>阻断 / 暂停</dt><dd>'+esc(p.blockedReason || (row.paused ? '已暂停' : '无'))+'</dd>'
        + '<dt>当前状态</dt><dd>'+esc([p.phase,p.intent,p.lastFinishedReason].filter(Boolean).join(' · ')||'—')+'</dd></dl></div>';
    }).join('')||'<p class="meta">暂无会话</p>';
  }catch(error){root.textContent='读取失败：'+error.message;}
}
export function initialize(){
 document.getElementById('proactivePreviewRefresh').addEventListener('click',refreshProactivePreview);
 registerPageLoader('setting-l-1',refreshProactivePreview);
}
