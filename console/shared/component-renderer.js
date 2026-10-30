import { isInternalPromptComponent } from './components/presentation.js';

import { componentUI } from './components/service.js';
import { loadComponentDetail } from './components/detail.js';
import { renderToolInventory } from '../layers/T/tool-inventory.js';
import { COMPONENT_OWNERS, componentPage } from './components/ownership.js';
import { api, esc } from './api.js';
import { refresh } from '../layers/O/status.js';
import { syncV2TimeBubbleCapacity } from '../layers/L/time-bubbles.js';
import { currentConsolePage } from './navigation.js';
import { featureIndex } from './accessibility.js';
import { refreshUsage } from '../layers/O/usage.js';
import { COMPONENT_FORMS } from './components/forms.js';
// shared/component-renderer: explicit imports; initialize is called in the application startup order.








export function initialize() {
  const pluginsReady=api('/api/plugins');
  void renderToolInventory(pluginsReady).catch(error=>{document.getElementById('toolSwitchStatus').textContent='工具开关加载失败：'+error.message;});
(() => {

  const COMP_LAYERS = [
    { id: 'C', name: '上下文与记忆' }, { id: 'T', name: '工具接口与协议' }, { id: 'E', name: '环境与执行' },
    { id: 'L', name: '生命周期与编排' }, { id: 'O', name: '可观测与运维' }, { id: 'V', name: '验证与评估' },
    { id: 'G', name: '治理与安全' }, { id: 'S', name: 'SCHNIE 参考' }, { id: '', name: '组件注册中心' }
  ];
  let compCache = [];





  // ── 组件配置表单：把「大黑框 + {}」换成勾选/下拉/数字的可视化编辑 ──────────












  // 暴露给 V/S 等单层页复用：渲染某层全部组件（含配置编辑）。
  componentUI.renderLayer = async (layerId, rootOrId) => {
    if (!compCache.length) { const d = await api('/api/plugins'); compCache = d.plugins || []; }
    const root = typeof rootOrId === 'string' ? document.getElementById(rootOrId) : rootOrId;
    if (!root) return;
    const items = compCache.filter((p) => !isInternalPromptComponent(p) && (p.layer || '') === layerId && !(layerId === 'V' && p.id === 'human'));
    root.innerHTML = items.length ? items.map((p) => `<details class="comp-card" open data-id="${esc(p.id)}"><summary><b>${esc(p.name)}</b><span class="meta">${esc(p.id)} v${esc(p.version || '0')}</span></summary><div class="meta">${esc(p.description)}</div><div class="comp-body">加载详情…</div></details>`).join('') : '<p class="meta">当前没有可配置功能。</p>';
    root.querySelectorAll('details.comp-card').forEach((d) => { loadComponentDetail(d.dataset.id, d); d.addEventListener('toggle', () => { if (d.open) loadComponentDetail(d.dataset.id, d); }); });
  };

  // 暴露给「环境与执行」页复用：按 id 渲染指定组件（含配置编辑）。
  componentUI.renderIds = async (ids, rootOrId) => {
    if (!compCache.length) { const d = await api('/api/plugins'); compCache = d.plugins || []; }
    const root = typeof rootOrId === 'string' ? document.getElementById(rootOrId) : rootOrId;
    if (!root) return;
    const items = compCache.filter((p) => !isInternalPromptComponent(p) && (ids || []).includes(p.id));
    root.innerHTML = items.length ? items.map((p) => `<div class="comp-card" data-id="${esc(p.id)}" data-hide-toggle="${root.dataset.hideToggle === '1' || ['ctx-memory-profile-store', 'life-campus-watch', 'exec-image-generation'].includes(p.id) ? '1' : '0'}" data-save-label="${esc(root.dataset.saveLabel || '')}" data-toggle-label="${p.id === 'exec-browser-manager' ? '启用 DOM 操作' : esc(p.name)}" data-inline-fields="${esc(root.dataset.fields || '')}"><div class="comp-body">加载设置…</div></div>`).join('') : '';
    await Promise.all([...root.querySelectorAll('.comp-card')].map((d) => loadComponentDetail(d.dataset.id, d)));
  };

  componentUI.loadMessageAck = async () => {
    const root = document.getElementById('messageAckComponentRoot');
    if (!root || root.dataset.loaded === '1' || root.dataset.loading === '1') return;
    root.dataset.loading = '1';
    try {
      compCache = (await api('/api/plugins')).plugins || [];
      await componentUI.renderIds(['life-message-ack'], root);
      if (!root.children.length) throw Error('未找到 life-message-ack 组件，请确认桥接已加载该组件');
      if (root.querySelector('.comp-body')?.dataset.loaded !== '1') throw Error('组件参数读取失败');
      root.dataset.loaded = '1';
    } catch (error) {
      root.innerHTML = '<div class="meta">读取组件失败：' + esc(error.message) + ' <button class="small" type="button" data-retry-message-ack>重试</button></div>';
      root.querySelector('[data-retry-message-ack]')?.addEventListener('click', () => { root.dataset.loaded = ''; void componentUI.loadMessageAck(); });
    } finally {
      root.dataset.loading = '';
    }
  };

  // 每个组件按实际效果进入已有功能页，不再出现“本层组件”汇总框。
  componentUI.mount = async () => {
    const data = await pluginsReady;
    compCache = data.plugins || [];
    // 已有主设置的功能只把独有参数放回对应栏目，避免重复的组件开关和说明卡。
    const inlineSettings = [
      ['life-proactive-time-bubble', 'v2TimeBubbleAdd', 'maxBubblesPerDay'],
      ['life-schedule-reminder', 'v2ScheduleRefresh', 'enabled,advanceMinutes,intervalMinutes,lateMinutes,horizonDays,maxItems,maxPromptItems'],
      ['ctx-media-sticker-pick', 'v2StickerEnabled'],
      ['ctx-memory-profile-facts', 'v2PmEnabled'],
      ['ctx-memory-context', 'v2ContextRecentLimit', 'maxChars'],
      ['ctx-chat-topic-drive', 'v2FollowupGlobalAnchor', 'privateFollowupEnabled,minIntervalMinutes,dailyLimit,followUpCooldownMinutes,newTopicCooldownMinutes,newTopicMaxPerHour,followupWeight,newTopicWeight'],
      ['life-daily-worklog', 'v2DdEnabled'],
      ['ctx-memory-store', 'v2DdEnabled', 'diaryArchive']
    ];
    const mergedIds = new Set();
    for (const [id, anchorId, fields] of inlineSettings) {
      const anchor = document.getElementById(anchorId);
      const target = anchor?.closest('.settings-content') || anchor?.closest('.card');
      if (!target || !compCache.some(p => p.id === id)) continue;
      const slot = document.createElement('div');
      slot.className = 'inline-component-settings';
      slot.dataset.componentId = id;
      mergedIds.add(id);
      slot.dataset.hideToggle = '1';
      if (target.closest('section[data-page^="setting-"]') && target.closest('section').dataset.page!=='setting-l-2') slot.dataset.deferSave = '1';
      if (fields) slot.dataset.inlineFields = fields;
      slot.innerHTML = '<div class="comp-body">读取设置中…</div>';
      const sessionEditor = id === 'ctx-chat-topic-drive' ? document.getElementById('v2FollowupSessionEditor') : null;
      if (sessionEditor && sessionEditor.parentElement === target) target.insertBefore(slot, sessionEditor);
      else target.append(slot);
      loadComponentDetail(id, slot);
    }

    const main = document.getElementById('mainContent');
    const grid = main.querySelector(':scope > .grid');
    for (const slot of main.querySelectorAll('[data-component-slot]')) {
      const id = slot.dataset.componentSlot;
      if (!compCache.some(p => p.id === id)) continue;
      slot.dataset.componentId = id;
      slot.classList.add('owned-component');
      slot.innerHTML = '<div class="comp-body">读取设置中…</div>';
      mergedIds.add(id);
      await loadComponentDetail(id, slot);
    }
    for (const p of compCache) {
      if (isInternalPromptComponent(p)) continue;
      if ([...document.querySelectorAll('.env-comp-root[data-ids]')].some(root=>(root.dataset.ids||'').split(',').includes(p.id))) continue;
      if (mergedIds.has(p.id)) continue;
      const dedicated = COMPONENT_OWNERS[p.id]?.selector;
      const dedicatedRoot = dedicated && document.querySelector(dedicated);
      if (dedicatedRoot) { dedicatedRoot.dataset.componentId = p.id; continue; }
      if (p.layer === 'V' || p.layer === 'S') continue;
      // /api/plugins 的 summary 不再返回 config（值可能含敏感信息，只在 detail 里给），
      // 所以这里不能再用 p.config 判断“有没有可配置项”，否则所有纯配置组件（如成本策略）
      // 都会从页面消失。改为看控制台自己声明的表单（COMPONENT_FORMS）或组件工具。
      const page = componentPage(p);
      if (!page) continue;
      const section = document.createElement('section');
      section.className = 'card span-all commercial-component';
      section.dataset.page = page;
      section.dataset.componentId = p.id;
      section.hidden = currentConsolePage !== page;
      section.innerHTML = '<div class="component-heading"><div><h2>' + esc(p.name) + '</h2><p class="meta">' + esc(p.description || '此功能没有额外说明。') + '</p></div></div>' +
        ((p.tools || []).length && p.id !== 'ctx-memory-profile-store' ? '<div class="tool-reference-list">' + p.tools.map(t => '<div class="tool-reference-item"><code>' + esc(t.name) + '</code><span>' + esc(t.description || '由 AI 按需使用') + '</span></div>').join('') + '</div>' : '') +
        '<div class="comp-body">读取设置中…</div>';
      const pageAnchor = page === 'setting-c-2' ? grid.querySelector('section[data-page="setting-c-2"]') : null;
      if (pageAnchor) pageAnchor.before(section);
      else grid.append(section);
      featureIndex.push({ page, label: p.name, target: section });
      loadComponentDetail(p.id, section);
    }
  };
  componentUI.mount().catch(error => { document.getElementById('statusText').title = '功能导航读取失败：' + error.message; });
})();
}
