import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/life-user-availability/index.js';

function setup(saved = {}) {
  let state = structuredClone(saved);
  const jobs = new Map();
  let contacts = 0;
  let plugin;
  const ctx = {
    id: 'life-user-availability',
    config: {},
    state: { get: () => state, set: (p) => { state = { ...state, ...p }; } },
    scheduler: {
      schedule: (j) => { jobs.set(j.id, j); return { scheduledId: j.id }; },
      cancel: (id) => jobs.delete(typeof id === 'string' ? id : id.scheduledId)
    },
    capabilities: { requestScheduledContact: async ({ key, id }) => {
      if (!plugin.services.availability.canWake({ key, reason: 'scheduledContact:' + id })) return;
      contacts += 1;
      plugin.services.availability.markDispatched({ key, id });
    } }
  };
  plugin = createPlugin(ctx);
  return { p: plugin, ctx, jobs, get state() { return state; }, get contacts() { return contacts; } };
}

const t = (iso) => Date.parse(iso);
const KEY = 'private:1';

test('daily：多时段免打扰（含工作时段两段 + 跨午夜）', () => {
  const f = setup();
  const now = t('2026-10-26T10:00:00+08:00');
  const out = f.p.services.availability.setPlan({ key: KEY, kind: 'daily', windows: [{ start: '08:00', end: '11:30' }, { start: '13:30', end: '23:30' }], now });
  assert.equal(out.ok, true);
  const svc = f.p.services.availability;
  assert.equal(svc.isQuiet({ key: KEY, now }), true);                    // 10:00 在上午时段
  assert.equal(svc.isQuiet({ key: KEY, now: t('2026-10-26T12:30:00+08:00') }), false); // 午休不在
  assert.equal(svc.isQuiet({ key: KEY, now: t('2026-10-26T14:00:00+08:00') }), true);
  assert.equal(svc.isQuiet({ key: KEY, now: t('2026-10-26T23:45:00+08:00') }), false);
  f.p.services.availability.setPlan({ key: 'private:2', kind: 'daily', windows: [{ start: '22:00', end: '08:00' }] });
  assert.equal(svc.isQuiet({ key: 'private:2', now: t('2026-10-27T01:00:00+08:00') }), true);
  assert.equal(svc.isQuiet({ key: 'private:2', now: t('2026-10-27T08:30:00+08:00') }), false);
});

test('quiet：一次性免打扰精确窗口 + 参数校验', () => {
  const f = setup();
  const now = t('2026-10-26T10:00:00+08:00');
  const svc = f.p.services.availability;
  const ok = svc.setPlan({ key: KEY, kind: 'quiet', startISO: '2026-10-26T11:00:00+08:00', endISO: '2026-10-26T13:00:00+08:00', reason: '开会', now });
  assert.equal(ok.ok, true);
  assert.equal(svc.isQuiet({ key: KEY, now }), false);
  assert.equal(svc.isQuiet({ key: KEY, now: t('2026-10-26T12:00:00+08:00') }), true);
  assert.equal(svc.isQuiet({ key: KEY, now: t('2026-10-26T14:00:00+08:00') }), false);
  assert.equal(svc.setPlan({ key: KEY, kind: 'quiet', startISO: '2026-10-26T11:00:00+08:00', endISO: '2026-10-26T09:00:00+08:00', now }).ok, false);
  assert.equal(svc.setPlan({ key: KEY, kind: 'quiet', startISO: '2026-10-26T08:00:00+08:00', endISO: '2026-10-26T09:30:00+08:00', now }).ok, false); // 已过去
  assert.equal(svc.setPlan({ key: KEY, kind: 'quiet', startISO: '2026-10-26T11:00:00', endISO: '2026-10-26T13:00:00', now }).ok, false); // 缺时区
});

test('later：到点联系一次，取消/重启不重复', async () => {
  const f = setup();
  const now = Date.now();
  const contactISO = new Date(now + 3600000).toISOString();
  const out = f.p.services.availability.setPlan({ key: KEY, kind: 'later', contactISO, reason: '去忙了', now });
  assert.equal(out.ok, true);
  assert.equal(f.jobs.size, 1);
  const [job] = [...f.jobs.values()];
  assert.equal(f.p.services.availability.canWake({ key: KEY, reason: 'scheduledContact:' + job.id.split(':').pop() }), true);
  await job.run();
  assert.equal(f.contacts, 1);
  assert.equal(f.p.services.availability.canWake({ key: KEY, reason: 'scheduledContact:' + job.id.split(':').pop() }), false);
  const again = setup(f.state);
  again.p.services.availability.restore({ now });
  assert.equal(again.jobs.size, 0, '已触发的任务不应重新注册');
});

