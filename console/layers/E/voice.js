
import { api, esc } from '../../shared/api.js';
// layers/E/voice: explicit imports; initialize is called in the application startup order.

let voiceEntries;

let voiceLibraryLoaded;

async function loadVoiceLibrary(force) {
  if (voiceLibraryLoaded && force !== true) return;
  const box = document.getElementById('voiceList');
  const msg = document.getElementById('voiceMsg');
  try {
    const r = await api('/api/voice/list?probe=1');
    voiceEntries = Array.isArray(r.voices) ? r.voices : [];
    voiceLibraryLoaded = true;
    if (!voiceEntries.length) {
      box.innerHTML = '语音库是空的：把音频文件放进 <code>qq-bridge/audio/</code> 后点「刷新语音库」。';
      return;
    }
    const limits = r.limits || {};
    box.innerHTML = '共 ' + voiceEntries.length + ' 个（上限：' + (limits.maxSeconds || '?') + ' 秒 / '
      + Math.round((limits.maxBytes ?? 0) / 1024 / 1024) + ' MiB）。统一出站上限：' + (limits.maxPerMinute === 0 ? '每分钟无限制' : esc(limits.maxPerMinute ?? '不可用') + ' 条/分钟') + '，' + (limits.maxPerHour === 0 ? '每小时无限制' : esc(limits.maxPerHour ?? '不可用') + ' 条/小时') + '（与文字共用发送计划）。<br>'
      + voiceEntries.map((v, i) => {
        const bad = v.ok === false;
        // v.name / v.error / v.detail 来自语音库的文件名与探测结果，属于**外部数据**：
        // 语音库目录里放一个名为 `x<img src=x onerror=...>.mp3` 的文件即可注入脚本
        // （CSP 允许 unsafe-inline，拦不住内联事件处理器）。所有插值都必须过 esc()。
        return '<label style="display:block;margin:2px 0">'
          + '<input type="radio" name="voicePick" value="' + i + '"' + (i === 0 ? ' checked' : '') + '> '
          + '<code>' + esc(v.name) + '</code> ' + (bad ? '❌ ' + esc(v.error || '不可用') : esc(v.detail || ''))
          + '</label>';
      }).join('');
  } catch (error) {
    box.textContent = '加载失败：' + (error && error.message ? error.message : error);
  }
  if (msg) msg.textContent = '';
}

async function sendVoiceFromConsole() {
  const msg = document.getElementById('voiceMsg');
  const target = document.getElementById('voiceSendTarget').value.trim();
  const dryRun = document.getElementById('voiceSendDryRun').checked;
  const pick = document.querySelector('input[name="voicePick"]:checked');
  if (!target) { msg.textContent = '❌ 请填发送目标（如 group:20010）'; msg.className = 'meta err'; return; }
  if (!pick) { msg.textContent = '❌ 先刷新语音库并选中一个音频'; msg.className = 'meta err'; return; }
  const entry = voiceEntries[Number(pick.value)];
  msg.textContent = '发送中…'; msg.className = 'meta';
  try {
    const r = await api('/api/voice/send', 'POST', { target, file: entry.name, dryRun });
    if (r.dryRun) {
      msg.textContent = '✅ 校验通过（未发送）：' + (r.detail || '');
      msg.className = 'meta ok';
    } else if (r.ok) {
      msg.textContent = '✅ 已发出 messageId=' + (r.messageId ?? '?')
        + (r.detail ? '（' + r.detail + '）' : '')
        + (r.verified ? '，已回读校验为语音段' : '，未能回读校验');
      msg.className = 'meta ok';
    } else {
      msg.textContent = '❌ ' + (r.error || '失败');
      msg.className = 'meta err';
    }
  } catch (error) {
    msg.textContent = '❌ ' + (error && error.message ? error.message : error);
    msg.className = 'meta err';
  }
}

export function initialize() {
voiceEntries = [];
voiceLibraryLoaded = false;
}
export { voiceEntries, voiceLibraryLoaded, loadVoiceLibrary, sendVoiceFromConsole };
