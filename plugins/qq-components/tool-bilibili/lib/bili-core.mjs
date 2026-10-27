const BV_RE = /^BV[0-9A-Za-z]{10}$/i;
const BILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv']);

export class BiliError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'BiliError';
    this.code = code;
  }
}

function invalidInput() {
  return new BiliError('INVALID_VIDEO_INPUT', '输入必须是 BV 号、AV 号或 Bilibili 视频链接');
}

function positivePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isSafeInteger(page) && page > 0 && page <= 1000 ? page : 1;
}

export function parseVideoInput(input) {
  const value = String(input ?? '').trim();
  if (!value || value.length > 2048) throw invalidInput();

  const bv = value.match(/^(BV[0-9A-Za-z]{10})$/i);
  if (bv) return { bvid: bv[1], page: 1 };

  const av = value.match(/^(?:av)?(\d{1,15})$/i);
  if (av && Number(av[1]) > 0) return { aid: Number(av[1]), page: 1 };

  let url;
  try { url = new URL(value); } catch { throw invalidInput(); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !BILI_HOSTS.has(url.hostname.toLowerCase())) {
    throw invalidInput();
  }

  if (url.hostname.toLowerCase() === 'b23.tv') {
    if (!url.pathname || url.pathname === '/') throw invalidInput();
    url.hash = '';
    return { shortUrl: url.toString() };
  }

  const id = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)\/?$/i);
  if (!id) throw invalidInput();
  const page = positivePage(url.searchParams.get('p'));
  if (/^BV/i.test(id[1])) return { bvid: id[1], page };
  return { aid: Number(id[1].replace(/^av/i, '')), page };
}

function cleanText(value, maxLength = 2000) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function durationSeconds(value) {
  if (Number.isFinite(Number(value)) && typeof value !== 'string') return Math.max(0, Math.floor(Number(value)));
  const parts = String(value ?? '').split(':').map(Number);
  if (!parts.length || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return 0;
  return Math.floor(parts.reduce((total, part) => total * 60 + part, 0));
}

function safeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function bvidFor(item) {
  const value = String(item?.bvid ?? '').trim();
  return BV_RE.test(value) ? value : '';
}

export function normalizeSearchResults(raw, excludeBvids = []) {
  const results = Array.isArray(raw) ? raw : Array.isArray(raw?.data?.result) ? raw.data.result : Array.isArray(raw?.result) ? raw.result : [];
  const excluded = new Set((Array.isArray(excludeBvids) ? excludeBvids : []).map(x => String(x).trim().toUpperCase()));
  const seen = new Set();
  const items = [];
  for (const row of results) {
    const bvid = bvidFor(row);
    if (!bvid || seen.has(bvid) || excluded.has(bvid.toUpperCase())) continue;
    seen.add(bvid);
    items.push({
      bvid,
      aid: safeCount(row.aid) || undefined,
      title: cleanText(row.title, 300),
      uploader: cleanText(row.author ?? row.owner?.name, 160),
      description: cleanText(row.description ?? row.desc, 1000),
      durationSeconds: durationSeconds(row.duration),
      publishTime: safeCount(row.pubdate),
      playCount: safeCount(row.play ?? row.stat?.view),
      url: `https://www.bilibili.com/video/${bvid}`
    });
  }
  return items;
}

export function normalizeVideoInfo(raw) {
  const item = raw?.data?.View ?? raw?.data ?? raw?.View ?? raw;
  const bvid = bvidFor(item);
  if (!bvid) throw new BiliError('VIDEO_UNAVAILABLE', 'Bilibili 未返回有效视频信息');
  const rawPages = Array.isArray(item.pages) ? item.pages : [];
  const pages = rawPages.slice(0, 100).map((page, index) => ({
    page: positivePage(page.page ?? index + 1),
    cid: safeCount(page.cid),
    part: cleanText(page.part, 300),
    durationSeconds: durationSeconds(page.duration)
  })).filter(page => page.cid > 0);
  return {
    bvid,
    aid: safeCount(item.aid) || undefined,
    title: cleanText(item.title, 300),
    description: cleanText(item.desc ?? item.description, 4000),
    uploader: cleanText(item.owner?.name ?? item.author, 160),
    cover: String(item.pic ?? item.cover ?? '').slice(0, 2048),
    durationSeconds: durationSeconds(item.duration),
    publishTime: safeCount(item.pubdate),
    playCount: safeCount(item.stat?.view ?? item.play),
    url: `https://www.bilibili.com/video/${bvid}`,
    pages
  };
}

export function normalizeSubtitles(tracksRaw, segmentsRaw) {
  const tracks = (Array.isArray(tracksRaw) ? tracksRaw : []).slice(0, 20).map(track => ({
    language: cleanText(track.lan, 40),
    label: cleanText(track.lan_doc ?? track.lan, 100)
  }));
  const segments = (Array.isArray(segmentsRaw) ? segmentsRaw : []).slice(0, 20000).map(segment => ({
    startSeconds: Math.max(0, Number(segment.from) || 0),
    endSeconds: Math.max(0, Number(segment.to) || 0),
    text: cleanText(segment.content, 2000)
  })).filter(segment => segment.endSeconds >= segment.startSeconds && segment.text);
  return { status: tracks.length ? 'available' : 'unavailable', tracks, segments };
}

export function planVideoRanges({ durationSeconds: duration, maxSegmentSeconds, startSeconds = 0, endSeconds = duration } = {}) {
  const fullDuration = Number(duration);
  const segmentLimit = Number(maxSegmentSeconds);
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  if (!Number.isFinite(fullDuration) || fullDuration <= 0 || !Number.isFinite(segmentLimit) || segmentLimit <= 0 ||
      !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > fullDuration) {
    throw new BiliError('INVALID_RANGE', '视频时间范围无效');
  }
  const ranges = [];
  for (let cursor = start; cursor < end; cursor = Math.min(end, cursor + segmentLimit)) {
    const next = Math.min(end, cursor + segmentLimit);
    ranges.push({ startSeconds: cursor, endSeconds: next });
  }
  return ranges;
}
