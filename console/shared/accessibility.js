
import { setSlangTab, closeSlangModal } from '../layers/C/slang.js';
import { consolePages, setConsolePage } from './navigation.js';
// shared/accessibility: explicit imports; initialize is called in the application startup order.


let primaryActions;

let searchInput;

let searchResults;

let featureIndex;

function closeConsoleSearch() { searchResults.hidden = true; searchInput.setAttribute('aria-expanded','false'); }

let modalPreviousFocus;

let slangOverlay;

let tokenToggle;

export function initialize() {
document.querySelectorAll('input,select,textarea').forEach(input => {
  if (input.labels?.length || input.hasAttribute('aria-label')) return;
  let label = input.previousElementSibling;
  while (label && label.tagName !== 'LABEL') label = label.previousElementSibling;
  if (label) {
    const siblings = [];
    let next = label.nextElementSibling;
    while (next && next.tagName !== 'LABEL') {
      if (next.matches('input,select,textarea')) siblings.push(next);
      next = next.nextElementSibling;
    }
    input.setAttribute('aria-label', label.textContent.trim() + (siblings.length > 1 ? (siblings.indexOf(input) === 0 ? '（下限）' : '（上限）') : ''));
  } else {
    const names = { consoleTokenInput: '新的控制台访问令牌', closedPreset: '封闭 Agent 使用的 DSH 预设', tsKind: '测试消息目标类型', aiNotifyKind: '后台提醒目标类型', sStateKey: '一代仿真会话', slangLimitCand: '候选词显示数量', slangLimitConfirmed: '已确认词显示数量', slangLimitRejected: '已拒绝词显示数量' };
    input.setAttribute('aria-label', names[input.id] || input.placeholder || input.closest('section')?.querySelector('h2')?.textContent || '设置');
  }
});
primaryActions = ['roleSet','roleCreate','socialSave','v2ConfigSaveTop','wlSave','secInterceptNotifySave','secInterceptTextSave','consoleTokenSave','tsSend','aiNotifySend','slangAdd','slangConfigSave','slangModalDirectConfirm'];
primaryActions.forEach(id => document.getElementById(id)?.classList.add('primary'));
document.querySelectorAll('.meta[id$="Msg"], .meta[id$="Msg2"]').forEach(el => el.setAttribute('role','status'));
document.getElementById('section-mode').querySelector('h2').dataset.note = '选择后即时生效';
document.getElementById('section-activity').querySelector('h2').dataset.note = '每 3 秒自动同步';
searchInput = document.getElementById('consoleSearch');
searchResults = document.getElementById('searchResults');
featureIndex = [];
document.querySelectorAll('section[data-page]').forEach(section => {
  const page = section.dataset.page;
  featureIndex.push({ page, label: section.querySelector('h2')?.textContent || '', target: section });
  section.querySelectorAll('details.settings-group>summary,input,textarea,select').forEach(el => {
    let label = el.tagName === 'SUMMARY' ? el.textContent : (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.placeholder);
    if (label) featureIndex.push({ page, label: label.trim(), target: el });
  });
});
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  searchResults.replaceChildren();
  if (!query) return closeConsoleSearch();
  const matches = featureIndex.filter(entry => (consolePages[entry.page][0] + entry.label + entry.target.id).toLowerCase().includes(query)).slice(0,12);
  if (!matches.length) { const empty = document.createElement('p'); empty.textContent = '未找到匹配功能，试试「唤醒」「白名单」或「表情」。'; searchResults.append(empty); }
  matches.forEach(entry => {
    const button = document.createElement('button');
    const title = document.createElement('span'); title.textContent = entry.label;
    const caption = document.createElement('small'); caption.textContent = consolePages[entry.page][0];
    button.append(title,caption);
    button.addEventListener('click', () => {
      setConsolePage(entry.page);
      let ancestor = entry.target.closest('details');
      while (ancestor) { ancestor.open = true; ancestor = ancestor.parentElement.closest('details'); }
      if (entry.target.closest('#section-slang .slang-panel')) {
        const panels = { slangPanelCandidate: 'candidate', slangPanelConfirmed: 'confirmed', slangPanelRejected: 'rejected' };
        setSlangTab(panels[entry.target.closest('.slang-panel').id]);
      }
      const aliasPanel=entry.target.closest('#section-alias .alias-panel');
      if(aliasPanel)document.querySelector('#aliasTabs [data-alias-tab="'+aliasPanel.id.replace('aliasPanel','').toLowerCase()+'"]')?.click();
      const termPanel=entry.target.closest('#section-terms .terms-panel');
      if(termPanel)document.querySelector('#termsTabs [data-term-tab="'+termPanel.id.replace('termsPanel','').toLowerCase()+'"]')?.click();
      entry.target.scrollIntoView({ block:'center', behavior:'instant' });
      if (!entry.target.hasAttribute('tabindex') && !entry.target.matches('input,textarea,select,button,summary')) entry.target.tabIndex = -1;
      entry.target.focus({ preventScroll:true });
      entry.target.classList.add('search-highlight');
      setTimeout(() => entry.target.classList.remove('search-highlight'), 2000);
    });
    searchResults.append(button);
  });
  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded','true');
});
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeConsoleSearch();
  if ((event.key === 'ArrowDown' || event.key === 'Enter') && !searchResults.hidden) { event.preventDefault(); searchResults.querySelector('button')?.focus(); }
});
document.addEventListener('click', event => { if (!event.target.closest('.search-wrap')) closeConsoleSearch(); });
searchResults.addEventListener('keydown', event => { if (event.key === 'Escape') { closeConsoleSearch(); searchInput.focus(); } });
slangOverlay = document.getElementById('slangModalOverlay');
new MutationObserver(() => {
  if (slangOverlay.classList.contains('open')) {
    modalPreviousFocus = document.activeElement;
    document.getElementById('slangModalMeaning').focus();
  } else modalPreviousFocus?.focus();
}).observe(slangOverlay, { attributes:true, attributeFilter:['class'] });
slangOverlay.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeSlangModal(); }
  if (event.key === 'Tab') {
    const controls = [...slangOverlay.querySelectorAll('button,input,textarea,select')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
tokenToggle = document.createElement('button');
tokenToggle.id = 'consoleTokenToggle';
tokenToggle.className = 'small';
tokenToggle.textContent = '显示令牌';
tokenToggle.type = 'button';
tokenToggle.setAttribute('aria-pressed','false');
tokenToggle.addEventListener('click', () => {
  const input = document.getElementById('consoleTokenInput');
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  tokenToggle.textContent = visible ? '隐藏令牌' : '显示令牌';
  tokenToggle.setAttribute('aria-pressed',String(visible));
});
document.getElementById('consoleTokenInput').after(tokenToggle);
}
export { primaryActions, searchInput, searchResults, featureIndex, closeConsoleSearch, modalPreviousFocus, slangOverlay, tokenToggle };
