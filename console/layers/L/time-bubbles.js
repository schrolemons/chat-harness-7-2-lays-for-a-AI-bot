
import { api } from '../../shared/api.js';
import { refreshV2Schedule } from './schedule.js';
// layers/L/time-bubbles: explicit imports; initialize is called in the application startup order.

function buildV2TimeBubbleRow(slot) {
  const div = document.createElement('div');
  div.className = 'row';
  div.dataset.tbRow = '1';
  div.dataset.tbId = String(slot.id || '');
  div.innerHTML = '<label style="flex:0 0 auto"><input type="checkbox" data-tb="enabled"> 启用</label>'
    + '<label style="flex:0 0 auto"><input type="checkbox" data-tb="locked"> 锁定</label>'
    + '<input type="number" data-tb="hour" min="0" max="23" style="width:64px">'
    + '<span>:</span>'
    + '<input type="number" data-tb="minute" min="0" max="59" style="width:64px">'
    + '<input type="text" data-tb="label" placeholder="时段名（午饭点）" style="width:130px">'
    + '<input type="text" data-tb="hint" placeholder="参考说法：咚咚咚 白饭端来了" style="flex:1">'
    + '<button class="small danger" data-tb-del>删除</button>';
  div.querySelector('[data-tb="enabled"]').checked = slot.enabled !== false;
  div.querySelector('[data-tb="locked"]').checked = slot.locked === true;
  div.querySelector('[data-tb="hour"]').value = slot.hour ?? 12;
  div.querySelector('[data-tb="minute"]').value = slot.minute ?? 0;
  div.querySelector('[data-tb="label"]').value = slot.label || '';
  div.querySelector('[data-tb="hint"]').value = slot.hint || '';
  div.querySelector('[data-tb-del]').addEventListener('click', () => { div.remove(); applyV2TimeBubbleLocks(); });
  div.querySelector('[data-tb="locked"]').addEventListener('change', () => applyV2TimeBubbleLocks());
  return div;
}

function applyV2TimeBubbleLocks() {
  const allLocked = document.getElementById('v2TbAllLocked')?.checked === true;
  document.querySelectorAll('#v2TimeBubbleRows [data-tb-row]').forEach((row) => {
    const rowLocked = row.querySelector('[data-tb="locked"]')?.checked === true;
    row.querySelectorAll('[data-tb]:not([data-tb="locked"]),[data-tb-del]').forEach((el) => { el.disabled = allLocked || rowLocked; });
    row.querySelector('[data-tb="locked"]').disabled = allLocked;
  });
  syncV2TimeBubbleCapacity();
}

function syncV2TimeBubbleCapacity() {
  const box = document.getElementById('v2TimeBubbleRows');
  const add = document.getElementById('v2TimeBubbleAdd');
  const msg = document.getElementById('v2TbCapacityMsg');
  const capacityInput = add?.closest('.settings-content')?.querySelector('.inline-component-settings .comp-form-num');
  const count = box?.querySelectorAll('[data-tb-row]').length || 0;
  const allLocked = document.getElementById('v2TbAllLocked')?.checked === true;
  const rawLimit = capacityInput?.value;
  const limit = rawLimit !== '' && Number.isFinite(Number(rawLimit)) ? Math.max(0, Math.floor(Number(rawLimit))) : Infinity;
  const overLimit = count > limit;
  if (add) add.disabled = allLocked || count >= limit;
  if (capacityInput) {
    capacityInput.disabled = overLimit;
    if (!overLimit) capacityInput.dataset.lastValidValue = capacityInput.value;
  }
  if (msg) {
    if (overLimit) msg.textContent = `当前已配置 ${count} 个时段，超过每日上限 ${limit}；请先删除多余时段，再调整上限。`;
    else if (allLocked) msg.textContent = `当前已配置 ${count}${Number.isFinite(limit) ? ' / ' + limit : ''} 个时段；冒泡栏已锁定。`;
    else if (count >= limit) msg.textContent = `当前已配置 ${count} / ${limit} 个时段，已达到上限，不能继续添加。`;
    else if (Number.isFinite(limit)) msg.textContent = `当前已配置 ${count} / ${limit} 个时段，还可添加 ${limit - count} 个。`;
    else msg.textContent = `当前已配置 ${count} 个时段。`;
  }
}

