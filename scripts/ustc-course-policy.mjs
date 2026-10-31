import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const historyPath = dir => path.join(dir, 'data', 'auto_enrolled.json');
function readObject(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('课程策略文件格式错误：' + file);
  return value;
}
function saveHistory(dir, history) {
  const file = historyPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(history, null, 2), 'utf8');
  fs.renameSync(file + '.tmp', file);
}
export function normalizeCourse(row) {
  return { bgbm: String(row.BGBM ?? row.bgbm ?? ''), title: row.BGTMZW ?? row.title,
    time: row.BGSJ ?? row.time, place: row.DD ?? row.place, dept: row.YXDM_DISPLAY ?? row.dept };
}
export function recordEnrollment(dir, row) {
  const item = normalizeCourse(row);
  if (!item.bgbm) throw new Error('选课成功结果缺少课程号，无法记录防重抢策略');
  const history = readObject(historyPath(dir));
  history[item.bgbm] ??= { ...item, at: Date.now(), notificationPending: true };
  saveHistory(dir, history);
}
export function migrateLegacyEnrollments(dir, state) {
  const history = readObject(historyPath(dir));
  let changed = false;
  for (const [key, at] of Object.entries(state.notifiedGrab || {})) {
    const id = key.includes('|') ? 'title:' + key : key;
    if (!history[id]) { history[id] = { bgbm: key.includes('|') ? undefined : key, at, notificationPending: false }; changed = true; }
  }
  for (const [key, value] of Object.entries(state.enrolled || {})) {
    const alias = 'title:' + key;
    if (!history[alias]) { history[alias] = { at: value.at, notificationPending: false }; changed = true; }
  }
  if (changed) saveHistory(dir, history);
}
export function pendingEnrollments(dir) {
  return Object.values(readObject(historyPath(dir))).filter(item => item.notificationPending && item.bgbm);
}
export function acknowledgeEnrollments(dir, ids) {
  if (!ids.length) return;
  const history = readObject(historyPath(dir));
  for (const id of ids) if (history[id]) history[id].notificationPending = false;
  saveHistory(dir, history);
}
export function loadCoursePolicy(dir, lectures = {}) {
  const config = yaml.load(fs.readFileSync(path.join(dir, 'config.yml'), 'utf8')) || {};
  const query = config.data_raw || {};
  const dept = query.querySetting?.find(item => item.name === 'YXDM')?.value;
  const excluded = readObject(path.join(dir, 'data', 'exclude.json'), { EXCLUDE_BGBM: [] }).EXCLUDE_BGBM;
  if (!Array.isArray(excluded)) throw new Error('排除列表格式错误，停止自动选课');
  return { dir, query, departments: new Set(String(dept || '').split(',').filter(Boolean)),
    location: String(lectures.locationKeyword ?? config.location_keyword ?? ''),
    excluded: new Set(excluded.map(String)), history: readObject(historyPath(dir)) };
}
function timestamp(text) {
  return Date.parse(String(text || '').trim().replace(' ', 'T'));
}
export function eligibleReports(rows, policy, now = Date.now()) {
  return rows.filter(row => {
    const id = String(row.BGBM || '');
    return id && !policy.excluded.has(id) && !policy.history[id] &&
      !policy.history['title:' + row.BGTMZW + '|' + row.BGSJ] &&
      (!policy.departments.size || policy.departments.has(String(row.YXDM))) &&
      (!policy.location || String(row.DD || '').includes(policy.location)) &&
      timestamp(row.BGSJ) > now && timestamp(row.JZSJ) > now &&
      (row.SFKXK == null || String(row.SFKXK) === '1');
  });
}
export async function processDOMRows(rows, policy, enroll) {
  const result = { grabbed: [], failed: [], full: [] };
  for (const course of eligibleReports(rows, policy)) {
    const capacity = Number(course.KXRS), selected = Number(course.YXRS);
    if (!Number.isFinite(capacity) || !Number.isFinite(selected)) continue;
    if (capacity <= selected) { result.full.push(course); continue; }
    let reply;
    try { reply = await enroll(course); } catch (error) { reply = { ok: false, error: error.message }; }
    if (reply.ok === true) {
      recordEnrollment(policy.dir, course);
      policy.history[String(course.BGBM)] = normalizeCourse(course);
      result.grabbed.push(normalizeCourse(course));
    } else result.failed.push({ course, error: reply.error || '选课未成功' });
  }
  return result;
}
