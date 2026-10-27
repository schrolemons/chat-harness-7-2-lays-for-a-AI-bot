import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const harness = await bridgeHarness({ config: { allow: { private: ['123'], groups: ['456'] } } });
try {
  harness.setMode('reserved2');
  await harness.handleIncoming('group', '456', {
    user_id: 222,
    group_id: 456,
    self_id: 999,
    message_id: 'friend-image-without-wake',
    message_seq: 100,
    message: [{ type: 'image', data: { file: 'fixture.png' } }],
    sender: { nickname: 'Group friend' }
  }, harness.cfg);

  const staged = harness.imageAssetStore.list({ key: 'group:456' });
  assert.equal(staged.length, 1);
  assert.equal(staged[0].source, 'qq-incoming');
  assert.match(staged[0].name, /^QQ-?图片-1\.png$/);
  assert.equal(harness.calls.created.length, 0, 'image staging must not require a model wake');
  console.log('group image is staged from the inbound event even when it does not wake DSH');
} finally {
  await harness.close();
}
