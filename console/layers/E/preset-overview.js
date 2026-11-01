import {api,esc} from '../../shared/api.js';
import {setConsolePage} from '../../shared/navigation.js';
export async function loadPresetOverview() {
  const status=document.getElementById('presetOverviewStatus');
  status.textContent='读取中…';
  try {
    const data=await api('/api/presets/overview');
    if(!data.ok)throw Error(data.error||'预设总览接口尚未加载，请确认桥接版本。');
    const owner=data.bindings.find(b=>b.key==='owner');
    const usingAdmin=data.mode==='closed-agent'||data.adminEnabled;
    document.getElementById('presetOverviewExplanation').innerHTML='<p><strong>管理员日常聊天：</strong>'+esc(usingAdmin?'当前整个管理员私聊使用管理员环境预设，包括日常聊天。':'当前管理员环境未启用，日常聊天使用当前运行模式的预设。')+'当前选定 <code>'+esc(owner?.preset||'待确定')+'</code>。</p><p>预设按整个会话选择，不按单条消息的内容自动切换。管理员身份决定管理接口权限，预设决定工具与工作规则；角色卡仍独立提供AI助手人设。</p><p>“跟随 DSH 默认”当前解析为 <code>'+esc(data.defaultPreset||'待确定')+'</code>，与一、二代运行模式独立。</p>';
    document.getElementById('presetOverviewRows').innerHTML=data.bindings.map(binding=>{
      const config=binding.configuration;
      const phase=binding.active===true?'当前使用':binding.active===false?'当前未启用':'按用途调用';
      const recorded=binding.key==='owner'?(binding.hasSession?'<p class="meta">既有会话记录：<code>'+esc(binding.loadedPreset||'未知')+'</code>'+(binding.loadedPreset!==binding.preset?'；与选定值不同，将在后续会话协调时更新。':'')+'</p>':'<p class="meta">尚无已建立的管理员私聊会话。</p>'):'';
      return '<article class="preset-overview-card" data-preset-binding="'+esc(binding.key)+'"><div class="preset-overview-heading"><h3>'+esc(binding.key==='learning'?(config?.name||binding.label):binding.label)+'</h3><span class="meta">'+phase+'</span></div><p><strong>'+esc(config?.name||binding.preset||'尚未确定')+'</strong><br><code>'+esc(binding.preset||'—')+'</code></p><p>'+esc(binding.description)+'</p>'+recorded+(config?.description?'<p class="meta">'+esc(config.description)+'</p>':'')+'<ul>'+((config?.features)||['配置暂不可用']).map(feature=>'<li>'+esc(feature)+'</li>').join('')+'</ul><p class="meta">'+(config?.configStatus==='read'?'展示预设的能力配置；当前会话可用的工具还受开关与权限限制。':'配置未读取；不据此推断能力。')+'</p>'+(binding.edit?'<a href="#'+esc(binding.edit.page)+'" data-preset-edit="'+esc(binding.edit.page)+'" data-preset-target="'+esc(binding.edit.target)+'">'+esc(binding.edit.label)+' ↗</a>':'<span class="meta">固定预设 · Console 不提供预设编辑</span>')+'</article>';
    }).join('');
    status.textContent='已读取当前选定值与 DSH 声明；只读';
  }catch(error){status.textContent='读取失败：'+error.message;}
}
export function initializePresetOverview() {
  document.getElementById('presetOverviewRefresh').addEventListener('click',loadPresetOverview);
  document.getElementById('presetOverviewRows').addEventListener('click',event=>{
    const link=event.target.closest('[data-preset-edit]');if(!link)return;
    event.preventDefault();setConsolePage(link.dataset.presetEdit,{focus:true});
    document.getElementById(link.dataset.presetTarget)?.scrollIntoView({block:'center',behavior:'smooth'});
  });
}
