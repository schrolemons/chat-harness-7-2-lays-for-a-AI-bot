import { createHash } from 'node:crypto';
import { BiliError, normalizeSearchResults, normalizeSubtitles, normalizeVideoInfo, parseVideoInput } from './bili-core.mjs';

const API = 'https://api.bilibili.com';
const PAGE_HOSTS = new Set(['www.bilibili.com', 'bilibili.com', 'm.bilibili.com', 'b23.tv']);
const CONTENT_SUFFIXES = ['.hdslb.com', '.bilibili.com', '.bilivideo.com', '.bilivideo.cn', '.bilivideo.net'];
const MIXIN_TABLE = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';

function error(code, message, options) { return new BiliError(code, message, options); }

function safeEndpointUrl(value, { content = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw error('UNSAFE_URL', 'Bilibili 返回了无效地址'); }
  const hostname = url.hostname.toLowerCase();
  const hostAllowed = content
    ? CONTENT_SUFFIXES.some(suffix => hostname.endsWith(suffix))
    : hostname === 'api.bilibili.com';
  if (url.protocol !== 'https:' || !hostAllowed || url.username || url.password || url.port) {
    throw error('UNSAFE_URL', '请求目标不在允许访问的 Bilibili 公共域名内');
  }
  return url;
}

function keyFromUrl(value) {
  const name = String(value ?? '').split('/').pop() ?? '';
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
}

function encodeWbi(value) {
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ''));
}

