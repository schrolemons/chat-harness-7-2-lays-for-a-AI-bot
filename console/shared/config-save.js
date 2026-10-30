import {selectPageConfig} from './config-scope.js';

import { collectCConfig } from '../layers/C/config-save.js';
import { collectTConfig } from '../layers/T/config-save.js';
import { collectEConfig } from '../layers/E/config-save.js';
import { collectLConfig } from '../layers/L/config-save.js';
import { collectOConfig } from '../layers/O/config-save.js';
import { api } from './api.js';

// shared/config-save: explicit imports; initialize is called in the application startup order.


async function persistPageConfig(btn) {
  const page=btn?.closest('section')?.dataset.page || btn?.dataset.page;
  const body = selectPageConfig({ ...collectCConfig(), ...collectTConfig(), ...collectEConfig(), ...collectLConfig(), ...collectOConfig() },page);
  const r = await api('/api/socialV2/config', 'POST', body);
  const msg = (btn && btn.closest && btn.closest('section')?.querySelector('.v2-save-msg')) || document.getElementById('lifecycleActionMessage');
  msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  msg.classList.remove('ok','err');msg.classList.add('meta',r.ok?'ok':'err');
  if (r.ok) {
    const slots = [...(btn?.closest('section')?.querySelectorAll('.inline-component-settings[data-defer-save="1"]') || [])];
    try {
      await Promise.all(slots.map(slot => slot.__saveComponent?.()));
      if (btn?.closest('section')?.dataset.page === 'setting-c-1') {
        const detail = await api('/api/plugins/detail?id=ctx-memory-update');
        const plugin = detail.plugin || detail;
        const sync = await api('/api/plugins/config', 'POST', { id: 'ctx-memory-update', config: { ...(plugin.config || {}), maxChars: Number(document.getElementById('v2PmMaxChars').value) || 4000 } });
        if (sync.ok === false) throw Error(sync.error || '记忆写入上限同步失败');
      }
      if (slots.length) msg.textContent = '✅ 页面设置与补充参数已保存';
    } catch (error) { msg.textContent = '部分参数未保存：' + error.message; msg.className = 'meta err'; }
    // Keep unsaved values on other pages; saving this page must not reset their drafts.
  }
}

async function saveV2Config(button){
  if(button?.disabled)return;
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  try{await persistPageConfig(button);}catch(error){const msg=button?.closest('section')?.querySelector('.v2-save-msg');if(msg){msg.textContent='保存失败：'+error.message;msg.classList.remove('ok');msg.classList.add('meta','err');}}
  finally{if(button){button.disabled=false;button.removeAttribute('aria-busy');}}
}
export function initialize() {

}
export { saveV2Config };
