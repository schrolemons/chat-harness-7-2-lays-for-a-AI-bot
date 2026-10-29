
import { api, esc } from '../../shared/api.js';
import { loadV2FollowupSessionLimits } from './time-bubbles.js';
// layers/L/schedule: explicit imports; initialize is called in the application startup order.


async function refreshV2Schedule() {
  const msg = document.getElementById('v2ScheduleMsg');
  const listEl = document.getElementById('v2ScheduleList');
  const sel = document.getElementById('v2ReminderKey');
  if (!msg || !listEl || !sel) return;
  try {
    const [r, sch] = await Promise.all([
      api('/api/socialV2/states'),
      api('/api/socialV2/schedules', 'POST', { action: 'list' })
    ]);
    const convs = r.conversations || [];
    const schMap = new Map();
    for (const c of (sch && sch.conversations) || []) schMap.set(c.key, c);
    // 填充各自功能的会话下拉；跟进覆盖值仅适用于私聊。
    const fillKeys = (el) => {
      if (!el) return;
      const prev = el.value;
      el.innerHTML = convs.length ? convs.map((c) => '<option value="' + esc(c.key) + '">' + esc(c.key) + '</option>').join('') : '<option value="">（暂无会话）</option>';
      if (prev && convs.some((c) => c.key === prev)) el.value = prev;
    };
    fillKeys(document.getElementById('v2TbKey'));
    fillKeys(document.getElementById('v2PmKey'));
    const followupKey = document.getElementById('v2FollowupSessionKey');
    if (followupKey) {
      const previous = followupKey.value;
      const privateConvs = convs.filter((c) => String(c.key || '').startsWith('private:'));
      followupKey.innerHTML = privateConvs.length
        ? privateConvs.map((c) => '<option value="' + esc(c.key) + '">' + esc(c.key) + '</option>').join('')
        : '<option value="">（暂无私聊会话）</option>';
      if (previous && privateConvs.some((c) => c.key === previous)) followupKey.value = previous;
      if (followupKey.value) await loadV2FollowupSessionLimits(followupKey.value);
      else await loadV2FollowupSessionLimits('');
    }
    const cur = sel.value;
    sel.innerHTML = convs.length
      ? convs.map((c) => '<option value="' + esc(c.key) + '">' + esc(c.key) + '</option>').join('')
      : '<option value="">（暂无会话）</option>';
    if (cur && convs.some((c) => c.key === cur)) sel.value = cur;
    const repeatLabel = (rep) => (rep === 'daily' ? '每天重复' : rep === 'weekly' ? '每周重复' : '一次性');
    const scheduleSessions = (sch && sch.conversations || []).filter((c) => Array.isArray(c.items) && c.items.length);
    const rows = [];
    let scheduleCount = 0;
    const remainingLabel = (dueAt) => {
      const delta = Number(dueAt) - Date.now();
      if (delta <= 0) return '待提醒';
      if (delta < 60 * 60 * 1000) return '1 小时内';
      if (delta < 24 * 60 * 60 * 1000) return '今天';
      return Math.ceil(delta / (24 * 60 * 60 * 1000)) + ' 天后';
    };
    for (const c of scheduleSessions) {
      const items = [...c.items].sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
      scheduleCount += items.length;
      const isGroup = String(c.key || '').startsWith('group:');
      rows.push('<section class="schedule-session"><header class="schedule-session-head">'
        + '<span class="schedule-session-kind">' + (isGroup ? '群聊' : '私聊') + '</span>'
        + '<strong class="schedule-session-key">' + esc(c.key) + '</strong>'
        + '<span class="schedule-session-count">' + items.length + ' 条待办</span></header>');
      for (const it of items) {
        const dueAt = Number(it.dueAt) || 0;
        const dueDate = dueAt ? new Date(dueAt) : new Date(NaN);
        const dateText = Number.isFinite(dueDate.getTime()) ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' }).format(dueDate) : String(it.when || '时间未设置');
        const timeText = Number.isFinite(dueDate.getTime()) ? dueDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        const extra = [it.place ? '地点：' + it.place : '', it.detail ? '备注：' + it.detail : ''].filter(Boolean).join('　·　');
        // 提前量：每条日程自己的 leadMinutes；缺字段/未指定时由服务端按全局默认（30）解析。
        const rawLead = Number(it.leadMinutes);
        const leadMinutes = Number.isFinite(rawLead) ? Math.min(1440, Math.max(0, Math.round(rawLead))) : 30;
        const leadIsDefault = it.leadIsDefault === true;
        const remindAt = Number(it.remindAt) || (dueAt ? dueAt - leadMinutes * 60 * 1000 : 0);
        const remindText = remindAt && Number.isFinite(new Date(remindAt).getTime())
          ? new Date(remindAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
          : '';
        const leadEncKey = esc(encodeURIComponent(c.key));
        const intervalMinutes = Number.isInteger(Number(it.intervalMinutes)) ? Math.min(1440, Math.max(1, Number(it.intervalMinutes))) : 30;
        const nextReminderAt = Number(it.nextReminderAt) || remindAt;
        const nextReminderText = nextReminderAt && Number.isFinite(new Date(nextReminderAt).getTime())
          ? new Date(nextReminderAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
          : '';
        const nextReminderLabel = Number(it.lastRemindedAt) > 0 ? '下次 ' : (nextReminderAt <= Date.now() ? '待首次补发 ' : '首次 ');
        rows.push('<article class="schedule-card"><div class="schedule-card-date"><span>' + esc(dateText) + '</span>'
          + '<strong>' + esc(timeText) + '</strong><small>' + esc(remainingLabel(dueAt)) + '</small></div>'
          + '<div class="schedule-card-body"><div class="schedule-card-title">' + esc(it.title || '未命名日程') + '</div>'
          + '<div class="schedule-card-meta">' + esc(repeatLabel(it.repeat)) + '</div>'
          + (extra ? '<div class="schedule-card-extra">' + esc(extra) + '</div>' : '')
          + '<div class="schedule-card-lead">开始前 <input type="number" min="0" max="1440" step="1" value="' + leadMinutes + '" data-lead-key="' + leadEncKey
          + '" data-lead-id="' + esc(it.id) + '" aria-label="提醒开始提前分钟数"> 分钟；之后每 <input type="number" min="1" max="1440" step="1" value="' + intervalMinutes + '" data-interval-id="' + esc(it.id) + '" aria-label="提醒间歇分钟数"> 分钟提醒'
          + ' <button type="button" class="small" data-lead-save="1" data-lead-key="' + leadEncKey + '" data-lead-id="' + esc(it.id)
          + '">保存提醒设置</button>'
          + ' <button type="button" class="small" data-sch-complete="1" data-sch-key="' + leadEncKey + '" data-sch-id="' + esc(it.id)
          + '" data-sch-title="' + esc(encodeURIComponent(String(it.title || ''))) + '">确认已去做</button>'
          + ' <span class="meta">' + (leadIsDefault ? '提前量跟随全局默认' : '提前量单独设置') + (remindText ? ' · 开始 ' + esc(remindText) : '') + (nextReminderText ? ' · ' + nextReminderLabel + esc(nextReminderText) : '') + '</span></div></div>'
          + '<button type="button" class="small danger schedule-card-delete" aria-label="删除日程 ' + esc(it.title || '') + '" data-sch-delete="1" data-sch-key="' + esc(encodeURIComponent(c.key))
          + '" data-sch-id="' + esc(it.id) + '" data-sch-title="' + esc(encodeURIComponent(String(it.title || ''))) + '">删除</button></article>');
      }
      rows.push('</section>');
    }
    listEl.innerHTML = rows.join('') || '<div class="schedule-empty">暂无待办日程。选择会话并填写时间与内容即可添加。</div>';
    listEl.querySelectorAll('[data-sch-delete]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('删除日程「' + decodeURIComponent(btn.dataset.schTitle || '') + '」？')) return;
      const res = await api('/api/socialV2/schedules', 'POST', { action: 'cancel', key: decodeURIComponent(btn.dataset.schKey), id: btn.dataset.schId });
      if (res && res.ok === false) alert('删除失败：' + (res.error || '未知错误'));
      await refreshV2Schedule();
    }));
    listEl.querySelectorAll('[data-sch-complete]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('确认「' + decodeURIComponent(btn.dataset.schTitle || '') + '」已经去做了吗？')) return;
      const res = await api('/api/socialV2/schedules', 'POST', { action: 'complete', key: decodeURIComponent(btn.dataset.schKey || ''), id: btn.dataset.schId });
      if (res && res.ok === false) alert('确认失败：' + (res.error || '未知错误'));
      await refreshV2Schedule();
    }));
    // 逐条改提前量：action=update（服务端改完立刻生效，下一个 tick 用新值）。
    listEl.querySelectorAll('[data-lead-save]').forEach((btn) => btn.addEventListener('click', async () => {
      const row = btn.closest('.schedule-card-lead');
      const leadInput = row ? row.querySelector('input[data-lead-id]') : null;
      const intervalInput = row ? row.querySelector('input[data-interval-id]') : null;
      const raw = leadInput ? String(leadInput.value || '').trim() : '';
      const rawInterval = intervalInput ? String(intervalInput.value || '').trim() : '';
      const minutes = Number(raw), interval = Number(rawInterval);
      if (raw === '' || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || !Number.isInteger(interval) || interval < 1 || interval > 1440) {
        alert('提醒开始提前量需为 0–1440 的整数，间歇周期需为 1–1440 的整数（分钟）');
        return;
      }
      btn.disabled = true;
      const res = await api('/api/socialV2/schedules', 'POST', {
        action: 'update',
        key: decodeURIComponent(btn.dataset.leadKey || ''),
        id: btn.dataset.leadId,
        leadMinutes: minutes,
        intervalMinutes: interval
      });
      btn.disabled = false;
      if (res && res.ok === false) alert('修改提醒设置失败：' + (res.error || '未知错误'));
      await refreshV2Schedule();
    }));
    msg.textContent = (sch && sch.ok === false)
      ? ('日程读取失败：' + (sch.error || '组件未启用'))
      : ('已刷新，共 ' + scheduleCount + ' 条待办');
  } catch (e) {
    msg.textContent = '读取失败：' + (e && e.message ? e.message : e);
  }
}

