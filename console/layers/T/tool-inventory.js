import {TOOL_PRESENTATION} from './tool-presentation.js';
import { TOOL_CONFIG_FLAGS } from "../../../src/tools/flags.js";
import { api, esc } from '../../shared/api.js';
import { registerPageLoader } from '../../shared/page-loaders.js';
function toolRows(tools) {
  return tools.map(tool=>'<div class="tool-reference-item"><code>'+esc(tool.qualifiedName)+'</code><span>'+esc(tool.description)+'<br><small>'+esc(tool.server)+' · '+(tool.botInjectedSessions||0)+' 个聊天会话有注入记录</small></span></div>').join('');
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
export async function renderToolInventory() {
  const groups=new Map();
  for(const [name,flag] of Object.entries(TOOL_CONFIG_FLAGS)) {
    if(!groups.has(flag))groups.set(flag,[]);
    groups.get(flag).push(name);
  }
  const root=document.getElementById('v2Tools');
  const sections=new Map();
  for(const [flag,names]of groups){const view=TOOL_PRESENTATION[flag]||{group:'其他能力',label:names.join(' / '),example:'调整后需保存，并刷新对应MCP工具清单。'};if(!sections.has(view.group))sections.set(view.group,[]);sections.get(view.group).push({flag,names,...view});}
  root.innerHTML=[...sections].map(([title,items])=>'<details class="tool-parameter-group"><summary>'+esc(title)+'<small class="meta" data-tool-group-count></small></summary><div class="tool-parameter-options">'+items.map(({flag,names,label,example})=>'<label class="v2-tool-item"><input type="checkbox" data-v2-tool="'+esc(flag)+'"><span><b>'+esc(label)+'</b><small class="meta">'+esc(names.join(' / '))+'</small><small class="parameter-example">'+esc(example)+'</small></span></label>').join('')+'</div></details>').join('');
  const config=await api('/api/socialV2/config');
  root.querySelectorAll('[data-v2-tool]').forEach(input=>{input.checked=config.config?.tools?.[input.dataset.v2Tool]!==false;});
  const updateCounts=()=>root.querySelectorAll('.tool-parameter-group').forEach(group=>{const all=group.querySelectorAll('[data-v2-tool]');group.querySelector('[data-tool-group-count]').textContent=' · 勾选 '+[...all].filter(x=>x.checked).length+'/'+all.length;});
  updateCounts();root.onchange=updateCounts;

  const balance=(await api('/api/plugins')).plugins?.find(p=>p.id==='tool-deepseek-balance');
  const extras=document.getElementById('toolSwitchExtras');
  if(balance){
   const row=document.createElement('div');row.id='balanceToolControl';row.dataset.componentId=balance.id;
   row.innerHTML='<label class="v2-tool-item"><input type="checkbox" id="balanceToolEnabled"'+(balance.enabled?' checked':'')+'><span><b>DeepSeek 余额查询</b><span class="meta">管理员私聊只读查询；开关即时生效。</span></span></label><span class="meta" role="status"></span>';
   extras.before(row);
   row.querySelector('input').addEventListener('change',async event=>{
    const input=event.target,previous=!input.checked,msg=row.querySelector('[role=status]');input.disabled=true;
    try{const out=await api('/api/plugins/toggle','POST',{id:balance.id,enabled:input.checked});if(out.ok!==true)throw Error(out.error||'更新失败');msg.textContent=input.checked?'已启用':'已停用';}
    catch(error){input.checked=previous;msg.textContent='更新失败：'+error.message;}
    finally{input.disabled=false;}
   });
  }
  document.getElementById('toolSwitchExtras').textContent='开关来自 MCP 的唯一注册定义。组件工具在所属层管理；工具参考只把有真实请求注入证据的聊天工具列为可用。';
  document.getElementById('toolsCatalogRefresh').addEventListener('click',loadToolCatalog);
  registerPageLoader('reference',loadToolCatalog);
  await loadToolCatalog();
}
