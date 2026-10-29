import { api, esc } from '../../../shared/api.js';
export async function mountPersonProfile({id,body,p,el,form}) {
          body.insertAdjacentHTML('beforeend', '<section class="member-card-preview"><div class="quota-console-head"><div><b>按 QQ 管理人物档案</b><div class="meta">此 QQ 档案：按 QQ 号保存，同一人的资料可用于其相关会话。私聊自动注入本人档案；群聊不自动注入成员资料。可选择已有档案，也可输入尚未成为好友的 QQ 号。</div></div></div><div class="quota-console-actions"><select class="member-key" aria-label="选择 QQ 档案"><option value="">正在读取档案…</option></select><input class="profile-qq" inputmode="numeric" placeholder="或输入 QQ 号" aria-label="手动输入 QQ 号"><button class="small member-preview">读取档案</button></div><div class="profile-fields"></div><div class="quota-console-actions"><input class="profile-new-key" placeholder="新增 JSON 字段名" aria-label="新增档案字段名"><button class="small profile-add-key">增加字段</button><button class="small primary profile-save" data-save-action>保存此 QQ 档案</button><button class="small danger profile-delete-person">删除该 QQ 档案</button><span class="profile-status meta" aria-live="polite">固定字段可留空；新增字段会保留。</span></div></section>');
          const panel = body.querySelector('.member-card-preview'), select = panel.querySelector('.member-key'), qqInput = panel.querySelector('.profile-qq'), fieldsBox = panel.querySelector('.profile-fields'), status = panel.querySelector('.profile-status');
          const labels = { routine_food: '作息与饮食', hobbies: '兴趣与爱好', relationships: '人际关系', catchphrases: '口头禅' };
          let current = {}, loadedId = '', originalKeys = new Set(), readVersion = 0, reading = false, writing = false;
          const chosenId = () => (qqInput.value.trim() || select.value.trim()).replace(/^private:/, '');
          const syncEditor = () => {
            const ready = !!loadedId && loadedId === chosenId() && !reading && !writing;
            fieldsBox.querySelectorAll('textarea,button').forEach(el => { el.disabled = !ready; });
            panel.querySelectorAll('.profile-save,.profile-add-key,.profile-new-key,.profile-delete-person').forEach(el => { el.disabled = !ready; });
          };
          const render = profile => {
            current = profile && typeof profile === 'object' ? profile : {};
            const keys = [...new Set([...Object.keys(labels), ...Object.keys(current)])];
            fieldsBox.innerHTML = keys.map(key => '<div class="profile-json-field"><label><span>' + esc(labels[key] || key) + (labels[key] ? '' : ' · 扩展字段') + '</span><textarea data-profile-key="' + esc(key) + '" rows="3" placeholder="填写一段长句或短句">' + esc(current[key] || '') + '</textarea></label><button type="button" class="small danger profile-delete-key" data-remove-key="' + esc(key) + '">' + (labels[key] ? '清空' : '删除字段') + '</button></div>').join('');
            fieldsBox.querySelectorAll('textarea[data-profile-key]').forEach(el => el.addEventListener('input', () => { current[el.dataset.profileKey] = el.value; }));
            fieldsBox.querySelectorAll('[data-remove-key]').forEach(btn => btn.addEventListener('click', () => { const key = btn.dataset.removeKey; if (labels[key]) current[key] = ''; else delete current[key]; render(current); }));
            syncEditor();
          };
          const readProfile = async () => {
            const id = chosenId();
            if (!/^\d{1,20}$/.test(id)) { status.textContent = '请输入有效 QQ 号。'; return; }
            const version = ++readVersion;
            reading = true; writing = false; loadedId = ''; originalKeys = new Set(); render({});
            status.textContent = '正在读取…';
            try {
              const r = await api('/api/plugins/call', 'POST', { tool: 'profile_snapshot', input: { userId: id } });
              const d = r?.result || r || {};
              if (version !== readVersion || chosenId() !== id) return;
              if (r?.ok !== true || d.ok === false) throw Error(d.error || r?.error || '读取失败');
              qqInput.value = id; loadedId = id; originalKeys = new Set(Object.keys(d.profiles?.[id] || {})); render(d.profiles?.[id] || {}); status.textContent = '档案已读取；空档案也可直接填写创建。';
            } catch (e) { if (version === readVersion && chosenId() === id) status.textContent = '读取失败：' + e.message; }
            finally { if (version === readVersion) { reading = false; syncEditor(); } }
          };
          const loadProfiles = async () => {
            try {
              const r = await api('/api/plugins/call', 'POST', { tool: 'profile_snapshot', input: {} });
              const d = r?.result || r || {};
              if (r?.ok !== true && d.ok !== true) throw Error(d.error || r?.error || '读取失败');
              const ids = new Set(Object.keys(d.profiles || {}));
              const options = [...ids].sort().map(id => { const name = d.people?.[id]?.name; return '<option value="' + esc(id) + '">' + esc(name ? name + ' · ' : '') + esc(id) + '</option>'; });
              select.innerHTML = '<option value="">选择已有档案</option>' + options.join('');
            } catch (e) { select.innerHTML = '<option value="">档案列表读取失败</option>'; status.textContent = '档案列表读取失败：' + e.message; }
          };
          select.addEventListener('change', () => { if (select.value) { qqInput.value = select.value; void readProfile(); } });
          qqInput.addEventListener('input', () => { const id = chosenId(); if (id !== loadedId) { readVersion++; reading = false; writing = false; originalKeys = new Set(); loadedId = ''; render({}); status.textContent = '请先读取这个 QQ 的档案，再填写或创建。'; } });
          panel.querySelector('.member-preview').addEventListener('click', () => void readProfile());
          panel.querySelector('.profile-delete-person').addEventListener('click', async () => {
            const id = chosenId();
            if (!/^\d{1,20}$/.test(id)) { status.textContent = '请输入有效 QQ 号。'; return; }
            if (reading || writing || loadedId !== id) { status.textContent = '请先读取目标档案。'; return; }
            if (!confirm('确定删除 QQ ' + id + ' 的整份人物档案？此操作会移除所有字段和档案元数据。')) return;
            const version = readVersion; writing = true; syncEditor();
            status.textContent = '正在删除…';
            try {
              const r = await api('/api/plugins/call', 'POST', { tool: 'profile_delete', input: { userId: id, key: 'private:' + id, adminCrossSession: true } });
              const d = r?.result || r || {};
              if (version !== readVersion || chosenId() !== id) return;
              if (r?.ok !== true || d.ok === false) throw Error(d.error || r?.error || '删除失败');
              originalKeys = new Set(); loadedId = ''; qqInput.value = ''; select.value = ''; render({}); await loadProfiles();
              status.textContent = d.deleted ? '该 QQ 档案已删除。' : '该 QQ 档案原本不存在。';
            } catch (e) { if (version === readVersion) status.textContent = '删除失败：' + e.message; }
            finally { if (version === readVersion) { writing = false; syncEditor(); } }
          });

          render({});
          panel.querySelector('.profile-add-key').addEventListener('click', () => { const input = panel.querySelector('.profile-new-key'), key = input.value.trim(); if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key)) { status.textContent = '字段名需以字母开头，只能包含字母、数字和下划线。'; return; } if (key in current) { status.textContent = '该字段已经存在。'; return; } current[key] = ''; input.value = ''; render(current); status.textContent = '已添加字段，填写后保存。'; });
          panel.querySelector('.profile-save').addEventListener('click', async () => {
            const id = chosenId();
            if (!/^\d{1,20}$/.test(id)) { status.textContent = '请输入有效 QQ 号。'; return; }
            if (reading || writing || loadedId !== id) { status.textContent = '请先读取目标档案。'; return; }
            const version = readVersion; writing = true; syncEditor();
            const patch = {};
            fieldsBox.querySelectorAll('textarea[data-profile-key]').forEach(el => { patch[el.dataset.profileKey] = el.value; });
            status.textContent = '正在保存…';
            try {
              const deleteKeys = [...originalKeys].filter(key => !labels[key] && !Object.prototype.hasOwnProperty.call(patch, key));
              const r = await api('/api/plugins/call', 'POST', { tool: 'profile_update', input: { userId: id, key: 'private:' + id, adminCrossSession: true, profile: patch, deleteKeys } });
              const d = r?.result || r || {};
              if (version !== readVersion || chosenId() !== id) return;
              if (r?.ok !== true || d.ok === false) throw Error(d.error || r?.error || '保存失败');
              render(d.profile || patch); originalKeys = new Set(Object.keys(d.profile || patch)); qqInput.value = id; loadedId = id; await loadProfiles();
              if (version === readVersion && chosenId() === id) { select.value = id; status.textContent = '已保存；未改字段均保留。'; }
            } catch (e) { if (version === readVersion) status.textContent = '保存失败：' + e.message; }
            finally { if (version === readVersion) { writing = false; syncEditor(); } }
          });
          void loadProfiles();
        }
