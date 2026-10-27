import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../index.js';
import { createBiliRuntime, normalizeBiliConfig } from '../lib/bili-runtime.mjs';

const info = {
  bvid: 'BV1xx411c7mD', aid: 170001, title: 'A public video', description: 'Description', uploader: 'UP',
  durationSeconds: 120, pages: [{ page: 1, cid: 12, part: 'Part 1', durationSeconds: 120 }], url: 'https://www.bilibili.com/video/BV1xx411c7mD'
};

function makeClient(overrides = {}) {
  return {
    resolveVideoInput: async video => ({ bvid: video.includes('BV') ? video.slice(-12) : 'BV1xx411c7mD', page: 1 }),
    search: async input => ({ status: 'ok', items: [], keyword: input.keyword }),
    videoInfo: async () => info,
    subtitles: async () => ({ status: 'unavailable', tracks: [], segments: [], reason: 'no_public_subtitle' }),
    audienceContext: async () => ({ status: 'available', source: 'public_comments', label: '观众评论，仅作辅助上下文，不代表视频事实', comments: [] }),
    publicPlayUrl: async () => ({ url: 'https://upos-sz-mirrorali.bilivideo.com/video.m4s', referer: info.url }),
    ...overrides
  };
}

function makeContext(config = {}) {
  const tools = new Map();
  return { tools, ctx: { id: 'tool-bilibili', dir: 'C:/bridge/plugins/tool-bilibili', root: 'C:/bridge', config, registerTool: (name, spec) => tools.set(name, spec) } };
}

test('FFmpeg proxy use defaults off and can be explicitly enabled', () => {
  assert.equal(normalizeBiliConfig().ffmpegUseSystemProxy, false);
  assert.equal(normalizeBiliConfig({ ffmpegUseSystemProxy: true }).ffmpegUseSystemProxy, true);
  assert.throws(() => normalizeBiliConfig({ ffmpegUseSystemProxy: 'true' }), { code: 'INVALID_CONFIG' });
});

test('registers exactly five read-only Bilibili tools with closed schemas', () => {
  const { tools, ctx } = makeContext();
  createPlugin(ctx, { runtime: { handlers: {} } });
  assert.deepEqual([...tools.keys()].sort(), ['bili_analyze_video', 'bili_search', 'bili_video_content', 'bili_video_frames', 'bili_video_info']);
  for (const spec of tools.values()) assert.equal(spec.schema.additionalProperties, false);
  assert.ok(tools.get('bili_search').schema.properties.excludeBvids);
});

test('search validates query limits and passes explicit duplicate exclusions', async () => {
  let seen;
  const runtime = createBiliRuntime({ config: { defaultFrameCount: 9, maxVideoSeconds: 3600 }, client: makeClient({ search: async input => { seen = input; return { items: [] }; } }), cache: { get: async () => null, set: async () => {} } });
  const result = await runtime.handlers.search({ keyword: '猫', page: 1, sort: 'play', excludeBvids: ['BV1xx411c7mD'] });
  assert.equal(result.items.length, 0);
  assert.deepEqual(seen.excludeBvids, ['BV1xx411c7mD']);
  await assert.rejects(runtime.handlers.search({ keyword: 'x'.repeat(101) }), { code: 'INVALID_QUERY' });
  await assert.rejects(runtime.handlers.search({ keyword: 'ok', arbitraryUrl: 'https://example.com' }), { code: 'INVALID_TOOL_INPUT' });
  await runtime.dispose();
});

test('metadata and content work without FFmpeg and report unavailable ASR honestly', async () => {
  let ffmpegCalled = false;
  const runtime = createBiliRuntime({
    config: { defaultFrameCount: 9, maxVideoSeconds: 3600 }, client: makeClient(),
    frameExtractor: async () => { ffmpegCalled = true; throw new Error('must not be called'); },
    cache: { get: async () => null, set: async () => {} }
  });
  const metadata = await runtime.handlers.videoInfo({ video: info.bvid });
  const content = await runtime.handlers.videoContent({ video: info.bvid });
  assert.equal(metadata.title, info.title);
  assert.equal(content.videoEvidence.source, 'none');
  assert.equal(content.subtitle.status, 'unavailable');
  assert.deepEqual(content.asr, { status: 'unavailable', reason: '当前 Bot 未注册可用的语音识别能力' });
  assert.equal(ffmpegCalled, false);
  await runtime.dispose();
});

test('visual analysis carries goal, timestamped evidence labels, and only invokes the frame extractor when requested', async () => {
  let received;
  const runtime = createBiliRuntime({
    config: { defaultFrameCount: 3, maxVideoSeconds: 3600, maxSegmentSeconds: 600 }, client: makeClient(),
    frameExtractor: async options => { received = options; return { status: 'available', sampling: 'scene', contactSheets: [{ range: { startSeconds: 0, endSeconds: 120 }, frameTimestamps: [10, 50, 90], base64: 'AQID', bytes: 3 }] }; },
    cache: { get: async () => null, set: async () => {} }
  });
  const result = await runtime.handlers.analyzeVideo({ video: info.bvid, question: '描述关键动作', frameCount: 3 });
  assert.equal(result.analysisGoal, '描述关键动作');
  assert.deepEqual(result.evidenceBoundary.categories, ['direct_visual_observation', 'official_subtitles', 'audience_context', 'inference', 'uncertainty']);
  assert.deepEqual(result.frames.contactSheets[0].frameTimestamps, [10, 50, 90]);
  assert.equal(received.streamUrl, 'https://upos-sz-mirrorali.bilivideo.com/video.m4s');
  assert.equal(result.modelMustAnalyzeFrames, true);
  await runtime.dispose();
});

test('limits concurrent tool jobs and releases the slot after failures', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const runtime = createBiliRuntime({
    config: { maxConcurrentJobs: 1 }, client: makeClient({ search: async () => pending }),
    cache: { get: async () => null, set: async () => {} }
  });
  const first = runtime.handlers.search({ keyword: 'one' });
  await assert.rejects(runtime.handlers.search({ keyword: 'two' }), { code: 'TOO_MANY_JOBS' });
  release({ items: [] });
  await first;
  await runtime.handlers.search({ keyword: 'three' });
  await runtime.dispose();
});