function renderV2TimeBubbles(list, allLocked = false) {
  const box = document.getElementById('v2TimeBubbleRows');
  if (!box) return;
  const lock = document.getElementById('v2TbAllLocked');
  if (lock) lock.checked = allLocked === true;
  box.innerHTML = '';
  (Array.isArray(list) ? list : []).forEach((s) => box.appendChild(buildV2TimeBubbleRow(s)));
  applyV2TimeBubbleLocks();
}

function collectV2TimeBubbles() {
  return [...document.querySelectorAll('#v2TimeBubbleRows [data-tb-row]')].map((row) => ({
    ...(row.dataset.tbId ? { id: row.dataset.tbId } : {}),
    enabled: row.querySelector('[data-tb="enabled"]').checked,
    locked: row.querySelector('[data-tb="locked"]').checked,
    hour: Math.min(23, Math.max(0, Math.round(Number(row.querySelector('[data-tb="hour"]').value) || 0))),
    minute: Math.min(59, Math.max(0, Math.round(Number(row.querySelector('[data-tb="minute"]').value) || 0))),
    label: row.querySelector('[data-tb="label"]').value.trim().slice(0, 20),
    hint: row.querySelector('[data-tb="hint"]').value.trim().slice(0, 120)
  }));
}

function setV2TbMsg(text) { const el = document.getElementById('v2TbMsg'); if (el) el.textContent = text || ''; }

async function loadV2TimeBubblesFor(key) {
  if (!key) { renderV2TimeBubbles([]); setV2TbMsg('请选择会话'); return; }
  try {
    const r = await api('/api/socialV2/time-bubbles?key=' + encodeURIComponent(key));
    if (!r.ok) throw new Error(r.error || '读取失败');
    const all = r.all || r.slots || [];
    renderV2TimeBubbles(all, r.allLocked === true);
    setV2TbMsg((all.length ? '该会话已配置时间冒泡。' : '当前没有时间冒泡。') + ' 共 ' + all.length + ' 个时段。');
  } catch (e) { setV2TbMsg('读取失败：' + (e && e.message ? e.message : e)); }
}

async function saveV2TimeBubblesFor(key) {
  if (!key) { setV2TbMsg('请选择会话'); return; }
  try {
    const r = await api('/api/socialV2/time-bubbles', 'POST', { key, slots: collectV2TimeBubbles(), allLocked: document.getElementById('v2TbAllLocked')?.checked === true });
    setV2TbMsg(r.ok ? (r.conflicts?.length
      ? ('⚠️ 已保存未锁时段；锁定时段 ' + r.conflicts.join('、') + ' 保持原样。')
      : ('✅ 已保存，共 ' + ((r.all || []).length) + ' 个时段')) : ('❌ ' + (r.error || '失败')));
    if (r.ok) loadV2TimeBubblesFor(key);
    else if (r.error === 'LOCKED_SCHEDULE') { setV2TbMsg('该冒泡栏或时段已锁定；先解锁，再保存。'); loadV2TimeBubblesFor(key); }
  } catch (e) { setV2TbMsg('保存失败：' + (e && e.message ? e.message : e)); }
}

async function resetV2TimeBubblesFor(key) {
  if (!key) return;
  if (!confirm('清空此会话的所有时间冒泡时段？')) return;
  try {
    const r = await api('/api/socialV2/time-bubbles', 'POST', { key, reset: true });
    setV2TbMsg(r.ok ? '✅ 已清空；此会话不会再发送时间冒泡' : ('❌ ' + (r.error || '失败')));
    if (r.ok) loadV2TimeBubblesFor(key);
  } catch (e) { setV2TbMsg('恢复失败：' + (e && e.message ? e.message : e)); }
}

async function loadV2FollowupSessionLimits(key) {
  const interval = document.getElementById('v2TbFollowupInterval');
  const daily = document.getElementById('v2TbFollowupDaily');
  const msg = document.getElementById('v2TbFollowupMsg');
  if (!interval || !daily) return;
  if (!key) { interval.value = ''; daily.value = ''; if (msg) msg.textContent = ''; return; }
  if (!key.startsWith('private:')) { interval.value = ''; daily.value = ''; if (msg) msg.textContent = '请选择 private: 私聊会话。'; return; }
  try {
    const response = await api('/api/plugins/detail?id=ctx-chat-topic-drive');
    const plugin = response.plugin || response;
    const limit = plugin.config?.sessionLimits?.[key] || {};
    interval.value = limit.minIntervalMinutes ?? '';
    daily.value = limit.dailyLimit ?? '';
    if (msg) msg.textContent = '空白项继承全局限制。';
  } catch (error) { if (msg) msg.textContent = '读取失败：' + error.message; }
}

