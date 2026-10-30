import { api, esc } from '../../../shared/api.js';
export async function mountWorklog({id,body,p,el,form}) {
          body.insertAdjacentHTML('beforeend', '<section class="worklog-console" aria-label="运维日报与日报归档"><div class="worklog-console-head"><div><h3>日报归档与预览</h3><p class="meta">每天保留最新版；手动生成会立即私聊管理员。</p><div class="worklog-send-setting"></div></div><div class="row"><button class="small worklog-generate-send" type="button">立即生成与发送</button><button class="small worklog-refresh" type="button">刷新列表</button></div></div><details class="worklog-sources"><summary class="worklog-sources-title">日报扫描来源</summary><ul class="worklog-sources-list"><li class="worklog-source"><code>state/memory/tasks-*.md</code><span>提取当天的中期任务进度记录。</span></li><li class="worklog-source"><code>state/tasks.json</code><span>汇总当天创建或更新的独立任务及状态。</span></li><li class="worklog-source"><code>state/tool-calls.jsonl</code><span>统计当天的工具调用次数与失败次数。</span></li><li class="worklog-source"><code>state/tool-calls.jsonl.1</code><span>读取轮转的工具调用历史，补齐当天统计。</span></li><li class="worklog-source"><code>state/token-usage.jsonl</code><span>统计当天模型调用步数与输入、输出 token。</span></li><li class="worklog-source"><code>state/token-usage.jsonl.1</code><span>读取轮转的 token 历史，补齐当天统计。</span></li><li class="worklog-source"><code>state/plugins/obs-self-review.json</code><span>统计反馈队列当天的状态变更；不复制反馈正文。</span></li><li class="worklog-source"><code>state/memory/_optimization.md</code><span>提取当天的自我更新发现与统一修复摘要。</span></li></ul></details><div class="worklog-status" aria-live="polite"></div><div class="meta worklog-action-message" aria-live="polite"></div><div class="worklog-layout"><nav class="worklog-list" aria-label="日报日期列表"><div class="worklog-empty">读取日报列表中…</div></nav><article class="worklog-preview"><div class="worklog-preview-head"><b>内容预览</b><span class="meta worklog-preview-meta">选择一份日报</span></div><pre class="worklog-preview-text">日报内容会显示在这里。</pre></article></div></section>');
          const panel = body.querySelector('.worklog-console');
          const sendOption = body.querySelector('[data-config-key="sendToOwner"]');
          if (sendOption) panel.querySelector('.worklog-send-setting').append(sendOption);
          const list = panel.querySelector('.worklog-list');
          const preview = panel.querySelector('.worklog-preview-text');
          const previewMeta = panel.querySelector('.worklog-preview-meta');
          const status = panel.querySelector('.worklog-status');
          const actionMessage = panel.querySelector('.worklog-action-message');
          const read = async (input = {}) => {
            const response = await api('/api/plugins/call', 'POST', { tool: 'worklog_history', input });
            const result = response?.result || response || {};
            if (result.ok !== true) throw Error(result.error || '读取失败');
            return result;
          };
          const loadReport = async (date) => {
            panel.querySelectorAll('.worklog-date').forEach(button => button.classList.toggle('active', button.dataset.date === date));
            preview.textContent = '正在读取日报…';
            try {
              const report = await read({ date });
              preview.textContent = report.text || '（日报内容为空）';
              previewMeta.textContent = report.date + ' · ' + report.chars + ' 字 · 更新于 ' + new Date(report.updatedAt).toLocaleString();
            } catch (error) { preview.textContent = '读取失败：' + error.message; previewMeta.textContent = date; }
          };
          const refresh = async () => {
            const config = p.config || {};
            const generated = p.state?.lastGeneratedDate || '尚无生成记录';
            const hh = String(Number(config.hour ?? 23)).padStart(2, '0');
            const mm = String(Number(config.minute ?? 0)).padStart(2, '0');
            status.innerHTML = '<span class="worklog-chip">每日生成 · ' + hh + ':' + mm + '</span><span class="worklog-chip">最近生成 · ' + esc(generated) + '</span>';
            list.innerHTML = '<div class="worklog-empty">正在读取…</div>';
            preview.textContent = '选择一份日报查看内容。';
            previewMeta.textContent = '只读预览';
            try {
              const history = await read({ limit: 30 });
              const reports = Array.isArray(history.reports) ? history.reports : [];
              if (!reports.length) { list.innerHTML = '<div class="worklog-empty">还没有生成日报。到达设定时间且当天有可汇总数据后会自动生成。</div>'; return; }
              list.innerHTML = reports.map(report => '<button class="worklog-date" type="button" data-date="' + esc(report.date) + '"><span>' + esc(report.date) + '<small>' + new Date(report.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' 更新</small></span><small>' + esc(report.chars) + ' 字</small></button>').join('');
              list.querySelectorAll('.worklog-date').forEach(button => button.addEventListener('click', () => loadReport(button.dataset.date)));
              await loadReport(reports[0].date);
            } catch (error) { list.innerHTML = '<div class="worklog-empty">读取失败：' + esc(error.message) + '</div>'; }
          };
          panel.querySelector('.worklog-generate-send').addEventListener('click', async event => {
            const button = event.currentTarget;
            button.disabled = true;
            actionMessage.textContent = '正在生成并发送今天的日报…';
            try {
              const result = await api('/api/socialV2/worklog/generate-send', 'POST', {});
              await refresh();
              actionMessage.textContent = result.ok
                ? `已生成并发送 ${result.dateKey} 的日报摘要；当天归档已更新为最新版（${result.chars} 字）。`
                : result.generated
                  ? `日报已更新并覆盖当天归档，但发送失败：${result.error || '未获发送确认'}`
                  : (result.error || '日报生成失败');
            } catch (error) {
              actionMessage.textContent = '生成或发送失败：' + (error.message || error);
            } finally { button.disabled = false; }
          });
          panel.querySelector('.worklog-refresh').addEventListener('click', refresh);
          void refresh();
        }