function signedParams(params, wbiImages, now = Date.now()) {
  const rawKey = keyFromUrl(wbiImages?.img_url) + keyFromUrl(wbiImages?.sub_url);
  if (rawKey.length !== 64) throw error('WBI_UNAVAILABLE', 'Bilibili 未提供可用的公开 WBI 签名密钥');
  const mixinKey = MIXIN_TABLE.map(index => rawKey[index]).join('').slice(0, 32);
  const values = { ...params, wts: Math.floor(now / 1000) };
  delete values.w_rid;
  const query = Object.keys(values).sort().map(key => `${encodeWbi(key)}=${encodeWbi(values[key])}`).join('&');
  const w_rid = createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${w_rid}`;
}

export function createRequestGate(minIntervalMs = 650) {
  let lastAt = 0;
  let pending = Promise.resolve();
  return () => {
    const next = pending.then(async () => {
      const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastAt));
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      lastAt = Date.now();
    });
    pending = next.catch(() => {});
    return next;
  };
}

async function readLimitedText(response, maxBytes) {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw error('RESPONSE_TOO_LARGE', 'Bilibili 响应超过大小上限');
    return new TextDecoder().decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw error('RESPONSE_TOO_LARGE', 'Bilibili 响应超过大小上限');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

export function createBiliClient({
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
  maxResponseBytes = 2 * 1024 * 1024,
  requestGate = createRequestGate(),
  signal,
  now = () => Date.now()
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  let navCache = null;

  async function getJson(urlValue, { referer = 'https://www.bilibili.com/', content = false } = {}) {
    const url = safeEndpointUrl(urlValue, { content });
    await requestGate();
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.8', 'user-agent': USER_AGENT, referer },
        signal: signal ? AbortSignal.any([AbortSignal.timeout(Math.max(100, timeoutMs)), signal]) : AbortSignal.timeout(Math.max(100, timeoutMs))
      });
    } catch (cause) {
      if (signal?.aborted) throw error('REQUEST_ABORTED', 'Bilibili 请求已取消', { cause });
      if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') throw error('REQUEST_TIMEOUT', 'Bilibili 请求超时', { cause });
      throw error('NETWORK_ERROR', '无法连接 Bilibili 公共接口', { cause });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) throw error('UNSAFE_REDIRECT', 'Bilibili API 响应了非预期重定向');
    if (response.status === 412 || response.status === 429) throw error('RATE_LIMITED', `Bilibili 暂时限制请求（HTTP ${response.status}），请稍后重试`);
    if (!response.ok) throw error('UPSTREAM_HTTP_ERROR', `Bilibili 公共接口返回 HTTP ${response.status}`);
    const text = await readLimitedText(response, maxResponseBytes);
    let json;
    try { json = JSON.parse(text); } catch { throw error('UPSTREAM_INVALID_JSON', 'Bilibili 公共接口未返回有效 JSON'); }
    if (typeof json?.code === 'number' && json.code !== 0) {
      if ([-101, -403, -404, -10403].includes(json.code)) throw error(json.code === -404 ? 'VIDEO_UNAVAILABLE' : 'ACCESS_RESTRICTED', '该公开视频或字幕当前无法匿名访问');
      if ([-352, -412].includes(json.code)) throw error('RATE_LIMITED', 'Bilibili 暂时限制了该公开接口，请停止重试并稍后再试');
      throw error('UPSTREAM_API_ERROR', `Bilibili 公共接口失败（code ${json.code}）`);
    }
    return json;
  }

  async function wbiImages() {
    if (navCache && navCache.expiresAt > now()) return navCache.images;
    const result = await getJson(`${API}/x/web-interface/nav`);
    const images = result?.data?.wbi_img;
    if (!images?.img_url || !images?.sub_url) throw error('WBI_UNAVAILABLE', 'Bilibili 没有返回公开 WBI 密钥');
    navCache = { images, expiresAt: now() + 10 * 60 * 1000 };
    return images;
  }

  async function apiGet(path, params = {}, { wbi = false, referer } = {}) {
    if (!/^\/[a-z0-9/_-]+$/i.test(path)) throw error('INTERNAL_ENDPOINT_ERROR', '拒绝访问未登记的 Bilibili 接口');
    let query;
    if (wbi) query = signedParams(params, await wbiImages(), now());
    else query = new URLSearchParams(params).toString();
    return getJson(`${API}${path}${query ? `?${query}` : ''}`, { referer });
  }

  async function resolveVideoInput(input) {
    let parsed = parseVideoInput(input);
    if (!parsed.shortUrl) return parsed;
    let current = parsed.shortUrl;
    for (let redirects = 0; redirects < 4; redirects += 1) {
      let response;
      try {
        await requestGate();
        response = await fetchImpl(current, {
          method: 'GET', redirect: 'manual', headers: { accept: 'text/html', 'user-agent': USER_AGENT },
          signal: signal ? AbortSignal.any([AbortSignal.timeout(Math.max(100, timeoutMs)), signal]) : AbortSignal.timeout(Math.max(100, timeoutMs))
        });
      } catch (cause) {
        if (signal?.aborted) throw error('REQUEST_ABORTED', 'Bilibili 短链接解析已取消', { cause });
        if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') throw error('REQUEST_TIMEOUT', 'Bilibili 短链接解析超时', { cause });
        throw error('NETWORK_ERROR', '无法解析 Bilibili 短链接', { cause });
      }
      const location = response.headers?.get?.('location');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        let next;
        try { next = new URL(location, current); } catch { throw error('UNSAFE_REDIRECT', 'Bilibili 短链接返回了无效跳转'); }
        if (next.protocol !== 'https:' || !PAGE_HOSTS.has(next.hostname.toLowerCase()) || next.username || next.password || next.port) {
          throw error('UNSAFE_REDIRECT', 'Bilibili 短链接跳转到了不允许的域名');
        }
        current = next.href;
        if (next.hostname.toLowerCase() !== 'b23.tv') return parseVideoInput(current);
        continue;
      }
      const finalUrl = response.url || current;
      const final = new URL(finalUrl);
      if (response.ok && PAGE_HOSTS.has(final.hostname.toLowerCase()) && final.hostname.toLowerCase() !== 'b23.tv') return parseVideoInput(final.href);
      throw error('VIDEO_UNAVAILABLE', '无法从公开短链接解析视频地址');
    }
    throw error('TOO_MANY_REDIRECTS', 'Bilibili 短链接跳转次数超过限制');
  }

  async function search({ keyword, page = 1, order = 'relevance', excludeBvids = [] } = {}) {
    const q = String(keyword ?? '').trim();
    if (!q || q.length > 100) throw error('INVALID_QUERY', '搜索关键词不能为空且不能超过 100 个字符');
    const pageNumber = Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 20) throw error('INVALID_PAGE', '搜索页码范围为 1 到 20');
    const orders = { relevance: 'totalrank', play: 'click', pubdate: 'pubdate' };
    if (order !== undefined && !Object.hasOwn(orders, order)) throw error('INVALID_SORT', '排序仅支持 relevance、play 或 pubdate');
    const exclusions = Array.isArray(excludeBvids) ? excludeBvids.slice(0, 100).map(String) : [];
    const result = await apiGet('/x/web-interface/search/type', { search_type: 'video', keyword: q, page: pageNumber, order: orders[order] || 'totalrank' });
    const items = normalizeSearchResults(result?.data?.result, exclusions);
    return { status: 'ok', keyword: q, page: pageNumber, order, items };
  }

  async function videoInfo({ bvid, aid, page = 1 } = {}) {
    const parsed = bvid || aid ? { bvid, aid, page } : await resolveVideoInput(arguments[0]?.video ?? arguments[0]?.input);
    if (!(parsed.bvid || parsed.aid)) throw error('INVALID_VIDEO_INPUT', '视频信息查询需要 BV 号、AV 号或 Bilibili 链接');
    const result = await apiGet('/x/web-interface/view/detail', { ...(parsed.bvid ? { bvid: parsed.bvid } : { aid: parsed.aid }) }, { referer: parsed.bvid ? `https://www.bilibili.com/video/${parsed.bvid}/` : 'https://www.bilibili.com/' });
    const info = normalizeVideoInfo(result);
    const selectedPage = Math.min(Math.max(1, Number(parsed.page) || 1), Math.max(info.pages.length, 1));
    return { ...info, selectedPage };
  }

  async function subtitles({ bvid, cid } = {}) {
    const video = String(bvid ?? '').trim();
    const contentId = Number(cid);
    if (!/^BV[0-9A-Za-z]{10}$/i.test(video) || !Number.isSafeInteger(contentId) || contentId <= 0) throw error('INVALID_VIDEO_INPUT', '字幕查询需要有效 BV 号和 CID');
    const result = await apiGet('/x/player/v2', { bvid: video, cid: contentId }, { referer: `https://www.bilibili.com/video/${video}/` });
    const data = result?.data ?? {};
    const tracks = Array.isArray(data.subtitle?.subtitles) ? data.subtitle.subtitles : [];
    if (!tracks.length) return { ...normalizeSubtitles([], []), reason: data.need_login_subtitle ? 'login_required' : 'no_public_subtitle' };
    const selected = tracks.find(track => track.lan === 'ai-zh') ?? tracks.find(track => ['zh-CN', 'zh-Hans', 'zh'].includes(track.lan)) ?? tracks[0];
    let subtitleUrl = String(selected.subtitle_url ?? '');
    if (subtitleUrl.startsWith('//')) subtitleUrl = `https:${subtitleUrl}`;
    const subtitle = await getJson(subtitleUrl, { content: true, referer: `https://www.bilibili.com/video/${video}/` });
    return normalizeSubtitles([selected], subtitle.body);
  }

  async function audienceContext({ aid, bvid, limit = 8 } = {}) {
    const info = aid ? { aid: Number(aid) } : await videoInfo({ bvid });
    if (!Number.isSafeInteger(Number(info.aid)) || Number(info.aid) <= 0) throw error('INVALID_VIDEO_INPUT', '获取公开热评需要视频 AV ID');
    const count = Math.max(1, Math.min(20, Number(limit) || 8));
    const result = await apiGet('/x/v2/reply/wbi/main', { type: 1, oid: Number(info.aid), mode: 3, next: 0, ps: count, web_location: 1315875 }, { wbi: true });
    const replies = Array.isArray(result?.data?.replies) ? result.data.replies : [];
    return {
      status: 'available', source: 'public_comments', label: '观众评论，仅作辅助上下文，不代表视频事实',
      comments: replies.slice(0, count).map(reply => ({
        username: String(reply.member?.uname ?? '').slice(0, 100),
        text: String(reply.content?.message ?? '').replace(/\s+/g, ' ').slice(0, 1000),
        likes: Number.isSafeInteger(Number(reply.like)) ? Number(reply.like) : 0,
        publishTime: Number(reply.ctime) || 0
      }))
    };
  }

  async function publicPlayUrl({ bvid, cid, aid, quality = 32 } = {}) {
    const params = { cid: Number(cid), qn: Math.min(64, Math.max(16, Number(quality) || 32)), fnval: 0, fourk: 0 };
    if (bvid) params.bvid = String(bvid);
    else params.avid = Number(aid);
    if ((!bvid && !(Number(params.avid) > 0)) || !(params.cid > 0)) throw error('INVALID_VIDEO_INPUT', '获取公开视频流需要有效 CID 和视频 ID');
    const result = await apiGet('/x/player/playurl', params, { referer: bvid ? `https://www.bilibili.com/video/${bvid}/` : 'https://www.bilibili.com/' });
    const data = result?.data ?? {};
    const durls = Array.isArray(data.durl) ? data.durl : [];
    if (durls.length > 1) throw error('SEGMENTED_STREAM_UNSUPPORTED', 'Bilibili 返回了多个 MP4 分段；为避免抽错时间段，本次无法安全抽帧');
    const durl = durls[0] ?? null;
    if (durl?.url) {
      const durlUrl = safeEndpointUrl(String(durl.url), { content: true });
      return { url: durlUrl.href, quality: Number(data.quality) || params.qn, referer: params.bvid ? `https://www.bilibili.com/video/${params.bvid}/` : 'https://www.bilibili.com/' };
    }
    const video = (Array.isArray(data.dash?.video) ? [...data.dash.video].sort((a, b) => Number(a.bandwidth) - Number(b.bandwidth))[0] : null);
    const rawUrl = video?.baseUrl ?? video?.base_url ?? data.durl?.[0]?.url;
    const url = safeEndpointUrl(String(rawUrl ?? ''), { content: true });
    return { url: url.href, quality: Number(video?.id ?? data.quality) || params.qn, referer: params.bvid ? `https://www.bilibili.com/video/${params.bvid}/` : 'https://www.bilibili.com/' };
  }

  return { search, resolveVideoInput, videoInfo, subtitles, audienceContext, publicPlayUrl };
}
