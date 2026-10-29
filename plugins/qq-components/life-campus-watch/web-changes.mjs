import { createHash } from 'node:crypto';

const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const NOISE = /^(?:我的主页|\d+的标签\d+|课程|菜单管理选项|课程菜单[:：]?|课程主页|课程通知|课程资源|讨论版|作业区|工具|内容|跳过.*|主页|首页|返回顶部|展开.*菜单|收起.*菜单|登录|退出|注销|访问主页|数据智能实验室|中国科学技术大学\s*[·・].*实验室|PPT|PDF|下载|Home|Menu|Navigation|Copyright.*|版权所有.*)$/iu;
const important = text => /课件|讲义|大纲|作业|截止|提交|通知|考试|测验|评分|考核|教材|教室|教师|授课|周[一二三四五六日天]|第\s*\d|\bG\d[-－]|lecture|slides?|assignment|deadline|syllabus|quiz|\.pdf|\.pptx?/iu.test(text);
const useful = value => { const text = clean(value); return text && !NOISE.test(text); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

/** Runs in the page; prefer course content and exclude navigation/footer from both text and links. */
export function extractPageSnapshot() {
  const ignored = 'nav,footer,header,[role="navigation"],#courseMenuPalette,#navigationPane,.breadcrumbs,.breadcrumb';
  const roots = ['#content_listContainer', '#contentPanel', 'main', 'article', '[role="main"]'];
  const root = roots.map(selector => document.querySelector(selector)).find(Boolean) || document.body;
  const normalize = text => String(text || '').replace(/\s+/gu, ' ').trim();
  const omitted = new Set([...root?.querySelectorAll(ignored) || []].flatMap(el => (el.innerText || '').split('\n').map(normalize)));
  const lines = [...new Set(String(root?.innerText || '').split('\n').map(normalize).filter(line => line && !omitted.has(line)))].slice(0, 500);
  const links = [...root?.querySelectorAll('a[href]') || []].filter(a => !a.closest(ignored)).map(a => ({ t: normalize(a.innerText).slice(0, 160), h: a.getAttribute('href') || '' })).slice(0, 300);
  // Authentication evidence must be captured in the same DOM snapshot as text:
  // the content URL can stay unchanged and normalization merges heading lines.
  const visible = el => !!el && !el.hidden && el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const password = [...document.querySelectorAll('input[type="password"]')].some(visible);
  const authTitle = /^(?:(?:account\s+)?(?:sign[ -]?in|log[ -]?in)(?:\s+(?:to|with)\b.*)?|登录|账号登录|统一身份认证(?:登录)?)$/i;
  const authAction = /^(?:(?:sign[ -]?in|log[ -]?in)(?:\s+(?:to|with)\b.*)?|continue with\s+.+|登录|统一身份认证(?:登录)?|使用.+登录)$/i;
  const headings = [...root?.querySelectorAll('h1,h2,h3,[role="heading"]') || []];
  const actions = [...root?.querySelectorAll('button,[role="button"],input[type="submit"],form a[href]') || []];
  const heading = headings.some(el => visible(el) && authTitle.test(normalize(el.innerText)));
  const action = actions.some(el => visible(el) && authAction.test(normalize(el.innerText || el.value || el.getAttribute('aria-label'))));
  const username = [...root?.querySelectorAll('input[autocomplete="username"],input[type="email"]') || []].some(visible);
  const signInPrompt = action && (heading || username);
  return { url: location.href, title: document.title, text: lines.join(' '), lines, links, password, signInPrompt, contentVersion: 2 };
}

function safeLinks(links, base) {
  return (links || []).flatMap(link => {
    const title = clean(link.t ?? link.title);
    if (!useful(title)) return [];
    try {
      const url = new URL(link.h ?? link.url, base);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
      if ([...url.searchParams.keys()].some(key => /token|ticket|session|auth|password/i.test(key))) return [];
      url.hash = '';
      return [{ title, url: url.href }];
    } catch { return []; }
  });
}

export function buildWebChange({ site, previous, current, sourceAt = Date.now() }) {
  // An old hash without text cannot prove which content was added.
  if (!Array.isArray(previous?.lines)) return null;
  const oldLines = [...new Set(previous.lines.map(clean).filter(useful))];
  const newLines = [...new Set((current.lines || []).map(clean).filter(useful))];
  const added = newLines.filter(line => !oldLines.includes(line)).slice(0, 60);
  // First migration from whole-page snapshots cannot establish real deletions.
  const removed = previous.contentVersion === 2 ? oldLines.filter(line => !newLines.includes(line)).slice(0, 60) : [];
  const beforeLinks = safeLinks(previous.linkDetails, site.url);
  const oldTitles = new Set((previous.links || previous.items || []).map(clean));
  const newLinks = safeLinks(current.links, site.url).filter(link => !beforeLinks.some(old => old.title === link.title && old.url === link.url) && !(previous.contentVersion !== 2 && oldTitles.has(link.title))).slice(0, 24);
  if (!added.length && !removed.length && !newLinks.length) return null;
  const evidence = { name: site.name, url: site.url, added, removed, newLinks };
  const id = digest(evidence);
  return { kind: 'bookmark', sourceAt, webDiff: { id, ...evidence }, msg: `【${site.name}】网页内容有变化` };
}

export function stageWebChanges(state, changes, now = Date.now()) {
  state.pendingWebChanges ||= {};
  state.webChangeHistory ||= [];
  for (const change of changes) if (change?.webDiff) {
    state.pendingWebChanges[change.webDiff.id] ||= change;
    if (!state.webChangeHistory.some(item => item.webDiff.id === change.webDiff.id)) state.webChangeHistory.push(change);
  }
  state.webChangeHistory = state.webChangeHistory.slice(-80);
  for (const [id, item] of Object.entries(state.pendingWebChanges)) if (now - Number(item.sourceAt || 0) >= 86400000) delete state.pendingWebChanges[id];
  return [...changes.filter(change => !change.webDiff), ...Object.values(state.pendingWebChanges)];
}

function fallback(diff) {
  const rows = [
    ...diff.added.slice(0, 6).map(line => '新增或调整：' + line.slice(0, 180)),
    ...diff.removed.slice(0, 3).map(line => '页面移除：' + line.slice(0, 180)),
  ];
  if (!rows.length && diff.newLinks.length) rows.push('新增资料链接：' + diff.newLinks.map(link => link.title).slice(0, 6).join('、'));
  return rows;
}

function validatePoints(row, diff) {
  if (!row || typeof row.meaningful !== 'boolean' || !Array.isArray(row.points)) return null;
  const all = [...diff.added, ...diff.removed, ...diff.newLinks.map(link => link.title + ' ' + link.url)].join('\n');
  if (!row.meaningful) return important(all) ? null : [];
  if (!row.points.length || row.points.length > 8) return null;
  const points = [];
  for (const point of row.points) {
    const text = clean(point.text);
    if (!text || text.length > 240 || /https?:\/\//i.test(text) || !Array.isArray(point.evidence) || !point.evidence.length) return null;
    const cited = [];
    for (const ref of point.evidence) {
      const match = /^(added|removed|link):(\d+)$/.exec(ref);
      if (!match) return null;
      const source = (match[1] === 'link' ? diff.newLinks.map(link => link.title + ' ' + link.url) : diff[match[1]])[Number(match[2])];
      if (!source) return null;
      cited.push(source);
    }
    // Dates, room numbers and counts must occur in the evidence cited for that point.
    const evidenceText = cited.join('\n');
    if ((text.match(/\d+/g) || []).some(number => !evidenceText.includes(number)
      && !(Number(number) <= cited.length && new RegExp(number + '\\s*(?:份|个|组|套|项)').test(text)))) return null;
    points.push(text);
  }
  return points;
}

export async function prepareWebNotifications(changes, { generate, cache = {}, onError = () => {} } = {}) {
  const web = changes.filter(change => change.webDiff);
  const missing = web.filter(change => !cache[change.webDiff.id]);
  let rows = [];
  if (missing.length && generate) {
    try {
      const result = await generate({ pages: missing.slice(0, 6).map(({ webDiff: diff }) => ({ ...diff,
        added: diff.added.slice(0, 24).map(line => line.slice(0, 200)), removed: diff.removed.slice(0, 12).map(line => line.slice(0, 200)), newLinks: diff.newLinks.slice(0, 12) })) });
      if (Array.isArray(result?.pages)) rows = result.pages;
    } catch (error) { onError(error); }
  }
  const suppressedIds = [];
  const prepared = changes.flatMap(change => {
    if (!change.webDiff) return [change];
    const diff = change.webDiff;
    let summary = cache[diff.id];
    if (!summary) {
      const matching = rows.filter(row => row.id === diff.id);
      const points = matching.length === 1 ? validatePoints(matching[0], diff) : null;
      summary = cache[diff.id] = { points: points ?? fallback(diff), mode: points === null ? 'fallback' : 'ai' };
    }
    if (!summary.points.length) { suppressedIds.push(diff.id); return []; }
    const resources = diff.newLinks.filter(link => important(link.title + link.url)).slice(0, 6);
    const msg = `【${diff.name}】网页更新\n` + summary.points.map(point => '• ' + point).join('\n')
      + (resources.length ? '\n资料：\n' + resources.map(link => link.title + '：' + link.url).join('\n') : '') + '\n原网页：' + diff.url;
    return [{ ...change, msg, summaryMode: summary.mode, deliveryId: 'campus-web:' + diff.id }];
  });
  return { changes: prepared, suppressedIds };
}
