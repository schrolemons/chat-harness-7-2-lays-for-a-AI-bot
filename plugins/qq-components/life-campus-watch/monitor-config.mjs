const SCRIPT_IDS = new Set(['blackboard', 'lectures', 'bookmarks', 'grab']);

// 把「字符串数组」或「{value, enabled} 数组」统一成已启用条目的字符串数组（勾选=启用，取消勾选不生效但保留）。
function normalizeItems(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((e) => (typeof e === 'string' ? { value: e, enabled: true } : e))
    .filter((e) => e && e.enabled !== false)
    .map((e) => String(e.value ?? '').trim())
    .filter(Boolean);
}

export function parseEnabledScripts(value = 'blackboard|lectures|bookmarks|grab') {
  const selected = new Set(String(value).split('|').map(s => s.trim()).filter(Boolean));
  for (const id of selected) if (!SCRIPT_IDS.has(id)) throw Error('无效脚本：' + id);
  return selected;
}

export function parseWatchUrls(lines, fallback = []) {
  const active = normalizeItems(lines);
  if (!active.length) return fallback;
  if (active.length > 20) throw Error('最多监控 20 个网址');
  const seen = new Set();
  return active.map((raw, index) => {
    const split = raw.indexOf('|');
    const name = split < 0 ? '网页 ' + (index + 1) : raw.slice(0, split).trim().slice(0, 60);
    const urlText = split < 0 ? raw : raw.slice(split + 1).trim();
    let url;
    try { url = new URL(urlText); } catch { throw Error('网址格式无效：' + urlText); }
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('监控网址只接受 http/https');
    if (seen.has(url.href)) throw Error('重复网址：' + url.href);
    seen.add(url.href);
    return { name: name || '网页 ' + (index + 1), url: url.href };
  });
}

export function parseScriptPaths(lines) {
  const values = normalizeItems(lines);
  if (values.length > 30) throw Error('最多登记 30 个脚本');
  if (values.some(value => /[\r\n\0]/.test(value))) throw Error('脚本路径不能包含换行或空字符');
  if (new Set(values).size !== values.length) throw Error('脚本路径不能重复');
  return values;
}

// BB 课程：每行「课程名|courseId|页面名|contentId」，按 courseId 归组回结构化数组。
export function parseBbCourses(lines) {
  if (!Array.isArray(lines)) return [];
  const map = new Map();
  for (const raw of lines) {
    const parts = String(raw || '').split('|').map(s => s.trim());
    if (parts.length < 4) continue;
    const [name, courseId, label, contentId] = parts;
    if (!name || !courseId || !label || !contentId) continue;
    if (!map.has(courseId)) map.set(courseId, { name, courseId, pages: [] });
    map.get(courseId).pages.push({ label, contentId });
  }
  return [...map.values()];
}

// 讲座配置：从扁平字段拼回 campus-watch 期望的结构。
export function parseLectures(cfg = {}) {
  return {
    enabled: cfg.lecturesEnabled !== false,
    portalUrl: String(cfg.lecturesPortalUrl || '').trim(),
    api: String(cfg.lecturesApi || '').trim(),
    locationKeyword: String(cfg.lecturesLocation || '').trim(),
    intervalMinutes: Number(cfg.lecturesIntervalMinutes) || 10
  };
}
