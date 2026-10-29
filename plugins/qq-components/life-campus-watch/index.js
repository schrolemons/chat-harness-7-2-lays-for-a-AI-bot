// Persist cooldowns and expose read-only per-site monitor status to the console.
import fs from 'node:fs';
import path from 'node:path';
import { parseEnabledScripts, parseWatchUrls, parseScriptPaths } from './monitor-config.mjs';
import { leaseActive } from '../../../scripts/campus-browser-session.mjs';

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// 内联：避免依赖 monitor-config.mjs 里「后加的」parseBbCourses 导出（插件宿主对依赖模块有缓存，
// 后加的导出在没重启桥接前 import 不到，报「does not provide an export named ...」）。
function parseBbCourses(lines) {
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

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const fast = Math.max(1, Number(cfg.fastCheckMinutes) || 1) * 60000;
  const full = Math.max(1, Number(cfg.fullCheckMinutes) || 30) * 60000;
  const base = readJson(path.join(ctx.root, 'campus-watch.json'));
  const watchUrls = parseWatchUrls(cfg.watchUrls, cfg.watchUrlsConfigured === true ? [] : (base.bookmarkPages || []));
  const enabledScripts = parseEnabledScripts(cfg.enabledScripts);
  const scriptPaths = parseScriptPaths(cfg.scriptPaths);
  const legacyBbLines = Array.isArray(base.bbCourses) ? base.bbCourses.flatMap(course =>
    (course.pages || []).map(page => [course.name, course.courseId, page.label, page.contentId].join('|'))) : [];
  const bbCourses = parseBbCourses(cfg.bbCoursesConfigured === true ? cfg.bbCourses :
    ((cfg.bbCourses || []).length ? cfg.bbCourses : legacyBbLines));
  ctx.state.set({ watchUrls: watchUrls.map(s => s.name + ' | ' + s.url), bbCourses: legacyBbLines });

  ctx.registerTool('campus_watch_status', {
    description: '只读查看监控网址、脚本选择及各监控灯状态；红灯表示需要管理员协助排查或登录',
    handler: () => {
      const state = readJson(path.join(ctx.root, 'state', 'campus-watch-state.json'));
      const heartbeats = readJson(path.join(ctx.root, 'state', 'script-heartbeats.json'));
      const scripts = scriptPaths.map(script => {
        const beat = heartbeats[script] || {};
        const recent = Number(beat.at) > 0 && Date.now() - Number(beat.at) < Math.max(full * 2, (Number(cfg.lecturesIntervalMinutes) || 10) * 120000, 10 * 60000);
        return { path: script, health: cfg.scriptCollabEnabled === false ? 'paused' : recent ? (beat.ok === false ? 'red' : beat.mode === 'fallback' ? 'fallback' : 'green') : Number(beat.at)>0 ? 'stale' : 'unknown', checkedAt: beat.at || null, hint: beat.hint || (recent ? '最近有运行心跳' : '尚未接入运行心跳') };
      });
      const bbSites = bbCourses.flatMap(course => (course.pages || []).map(p => {
        const url = `https://portal.example.invalid/webapps/blackboard/content/listContent.jsp?course_id=${course.courseId}&content_id=${p.contentId}&mode=reset`;
        return { name: `${course.name}·${p.label}`, url, health: state.monitorHealth?.[url] || null };
      }));
      const sites = (cfg.webWatchEnabled === false ? [] : watchUrls.map(site => ({ ...site, health: state.monitorHealth?.[site.url] || null })))
        .concat(enabledScripts.has('blackboard') ? bbSites : []);
      return { ok: true, sites, scripts, enabledScripts: [...enabledScripts] };
    }
  });

  return { hooks: { onTick({ now = Date.now() } = {}) {
    const hasWebWork = cfg.webWatchEnabled !== false && watchUrls.length > 0;
    const hasScriptWork = cfg.scriptCollabEnabled !== false && scriptPaths.length > 0;
    const hasLectureWork = enabledScripts.has('lectures') && (cfg.lecturesEnabled === true || cfg.lecturesEnabled !== false && base.lectures?.enabled === true);
    const hasLegacyWork = enabledScripts.has('blackboard') && bbCourses.length > 0 || hasLectureWork;
    if (!hasWebWork && !hasScriptWork && !hasLegacyWork) return;
    const spawn = ctx.capabilities?.spawnCampusWatch;
    if (typeof spawn !== 'function') return;
    if (leaseActive(path.join(ctx.root, 'state', 'login-window.lock')) || leaseActive(path.join(ctx.root, 'state', 'campus-watch.lock'))) return;
    const s = ctx.state.get(), t = Number(now) || Date.now();
    if (s.lastFastAt && t - s.lastFastAt < fast) return;
    const needFull = !s.lastFullAt || t - s.lastFullAt >= full;
    // A minute tick is a scheduler check, not a reason to navigate every minute.
    if (!needFull && !hasLectureWork) return;
    if (spawn(needFull ? [] : ['--lectures-only']) === true) ctx.state.set({ lastFastAt: t, ...(needFull ? { lastFullAt: t } : {}) });
  } } };
}
