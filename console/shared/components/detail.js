import { mountImageGeneration } from '../../layers/E/editors/image-generation.js';
import { mountKnowledgeQuota } from '../../layers/C/editors/knowledge-quota.js';
import { mountPersonProfile } from '../../layers/C/editors/person-profile.js';
import { mountWorklog } from '../../layers/O/editors/worklog.js';

import { api, esc } from '../api.js';
import { renderComponentForm } from './form.js';
import { componentScope } from './scope.js';
import { wireItems } from './fields.js';
import { syncV2TimeBubbleCapacity } from '../../layers/L/time-bubbles.js';
import { refresh } from '../../layers/O/status.js';
import { refreshUsage } from '../../layers/O/usage.js';
export async function loadComponentDetail(id, el) {
    const body = el.querySelector('.comp-body');
    if (!body || body.dataset.loaded === '1') return;
    try {
      const resp = await api('/api/plugins/detail?id=' + encodeURIComponent(id));
      const p = resp && resp.plugin ? resp.plugin : resp;
      if (id === 'human') {
        body.innerHTML = '<div class="human-loop-banner" role="img" aria-label="Human in the loop；Version 1.0；我也是一个组件"><div class="human-loop-kicker">V · HUMAN</div><div class="human-loop-title">HUMAN IN THE LOOP</div><div class="human-loop-version">Version 1.0</div><div class="human-loop-caption">我也是一个组件。</div></div>';
        body.dataset.loaded = '1';
        return;
      }
      const form = renderComponentForm(p, el.dataset.inlineFields ? el.dataset.inlineFields.split(',') : null, !!el.dataset.inlineFields && id !== 'life-daily-worklog' && !el.closest('.env-comp-root'), !!el.closest('.environment-page'));
      const toggleLabel = id === 'tool-user-checking' ? '启用自查与桌面便签' : (el.dataset.toggleLabel || '启用此功能');
      const enabled = el.dataset.hideToggle === '1' || id === 'exec-image-generation' || form?.ownsEnabled ? '' : '<label class="comp-toggle"><input type="checkbox" class="comp-enabled"' + (p.enabled ? ' checked' : '') + '> <span>' + esc(toggleLabel) + '</span></label><span class="meta comp-toggle-msg"></span>';
      if (form) {
        const saveLabel=el.dataset.saveLabel || (id==='life-campus-watch' ? (el.closest('#envCompScript')?'保存脚本协同参数':'保存网页监控参数') : (form.saveLabel||'保存'+p.name));
        const scope = componentScope(id, saveLabel);

        body.innerHTML = (form.empty ? '' : '<p class="parameter-scope" data-config-scope="'+esc(scope.label)+'"><b>'+esc(scope.label)+'</b> · '+esc(scope.description)+'</p>') + enabled + form.html + (form.empty || el.dataset.deferSave === '1' ? '' : '<div class="row" style="gap:8px;margin-top:8px"><button class="small primary comp-save" data-save-action>' + esc(scope.saveLabel) + '</button><span class="meta comp-msg"></span></div>');
        if (id === 'life-proactive-time-bubble') {
          const capacityInput = body.querySelector('.comp-form-num');
          if (capacityInput) {
            capacityInput.dataset.lastValidValue = capacityInput.value;
            syncV2TimeBubbleCapacity();
          }
        }
        if (id === 'exec-image-generation') await mountImageGeneration({id,body,p,el,form});
        if (id === 'ctx-knowledge-quota') await mountKnowledgeQuota({id,body,p,el,form});
        if (id === 'ctx-memory-profile-store') await mountPersonProfile({id,body,p,el,form});
        if (id === 'life-daily-worklog') await mountWorklog({id,body,p,el,form});
        wireItems(body);
        body.dataset.loaded = '1';
        body.querySelector('.comp-enabled')?.addEventListener('change', async (event) => {
          const msg = body.querySelector('.comp-toggle-msg');
          const previous = !event.target.checked;
          msg.textContent = '更新中…';
          try {
            const out = await api('/api/plugins/toggle', 'POST', { id, enabled: event.target.checked });
            if (out.ok !== true) throw Error(out.error || '更新失败');
            msg.textContent = event.target.checked ? '已启用' : '已停用';
          } catch (error) { event.target.checked = previous; msg.textContent = '更新失败：' + error.message; }
        });
        el.__saveComponent = async () => {
          const cfg2 = form.collect(body);
          const msg = body.querySelector('.comp-msg');
          if (msg) msg.textContent = '保存中…';
          let next = cfg2;
          if (el.dataset.inlineFields) {
            const latest = await api('/api/plugins/detail?id=' + encodeURIComponent(id));
            next = { ...((latest.plugin || latest).config || {}), ...cfg2 };
          }
          if (id === 'life-campus-watch' && el.closest('#envCompBrowserWatch')) {
            next.watchUrlsConfigured = true;
            next.bbCoursesConfigured = true;
            next.bbCourses = [];

            next.enabledScripts = String(next.enabledScripts || '').split('|').filter(script => script && script !== 'blackboard').join('|');
            const activeUrls = (next.watchUrls || []).filter((e) => (typeof e === 'string' ? true : e.enabled !== false));
            if (next.webWatchEnabled && !activeUrls.length) throw Error('请先勾选并填写至少一个监控网址');
          }
          if (id === 'life-campus-watch' && el.closest('#envCompScript')) {
            const activeScripts = (next.scriptPaths || []).filter((e) => (typeof e === 'string' ? true : e.enabled !== false));
            next.scriptCollabEnabled=activeScripts.length>0;
          }
          const out = await api('/api/plugins/config', 'POST', { id, config: next });
          if (out.ok === false) throw Error(out.error || '保存失败');
          if(form.ownsEnabled&&next.enabled===true){
            try{const active=await api('/api/plugins/toggle','POST',{id,enabled:true});if(active.ok!==true)throw Error(active.error||'启用失败');}
            catch(error){const control=body.querySelector('[data-config-key="enabled"] input');if(control)control.checked=false;throw Error('参数已保存，但组件启用失败：'+error.message);}
          }
          if (msg) msg.textContent = '已保存并重载';
          body.dataset.loaded = '';
          await loadComponentDetail(id, el);
          const readbackMsg = body.querySelector('.comp-msg');
          if (readbackMsg) readbackMsg.textContent = '已保存并重载，已重新读取';
          el.dispatchEvent(new CustomEvent('component-config-saved', {bubbles:true, detail:{id}}));
        };
        body.querySelector('.comp-save')?.addEventListener('click', async event => {
          const button=event.currentTarget;button.disabled=true;button.setAttribute('aria-busy','true');
          try{await el.__saveComponent();}catch(error){const msg=body.querySelector('.comp-msg');if(msg)msg.textContent='保存失败：'+error.message;}
          finally{button.disabled=false;button.removeAttribute('aria-busy');}
        });
      }
    } catch (error) {
      body.textContent = '读取详情失败：' + error.message;
    }
  }
