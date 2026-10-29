
import { api } from '../../shared/api.js';
// layers/O/model-status: explicit imports; initialize is called in the application startup order.

async function refreshDshModel() {
  try {
    const r = await api('/api/dsh/model');
    document.getElementById('dshModelText').textContent = r.model || '-';
    document.getElementById('dshProviderText').textContent = r.provider || '-';
    const select = document.getElementById('dshEffortSelect');
    const labels = r.labels || {};
    select.replaceChildren();
    for (const option of (r.options || [])) {
      const el = document.createElement('option');
      el.value = option;
      const info = labels[option] || {};
      const isDefault = option === (r.providerDefault || r.default);
      el.textContent = `${option}${isDefault ? '（默认）' : ''}`;
      if (info.description) el.title = info.description;
      select.appendChild(el);
    }
    select.value = r.reasoningEffort;
    const parts = [];
    if (r.providerDefault) parts.push(`DSH 出厂默认是 ${r.providerDefault}`);
    parts.push(r.catalogSource === 'dsh' ? '档位取自 DSH 实际公布的能力' : '未能读取 DSH 能力，档位为内置清单');
    document.getElementById('dshEffortNote').textContent = parts.join('；') + '。';
    document.getElementById('dshEffortSideEffect').textContent = r.globalSideEffect
      ? '注意：切换会同时写入 DSH 的全局默认（~/.dsh/settings.yaml 的 agent-default-model），也就是 Web GUI 里新建会话的默认强度也会跟着变。'
      : '';
    document.getElementById('dshEffortMsg').textContent = '';
  } catch (error) {
    document.getElementById('dshEffortMsg').textContent = '读取失败：' + (error?.message ?? error);
  }
}

export function initialize() {

}
export { refreshDshModel };
