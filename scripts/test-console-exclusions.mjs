import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const hidden = 'group:21006';

test('excluded conversation is omitted from console session and social-state lists', async () => {
  const h = await bridgeHarness({
    config: { console: { excludedConversationKeys: [hidden] } },
    savedState: { sessions: { [hidden]: 'group-session', 'private:123': 'private-session' } }
  });
  let server;
  try {
    h.setMode('reserved2');
    h.getSocialV2State(hidden);
    h.getSocialV2State('private:123');
    server = h.startConsoleServer();
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    const root = `http://127.0.0.1:${server.address().port}`;
    const sessions = await (await fetch(`${root}/api/sessions?token=fixture-console-token`)).json();
    const states = await (await fetch(`${root}/api/socialV2/states?token=fixture-console-token`)).json();
    assert.deepEqual(sessions.sessions.map((x) => x.key), ['private:123']);
    assert.deepEqual(states.conversations.map((x) => x.key), ['private:123']);
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await h.close();
  }
});

test('excluded conversation cannot be managed through keyed console APIs', async () => {
  const h = await bridgeHarness({ config: { console: { excludedConversationKeys: [hidden] } } });
  let server;
  try {
    h.setMode('reserved2');
    h.getSocialV2State(hidden);
    server = h.startConsoleServer();
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/socialV2/time-bubbles?token=fixture-console-token`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: hidden, slots: [{ id: 'blocked', label: '隐藏会话', time: '12:00' }] })
    });
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
    const directRead = await fetch(`http://127.0.0.1:${server.address().port}/api/socialV2/time-bubbles?token=fixture-console-token&key=${encodeURIComponent(hidden)}`);
    assert.equal(directRead.status, 404);
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await h.close();
  }
});
