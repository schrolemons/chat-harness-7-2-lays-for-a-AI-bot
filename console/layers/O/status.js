
import { api } from '../../shared/api.js';
import { updateOverview, setConnectionError } from '../../shared/navigation.js';
import {presetChoices,presetInfo} from './preset-catalog.js';
let presetRows=[];
function renderPresetChoices(selected) {
  const select=document.getElementById('closedPreset');
  if(!select)return;
  select.replaceChildren(new Option('跟随 DSH 默认（推荐）',''));
  const groups=new Map();
  for(const p of presetChoices(presetRows,document.getElementById('showAllPresets')?.checked,selected)){
    if(!groups.has(p.group)){const group=document.createElement('optgroup');group.label=p.group;groups.set(p.group,group);select.append(group);}
    const option=new Option(p.label+' · '+p.id,p.id);option.title=p.description;groups.get(p.group).append(option);
  }
  select.value=selected;
  updatePresetHelp();
}
function updatePresetHelp(mode) {
  const select=document.getElementById('closedPreset'),help=document.getElementById('closedPresetHelp');
  if(!select||!help)return;
  const p=presetRows.find(p=>p.id===select.value)||{id:select.value};
  help.textContent=select.value?presetInfo(p).description:'使用 DSH 当前声明的默认预设，通常无需另选。';
  const scope=document.getElementById('closedPresetScope');
  if(scope&&mode)scope.textContent=mode==='closed-agent'?'作用范围：当前管理员封闭 Agent 模式。切换选项后立即保存。':'作用范围：仅封闭 Agent 模式；当前聊天或仿真模式的预设由桥接自动选择。';
}
// layers/O/status: explicit imports; initialize is called in the application startup order.


function fmtAgoMs(ms) {
  if (ms === null || ms === undefined || ms === '') return '未知';
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '未知';
  if (n < 1000) return '刚刚';
  if (n < 60_000) return Math.round(n / 1000) + ' 秒';
  if (n < 3_600_000) return Math.round(n / 60_000) + ' 分钟';
  if (n < 86_400_000) return Math.round(n / 3_600_000) + ' 小时';
  return Math.round(n / 86_400_000) + ' 天';
}

function renderSnowlumaHealth(sl) {
  const el = document.getElementById('snowlumaWarn');
  const strong = document.getElementById('metricSnowluma');
  const hint = document.getElementById('metricSnowlumaHint');
  if (!el || !strong || !hint) return;
  if (!sl || typeof sl !== 'object') {
    el.style.display = 'none';
    strong.textContent = '未知';
    strong.className = '';
    hint.textContent = '桥接未上报上游健康（旧版桥接）';
    return;
  }
  const degraded = sl.degraded === true;
  const connected = sl.connected === true;
  const ago = sl.lastPacketAgoMs;
  const receiving = Number.isFinite(ago);
  const goodText = sl.good === true ? 'good=true' : sl.good === false ? 'good=false' : 'good 未知';
  if (degraded) {
    strong.textContent = '已连接 · 未接收';
    strong.className = 'err';
    hint.textContent = '网关连着，但 QQ 侧数据没到';
  } else if (!connected) {
    strong.textContent = '未连接';
    strong.className = 'err';
    hint.textContent = '连不上 QQ 网关，请先启动 SnowLuma';
  } else {
    strong.textContent = '正常 · 接收中';
    strong.className = 'ok';
    hint.textContent = (receiving ? '最近一份上游事件包在 ' + fmtAgoMs(ago) + '前 · ' : '')
      + (sl.good === false ? 'good=false' : sl.good === true ? 'good=true' : 'good 未上报');
  }
  if (!degraded) { el.style.display = 'none'; return; }
  document.getElementById('snowlumaWarnHint').textContent = sl.hint
    || '桥接与 QQ 网关的 WebSocket 连着，但一直收不到 QQ 侧的数据。';
  document.getElementById('snowlumaWarnPkt').textContent = (receiving ? fmtAgoMs(ago) + '前' : '从未收到')
    + (sl.lastPacketKind ? '（' + sl.lastPacketKind + '）' : '');
  document.getElementById('snowlumaWarnGood').textContent = goodText;
  el.style.display = '';
}

async function refresh() {
  try {
    const s = await api('/api/status');
    document.querySelectorAll('#modeRow button').forEach(b => (b.classList.toggle('active', b.dataset.mode === s.mode), b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode))));
    document.getElementById('roleText').textContent = s.role || '无';
    document.getElementById('roleModeText').textContent = s.roleMode === 'silent' ? '静默' : '正常';
    const modeLabel = s.mode === 'reserved' ? '一代仿真模式' : s.mode === 'reserved2' ? '二代仿真模式' : s.mode === 'closed-agent' ? '封闭 Agent' : '聊天模式';
    updateOverview(s, modeLabel);
    document.getElementById('activity').textContent = s.activity || '（空）';
    const presetSel = document.getElementById('closedPreset');
    if (presetSel && document.activeElement !== presetSel) renderPresetChoices(s.closedAgentPreset || '');
    updatePresetHelp(s.mode);
  } catch (e) { document.getElementById('statusText').textContent = '连接中断 · 请检查桥接服务'; setConnectionError(e); }
}

async function refreshPresets() {
  try {
    const r = await api('/api/presets');
    presetRows=r.presets||[];
    renderPresetChoices(document.getElementById('closedPreset').value);
    refresh();
  } catch {}
}

async function saveMode(mode) {
  // 不再硬编码 'router-standard'（DSH 0.1.5 已无此 preset）；
  // 留空表示让桥接使用 DSH 自己声明的默认 preset。
  const preset = document.getElementById('closedPreset').value || '';
  const r = await api('/api/mode', 'POST', { mode, closedAgentPreset: preset });
  if (r.ok) {
    refresh();
    // 桥接会把模式写穿到 DSH 设置；写穿失败时本地值会在下一次 5 秒轮询被覆盖回滚。
    // 不提示的话用户只会看到「刚切过去又自己变回来了」，无从判断原因。
    if (r.dshSynced === false) {
      alert('模式已写入本地，但未能同步到 DSH 设置（DSH 未运行？）——\n下一次轮询（约 5 秒）会把模式改回去。请检查 DSH 与桥接日志。');
    }
  } else {
    alert(r.error || '切换失败');
  }
  return r;
}

export function initialize() {
  document.getElementById('showAllPresets')?.addEventListener('change',()=>renderPresetChoices(document.getElementById('closedPreset').value));
  document.getElementById('closedPreset')?.addEventListener('change',()=>updatePresetHelp());
}
export { fmtAgoMs, renderSnowlumaHealth, refresh, refreshPresets, saveMode };
