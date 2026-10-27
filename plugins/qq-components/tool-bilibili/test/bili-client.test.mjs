import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiliClient } from '../lib/bili-client.mjs';

function response(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const nav = { code: 0, data: { wbi_img: { img_url: `https://i0.hdslb.com/${'a'.repeat(32)}.png`, sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png` } } };

test('searches anonymously using GET and normalizes result data', async () => {
  const calls = [];
  const client = createBiliClient({ requestGate: async () => {}, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return response({ code: 0, data: { result: [{ bvid: 'BV1xx411c7mD', aid: 170001, title: 'Video', author: 'UP', duration: '1:05' }] } });
  } });
  const out = await client.search({ keyword: 'public video', page: 1, order: 'relevance', excludeBvids: [] });
  assert.equal(out.items[0].bvid, 'BV1xx411c7mD');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers?.cookie, undefined);
  assert.equal(calls[0].init.headers?.authorization, undefined);
});

test('loads anonymous video metadata from the public view/detail endpoint without WBI', async () => {
  const calls = [];
  const client = createBiliClient({ requestGate: async () => {}, fetchImpl: async (url, init) => {
    const u = new URL(String(url));
    calls.push({ url: u, init });
    assert.equal(u.pathname, '/x/web-interface/view/detail');
    return response({ code: 0, data: { View: {
      bvid: 'BV1xx411c7mD', aid: 170001, title: 'Video', owner: { name: 'UP' }, duration: 4,
      pages: [{ page: 1, cid: 12, part: 'P1', duration: 4 }]
    } } });
  } });
  const info = await client.videoInfo({ bvid: 'BV1xx411c7mD' });
  assert.equal(info.title, 'Video');
  assert.equal(info.pages[0].cid, 12);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers?.cookie, undefined);
});

test('loads video metadata and public subtitle segments', async () => {
  const client = createBiliClient({ requestGate: async () => {}, fetchImpl: async url => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/nav')) return response(nav);
    if (u.pathname.endsWith('/view/detail')) return response({ code: 0, data: { View: { bvid: 'BV1xx411c7mD', aid: 170001, title: 'Video', owner: { name: 'UP' }, duration: 4, pages: [{ page: 1, cid: 12, part: 'P1', duration: 4 }] } } });
    if (u.pathname.endsWith('/player/v2')) return response({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: '简体中文', subtitle_url: '//aisubtitle.hdslb.com/a.json' }] } } });
    if (u.hostname === 'aisubtitle.hdslb.com') return response({ body: [{ from: 0, to: 2, content: 'hello' }] });
    throw new Error(`Unexpected URL ${u}`);
  } });
  const info = await client.videoInfo({ bvid: 'BV1xx411c7mD' });
  const content = await client.subtitles({ bvid: info.bvid, cid: info.pages[0].cid });
  assert.equal(info.pages[0].cid, 12);
  assert.equal(content.segments[0].text, 'hello');
});

test('reports login-only subtitles without WBI or login credentials', async () => {
  const calls = [];
  const client = createBiliClient({ requestGate: async () => {}, fetchImpl: async (url, init) => {
    const u = new URL(String(url));
    calls.push({ url: u, init });
    return response({ code: 0, data: { need_login_subtitle: true, subtitle: { subtitles: [] } } });
  } });
  const result = await client.subtitles({ bvid: 'BV1xx411c7mD', cid: 12 });
  assert.equal(result.reason, 'login_required');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/x/player/v2');
  assert.equal(calls[0].url.searchParams.has('w_rid'), false);
  assert.equal(calls[0].init.headers?.cookie, undefined);
});

test('gets a public DASH stream URL without WBI or login credentials', async () => {
  const calls = [];
  const client = createBiliClient({ requestGate: async () => {}, fetchImpl: async (url, init) => {
    const u = new URL(String(url));
    calls.push({ url: u, init });
    return response({ code: 0, data: { quality: 32, dash: { video: [
      { id: 16, bandwidth: 300000, baseUrl: 'https://upos-sz-mirrorali.bilivideo.com/low.m4s' },
      { id: 32, bandwidth: 800000, baseUrl: 'https://upos-sz-mirrorali.bilivideo.com/high.m4s' }
    ] } } });
  } });
  const stream = await client.publicPlayUrl({ bvid: 'BV1xx411c7mD', cid: 12, quality: 32 });
  assert.equal(new URL(stream.url).hostname, 'upos-sz-mirrorali.bilivideo.com');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/x/player/playurl');
  assert.equal(calls[0].url.searchParams.has('w_rid'), false);
  assert.equal(calls[0].init.headers?.cookie, undefined);
});

test('prefers a directly decodable public MP4 stream when available', async () => {
  const calls = [];
  const client = createBiliClient({ requestGate: async () => {}, fetchImpl: async (url, init) => {
    const u = new URL(String(url));
    calls.push({ url: u, init });
    return response({ code: 0, data: {
      quality: 16,
      durl: [{ url: 'https://cn-bj-se-01-04.bilivideo.com/public.mp4' }],
      dash: { video: [{ id: 16, bandwidth: 300000, baseUrl: 'https://upos-sz-mirrorali.bilivideo.com/video.m4s' }] }
    } });
  } });
  const stream = await client.publicPlayUrl({ bvid: 'BV1xx411c7mD', cid: 12, quality: 16 });
  assert.equal(new URL(stream.url).pathname, '/public.mp4');
  assert.equal(calls[0].url.searchParams.get('fnval'), '0');
  assert.equal(calls[0].url.searchParams.has('w_rid'), false);
  assert.equal(calls[0].init.headers?.cookie, undefined);
});

test('does not silently treat a multi-part durl response as one continuous video', async () => {
  const client = createBiliClient({ requestGate: async () => {}, fetchImpl: async () => response({ code: 0, data: {
    durl: [
      { url: 'https://cn-bj-se-01-04.bilivideo.com/part-1.mp4', length: 10000 },
      { url: 'https://cn-bj-se-01-04.bilivideo.com/part-2.mp4', length: 10000 }
    ]
  } }) });
  await assert.rejects(client.publicPlayUrl({ bvid: 'BV1xx411c7mD', cid: 12 }), { code: 'SEGMENTED_STREAM_UNSUPPORTED' });
});

test('resolves short links with bounded redirects and rejects external destinations', async () => {
  const client = createBiliClient({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://example.com/video/BV1xx411c7mD' } }), requestGate: async () => {} });
  await assert.rejects(client.resolveVideoInput('https://b23.tv/AbCdEf'), { code: 'UNSAFE_REDIRECT' });
});

test('returns structured errors for rate limiting and Bilibili API failures', async () => {
  const throttled = createBiliClient({ fetchImpl: async () => response('too many', 429), requestGate: async () => {} });
  await assert.rejects(throttled.search({ keyword: 'x' }), { code: 'RATE_LIMITED' });
  const apiFailure = createBiliClient({ fetchImpl: async url => String(url).includes('/nav') ? response(nav) : response({ code: -404, message: 'not found' }), requestGate: async () => {} });
  await assert.rejects(apiFailure.videoInfo({ bvid: 'BV1xx411c7mD' }), { code: 'VIDEO_UNAVAILABLE' });
});

test('enforces response byte limits and request timeout failures', async () => {
  const tooLarge = createBiliClient({ maxResponseBytes: 20, fetchImpl: async () => response({ code: 0, data: { result: [{ title: 'this body is too large' }] } }), requestGate: async () => {} });
  await assert.rejects(tooLarge.search({ keyword: 'x' }), { code: 'RESPONSE_TOO_LARGE' });
  const timeout = createBiliClient({ timeoutMs: 1, requestGate: async () => {}, fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) });
  await assert.rejects(timeout.search({ keyword: 'x' }), { code: 'REQUEST_TIMEOUT' });
});
