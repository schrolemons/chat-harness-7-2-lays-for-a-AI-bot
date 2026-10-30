
import { api, esc } from '../../shared/api.js';
import { showConsoleToast } from '../../shared/navigation.js';
import { refreshUsageChart } from './usage-chart.js';
// layers/O/usage: explicit imports; initialize is called in the application startup order.



let usageSelectedKey;

let usageConversationsCache;

function usageNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e5) return (v / 1e4).toFixed(0) + ' 万';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万';
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function usageMoney(n, sym) {
  const s = sym || '¥';
  const v = Number(n) || 0;
  if (v === 0) return s + '0';
  if (v < 0.01) return s + v.toFixed(4);
  return s + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function usagePct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return (v * 100).toFixed(1) + '%';
}

function usageRate(buckets) {
  const b = buckets || {};
  const input = (b.cacheMiss || 0) + (b.cacheHit || 0) + (b.cacheWrite || 0);
  return input > 0 ? (b.cacheHit || 0) / input : 0;
}

function usageTime(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (error) { return '—'; }
}

function usageBar(share) {
  const ratio = Math.max(0, Math.min(1, Number(share) || 0));
  const width = Math.max(2, Math.round(ratio * 100));
  return `<span class="usage-bar-wrap"><span class="usage-bar-track"><span class="usage-bar-fill" style="width:${width}%"></span></span><span class="meta">${(ratio * 100).toFixed(1)}%</span></span>`;
}

function usageTierTag(tier) {
  if (tier === 'peak') return '<span class="pill r usage-tier">高峰</span>';
  if (tier === 'off') return '<span class="pill g usage-tier">空闲</span>';
  if (tier === 'mixed') return '<span class="pill b usage-tier">跨时段</span>';
  return '<span class="meta">—</span>';
}

function syncUsageKeySelect(keys) {
  const sel = document.getElementById('usageKeySelect');
  if (!sel) return;
  if (!keys.includes(usageSelectedKey)) usageSelectedKey = keys[0] || '';
  const signature = keys.join('\u0000');
  if (sel.dataset.signature !== signature) {
    sel.dataset.signature = signature;
    sel.innerHTML = keys.length
      ? keys.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')
      : '<option value="">（暂无会话）</option>';
  }
  // 每 3 秒的轮询不得覆盖用户正在操作的控件。
  if (document.activeElement !== sel) sel.value = usageSelectedKey;
}

