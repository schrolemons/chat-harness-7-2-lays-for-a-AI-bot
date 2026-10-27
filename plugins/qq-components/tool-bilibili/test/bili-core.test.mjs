import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVideoInput,
  normalizeSearchResults,
  normalizeVideoInfo,
  normalizeSubtitles,
  planVideoRanges
} from '../lib/bili-core.mjs';

test('parses BV, AV, canonical video URLs, and page numbers', () => {
  assert.deepEqual(parseVideoInput('BV1xx411c7mD'), { bvid: 'BV1xx411c7mD', page: 1 });
  assert.deepEqual(parseVideoInput('av170001'), { aid: 170001, page: 1 });
  assert.deepEqual(parseVideoInput('https://www.bilibili.com/video/BV1xx411c7mD/?p=2'), { bvid: 'BV1xx411c7mD', page: 2 });
});

test('keeps a Bilibili short link unresolved for the bounded client resolver', () => {
  assert.deepEqual(parseVideoInput('https://b23.tv/AbCdEf'), { shortUrl: 'https://b23.tv/AbCdEf' });
});

test('rejects non-Bilibili URLs and unsafe URL schemes', () => {
  assert.throws(() => parseVideoInput('https://example.com/video/BV1xx411c7mD'), { code: 'INVALID_VIDEO_INPUT' });
  assert.throws(() => parseVideoInput('file:///C:/video.mp4'), { code: 'INVALID_VIDEO_INPUT' });
  assert.throws(() => parseVideoInput('https://bilibili.com.evil.test/video/BV1xx411c7mD'), { code: 'INVALID_VIDEO_INPUT' });
});

test('normalizes search results, removes duplicate BV IDs, and applies explicit exclusions', () => {
  const out = normalizeSearchResults([
    { bvid: 'BV1xx411c7mD', aid: 170001, title: 'A', author: 'UP', description: 'intro', duration: '1:05', pubdate: 1700000000, play: 20 },
    { bvid: 'BV1xx411c7mD', aid: 170001, title: 'duplicate' },
    { bvid: 'BV1yy411c7mD', aid: 170002, title: 'B' }
  ], ['BV1yy411c7mD']);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    bvid: 'BV1xx411c7mD', aid: 170001, title: 'A', uploader: 'UP', description: 'intro',
    durationSeconds: 65, publishTime: 1700000000, playCount: 20,
    url: 'https://www.bilibili.com/video/BV1xx411c7mD'
  });
});

test('normalizes video metadata and page CID records', () => {
  const out = normalizeVideoInfo({
    bvid: 'BV1xx411c7mD', aid: 170001, title: 'Title', desc: 'Description', owner: { name: 'UP' },
    pic: 'https://i0.hdslb.com/bfs/archive/x.jpg', duration: 90, pubdate: 1700000000, stat: { view: 123 },
    pages: [{ page: 1, cid: 100, part: 'Part one', duration: 90 }, { page: 2, cid: 101, part: 'Part two', duration: 45 }]
  });
  assert.equal(out.title, 'Title');
  assert.equal(out.uploader, 'UP');
  assert.deepEqual(out.pages.map(({ page, cid, part, durationSeconds }) => ({ page, cid, part, durationSeconds })), [
    { page: 1, cid: 100, part: 'Part one', durationSeconds: 90 },
    { page: 2, cid: 101, part: 'Part two', durationSeconds: 45 }
  ]);
});

test('normalizes timestamped subtitle segments and distinguishes no subtitles', () => {
  assert.deepEqual(normalizeSubtitles([
    { lan: 'zh-CN', lan_doc: '简体中文', subtitle_url: '//aisubtitle.hdslb.com/a.json' }
  ], [
    { from: 1.2, to: 2.8, content: '第一句' },
    { from: 3, to: 4.5, content: '第二句' }
  ]), {
    status: 'available',
    tracks: [{ language: 'zh-CN', label: '简体中文' }],
    segments: [{ startSeconds: 1.2, endSeconds: 2.8, text: '第一句' }, { startSeconds: 3, endSeconds: 4.5, text: '第二句' }]
  });
  assert.deepEqual(normalizeSubtitles([], []), { status: 'unavailable', tracks: [], segments: [] });
});

test('splits long videos into contiguous bounded ranges', () => {
  assert.deepEqual(planVideoRanges({ durationSeconds: 130, maxSegmentSeconds: 60 }), [
    { startSeconds: 0, endSeconds: 60 }, { startSeconds: 60, endSeconds: 120 }, { startSeconds: 120, endSeconds: 130 }
  ]);
});
