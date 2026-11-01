import {api} from '../../shared/api.js';
import {presetInfo} from '../O/preset-catalog.js';
let rows=[];
let selected='';
function help() {
  const select=document.getElementById('v2AdminDevPreset');
  const target=document.getElementById('envAdminPresetExample');
  if(!select||!target)return;
  const row=rows.find(p=>p.id===select.value);
  const current=rows.find(p=>p.isDefault);
  target.textContent=select.value ? (row ? presetInfo(row).description : '当前预设尚未由 DSH 列出，请确认已安装。') : '跟随 DSH 默认'+(current ? '：'+presetInfo(current).label+' · '+current.id : '（等待 DSH 返回默认项）')+'。控制基础指令与可用工具。';
}
export function renderAdminPresets(value=selected) {
  const select=document.getElementById('v2AdminDevPreset');
  if(!select)return;
  selected=value;
  select.replaceChildren(new Option('跟随 DSH 默认',''));
  for(const row of rows) {
    const info=presetInfo(row), option=new Option(info.label+' · '+row.id+(row.broken?'（不可用）':''),row.id);
    option.title=row.broken?'不可用：'+row.broken:info.description;
    option.disabled=Boolean(row.broken);
    select.append(option);
  }
  if(value&&!rows.some(p=>p.id===value))select.append(new Option('当前配置（DSH 未列出） · '+value,value));
  select.value=value;
  select.onchange=()=>{selected=select.value;help();};
  help();
}
export async function refreshAdminPresets() {
  try {
    const data=await api('/api/presets');
    if(!Array.isArray(data.presets))throw Error(data.error||'目录返回不完整');
    rows=data.presets;
    renderAdminPresets();
  }catch(error){
    const target=document.getElementById('envAdminPresetExample');
    if(target)target.textContent='预设目录读取失败：'+error.message+'。重新进入本页可重试。';
  }
}
