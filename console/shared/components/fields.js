
import { api, esc } from '../api.js';
function moodRuleRow(rule, direction) {
  return '<div class="mood-rule-row" data-rule-id="' + esc(rule.id) + '">'
    + '<label>行为<input class="mood-rule-label" type="text" maxlength="80" value="' + esc(rule.label) + '"></label>'
    + '<label>分值<input class="mood-rule-delta" type="number" min="' + (direction > 0 ? '0.01' : '-100') + '" max="' + (direction > 0 ? '100' : '-0.01') + '" step="any" value="' + esc(rule.delta) + '"></label>'
    + '<label>判断说明<textarea class="mood-rule-description" rows="2" maxlength="500">' + esc(rule.description) + '</textarea></label>'
    + '<button class="small mood-rule-delete" type="button" aria-label="删除行为规则">删除</button></div>';
}
export function compFieldHtml(field, value) {
    const hint = (field.help ? '<small class="meta comp-help">' + esc(field.help) + '</small>' : '') + (field.example ? '<small class="parameter-example">例：' + esc(field.example) + '</small>' : '');
    if (field.type === 'moodRules') return '<div class="comp-field mood-rules" data-rule-direction="' + field.direction + '"><b>' + esc(field.label) + '</b><div class="mood-rule-list">' + (Array.isArray(value) ? value : []).map(rule => moodRuleRow(rule, field.direction)).join('') + '</div><button class="small mood-rule-add" type="button">+ 添加行为规则</button><small class="meta comp-help">AI 结合语境选用规则；分值是该行为单次调整的上限。</small>' + hint + '</div>';
    if (field.type === 'json') return '<div class=\"comp-field\"><label class=\"meta\">' + esc(field.label) + '</label><textarea class=\"comp-form-json\" rows=\"6\">' + esc(JSON.stringify(value ?? null, null, 2)) + '</textarea>' + hint + '</div>';
    if (field.type === 'ackGroup') {
      const group = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const lines = Array.isArray(group.lines) ? group.lines : [];
      return '<fieldset class="comp-field comp-ack-group" style="border:1px solid var(--border-subtle);border-radius:12px;padding:12px 14px;margin:10px 0;background:var(--surface)">'
        + '<legend style="padding:0 6px;font-weight:650">' + esc(field.label) + '</legend>'
        + '<div class="row" style="gap:14px;align-items:center"><label><input type="checkbox" class="comp-ack-enabled"' + (group.enabled !== false ? ' checked' : '') + '> 启用这组</label>'
        + '<label>激活延迟（秒） <input type="number" class="comp-ack-delay" value="' + esc(String(Number(group.delayMs ?? 0) / 1000)) + '" min="0" max="600" step="0.1" style="width:110px"></label></div>'
        + '<label class="meta" style="display:block;margin-top:8px">固定话术表（每行一条，激活时随机选一条）</label>'
        + '<textarea class="comp-ack-lines" rows="' + Math.max(4, Math.min(8, lines.length)) + '" style="width:100%;min-height:100px">' + esc(lines.join('\n')) + '</textarea>'
        + '<small class="meta comp-help">清空话术表会让此组不发送；延迟上限为 600 秒。</small>' + hint + '</fieldset>';
    }
    if (field.type === 'flags') {
      const set = new Set(String(value || '').split('|').filter(Boolean));
      const opts = (field.options || []).map(([v, label]) => '<label class="comp-flag"><input type="checkbox" data-flag="' + esc(v) + '"' + (set.has(v) ? ' checked' : '') + '> ' + esc(label) + '</label>').join('');
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><div class="row" style="gap:10px;flex-wrap:wrap;margin-top:4px">' + opts + '</div>' + hint + '</div>';
    }
    if (field.type === 'comma-list') {
      const arr = Array.isArray(value) ? value : [];
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><input type="text" class="comp-form-text" style="width:100%;max-width:520px" placeholder="例如：论文，作业，报告" value="' + esc(arr.join('， ')) + '">' + hint + '</div>';
    }
    if (field.type === 'lines') {
      const arr = Array.isArray(value) ? value : [];
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><textarea class="comp-form-lines" style="width:100%;min-height:70px" rows="' + Math.max(3, arr.length + 1) + '">' + esc(arr.join('\n')) + '</textarea>' + hint + '</div>';
    }
    if (field.type === 'number') {
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><input type="number" class="comp-form-num" value="' + esc(String(value ?? '')) + '" min="' + (field.min ?? '') + '" max="' + (field.max ?? '') + '" step="any" style="width:120px">' + hint + '</div>';
    }
    if (field.type === 'minutes') {
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><input type="number" class="comp-form-minutes" value="' + esc(String(Math.round((Number(value) || 0) / 60000))) + '" min="' + (field.min ?? 0) + '" step="1" style="width:120px">' + hint + '</div>';
    }
    if (field.type === 'select') {
      const opts = (field.options || []).map((o) => '<option' + (String(value) === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><select class="comp-form-select" style="max-width:220px">' + opts + '</select>' + hint + '</div>';
    }
    if (field.type === 'boolean') {
      return '<div class="comp-field"><label><input type="checkbox" class="comp-form-bool"' + (value === true ? ' checked' : '') + '> ' + esc(field.label) + '</label>' + hint + '</div>';
    }
    if (field.type === 'text') {
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><input type="text" class="comp-form-text" maxlength="' + (field.maxLength ?? 10000) + '" value="' + esc(String(value ?? '')) + '" style="width:100%;max-width:320px">' + hint + '</div>';
    }
    if (field.type === 'textarea') {
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div><textarea class="comp-form-textarea" rows="4" maxlength="' + (field.maxLength ?? 300) + '" style="width:100%;max-width:720px">' + esc(String(value ?? '')) + '</textarea>' + hint + '</div>';
    }
    if (field.type === 'items') {
      const arr = Array.isArray(value) ? value.map((e) => (typeof e === 'string' ? { value: e, enabled: true } : e)) : [];
      const ph = esc(field.placeholder || '');
      const rows = arr.map((e) => '<div class="comp-item' + (e.enabled === false ? ' is-off' : '') + '"><input type="checkbox" class="comp-item-on" title="勾选=启用" aria-label="启用此项"' + (e.enabled !== false ? ' checked' : '') + '><input type="text" class="comp-item-val" value="' + esc(e.value || '') + '" placeholder="' + ph + '" style="flex:1"><button type="button" class="small comp-item-del" aria-label="删除此项">删除</button></div>').join('');
      return '<div class="comp-field"><div class="meta">' + esc(field.label) + '</div>' + rows + '<div class="row" style="gap:6px;margin-top:6px"><input type="text" class="comp-item-new" placeholder="' + ph + '" style="flex:1"><button type="button" class="small comp-item-add">' + esc(field.addLabel || '添加') + '</button></div>' + hint + '</div>';
    }
    return '';
  }

export function compFieldValue(field, el) {
    if (field.type === 'moodRules') {
      const rules = [...el.querySelectorAll('.mood-rule-row')].map(row => ({
        id: row.dataset.ruleId,
        label: row.querySelector('.mood-rule-label').value.trim(),
        delta: Number(row.querySelector('.mood-rule-delta').value),
        description: row.querySelector('.mood-rule-description').value.trim()
      }));
      const ids = new Set();
      for (const rule of rules) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(rule.id) || ids.has(rule.id)) throw Error('行为规则 ID 无效或重复');
        if (!Number.isFinite(rule.delta) || rule.delta * field.direction <= 0 || Math.abs(rule.delta) > 100) throw Error('行为规则分值方向或范围错误');
        if (!rule.label) throw Error('行为规则名称不能为空');
        ids.add(rule.id);
      }
      return rules;
    }
    if (field.type === 'json') return JSON.parse(el.querySelector('.comp-form-json').value);
    if (field.type === 'ackGroup') {
      const seconds = Number(el.querySelector('.comp-ack-delay').value);
      return {
        enabled: el.querySelector('.comp-ack-enabled').checked,
        delayMs: Number.isFinite(seconds) ? Math.round(Math.max(0, Math.min(600, seconds)) * 1000) : 0,
        lines: el.querySelector('.comp-ack-lines').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 100)
      };
    }
    if (field.type === 'flags') {
      const vals = [];
      el.querySelectorAll('input[data-flag]').forEach((c) => { if (c.checked) vals.push(c.dataset.flag); });
      return vals.join('|');
    }
    if (field.type === 'comma-list') return el.querySelector('.comp-form-text').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (field.type === 'lines') return el.querySelector('.comp-form-lines').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (field.type === 'number') {
      const n = Number(el.querySelector('.comp-form-num').value);
      if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max)) throw new Error(field.label + '超出有效范围');
      return n;
    }
    if (field.type === 'minutes') { const n = Number(el.querySelector('.comp-form-minutes').value); return Number.isFinite(n) ? Math.round(n) * 60000 : undefined; }
    if (field.type === 'select') return el.querySelector('.comp-form-select').value;
    if (field.type === 'boolean') return el.querySelector('.comp-form-bool').checked;
    if (field.type === 'text') return el.querySelector('.comp-form-text').value.trim();
    if (field.type === 'textarea') return el.querySelector('.comp-form-textarea').value.trim();
    if (field.type === 'items') {
      const items = [];
      el.querySelectorAll('.comp-item').forEach((row) => {
        const val = row.querySelector('.comp-item-val').value.trim();
        if (val) items.push({ value: val, enabled: row.querySelector('.comp-item-on').checked });
      });
      const add = el.querySelector('.comp-item-new');
      if (add) { const nv = add.value.trim(); if (nv) items.push({ value: nv, enabled: true }); }
      return items;
    }
    return undefined;
  }

