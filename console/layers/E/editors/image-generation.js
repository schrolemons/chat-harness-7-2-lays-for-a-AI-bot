import { api, esc } from '../../../shared/api.js';
export async function mountImageGeneration({id,body,p,el,form}) {
          body.insertAdjacentHTML('beforeend', '<div class="quota-console image-generation-console"><div class="quota-console-head"><div><b>本地 API 密钥</b><div class="meta">密钥不会写入组件配置，状态查询也不会返回密钥内容。</div></div><span class="meta image-secret-state" role="status">正在读取保存状态…</span></div><div class="row" style="gap:8px;margin-top:10px"><input type="password" class="image-secret-input comp-form-text" autocomplete="new-password" aria-label="图片生成 API 密钥" placeholder="输入新密钥" style="flex:1;min-width:180px;max-width:420px"><button type="button" class="small primary image-secret-set" data-save-action>保存本机 API 密钥</button><button type="button" class="small danger image-secret-clear">清除密钥</button></div><div class="meta image-secret-message" aria-live="polite"></div><div class="quota-console-head" style="margin-top:18px"><div><b>今日图片生成用量</b><div class="meta">按上海时间统计请求次数。</div></div><button type="button" class="small image-usage-refresh">刷新用量</button></div><div class="meta image-usage-result" aria-live="polite">正在读取…</div></div>');
          const panel = body.querySelector('.image-generation-console');
          panel.querySelector('.quota-console-head b').textContent = 'OpenAI API 密钥';
          const secretInput = panel.querySelector('.image-secret-input');
          secretInput.setAttribute('aria-label', 'OpenAI API 密钥');
          secretInput.placeholder = '输入用于图片生成的 OpenAI API 密钥';
          panel.querySelector('.image-secret-set').textContent = '保存本机 OpenAI 密钥';
          const secretState = panel.querySelector('.image-secret-state');
          const secretMessage = panel.querySelector('.image-secret-message');
          const usageResult = panel.querySelector('.image-usage-result');
          const secretCall = async input => {
            const response = await api('/api/plugins/call', 'POST', { tool: 'image_generation_secret', input });
            const result = response?.result || response || {};
            if (result.ok !== true) throw Error('密钥操作失败');
            return result;
          };
          const showSecretState = configured => { const ready = p.config?.apiBase && p.config?.model; secretState.textContent = configured ? (ready ? 'OpenAI 密钥已保存' : '密钥已保存；请配置 OpenAI 接口地址和模型') : '未配置 OpenAI 密钥'; };
          const refreshSecret = async () => {
            try { showSecretState((await secretCall({ op: 'status' })).configured === true); }
            catch { secretState.textContent = '状态读取失败'; }
          };
          const refreshUsage = async () => {
            usageResult.textContent = '正在读取…';
            try {
              const response = await api('/api/plugins/call', 'POST', { tool: 'image_generation_status', input: {} });
              const result = response?.result || response || {};
              if (response?.ok !== true || result.ok !== true) throw Error(result.error || response?.error || '接口返回了无效用量');
              usageResult.textContent = '日期 ' + (result.day || '—') + ' · 全局已用 ' + (result.globalUsed ?? '—') + ' / ' + (result.globalLimit ?? '—') + ' · 会话上限 ' + (result.sessionLimit ?? '—') + ' · 模式 ' + (result.quotaMode || '—');
            } catch (error) { usageResult.textContent = '用量读取失败：' + (error?.message || '未知错误'); }
          };
          panel.querySelector('.image-secret-set').addEventListener('click', async () => {
            const apiKey = secretInput.value.trim();
            if (!apiKey) { secretMessage.textContent = '请先输入新密钥。'; secretInput.focus(); return; }
            secretInput.value = '';
            secretMessage.textContent = '正在保存…';
            try { showSecretState((await secretCall({ op: 'set', apiKey })).configured === true); secretMessage.textContent = '密钥已保存。'; }
            catch { secretMessage.textContent = '密钥保存失败。'; }
          });
          panel.querySelector('.image-secret-clear').addEventListener('click', async () => {
            secretInput.value = '';
            secretMessage.textContent = '正在清除…';
            try { showSecretState((await secretCall({ op: 'clear' })).configured === true); secretMessage.textContent = '密钥已清除。'; }
            catch { secretMessage.textContent = '密钥清除失败。'; }
          });
          panel.querySelector('.image-usage-refresh').addEventListener('click', refreshUsage);
          void refreshSecret();
          void refreshUsage();
        }
