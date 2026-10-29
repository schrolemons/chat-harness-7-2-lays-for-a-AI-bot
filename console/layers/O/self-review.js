
import { api } from '../../shared/api.js';
// layers/O/self-review: explicit imports; initialize is called in the application startup order.

async function saveV2SelfReviewConfig(button) {
  const msg = button?.closest('.settings-content')?.querySelector('.self-review-save-msg');
  const boundedInt = (id, min, max, fallback) => Math.min(max, Math.max(min, Math.round(Number(document.getElementById(id)?.value) || fallback)));
  if (button) button.disabled = true;
  if (msg) { msg.textContent = '正在保存…'; msg.className = 'meta'; }
  try {
    const result = await api('/api/socialV2/config', 'POST', { selfReview: {
      enabled: document.getElementById('v2SelfReviewEnabled').checked,
      intervalHours: boundedInt('v2SelfReviewHours', 1, 168, 6),
      autoOptimize: document.getElementById('v2SelfReviewAuto').checked,
      optimizeCooldownHours: boundedInt('v2SelfReviewCooldown', 1, 168, 2),
      maxFeedbackFixesPerRound: boundedInt('v2SelfReviewFeedbackMax', 1, 20, 3),
      maxSelfFixesPerRound: boundedInt('v2SelfReviewSelfMax', 1, 20, 3)
    } });
    if (result?.ok !== true) throw Error(result?.error || '保存失败');
    if (msg) { msg.textContent = '自我更新参数已保存'; msg.className = 'meta ok'; }
  } catch (error) {
    if (msg) { msg.textContent = '保存失败：' + (error?.message || error); msg.className = 'meta err'; }
  } finally { if (button) button.disabled = false; }
}

export function initialize() {


document.getElementById('v2SelfReviewSave')?.addEventListener('click', event => saveV2SelfReviewConfig(event.currentTarget));
document.getElementById('v2SelfReviewRun').addEventListener('click', async () => {
  const msg = document.getElementById('v2SelfReviewMsg');
  try {
    const r = await api('/api/socialV2/self-review', 'POST', { action: 'runNow' });
    if (msg) msg.textContent = r.ok ? (r.updateTriggered ? '✅ 已完成问题汇总并启动会话分析与自我改进，稍后查看记录/私聊汇报' : '✅ 问题汇总完成；未启动改进回合（请检查功能开关和运行模式）') : ('❌ ' + (r.error || '失败'));
  } catch (e) { if (msg) msg.textContent = '触发失败：' + (e && e.message ? e.message : e); }
});
}
export { saveV2SelfReviewConfig };