async function saveV2FollowupSessionLimits() {
  const key = document.getElementById('v2FollowupSessionKey')?.value || '';
  const intervalEl = document.getElementById('v2TbFollowupInterval');
  const dailyEl = document.getElementById('v2TbFollowupDaily');
  const msg = document.getElementById('v2TbFollowupMsg');
  if (!key) { if (msg) msg.textContent = '请先选择 session。'; return; }
  if (!key.startsWith('private:')) { if (msg) msg.textContent = '跟进限制需选择 private:QQ号 会话。'; return; }
  try {
    const detail = await api('/api/plugins/detail?id=ctx-chat-topic-drive');
    const plugin = detail.plugin || detail;
    const config = plugin.config || {};
    const overrides = { ...(config.sessionLimits || {}) };
    const limit = {};
    if (intervalEl.value !== '') limit.minIntervalMinutes = Math.max(0, Math.min(10080, Math.round(Number(intervalEl.value) || 0)));
    if (dailyEl.value !== '') limit.dailyLimit = Math.max(0, Math.min(30, Math.round(Number(dailyEl.value) || 0)));
    if (Object.keys(limit).length) overrides[key] = limit; else delete overrides[key];
    const result = await api('/api/plugins/config', 'POST', { id: 'ctx-chat-topic-drive', config: { ...config, sessionLimits: overrides } });
    if (result.ok === false) throw Error(result.error || '保存失败');
    if (msg) msg.textContent = '已保存；生效值取全局与该 session 的较小值。';
  } catch (error) { if (msg) msg.textContent = '保存失败：' + error.message; }
}

export function initialize() {


document.getElementById('v2TimeBubbleAdd').addEventListener('click', () => {
  const box = document.getElementById('v2TimeBubbleRows');
  if (box) {
    const capacity = document.getElementById('v2TimeBubbleAdd')?.closest('.settings-content')?.querySelector('.inline-component-settings .comp-form-num');
    const limit = capacity && capacity.value !== '' ? Math.max(0, Math.floor(Number(capacity.value) || 0)) : Infinity;
    if (box.querySelectorAll('[data-tb-row]').length >= limit) { syncV2TimeBubbleCapacity(); return; }
    box.appendChild(buildV2TimeBubbleRow({ hour: 12, minute: 0, label: '', hint: '', enabled: true }));
    applyV2TimeBubbleLocks();
  }
});
document.getElementById('v2TbAllLocked').addEventListener('change', applyV2TimeBubbleLocks);
document.addEventListener('change', (event) => {
  const input = event.target;
  if (!input.matches?.('.inline-component-settings .comp-form-num') || !input.closest('.settings-content')?.querySelector('#v2TimeBubbleAdd')) return;
  const count = document.querySelectorAll('#v2TimeBubbleRows [data-tb-row]').length;
  const attempted = input.value === '' ? Infinity : Math.max(0, Math.floor(Number(input.value) || 0));
  if (count > attempted) {
    input.value = input.dataset.lastValidValue ?? '';
    syncV2TimeBubbleCapacity();
    return;
  }
  input.dataset.lastValidValue = input.value;
  syncV2TimeBubbleCapacity();
});
document.getElementById('v2TbFollowupSave').addEventListener('click', saveV2FollowupSessionLimits);
document.getElementById('v2FollowupSessionKey').addEventListener('change', (event) => loadV2FollowupSessionLimits(event.target.value));
document.getElementById('v2FollowupSessionRefresh').addEventListener('click', async () => {
  await refreshV2Schedule();
  await loadV2FollowupSessionLimits(document.getElementById('v2FollowupSessionKey').value);
});
document.getElementById('v2TbLoad').addEventListener('click', () => loadV2TimeBubblesFor(document.getElementById('v2TbKey').value));
document.getElementById('v2TbSave').addEventListener('click', () => saveV2TimeBubblesFor(document.getElementById('v2TbKey').value));
document.getElementById('v2TbReset').addEventListener('click', () => resetV2TimeBubblesFor(document.getElementById('v2TbKey').value));
}
export { buildV2TimeBubbleRow, applyV2TimeBubbleLocks, syncV2TimeBubbleCapacity, renderV2TimeBubbles, collectV2TimeBubbles, setV2TbMsg, loadV2TimeBubblesFor, saveV2TimeBubblesFor, resetV2TimeBubblesFor, loadV2FollowupSessionLimits, saveV2FollowupSessionLimits };
