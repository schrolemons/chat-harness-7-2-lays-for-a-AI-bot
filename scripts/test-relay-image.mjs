import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlugin } from '../plugins/qq-components/life-relay-message/index.js';

function fixture() {
  let state = {};
  const sends = [];
  const plugin = createPlugin({
    config: { minIntervalMin: 1 },
    state: { get: () => state, set: patch => { state = { ...state, ...patch }; } },
    capabilities: {
      resolveRelayTarget: () => 'group:2002',
      sendSessionText: async () => true,
      relaySend: async input => { sends.push(input); return { ok: true }; }
    },
    warn: () => {}, log: () => {}
  });
  return { plugin, sends };
}

test('a relay request can deliver staged QQ images together with its text', async () => {
  const { plugin, sends } = fixture();
  const imageIds = [{ imageId: 'a6d52e93-901f-4c93-9b0f-58802a1d02bb', name: 'QQ图片-42-1.png', source: 'qq-incoming' }];
  const result = await plugin.hooks.relayIncoming({
    key: 'private:1001', plainContent: '给小群带句话，晚点到', isOwner: false, allowed: true, imageIds
  });
  assert.equal(result.action, 'relay');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].imageIds, imageIds);
});

test('a staged image can be the content for an in progress relay request', async () => {
  const { plugin, sends } = fixture();
  await plugin.hooks.relayIncoming({
    key: 'private:1001', plainContent: '给小群带句话', isOwner: false, allowed: true
  });
  const imageIds = [{ imageId: 'a6d52e93-901f-4c93-9b0f-58802a1d02bb', name: 'B站关键帧.jpg', source: 'mcp:bili_video_frames' }];
  await plugin.hooks.relayIncoming({
    key: 'private:1001', plainContent: '[图片]', isOwner: false, allowed: true, imageIds
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].imageIds, imageIds);
});
