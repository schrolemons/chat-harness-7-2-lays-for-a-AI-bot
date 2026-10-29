
import { api, esc } from '../../shared/api.js';
// layers/L/social-v1: explicit imports; initialize is called in the application startup order.

async function loadSocialForm() {
  try {
    const s = await api('/api/social');
    const c = s.config;
    document.getElementById('sTrigger').value = c.triggerProbability;
    document.getElementById('sCheckMin').value = Math.round((c.activeCheckMinMs || 0) / 1000);
    document.getElementById('sCheckMax').value = Math.round((c.activeCheckMaxMs || 0) / 1000);
    document.getElementById('sActiveDelayMin').value = Math.round((c.activeReplyDelayMinMs || 0) / 1000);
    document.getElementById('sActiveDelayMax').value = Math.round((c.activeReplyDelayMaxMs || 0) / 1000);
    document.getElementById('sActiveDurationEnabled').checked = c.activeDurationEnabled !== false;
    document.getElementById('sActiveDurationMin').value = Math.round((c.activeDurationMinMs || 0) / 60000);
    document.getElementById('sActiveDurationMax').value = Math.round((c.activeDurationMaxMs || 0) / 60000);
    document.getElementById('sIdleWindow').value = Math.round((c.idleWindowMs || 0) / 60000);
    document.getElementById('sIdleRetry').value = c.idleRetryProbability;
    document.getElementById('sIdleWait').value = Math.round((c.idleRetryWaitMs || 0) / 60000);
    document.getElementById('sSkipProb').value = c.skipProbability ?? 0.15;
    document.getElementById('sSurrenderProb').value = c.surrenderProbability ?? 0.08;
    document.getElementById('sContextWindow').value = c.contextWindow;
    document.getElementById('sMaxChars').value = c.maxReplyChars ?? 500;
    document.getElementById('sBurstEnabled').checked = c.burstEnabled !== false;
    document.getElementById('sBurstIntervalMin').value = c.burstIntervalMinMs ?? 1000;
    document.getElementById('sBurstIntervalMax').value = c.burstIntervalMaxMs ?? 3000;
    document.getElementById('sLongGapProb').value = c.longGapProbability ?? 0.1;
    document.getElementById('sLongGapMin').value = c.longGapMinMs ?? 2500;
    document.getElementById('sLongGapMax').value = c.longGapMaxMs ?? 5000;
    document.getElementById('sKeywords').value = (c.mustReplyKeywords || []).join(', ');
    document.getElementById('sProactiveEnabled').checked = c.proactiveEnabled !== false;
    document.getElementById('sProactiveIdle').value = Math.round((c.proactiveIdleThresholdMs || 0) / 60000);
    document.getElementById('sProactiveCheckMin').value = Math.round((c.proactiveCheckMinMs || 0) / 60000);
    document.getElementById('sProactiveCheckMax').value = Math.round((c.proactiveCheckMaxMs || 0) / 60000);
    document.getElementById('sProactiveProb').value = c.proactiveProbability;
  } catch {}
}

async function refreshSocialStatus() {
  try {
    const s = await api('/api/social');
    const buff = Object.entries(s.pendingSummaries || {}).map(([k, n]) => k + ':' + n).join('  ') || '无';
    const phaseLabel = { idle: '观望', active: '活跃', probing: '试探', exiting: '退场中' };
    const phaseClass = { idle: 'pill g', active: 'pill b', probing: 'pill r', exiting: 'pill' };
    const stateEntries = Object.entries(s.states || {});
    const sel = document.getElementById('sStateKey');
    const prevSel = sel.value;
    sel.innerHTML = '<option value="">选择会话</option>';
    for (const [k] of stateEntries) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    }
    if (prevSel && [...sel.options].some(o => o.value === prevSel)) sel.value = prevSel;
    let html = '摘要缓冲: ' + esc(buff) + '<br>状态:';
    if (!stateEntries.length) html += ' 暂无（发过消息的群会显示状态）';
    for (const [k, v] of stateEntries) {
      html += ` <span class="${phaseClass[v.phase] || 'pill'}">${esc(k)} · ${phaseLabel[v.phase] || esc(v.phase)}</span>`;
    }
    document.getElementById('socialStatus').innerHTML = html;
  } catch {}
}

