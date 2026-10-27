import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFfmpegEnvironment,
  buildFfmpegArgs,
  chooseFrameTimes,
  extractVideoFrames,
  planVideoRanges
} from '../lib/video-frames.mjs';

test('keeps system proxy settings out of FFmpeg by default but allows explicit opt-in', () => {
  const source = { PATH: 'C:/tools', HTTPS_PROXY: 'http://proxy.invalid:8080', NO_PROXY: 'localhost' };
  assert.deepEqual(buildFfmpegEnvironment(false, source), { PATH: 'C:/tools' });
  assert.deepEqual(buildFfmpegEnvironment(true, source), source);
});

test('builds argument-array interval and scene extraction commands', () => {
  const common = { streamUrl: 'https://upos-sz-mirrorali.bilivideo.com/video.m4s', referer: 'https://www.bilibili.com/video/BV1xx411c7mD/', outputPattern: 'frame-%03d.jpg', startSeconds: 0, endSeconds: 60, frameCount: 9, width: 720 };
  const interval = buildFfmpegArgs({ ...common, sampleMode: 'interval' });
  const scene = buildFfmpegArgs({ ...common, sampleMode: 'scene', sceneThreshold: 0.15 });
  assert.ok(interval.includes('https://upos-sz-mirrorali.bilivideo.com/video.m4s'));
  assert.ok(interval.some(arg => arg.includes('fps=')));
  assert.ok(scene.some(arg => arg.includes("select='gt(scene,0.15)'")));
  assert.ok(interval.includes('-protocol_whitelist'));
  const protocols = interval[interval.indexOf('-protocol_whitelist') + 1].split(',');
  assert.ok(protocols.includes('https'));
  assert.ok(!protocols.includes('file'), 'remote input must never be allowed to open local files');
  assert.ok(!protocols.includes('httpproxy'), 'system proxy is opt-in');
  const proxied = buildFfmpegArgs({ ...common, sampleMode: 'interval', useSystemProxy: true });
  const proxyProtocols = proxied[proxied.indexOf('-protocol_whitelist') + 1].split(',');
  assert.ok(proxyProtocols.includes('httpproxy'));
  assert.ok(!proxyProtocols.includes('file'));
  assert.ok(interval.every(arg => typeof arg === 'string'));
});

test('rejects arbitrary stream hosts and unsafe frame options', () => {
  assert.throws(() => buildFfmpegArgs({ streamUrl: 'https://example.com/video.mp4', outputPattern: 'x.jpg', startSeconds: 0, endSeconds: 5, frameCount: 1, width: 640 }), { code: 'UNSAFE_URL' });
  assert.throws(() => buildFfmpegArgs({ streamUrl: 'https://upos-sz-mirrorali.bilivideo.com/video.m4s', outputPattern: '..\\escape.jpg', startSeconds: 0, endSeconds: 5, frameCount: 1, width: 640 }), { code: 'INVALID_FRAME_OPTIONS' });
});

test('chooses scene changes near an even-interval backbone without duplicate frames', () => {
  const chosen = chooseFrameTimes({ durationSeconds: 90, frameCount: 4, sceneTimes: [1, 18, 20, 44, 48, 73, 88] });
  assert.equal(chosen.length, 4);
  assert.equal(new Set(chosen).size, 4);
  assert.ok(chosen[0] > 0 && chosen.at(-1) < 90);
  assert.ok(chosen.some(time => [18, 20, 44, 48, 73, 88].includes(time)));
});

test('splits long duration into bounded extraction ranges', () => {
  assert.deepEqual(planVideoRanges({ durationSeconds: 130, maxSegmentSeconds: 60 }), [
    { startSeconds: 0, endSeconds: 60 }, { startSeconds: 60, endSeconds: 120 }, { startSeconds: 120, endSeconds: 130 }
  ]);
});

test('returns a structured missing-FFmpeg error before creating temp files', async () => {
  let madeTemp = false;
  await assert.rejects(extractVideoFrames({
    streamUrl: 'https://upos-sz-mirrorali.bilivideo.com/video.m4s', durationSeconds: 10,
    startSeconds: 0, endSeconds: 10, frameCount: 2, ffmpegPath: ''
  }, { exists: async () => false, mkdtemp: async () => { madeTemp = true; } }), { code: 'FFMPEG_MISSING' });
  assert.equal(madeTemp, false);
});

test('cleans temporary files after FFmpeg errors', async () => {
  const removed = [];
  await assert.rejects(extractVideoFrames({
    streamUrl: 'https://upos-sz-mirrorali.bilivideo.com/video.m4s', referer: 'https://www.bilibili.com/', durationSeconds: 10,
    startSeconds: 0, endSeconds: 10, frameCount: 2, ffmpegPath: 'ffmpeg.exe', tempRoot: 'C:/temp'
  }, {
    exists: async () => true, mkdtemp: async () => 'C:/temp/bili-frame-1',
    fileOps: { mkdir: async () => {}, rm: async p => removed.push(p) },
    runFfmpeg: async () => { throw new Error('ffmpeg failed'); }
  }));
  assert.deepEqual(removed, ['C:/temp/bili-frame-1']);
});

test('creates a missing configured temp root before allocating a frame directory', async () => {
  const events = [];
  await assert.rejects(extractVideoFrames({
    streamUrl: 'https://upos-sz-mirrorali.bilivideo.com/video.m4s', referer: 'https://www.bilibili.com/', durationSeconds: 10,
    startSeconds: 0, endSeconds: 10, frameCount: 2, ffmpegPath: 'ffmpeg.exe', tempRoot: 'C:/new/state/tmp'
  }, {
    exists: async () => true,
    fileOps: {
      mkdir: async path => events.push(`mkdir:${path}`),
      rm: async path => events.push(`rm:${path}`)
    },
    mkdtemp: async prefix => { events.push(`mkdtemp:${prefix}`); return 'C:/new/state/tmp/bili-frame-1'; },
    runFfmpeg: async () => { throw new Error('fixture stop'); }
  }));
  assert.match(events[0], /^mkdir:C:\/new\/state\/tmp$/);
  assert.match(events[1], /^mkdtemp:/);
});
