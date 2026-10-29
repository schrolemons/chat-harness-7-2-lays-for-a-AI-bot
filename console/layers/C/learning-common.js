
import { api, esc } from '../../shared/api.js';
// layers/C/learning-common: explicit imports; initialize is called in the application startup order.

async function learningCall(tool,input={}) {
  const out=await api('/api/plugins/call','POST',{tool,input});
  if(out.ok===false||out.result?.ok===false)throw Error(out.error||out.result?.error||'操作失败');
  return out.result||out;
}

function learningEvidence(rows) {
  if(!rows?.length)return '<div class="meta">暂无采集语境；此记录可能来自手动维护。</div>';
  return '<details><summary>查看采集语境（'+rows.length+'）</summary><ul class="learning-evidence">'+rows.map(e=>'<li><small>'+esc(e.key||'手动')+' · '+esc(e.time?new Date(e.time).toLocaleString():'')+'</small><p>'+esc(e.text||'')+'</p></li>').join('')+'</ul></details>';
}

function learningLinks(urls) {
  return (urls||[]).map(value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?'<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">'+esc(u.hostname+u.pathname)+'</a>':'';}catch{return '';}}).filter(Boolean).join(' · ');
}

export function initialize() {

}
export { learningCall, learningEvidence, learningLinks };
