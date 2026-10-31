import {TOOL_PRESENTATION} from './tool-presentation.js';
import { TOOL_CONFIG_FLAGS } from "../../../src/tools/flags.js";
import { api, esc } from '../../shared/api.js';
import { registerPageLoader } from '../../shared/page-loaders.js';
export function toolRows(tools) {
  const name = tool => tool.name || String(tool.qualifiedName || '').split('__').slice(2).join('__');
  return [...tools].sort((a,b)=>name(a).localeCompare(name(b),'en',{sensitivity:'base',numeric:true}) || String(a.server).localeCompare(String(b.server)))
    .map(tool=>'<div class="tool-reference-item"><code title="'+esc(tool.qualifiedName)+'">'+esc(name(tool))+'</code><span>'+esc(tool.description)+'<br><small>'+esc(tool.server)+' · '+(tool.botInjectedSessions||0)+' 个聊天会话有注入记录</small></span></div>').join('');
}
export async function loadToolCatalog() {
  const root=document.getElementById('toolReferenceRoot');
  const status=document.getElementById('toolsCatalogStatus');
  try {
    const catalog=await api('/api/tools/catalog');
    if(!catalog.ok)throw Error(catalog.error||'注册表读取失败');
    const visible=catalog.tools.filter(tool=>tool.audience==='qq' && tool.registered && tool.botInjectedSessions>0);
    const pending=catalog.tools.filter(tool=>tool.audience==='qq' && (!tool.registered || !tool.botInjectedSessions));
    const admin=catalog.tools.filter(tool=>tool.audience==='admin');
    root.innerHTML=toolRows(visible)||'<p class="meta">尚无真实请求的注入证据。</p>';
    document.getElementById('toolPendingRoot').innerHTML=toolRows(pending)||'<p class="meta">无待注入工具。</p>';
    document.getElementById('toolAdminRoot').innerHTML=toolRows(admin);
    const unexpected=admin.filter(tool=>tool.botInjectedSessions>0);
    status.textContent=visible.length+' 个聊天工具有实际注入记录；依据会话最新 request/header。'+(catalog.stale?' 注册定义有变化，需重新运行 audit:tools 核验。':'')+(unexpected.length?' 当前历史工具面仍含 '+unexpected.length+' 个管理工具；过滤修复需刷新对应 preset 后在下一轮请求核验。':'')+(catalog.evidenceError?' '+catalog.evidenceError:'');
    status.className='meta'+(catalog.stale||unexpected.length?' err':' ok');
    return catalog;
  }catch(error){root.innerHTML='<div class="err">工具注册读取失败：'+esc(error.message)+'</div>';status.textContent='未取得工具注入证据';return null;}
}
// Paint from the registration source before waiting for any network response.
export async function renderToolInventory(pluginsReady) {
  const groups=new Map();
  for(const [name,flag] of Object.entries(TOOL_CONFIG_FLAGS)) {
    if(!groups.has(flag))groups.set(flag,[]);
    groups.get(flag).push(name);
  }
  const root=document.getElementById('v2Tools');
  const sections=new Map();
  for(const [flag,names]of groups){const view=TOOL_PRESENTATION[flag]||{group:'其他能力',label:names.join(' / '),example:'调整后需保存，并刷新对应MCP工具清单。'};if(!sections.has(view.group))sections.set(view.group,[]);sections.get(view.group).push({flag,names,...view});}
  root.dataset.loaded='0';
  root.innerHTML=[...sections].map(([title,items])=>'<details class="tool-parameter-group tool-switch-group" data-tool-group="'+esc(title)+'"><summary><span>'+esc(title)+'</span><small class="meta" data-tool-group-count></small></summary><div class="tool-parameter-options">'+items.map(({flag,names,label,example})=>'<label class="v2-tool-item"><input type="checkbox" disabled data-v2-tool="'+esc(flag)+'"><span><b>'+esc(label)+'</b><small class="meta tool-call-names">'+esc(names.join(' / '))+'</small><small class="parameter-example">'+esc(example)+'</small></span></label>').join('')+'</div></details>').join('');
  const save=document.querySelector('#section-v2-t .v2-save'),status=document.getElementById('toolSwitchStatus'),retry=document.getElementById('toolSwitchRetry');
  save.disabled=true;
  const updateCounts=()=>root.querySelectorAll('.tool-parameter-group').forEach(group=>{const all=group.querySelectorAll('.v2-tool-item input[type="checkbox"]');group.querySelector('[data-tool-group-count]').textContent=root.dataset.loaded==='1'?'已启用 '+[...all].filter(x=>x.checked).length+' / '+all.length:all.length+' 项 · 读取中';});
  updateCounts();root.onchange=updateCounts;
  const loadConfig=async()=>{
    status.textContent='读取开关状态…';retry.hidden=true;
    try{
      const out=await api('/api/socialV2/config');
      if(out.ok!==true||!out.config||typeof out.config!=='object')throw Error(out.error||'未取得当前配置');
      root.querySelectorAll('[data-v2-tool]').forEach(input=>{input.checked=out.config.tools?.[input.dataset.v2Tool]!==false;input.disabled=false;});
      root.dataset.loaded='1';save.disabled=false;status.textContent='';updateCounts();
    }catch(error){status.textContent='开关读取失败：'+error.message;retry.hidden=false;}
  };
  retry.onclick=loadConfig;
  // Evidence belongs to its own page; it must not delay switches or component forms.
  document.getElementById('toolsCatalogRefresh').onclick=loadToolCatalog;
  registerPageLoader('reference',loadToolCatalog);
  const configReady=loadConfig();
  void pluginsReady;await configReady;
}
