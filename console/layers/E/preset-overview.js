import {api,esc} from '../../shared/api.js';
import {setConsolePage} from '../../shared/navigation.js';
import {loadPresetModelPolicy} from './preset-model-policy.js';
export async function loadPresetOverview() {
  const status=document.getElementById('presetOverviewStatus');
  status.textContent='读取中…';
  try {
    const data=await api('/api/presets/overview');
    if(!data.ok)throw Error(data.error||'预设总览接口尚未加载，请确认桥接版本。');
    const owner=data.bindings.find(b=>b.key==='owner');
    document.getElementById('presetOverviewExplanation').innerHTML='<span>管理员环境：<strong>'+(data.adminEnabled?'已启用':'未启用，跟随当前运行模式')+'</strong> · 私聊使用 <code>'+esc(owner?.preset||'待确定')+'</code></span><span>DSH 新会话默认：<code>'+esc(data.defaultPreset||'待确定')+'</code></span>'+(owner?.hasSession&&owner.loadedPreset!==owner.preset?'<span>管理员既有会话仍为 '+esc(owner.loadedPreset)+'，后续协调时更新。</span>':'');
    await loadPresetModelPolicy(data);
    status.textContent='已刷新用途与运行状态';
  }catch(error){status.textContent='读取失败：'+error.message;}
}
export function initializePresetOverview() {
  document.getElementById('presetOverviewRefresh').addEventListener('click',loadPresetOverview);
  document.getElementById('section-environment-presets').addEventListener('click',event=>{
    const link=event.target.closest('[data-preset-edit]');if(!link)return;
    event.preventDefault();setConsolePage(link.dataset.presetEdit,{focus:true});
    document.getElementById(link.dataset.presetTarget)?.scrollIntoView({block:'center',behavior:'smooth'});
  });
}
