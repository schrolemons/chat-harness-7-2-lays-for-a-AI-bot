import { PARAMETER_EXAMPLES } from './examples.js';

import { api, esc } from '../api.js';
import { COMPONENT_FORMS } from './forms.js';
import { resolveComponentFields } from './field-contract.js';
import { compFieldHtml, compFieldValue } from './fields.js';
export function renderComponentForm(p, selectedKeys, showTitle = true, expandGroups = false) {
    const cfg = { ...(p.config || {}) };
    if (p.id === 'exec-image-generation') delete cfg.apiKey;
    const componentForm = COMPONENT_FORMS[p.id];
    const ownsEnabled=componentForm?.ownsEnabled===true;
    if(ownsEnabled)cfg.enabled=p.enabled!==false&&cfg.enabled!==false;
    const form = { title: componentForm?.title || p.name || '功能设置', fields: resolveComponentFields(p, componentForm, selectedKeys) };
    if (!form.fields.length) return { html: '<p class="meta">此功能没有需要填写的参数。</p>', collect: () => ({ ...cfg }), empty: true };
    let grouped=false, groupCount=0;
    const fields = form.fields.map((f) => {
      const id = 'cfg-' + p.id + '-' + f.key;
      let html = compFieldHtml({...f,example:f.example||PARAMETER_EXAMPLES[p.id]?.[f.key]}, f.key === 'watchUrls' && !(cfg.watchUrls || []).length ? (p.state?.watchUrls || []) : cfg[f.key]);
      html = html.replace('class="comp-field', 'data-config-key="' + esc(f.key) + '" class="comp-field');
      // Give every simple control its own nearby label; custom tables own their row labels.
      if (!['moodRules','ackGroup','items','flags'].includes(f.type)) {
        html = html.replace(/<(input|select|textarea) /, '<$1 id="' + id + '" aria-label="' + esc(f.label) + '" ');
        html = html.replace('<div class="meta">' + esc(f.label) + '</div>', '<label class="meta" for="' + id + '">' + esc(f.label) + '</label>');
      }
      let heading='';
      if(f.group){heading=(grouped?'</div></details>':'')+'<details class="parameter-group"'+(groupCount++===0||expandGroups?' open':'')+'><summary>'+esc(f.group)+'</summary><div class="component-fields">';grouped=true;}
      return heading+html;
    }).join('')+(grouped?'</div></details>':'');
    // 独立卡片上方已经有组件名 h2，再重复一行表单标题就显得啰嗦；只有并进别的设置框的
    // 内联表单（inlineFields）才需要这行小标题来区分归属。
    return { ownsEnabled,saveLabel:componentForm?.saveLabel || '保存'+form.title, html: (showTitle ? '<div class="meta" style="margin:6px 0">' + esc(form.title) + '</div>' : '') + '<div class="component-fields">' + fields + '</div>', collect: (el) => {
      const out = {};
      const fields = el.querySelectorAll('.comp-field[data-config-key]');
      form.fields.forEach((f, index) => { const v = compFieldValue(f, fields[index]); if (v === undefined) delete out[f.key]; else out[f.key] = v; });
      const ruleIds = [...(out.positiveRules || []), ...(out.negativeRules || [])].map(rule => rule.id);
      if (new Set(ruleIds).size !== ruleIds.length) throw Error('升分和降分规则 ID 不能重复');
      return out;
    } };
  }