function renderUsageConversations(r) {
  const box = document.getElementById('usageConversations');
  const list = r.conversations || [];
  const sym = r.symbol || '¥';
  usageConversationsCache = list;
  if (!list.length) {
    box.innerHTML = '<div class="empty-state"><strong>还没有用量记录</strong><p>QQ 会话产生一次 LLM 调用后，这里会按群 / 好友列出 token 与花费。新账本从桥接重启后开始记账。</p></div>';
    return;
  }
  const maxCost = Math.max(...list.map(x => Number(x.cost) || 0), 0);
  let html = '<table><tr><th>会话</th><th>类型</th><th class="num">轮数</th><th class="num">步数</th><th class="num">未命中输入</th><th class="num">命中输入</th><th class="num">命中率</th><th class="num">输出</th><th class="num">花费</th><th>占比</th></tr>';
  for (const c of list) {
    const key = String(c.key ?? '');
    const isInternal = key.startsWith('internal:');
    const type = isInternal ? '<span class="pill b">内部</span>'
      : (key.startsWith('private:') ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>');
    const b = c.buckets || {};
    html += '<tr>'
      + `<td class="usage-key"><button class="usage-key-button" data-usage-key="${esc(key)}" aria-pressed="${key === usageSelectedKey}">${esc(key)}</button></td>`
      + `<td>${type}</td>`
      + `<td class="num">${usageNum(c.turns)}</td>`
      + `<td class="num">${usageNum(c.steps)}</td>`
      + `<td class="num">${usageNum(b.cacheMiss)}</td>`
      + `<td class="num">${usageNum(b.cacheHit)}</td>`
      + `<td class="num">${usagePct(usageRate(b))}</td>`
      + `<td class="num">${usageNum(b.output)}</td>`
      + `<td class="num">${usageMoney(c.cost, sym)}</td>`
      + `<td>${usageBar(maxCost > 0 ? (Number(c.cost) || 0) / maxCost : 0)}</td>`
      + '</tr>';
  }
  html += '</table>';
  const totals = r.totals || {};
  if (Number(totals.unattributedCost) > 0) {
    html += `<div class="meta" style="padding:8px 10px">其中 ${usageMoney(totals.unattributedCost, sym)} 来自更早的回合：它们只剩累计值（在逐轮快照窗口之外），无法再拆到具体某一轮。</div>`;
  }
  if (totals.estimated) {
    html += '<div class="meta" style="padding:8px 10px">⚠️ 有模型未登记在价目表里，这部分按 <code>deepseek-flash</code> 兜底价估算，可在 <code>config.json</code> 的 <code>pricing.models</code> 补充。</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-usage-key]').forEach(btn => btn.addEventListener('click', () => {
    usageSelectedKey = btn.dataset.usageKey;
    box.querySelectorAll('[data-usage-key]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.usageKey === usageSelectedKey)));
    const sel = document.getElementById('usageKeySelect');
    if (sel) sel.value = usageSelectedKey;
    refreshUsageTurns();
  }));
}

let budgetRefreshRevision=0;
async function refreshUsageBudgets() {
  const ticket=++budgetRefreshRevision;
  const box = document.getElementById('usageBudgets');
  const msg = document.getElementById('usageBudgetMsg');
  if (box.contains(document.activeElement)||box.querySelector('[data-budget-dirty]')) return;
  try {
    const result = await api('/api/tokens/budgets');
    if(ticket!==budgetRefreshRevision||box.contains(document.activeElement)||box.querySelector('[data-budget-dirty]'))return;
    const rows = result.rows || [];
    const ownerEnabled = result.owner?.budgetEnabled !== false;
    const ownerInput = document.getElementById('usageOwnerBudgetEnabled');
    if (document.activeElement !== ownerInput && !ownerInput.dataset.dirty) ownerInput.checked = ownerEnabled;
    const money = (value) => usageMoney(value, result.symbol || '¥');
    const global = result.global || {};
    document.getElementById('usageGlobalTurns').textContent = usageNum(global.turns);
    document.getElementById('usageGlobalCost').textContent = money(global.cost);
    const globalInput = document.getElementById('usageGlobalLimit');
    if (document.activeElement !== globalInput) globalInput.value = Number(global.limit) || 0;
    const windows = result.recoveryWindows || {};
    for (const [id, field] of [['usageRecoveryPrivate', 'privateMessages'], ['usageRecoveryGroup', 'groupMessages'], ['usageRecoveryGroupAt', 'groupAtMessages']]) {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = Number(windows[field]) || 5;
    }
    document.getElementById('usageGlobalState').textContent = global.reached ? (ownerEnabled ? '已触发：全部会话进入机械回复' : '已触发：受限会话进入机械回复，owner 豁免') : global.remaining == null ? '未设统一上限' : `统一剩余 ${money(global.remaining)}`;
    box.innerHTML = rows.length ? '<table><tr><th>会话</th><th class="num">本周期轮数</th><th class="num">已用</th><th class="num">剩余</th><th>状态</th><th>冷漠阈值（元）</th><th>上限（元）</th><th>冷漠间隔（分钟）</th><th></th></tr>'
      + rows.map((row) => `<tr data-budget-key="${esc(row.key)}"><td>${esc(row.key)}</td><td class="num">${usageNum(row.turns)}</td><td class="num">${money(row.cost)}${row.partial ? ' <span title="部分历史用量无法按时段归属">*</span>' : ''}</td><td class="num">${row.remainingYuan == null ? '不限' : money(row.remainingYuan)}</td><td>${row.exempt ? '管理员豁免' : row.stage === 'silent' ? '机械回复' : row.stage === 'weak' ? '低频短回复' : '正常'}${Number(row.recoveryPending) > 0 ? `（待补 ${usageNum(row.recoveryPending)} 条）` : ''}</td><td><input type="number" min="0" step="0.01" value="${Number(row.coldLimitYuan) || 0}" style="width:90px"></td><td><input type="number" min="0" step="0.01" value="${Number(row.hardLimitYuan) || 0}" style="width:90px"></td><td><input type="number" min="1" max="1440" step="1" value="${Number(row.weakMinIntervalMin) || 30}" style="width:75px"></td><td><button class="small primary" data-budget-save data-save-action>保存此会话额度</button></td></tr>`).join('') + '</table>'
      : '<div class="empty-state">暂无可配置的会话；有 QQ 会话后会自动列出。</div>';
    if (rows.some((row) => row.partial)) {
      msg.textContent = '* 部分旧用量只有累计值，无法准确归入本周期；额度判断基于有时间戳的调用。';
      msg.className = 'meta';
    } else if (!msg.classList.contains('ok')) {
      msg.textContent = '';
      msg.className = 'meta';
    }
  } catch (error) {
    box.textContent = '阈值读取失败：' + (error?.message || '未知错误');
  }
}

let usageMechanicalDirty;

let mechanicalPrivateBox;

let mechanicalGroupBox;

async function refreshUsageMechanicalReplies() {
  if (usageMechanicalDirty) return;
  const msg = document.getElementById('usageMechanicalMsg');
  try {
    const result = await api('/api/tokens/budgets/replies');
    if (usageMechanicalDirty) return;
    mechanicalPrivateBox.value = (result.privateReplies || []).join('\n');
    mechanicalGroupBox.value = (result.groupReplies || []).join('\n');
    if (!msg.classList.contains('ok')) msg.textContent = '';
  } catch (error) { msg.textContent = '词条读取失败：' + error.message; msg.className = 'meta err'; }
}

function renderUsageTurns(r) {
  const box = document.getElementById('usageTurns');
  const scope = document.getElementById('usageTurnScope');
  const rows = r.turns || [];
  const sym = r.symbol || '¥';
  if (scope) {
    scope.textContent = `${esc(r.key || '')} ｜ 共 ${rows.length} 轮可追溯 ｜ 已归属 ${usageMoney(r.attributedCost, sym)}`
      + (Number(r.unattributedCost) > 0 ? ` ｜ 未逐轮归属 ${usageMoney(r.unattributedCost, sym)}` : '');
  }
  if (!rows.length) {
    box.innerHTML = '<span class="meta">该会话还没有可追溯的逐轮记录（只有累计值）。</span>';
    return;
  }
  let html = '<table><tr><th class="num">轮次</th><th>结束时间</th><th class="num">步数</th><th class="num">未命中输入</th><th class="num">命中输入</th><th class="num">命中率</th><th class="num">输出</th><th class="num">花费</th><th>时段</th></tr>';
  for (const t of rows) {
    const b = t.buckets || {};
    html += '<tr>'
      + `<td class="num">#${esc(t.turn)}</td>`
      + `<td>${esc(usageTime(t.endedAt))}</td>`
      + `<td class="num">${usageNum(t.steps)}</td>`
      + `<td class="num">${usageNum(b.cacheMiss)}</td>`
      + `<td class="num">${usageNum(b.cacheHit)}</td>`
      + `<td class="num">${usagePct(usageRate(b))}</td>`
      + `<td class="num">${usageNum(b.output)}</td>`
      + `<td class="num">${usageMoney(t.cost, sym)}</td>`
      + `<td>${usageTierTag(t.tier)}</td>`
      + '</tr>';
  }
  box.innerHTML = html + '</table>';
}

function renderUsageRecent(r) {
  const box = document.getElementById('usageRecent');
  const list = r.entries || [];
  const sym = r.symbol || '¥';
  if (!list.length) { box.innerHTML = '<span class="meta">（空）</span>'; return; }
  let html = '<table><tr><th>时间</th><th>会话</th><th class="num">轮</th><th class="num">步</th><th class="num">未命中</th><th class="num">命中</th><th class="num">输出</th><th class="num">花费</th><th>时段</th></tr>';
  for (const e of list) {
    html += '<tr>'
      + `<td>${esc(usageTime(e.time))}</td>`
      + `<td>${esc(e.key || '未归属')}</td>`
      + `<td class="num">#${esc(e.turn)}</td>`
      + `<td class="num">${esc(e.step)}</td>`
      + `<td class="num">${usageNum(e.cacheMiss)}</td>`
      + `<td class="num">${usageNum(e.cacheHit)}</td>`
      + `<td class="num">${usageNum(e.output)}</td>`
      + `<td class="num">${usageMoney(e.cost, sym)}</td>`
      + `<td>${usageTierTag(e.tier)}</td>`
      + '</tr>';
  }
  box.innerHTML = html + '</table>';
}

function renderUsagePrices(pt) {
  const box = document.getElementById('usagePrices');
  if (!pt || !pt.models) { box.textContent = '（价目表不可用）'; return; }
  const sym = pt.symbol || '¥';
  const tier = pt.nowTier;
  let html = `<div style="margin-bottom:6px">价目表版本 <code>${esc(pt.version)}</code> ｜ 高峰时段为北京时间的 2 倍价（周一至周五 9:00-12:00、14:00-18:00，法定节假日除外，已内置 ${esc(pt.holidayCount)} 天假期）</div>`;
  html += '<table><tr><th>模型</th><th class="num">缓存命中</th><th class="num">缓存未命中</th><th class="num">输出</th></tr>';
  for (const [name, m] of Object.entries(pt.models)) {
    // 单价与货币符号都可能来自 config.json 的 pricing 覆盖项（运维可写），
    // 不能直接拼进 innerHTML：这里统一走 esc() （数字原样显示仍然是数字）。
    const price = (v) => esc(sym + (Number.isFinite(Number(v)) ? Number(v) : (v ?? '')));
    html += `<tr><td><code>${esc(name)}</code><div class="meta">${esc(m.label)}</div></td>`
      + `<td class="num">${price(m.off?.cacheHit)}</td>`
      + `<td class="num">${price(m.off?.cacheMiss)}</td>`
      + `<td class="num">${price(m.off?.output)}</td></tr>`;
  }
  html += '</table>';
  html += `<div class="meta" style="padding:8px 10px">上表为<b>空闲时段</b>单价（元 / 百万 token）。当前时刻属于 <b>${tier ? esc(tier.tierLabel) : '—'}</b>${tier?.estimated ? '，且价目表里没有 <code>' + esc(tier.model) + '</code>，按兜底价估算' : ''}。</div>`;
  box.innerHTML = html;
}

async function refreshUsage() {
  const msg = document.getElementById('usageMsg');
  try {
    const r = await api('/api/tokens/summary?limit=200');
    const t = r.totals || {};
    const b = t.buckets || {};
    const sym = r.symbol || '¥';
    document.getElementById('metricUsageCost').textContent = usageMoney(t.cost, sym);
    document.getElementById('metricUsageCostHint').textContent =
      `高峰 ${usageMoney(t.byTier?.peak, sym)} ｜ 空闲 ${usageMoney(t.byTier?.off, sym)}`;
    document.getElementById('metricUsageTokens').textContent = usageNum(t.totalTokens);
    document.getElementById('metricUsageTokensHint').textContent =
      `输入 ${usageNum(t.inputTokens)} ｜ 输出 ${usageNum(b.output)}`;
    document.getElementById('metricUsageHitRate').textContent = usagePct(t.cacheHitRate);
    document.getElementById('metricUsageHitHint').textContent =
      `命中 ${usageNum(b.cacheHit)} ｜ 未命中 ${usageNum(b.cacheMiss)}`;
    document.getElementById('metricUsagePerTurn').textContent = usageMoney(t.avgCostPerTurn, sym);
    document.getElementById('metricUsagePerTurnHint').textContent =
      `${usageNum(t.turns)} 轮 ｜ ${usageNum(t.steps)} 步 ｜ 当前${r.nowTier?.tier === 'peak' ? '高峰' : '空闲'}时段`;
    renderUsageConversations(r);
    void refreshUsageBudgets();
    void refreshUsageMechanicalReplies();
    renderUsagePrices(r.priceTable ? { ...r.priceTable, nowTier: r.nowTier } : null);
    syncUsageKeySelect((r.conversations || []).map(c => String(c.key ?? '')));
    msg.textContent = `✅ 已同步于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    msg.className = 'meta ok';
  } catch (error) {
    msg.textContent = `❌ 读取失败：${error?.message || '未知错误'}`;
    msg.className = 'meta err';
  }
}

async function refreshUsageTurns() {
  const box = document.getElementById('usageTurns');
  if (!usageSelectedKey) {
    box.innerHTML = '<span class="meta">选择一个会话后加载逐轮明细…</span>';
    box.dataset.loaded = '';
    return;
  }
  try {
    const r = await api('/api/tokens/turns?key=' + encodeURIComponent(usageSelectedKey) + '&limit=200');
    renderUsageTurns(r);
    box.dataset.loaded = '1';
  } catch (error) {
    box.innerHTML = `<span class="meta err">读取失败：${esc(error?.message || '未知错误')}</span>`;
    box.dataset.loaded = '';
  }
}

async function refreshUsageRecent() {
  try {
    renderUsageRecent(await api('/api/tokens/recent?limit=40'));
  } catch (error) {
    document.getElementById('usageRecent').innerHTML = '<span class="meta">（读取失败）</span>';
  }
}

let usageDashboardRefresh;

function refreshUsageDashboard() {
  // Avoid overlapping page-load, navigation, button and polling requests. A
  // slower first response must not overwrite a newer billing snapshot.
  if (usageDashboardRefresh) return usageDashboardRefresh;
  usageDashboardRefresh = (async () => {
    await Promise.all([refreshUsage(), refreshUsageChart(), refreshUsageRecent()]);
    await refreshUsageTurns();
  })().finally(() => { usageDashboardRefresh = null; });
  return usageDashboardRefresh;
}

export function initialize() {
usageSelectedKey = '';
usageConversationsCache = [];
document.getElementById('usageOwnerBudgetEnabled').addEventListener('change', (event) => { event.target.dataset.dirty = 'true'; });
document.getElementById('usageOwnerBudgetSave').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const input = document.getElementById('usageOwnerBudgetEnabled');
  const msg = document.getElementById('usageBudgetMsg');
  button.disabled = true;
  try {
    await api('/api/tokens/budgets/owner', 'POST', { ownerBudgetEnabled: input.checked });
    delete input.dataset.dirty;
    button.blur();
    msg.textContent = '管理员额度设置已保存'; msg.className = 'meta ok';
    await refreshUsageBudgets();
  } catch (error) { msg.textContent = '保存失败：' + error.message; msg.className = 'meta err'; }
  finally { button.disabled = false; }
});
document.getElementById('usageBudgets').addEventListener('input',event=>{const row=event.target.closest('[data-budget-key]');if(row){row.dataset.budgetDirty='1';budgetRefreshRevision++;}});
document.getElementById('usageBudgets').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-budget-save]');
  if (!button) return;
  const row = button.closest('[data-budget-key]');
  const values = [...row.querySelectorAll('input')].map((input) => Number(input.value));
  const msg = document.getElementById('usageBudgetMsg');
  button.disabled = true;
  try {
    await api('/api/tokens/budgets', 'POST', { key: row.dataset.budgetKey, coldLimitYuan: values[0], hardLimitYuan: values[1], weakMinIntervalMin: values[2] });
    const unchanged=[...row.querySelectorAll('input')].every((input,index)=>Number(input.value)===values[index]);
    if(unchanged)delete row.dataset.budgetDirty;
    msg.textContent=unchanged?'已保存':'已保存提交值；之后的修改尚未保存';msg.className='meta ok';
    button.blur();
    await refreshUsageBudgets();
  } catch (error) { msg.textContent = '保存失败：' + error.message; msg.className = 'meta err'; }
  finally { button.disabled = false; }
});
document.getElementById('usageRecoverySave').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const msg = document.getElementById('usageBudgetMsg');
  button.disabled = true;
  try {
    await api('/api/tokens/budgets/recovery-windows', 'POST', {
      privateMessages: Number(document.getElementById('usageRecoveryPrivate').value),
      groupMessages: Number(document.getElementById('usageRecoveryGroup').value),
      groupAtMessages: Number(document.getElementById('usageRecoveryGroupAt').value)
    });
    msg.textContent = '全局恢复窗口已保存'; msg.className = 'meta ok';
    button.blur();
    await refreshUsageBudgets();
  } catch (error) { msg.textContent = '保存失败：' + error.message; msg.className = 'meta err'; }
  finally { button.disabled = false; }
});
document.getElementById('usageGlobalSave').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const msg = document.getElementById('usageBudgetMsg');
  button.disabled = true;
  try {
    await api('/api/tokens/budgets/global', 'POST', { globalHardLimitYuan: Number(document.getElementById('usageGlobalLimit').value) });
    button.blur();
    msg.textContent = '统一上限已保存'; msg.className = 'meta ok';
    await refreshUsageBudgets();
  } catch (error) { msg.textContent = '保存失败：' + error.message; msg.className = 'meta err'; }
  finally { button.disabled = false; }
});
usageMechanicalDirty = false;
mechanicalPrivateBox = document.getElementById('usageMechanicalPrivate');
mechanicalGroupBox = document.getElementById('usageMechanicalGroup');
for (const box of [mechanicalPrivateBox, mechanicalGroupBox]) box.addEventListener('input', () => { usageMechanicalDirty = true; });
document.getElementById('usageMechanicalSave').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const msg = document.getElementById('usageMechanicalMsg');
  const lines = (box) => box.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  button.disabled = true;
  try {
    const privateReplies = lines(mechanicalPrivateBox);
    const groupReplies = lines(mechanicalGroupBox);
    if (!privateReplies.length || !groupReplies.length) throw Error('私聊和群聊各需至少一条词条');
    await api('/api/tokens/budgets/replies', 'POST', { privateReplies, groupReplies });
    usageMechanicalDirty = false;
    button.blur();
    msg.textContent = `已保存：私聊 ${privateReplies.length} 条，群聊 ${groupReplies.length} 条`;
    msg.className = 'meta ok';
    await refreshUsageMechanicalReplies();
  } catch (error) { msg.textContent = '保存失败：' + error.message; msg.className = 'meta err'; }
  finally { button.disabled = false; }
});
usageDashboardRefresh = null;
document.getElementById('usageRefresh').addEventListener('click', () => {
  void refreshUsageDashboard();
  showConsoleToast('用量已刷新');
});
document.getElementById('usageTurnsLoad').addEventListener('click', () => refreshUsageTurns());
document.getElementById('usageKeySelect').addEventListener('change', (ev) => {
  usageSelectedKey = ev.target.value;
  refreshUsageTurns();
});
document.getElementById('usageClear').addEventListener('click', async () => {
  if (!confirm('确定清空 token 用量账本？累计花费与逐轮明细都会被删除，且不可恢复（下一次同步会从 DSH 重新拉取会话累计值）。')) return;
  const msg = document.getElementById('usageMsg');
  try {
    const r = await api('/api/tokens/reset', 'POST', {});
    msg.textContent = r.ok ? '✅ 账本已清空' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
  } catch (error) {
    msg.textContent = '❌ ' + (error?.message || '失败');
    msg.className = 'meta err';
  }
  usageSelectedKey = '';
  document.getElementById('usageTurnScope').textContent = '—';
  document.getElementById('usageTurns').dataset.loaded = '';
  refreshUsage();
  refreshUsageRecent();
});
}
export { usageSelectedKey, usageConversationsCache, usageNum, usageMoney, usagePct, usageRate, usageTime, usageBar, usageTierTag, syncUsageKeySelect, renderUsageConversations, refreshUsageBudgets, usageMechanicalDirty, mechanicalPrivateBox, mechanicalGroupBox, refreshUsageMechanicalReplies, renderUsageTurns, renderUsageRecent, renderUsagePrices, refreshUsage, refreshUsageTurns, refreshUsageRecent, usageDashboardRefresh, refreshUsageDashboard };