export function initialize() {


document.getElementById('v2ScheduleRefresh').addEventListener('click', refreshV2Schedule);
document.getElementById('v2ReminderAdd').addEventListener('click', async () => {
  const key = document.getElementById('v2ReminderKey').value;
  const date = document.getElementById('v2ReminderDate').value;
  const time = document.getElementById('v2ReminderTime').value || '09:00';
  const text = document.getElementById('v2ReminderText').value.trim();
  const repeatMap = { '无': 'none', '每天': 'daily', '每周': 'weekly' };
  const repeat = repeatMap[document.getElementById('v2ReminderRepeat').value] || 'none';
  const msg = document.getElementById('v2ScheduleMsg');
  if (!key || !date || !text) { msg.textContent = '请先选择会话、填日期和内容'; return; }
  const leadEl = document.getElementById('v2ReminderLead');
  const intervalEl = document.getElementById('v2ReminderInterval');
  const leadRaw = leadEl ? String(leadEl.value || '').trim() : '';
  const intervalRaw = intervalEl ? String(intervalEl.value || '').trim() : '';
  const payload = { action: 'add', key, title: text, when: date + ' ' + time, repeat };
  if (leadRaw !== '') {
    const leadMinutes = Number(leadRaw);
    if (!Number.isFinite(leadMinutes) || Math.round(leadMinutes) < 0 || Math.round(leadMinutes) > 1440) {
      msg.textContent = '提前量要是 0–1440 的整数（分钟）';
      return;
    }
    payload.leadMinutes = Math.round(leadMinutes);
  }
  if (intervalRaw !== '') {
    const intervalMinutes = Number(intervalRaw);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
      msg.textContent = '间歇周期要是 1–1440 的整数（分钟）';
      return;
    }
    payload.intervalMinutes = intervalMinutes;
  }
  const r = await api('/api/socialV2/schedules', 'POST', payload);
  if (r && r.ok !== false) {
    msg.textContent = '✅ 已添加日程：' + (r.item ? (r.item.when + ' · ' + r.item.title + ' · 提前 ' + r.item.leadMinutes + ' 分钟开始，每 ' + r.item.intervalMinutes + ' 分钟提醒' + (r.leadClamped ? '（已夹取）' : '')) : text);
    document.getElementById('v2ReminderText').value = '';
  } else {
    msg.textContent = '❌ ' + ((r && r.error) || '添加失败');
  }
  refreshV2Schedule();
});
}
export { refreshV2Schedule };