export function wireItems(body) {
    body.querySelectorAll('.mood-rules').forEach(table => {
      table.addEventListener('click', event => {
        if (event.target.closest('.mood-rule-delete')) event.target.closest('.mood-rule-row').remove();
        if (event.target.closest('.mood-rule-add')) {
          const direction = Number(table.dataset.ruleDirection);
          table.querySelector('.mood-rule-list').insertAdjacentHTML('beforeend', moodRuleRow({id:'rule-' + crypto.randomUUID(),label:'',delta:direction,description:''},direction));
        }
      });
    });
    body.querySelectorAll('.comp-item-del').forEach((btn) => btn.addEventListener('click', () => btn.closest('.comp-item').remove()));
    const wireToggle = (input) => input.addEventListener('change', () => input.closest('.comp-item').classList.toggle('is-off', !input.checked));
    body.querySelectorAll('.comp-item-on').forEach(wireToggle);
    body.querySelectorAll('.comp-item-add').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'comp-item';
        const ph = btn.closest('.comp-field')?.querySelector('.comp-item-new')?.getAttribute('placeholder') || '';
        row.innerHTML = '<input type="checkbox" class="comp-item-on" title="勾选=启用" aria-label="启用此项" checked><input type="text" class="comp-item-val" placeholder="' + esc(ph) + '" style="flex:1"><button type="button" class="small comp-item-del" aria-label="删除此项">删除</button>';
        btn.closest('.row').insertAdjacentElement('beforebegin', row);
        row.querySelector('.comp-item-del').addEventListener('click', () => row.remove());
        wireToggle(row.querySelector('.comp-item-on'));
        const input = btn.closest('.row')?.querySelector('.comp-item-new');
        if (input) input.value = '';
        row.querySelector('.comp-item-val').focus();
      });
    });
  }