async function setSocialPhase(phase) {
  const key = document.getElementById('sStateKey').value;
  if (!key) { alert('请先选择会话'); return; }
  const r = await api('/api/social/state', 'POST', { key, phase });
  document.getElementById('socialMsg').textContent = r.ok ? ('✅ 已设为' + (phase === 'active' ? '活跃' : '观望')) : ('❌ ' + (r.error || '失败'));
  document.getElementById('socialMsg').className = r.ok ? 'meta ok' : 'meta err';
  refreshSocialStatus();
}











export function initialize() {
document.getElementById('socialSave').addEventListener('click', async () => {
  const n = (id) => Number(document.getElementById(id).value);
  const r = await api('/api/social', 'POST', {
    triggerProbability: Math.min(1, Math.max(0, n('sTrigger'))),
    activeCheckMinMs: Math.max(5, n('sCheckMin')) * 1000,
    activeCheckMaxMs: Math.max(5, n('sCheckMax')) * 1000,
    activeReplyDelayMinMs: Math.max(0, n('sActiveDelayMin')) * 1000,
    activeReplyDelayMaxMs: Math.max(0, n('sActiveDelayMax')) * 1000,
    activeDurationEnabled: document.getElementById('sActiveDurationEnabled').checked,
    activeDurationMinMs: Math.max(1, n('sActiveDurationMin')) * 60000,
    activeDurationMaxMs: Math.max(1, n('sActiveDurationMax')) * 60000,
    idleWindowMs: Math.max(1, n('sIdleWindow')) * 60000,
    idleRetryProbability: Math.min(1, Math.max(0, n('sIdleRetry'))),
    idleRetryWaitMs: Math.max(1, n('sIdleWait')) * 60000,
    skipProbability: Math.min(1, Math.max(0, n('sSkipProb'))),
    surrenderProbability: Math.min(1, Math.max(0, n('sSurrenderProb'))),
    contextWindow: Math.min(100, Math.max(1, n('sContextWindow'))),
    maxReplyChars: Math.max(1, n('sMaxChars')),
    burstEnabled: document.getElementById('sBurstEnabled').checked,
    burstIntervalMinMs: Math.max(0, n('sBurstIntervalMin')),
    burstIntervalMaxMs: Math.max(0, n('sBurstIntervalMax')),
    longGapProbability: Math.min(1, Math.max(0, n('sLongGapProb'))),
    longGapMinMs: Math.max(0, n('sLongGapMin')),
    longGapMaxMs: Math.max(0, n('sLongGapMax')),
    mustReplyKeywords: document.getElementById('sKeywords').value.split(/[,，]/).map(x => x.trim()).filter(Boolean),
    proactiveEnabled: document.getElementById('sProactiveEnabled').checked,
    proactiveIdleThresholdMs: Math.max(1, n('sProactiveIdle')) * 60000,
    proactiveCheckMinMs: Math.max(1, n('sProactiveCheckMin')) * 60000,
    proactiveCheckMaxMs: Math.max(1, n('sProactiveCheckMax')) * 60000,
    proactiveProbability: Math.min(1, Math.max(0, n('sProactiveProb')))
  });
  document.getElementById('socialMsg').textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  document.getElementById('socialMsg').className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) { loadSocialForm(); refreshSocialStatus(); }
});
document.getElementById('socialFlush').addEventListener('click', async () => {
  const r = await api('/api/social/flush', 'POST', {});
  document.getElementById('socialMsg').textContent = r.ok ? '✅ 已触发摘要投喂' : ('❌ ' + (r.error || '失败'));
  document.getElementById('socialMsg').className = r.ok ? 'meta ok' : 'meta err';
});
document.getElementById('sStateActive').addEventListener('click', () => setSocialPhase('active'));
document.getElementById('sStateIdle').addEventListener('click', () => setSocialPhase('idle'));
}
export { loadSocialForm, refreshSocialStatus, setSocialPhase };
