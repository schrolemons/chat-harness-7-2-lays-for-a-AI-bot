import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MULTI_MESSAGE_REPLY_POLICY, PRIVATE_FOLLOWUP_POLICY } from '../src/qq-reply-policy.js';

test('multi-message policy merges selected meanings and reserves quotes for actual ambiguity', () => {
  assert.match(MULTI_MESSAGE_REPLY_POLICY,/同一人连续补充.*一条自然消息/s);
  assert.match(MULTI_MESSAGE_REPLY_POLICY,/默认用qq_send_message.*不加replyToMessageId/s);
  assert.match(MULTI_MESSAGE_REPLY_POLICY,/仅需明确区分.*qq_reply/s);
  assert.match(MULTI_MESSAGE_REPLY_POLICY,/不能用seq/);
  assert.match(MULTI_MESSAGE_REPLY_POLICY,/普通群聊可以只读不插话/);
  assert.doesNotMatch(MULTI_MESSAGE_REPLY_POLICY,/每一条.*必须单独调用/s);
  assert.match(PRIVATE_FOLLOWUP_POLICY, /值得关心/);
  assert.match(PRIVATE_FOLLOWUP_POLICY, /很感兴趣/);
  assert.match(PRIVATE_FOLLOWUP_POLICY, /private_followup_send/);
  assert.match(PRIVATE_FOLLOWUP_POLICY, /独立于.*qq_send_message \/ qq_reply/);

  const bridge = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
  assert.ok(bridge.includes('MULTI_MESSAGE_REPLY_POLICY'));
  assert.match(bridge, /taskCaps\.sendPrivateFollowup\s*=\s*async/);
  assert.match(bridge, /pluginHost\.emitSent\(\{ key, success: true/);
  assert.doesNotMatch(bridge, /用 qq_send_message 的 messages 数组/);
  const wakeRules = fs.readFileSync(new URL('../plugins/qq-components/life-wake-reasons/index.js', import.meta.url), 'utf8')+fs.readFileSync(new URL('../plugins/qq-components/life-wake-reasons/chat-entry-guidance.mjs', import.meta.url), 'utf8');
  assert.match(wakeRules, /MULTI_MESSAGE_REPLY_POLICY/);
  const topicDrive = fs.readFileSync(new URL('../plugins/qq-components/ctx-chat-topic-drive/index.js', import.meta.url), 'utf8');
  assert.ok(topicDrive.includes('PRIVATE_FOLLOWUP_POLICY'));
  assert.ok(topicDrive.includes("ctx.registerTool('private_followup_send'"));
});
