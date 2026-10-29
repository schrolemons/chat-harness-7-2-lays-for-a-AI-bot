import { api, esc } from '../../shared/api.js';
const phases={diving:'潜水中',active:'活跃中',sleeping:'等待唤醒',waiting:'等待消息'};
export function showSessionStates(response){
 const rows=Array.isArray(response.conversations)?response.conversations:[response];
 document.getElementById('v2StateSummary').innerHTML=rows.length?rows.map(row=>'<div class="session-state-row"><strong>'+esc(row.key||'当前会话')+'</strong><span>'+esc(phases[row.phase||row.wakeConfig?.mode]||row.phase||row.wakeConfig?.mode||'尚未设置')+'</span><span>未读 '+esc(String(row.unreadCount??0))+' 条</span></div>').join(''):'<p class="meta">暂无会话状态。</p>';
 document.getElementById('v2StateOutput').textContent=JSON.stringify(response,null,2);
}
export async function viewV2State(){const key=document.getElementById('v2StateKey').value.trim();if(!key){document.getElementById('v2StateSummary').textContent='请选择或输入一个会话。';return;}try{showSessionStates(await api('/api/socialV2/state?key='+encodeURIComponent(key)));}catch(error){document.getElementById('v2StateSummary').textContent='读取失败：'+error.message;}}
export function initialize(){}
