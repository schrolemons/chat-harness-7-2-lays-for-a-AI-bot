import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const key = 'private:123';
const sessionId = 'session-existing-owner';
const bridge = await bridgeHarness({
  config: {
    ownerQQ: 123,
    socialV2: {
      enabled: true,
      agentPreset: 'qq-chat-v2',
      adminDev: { enabled: false, preset: 'qq-chat-dev' },
    },
  },
  files: { 'state/mode.json': { mode: 'reserved2' } },
  savedState: {
    sessions: { [key]: sessionId },
    sessionPolicies: { [key]: '["reserved2","qq-chat-v2",null]' },
    sessionPresets: { [key]: 'qq-chat-v2' },
  },
});

try {
  bridge.setPresets([]);
  bridge.syncAdminDevPreset();
  assert.equal(bridge.calls.archived.includes(sessionId), false,
    'startup must preserve the owner session until the DSH preset list is available');
  assert.equal(bridge.state.sessions[key], sessionId,
    'startup must not drop the owner mapping while presets are still loading');
} finally {
  await bridge.close();
}

console.log('Admin session startup race regression passed.');