test('restore：重启后未触发的一次性计划继续有效，取消后不再复活', () => {
  const f = setup();
  const now = Date.now();
  f.p.services.availability.setPlan({ key: KEY, kind: 'quiet', startISO: new Date(now + 1000).toISOString(), endISO: new Date(now + 3600000).toISOString(), now });
  const restored = setup(f.state);
  restored.p.services.availability.restore({ now });
  assert.equal(restored.jobs.size, 1);
  assert.equal(restored.p.services.availability.cancelPlan({ key: KEY }).cancelled, true);
  assert.equal(restored.jobs.size, 0);
  const again = setup(restored.state);
  again.p.services.availability.restore({ now });
  assert.equal(again.jobs.size, 0);
});

test('indefinite：用户重新直接找来时自动解除', () => {
  const f = setup();
  f.p.services.availability.setPlan({ key: KEY, kind: 'indefinite', reason: '不想聊', now: Date.now() });
  assert.equal(f.p.services.availability.isQuiet({ key: KEY }), true);
  f.p.hooks.onIncoming({ key: KEY, text: '我回来了', isOwner: true });
  assert.equal(f.p.services.availability.isQuiet({ key: KEY }), false);
  assert.equal(f.p.services.availability.getPlan({ key: KEY }).plan, null);
});

test('参数校验：kind / windows / 联系时间非法时给出可读错误', () => {
  const f = setup();
  const svc = f.p.services.availability;
  assert.equal(svc.setPlan({ key: KEY, kind: 'unknown' }).ok, false);
  assert.equal(svc.setPlan({ key: KEY, kind: 'daily', windows: [] }).ok, false);
  assert.equal(svc.setPlan({ key: KEY, kind: 'daily', windows: [{ start: '9:00', end: '18:00' }] }).ok, false);
  assert.equal(svc.setPlan({ key: KEY, kind: 'daily', windows: [{ start: '09:00', end: '09:00' }] }).ok, false);
  assert.equal(svc.setPlan({ key: KEY, kind: 'later', contactISO: '2020-01-01T00:00:00+08:00' }).ok, false);
  assert.equal(svc.setPlan({}).ok, false);
});

test('beforePrompt / getPlan 展示当前约定（多时段合并显示）', () => {
  const f = setup();
  const now = t('2026-10-26T10:00:00+08:00');
  f.p.services.availability.setPlan({ key: KEY, kind: 'daily', windows: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '23:30' }], reason: '上班', now });
  const plan = f.p.services.availability.getPlan({ key: KEY });
  assert.equal(plan.ok, true);
  assert.equal(plan.quietNow, f.p.services.availability.isQuiet({ key: KEY, now: Date.now() }));
  assert.deepEqual(plan.plan.windows, [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '23:30' }]);
  const prompt = f.p.hooks.beforePrompt({ key: KEY });
  assert.match(prompt, /09:00–12:00/);
  assert.match(prompt, /13:30–23:30/);
  assert.match(prompt, /qq_availability/);
});

test('重复登记同一计划返回 duplicate，不重复调度', () => {
  const f = setup();
  const now = Date.now();
  const args = { key: KEY, kind: 'later', contactISO: new Date(now + 7200000).toISOString(), now };
  assert.equal(f.p.services.availability.setPlan(args).ok, true);
  const out = f.p.services.availability.setPlan(args);
  assert.equal(out.duplicate, true);
  assert.equal(f.jobs.size, 1);
});

test('旧 qq_memory_append 结构化内容仍能迁移到新计划（DSH 重启前的兼容入口）', () => {
  const f = setup();
  const now = t('2026-10-26T10:00:00+08:00');
  const svc = f.p.services.availability;
  const daily = svc.recordMemory({ key: KEY, content: '免打扰每天｜22:00｜08:00｜休息', now });
  assert.equal(daily.ok, true);
  assert.equal(svc.isQuiet({ key: KEY, now: t('2026-10-27T01:00:00+08:00') }), true);
  const later = svc.recordMemory({ key: 'private:2', content: '稍后联系｜2026-10-26T20:00:00+08:00｜去忙', now });
  assert.equal(later.ok, true);
  assert.equal(f.jobs.size, 1);
  const cancelled = svc.recordMemory({ key: KEY, content: '取消约定｜恢复', now });
  assert.equal(cancelled.cancelled, true);
  assert.equal(svc.isQuiet({ key: KEY, now }), false);
  assert.equal(svc.recordMemory({ key: KEY, content: '普通话题' }), null, '非约定内容不应拦截普通记忆');
});

