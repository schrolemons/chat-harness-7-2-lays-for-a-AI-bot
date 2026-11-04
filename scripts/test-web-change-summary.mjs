import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebChange, stageWebChanges, prepareWebNotifications } from '../plugins/qq-components/life-web-watch/web-changes.mjs';

const site = { name: '公开公告', url: 'https://example.test/notices/' };
function change(lines, extra = {}) {
  return buildWebChange({ site, previous: { lines: ['站点简介'], linkDetails: [], contentVersion: 2 }, current: { lines: ['站点简介', ...lines], links: [] }, ...extra });
}

test('navigation-only changes are silent and never call the model', async () => {
  const raw = change(['首页', '展开子菜单', '返回顶部', '登录', 'Copyright 2026']);
  assert.equal(raw, null);
  const result = await prepareWebNotifications(raw ? [raw] : [], { generate: () => assert.fail('no model needed') });
  assert.equal(result.changes.length, 0);
});

test('diff keeps real additions, removals and absolute resource URLs, excluding footer links', () => {
  const raw = change(['G3-108 · 第 2–5、7–16 周', '维护公告附件', 'PPT', '返回顶部'], {
    previous: { lines: ['站点简介', '旧维护地点 G3-101'], linkDetails: [], contentVersion: 2 },
    current: { lines: ['站点简介', 'G3-108 · 第 2–5、7–16 周', '维护公告附件', 'PPT', '返回顶部'], links: [{ t: '维护公告附件 PPT', h: 'slides/1.ppt' }, { t: '返回顶部', h: '/lab' }] }
  });
  assert.ok(raw.webDiff.added.includes('维护公告附件'));
  assert.deepEqual(raw.webDiff.removed, ['旧维护地点 G3-101']);
  assert.equal(raw.webDiff.newLinks[0].url, 'https://example.test/notices/slides/1.ppt');
  assert.equal(raw.webDiff.newLinks.length, 1);
});

test('missing old text builds a baseline instead of announcing the whole page as new', () => {
  assert.equal(change(['公告一'], { previous: { hash: 'legacy' } }), null);
});

test('one AI call organizes the batch, keeps other events and evidence-based URLs', async () => {
  const raw = change(['维护公告附件']);
  let calls = 0;
  const input = [raw, { kind: 'event', msg: '已有事件', notificationKey: 'one' }];
  const result = await prepareWebNotifications(input, { generate: async payload => {
    calls++;
    assert.equal(payload.pages.length, 1);
    return { pages: [{ id: raw.webDiff.id, meaningful: true, points: [{ text: '新增维护公告附件。', evidence: ['added:0'] }] }] };
  }});
  assert.equal(calls, 1);
  assert.match(result.changes[0].msg, /新增维护公告附件/);
  assert.doesNotMatch(result.changes[0].msg, /具体变化|＋/);
  assert.equal(result.changes[1], input[1]);
});

test('model failure, invalid evidence and invented dates fall back without losing real changes', async () => {
  const raw = change(['维护公告附件']);
  for (const generate of [async () => { throw Error('offline'); }, async () => ({ pages: [{ id: raw.webDiff.id, meaningful: true, points: [{ text: '截止 2099-12-31', evidence: ['added:0'] }] }] })]) {
    const result = await prepareWebNotifications([raw], { generate });
    assert.equal(result.changes.length, 1);
    assert.match(result.changes[0].msg, /维护公告附件/);
    assert.doesNotMatch(result.changes[0].msg, /2099/);
    assert.equal(result.changes[0].summaryMode, 'fallback');
  }
});

test('AI cannot hide clear deadline/resource changes as noise; unchanged evidence uses cached summary', async () => {
  const raw = change(['公告一截止日期 2026-11-01']);
  const cache = {};
  let calls = 0;
  const generate = async () => { calls++; return { pages: [{ id: raw.webDiff.id, meaningful: false, points: [] }] }; };
  const first = await prepareWebNotifications([raw], { generate, cache });
  assert.equal(first.changes.length, 1);
  await prepareWebNotifications([raw], { generate, cache });
  assert.equal(calls, 1);
});

test('failed sends remain pending across checks and deduplicate by raw diff identity', () => {
  const state = {}, raw = change(['维护公告附件']);
  stageWebChanges(state, [raw]);
  const retry = stageWebChanges(state, []);
  assert.equal(retry.length, 1);
  assert.equal(retry[0].webDiff.id, raw.webDiff.id);
  assert.equal(stageWebChanges(state, [raw]).length, 1);
});
