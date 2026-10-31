import test from 'node:test';
import assert from 'node:assert/strict';
import { sendCampusNotification } from './campus-notification-client.mjs';

test('missing notification API fails visibly without a legacy agent send or second receipt path', async () => {
  const requests = [];
  await assert.rejects(sendCampusNotification({ endpoint: 'http://fixture.invalid', consoleToken: 'fixture', key: 'private:123', text: 'update',
    fetchImpl: async (url, init) => { requests.push({ url, init }); return { status: 404 }; } }), /统一通知接口/);
  assert.equal(requests.length, 1); assert.equal(requests[0].url, 'http://fixture.invalid/api/notifications/send');
  assert.equal(Object.hasOwn(requests[0].init.headers, 'x-agent-token'), false);
});

test('website items retain stable identity, timestamps and confirmed or uncertain management outcomes', async () => {
  const items = [{ id: 'report-1', text: 'actual site change', sourceAt: 10, expiresAt: 20 }];
  for (const outcome of [{ ok: true, sent: true }, { ok: true, uncertain: true }, { ok: true, skipped: true }]) {
    let body;
    assert.equal(await sendCampusNotification({ endpoint: 'http://fixture.invalid', consoleToken: 'fixture', key: 'private:123', items,
      fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => outcome }; } }), true);
    assert.deepEqual(body, { key: 'private:123', items });
  }
});

test('a rejected request remains pending instead of being reported as delivered', async () => {
  await assert.rejects(sendCampusNotification({ endpoint: 'http://fixture.invalid', key: 'private:123', text: 'update',
    fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ ok: false, reason: 'quiet' }) }) }), /quiet/);
});
