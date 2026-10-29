
import { applyCConfig } from '../layers/C/config-load.js';
import { applyTConfig } from '../layers/T/config-load.js';
import { applyEConfig } from '../layers/E/config-load.js';
import { applyLConfig } from '../layers/L/config-load.js';
import { applyOConfig } from '../layers/O/config-load.js';
import { api } from './api.js';
import { refreshV2Diary } from '../layers/O/diary.js';
import { refreshV2Schedule } from '../layers/L/schedule.js';
import { refreshV2Mood } from '../layers/C/mood.js';
// shared/config-load: explicit imports; initialize is called in the application startup order.




async function loadV2Config() {
  try {
    const r = await api('/api/socialV2/config');
    const c = r.config || {};
    applyCConfig(c);
    applyTConfig(c);
    applyEConfig(c);
    applyLConfig(c);
    applyOConfig(c);
    refreshV2Mood(); refreshV2Diary(); refreshV2Schedule();
  } catch (error) {
    const alert = document.getElementById('connectionAlert');
    alert.hidden = false; alert.textContent = '参数读取失败：' + error.message;
    console.error('Console configuration failed', error);
  }
}

export function initialize() {

}
export { loadV2Config };