test('returned: model confirmation cancels only the identified pending contact and survives restart', async () => {
  const f = setup(), now = Date.now(), svc = f.p.services.availability;
  const booked = svc.setPlan({ key: KEY, kind: 'later', contactISO: new Date(now + 3600000).toISOString(), now });
  assert.equal(typeof booked.planId, 'string');
  assert.equal(svc.getPlan({ key: KEY }).plan.id, booked.planId);
  const [job] = f.jobs.values();
  f.p.hooks.onIncoming({ key: KEY, text: '我回来了' });
  assert.equal(svc.getPlan({ key: KEY }).plan.kind, 'later', 'ordinary incoming text cannot decide the semantic return');
  assert.equal(svc.markReturned({ key: KEY, planId: booked.planId }).cancelled, true);
  assert.equal(svc.getPlan({ key: KEY }).plan, null);
  assert.equal(f.jobs.size, 0);
  assert.equal(svc.markReturned({ key: KEY, planId: booked.planId }).duplicate, true);
  await job.run();
  assert.equal(f.contacts, 0, 'an already queued callback must not contact after return');
  const restarted = setup(f.state);
  restarted.p.services.availability.restore({ now });
  assert.equal(restarted.jobs.size, 0);
});

test('returned: stale or missing identity cannot cancel a replacement or another type of quiet plan', () => {
  const f = setup(), now = Date.now(), svc = f.p.services.availability;
  const first = svc.setPlan({ key: KEY, kind: 'later', contactISO: new Date(now + 3600000).toISOString(), now });
  const next = svc.setPlan({ key: KEY, kind: 'later', contactISO: new Date(now + 7200000).toISOString(), now });
  assert.equal(svc.markReturned({ key: KEY }).ok, false);
  assert.equal(svc.markReturned({ key: KEY, planId: first.planId }).ok, false);
  assert.equal(svc.getPlan({ key: KEY }).plan.id, next.planId);
  const quiet = svc.setPlan({ key: KEY, kind: 'daily', windows: [{ start: '00:00', end: '23:59' }], now });
  assert.equal(svc.markReturned({ key: KEY, planId: quiet.planId }).ok, false);
  assert.equal(svc.getPlan({ key: KEY }).plan.kind, 'daily');
});

test('returned: booking the same time again creates a fresh identity after cancellation', () => {
  const f = setup(), now = Date.now(), svc = f.p.services.availability;
  const args = { key: KEY, kind: 'later', contactISO: new Date(now + 3600000).toISOString(), now };
  const first = svc.setPlan(args);
  svc.markReturned({ key: KEY, planId: first.planId });
  const next = svc.setPlan(args);
  assert.notEqual(first.planId, next.planId);
  assert.equal(svc.markReturned({ key: KEY, planId: first.planId }).ok, false);
  assert.equal(svc.getPlan({ key: KEY }).plan.id, next.planId);
});

test('later: recent user messages do not silently cancel explicit scheduled contact', async () => {
  const f = setup(), now = Date.now(), svc = f.p.services.availability;
  svc.setPlan({ key: KEY, kind: 'later', contactISO: new Date(now + 60000).toISOString(), now });
  f.state.incoming[KEY] = { at: now + 30000, directed: true };
  const [job] = f.jobs.values();
  await job.run();
  await job.run();
  assert.equal(f.contacts, 1, 'contact must pass the actual wake gate exactly once unless the model marks returned');
});

test('restore: legacy grace settings do not control task expiry or recent contact suppression', () => {
  const f = setup(), now = Date.now();
  f.p.services.availability.setPlan({ key: KEY, kind: 'later', contactISO: new Date(now + 60000).toISOString(), now });
  const expired = setup(f.state);
  expired.ctx.config.contactGraceMinutes = 1440;
  expired.p.services.availability.restore({ now: now + 17 * 60000 });
  assert.equal(expired.jobs.size, 0);
  const pending = setup(f.state);
  pending.ctx.config.contactGraceMinutes = 1;
  pending.p.services.availability.restore({ now: now + 6 * 60000 });
  assert.equal(pending.jobs.size, 1);
});

test('QQ MCP exposes the returned action and matching plan identity without invoking a QQ tool', { timeout: 10000 }, async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { fileURLToPath } = await import('node:url');
  const client = new Client({ name: 'availability-schema-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../src/mcp-snowluma-safe.js', import.meta.url))], stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tool = (await client.listTools()).tools.find(tool => tool.name === 'qq_availability');
    assert.ok(tool.inputSchema.properties.action.enum.includes('returned'));
    assert.equal(tool.inputSchema.properties.planId.type, 'string');
  } finally { await client.close(); }
});
