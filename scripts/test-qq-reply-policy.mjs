import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MULTI_MESSAGE_REPLY_POLICY, PRIVATE_FOLLOWUP_POLICY } from '../src/qq-reply-policy.js';

test('multi-message prompt requires one explicit qq_reply for each replied-to message', () => {
  assert.match(MULTI_MESSAGE_REPLY_POLICY, /必须.*qq_reply/s);
  assert.match(MULTI_MESSAGE_REPLY_POLICY, /每一条.*messageId/s);
  assert.match(MULTI_MESSAGE_REPLY_POLICY, /不能用.*seq/s);
  assert.match(MULTI_MESSAGE_REPLY_POLICY, /qq_send_message.*数组/);
  assert.match(MULTI_MESSAGE_REPLY_POLICY, /引用内容与回复内容同等重要/);
  assert.match(MULTI_MESSAGE_REPLY_POLICY, /只有一条.*qq_send_message/s);
  assert.match(MULTI_MESSAGE_REPLY_POLICY, /本质含义相同.*qq_send_message/s);
  assert.match(MULTI_MESSAGE_REPLY_POLICY, /语义不同.*qq_reply/s);
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
  assert.match(wakeRules, /本质含义相同.*qq_send_message/s);
  assert.match(wakeRules, /语义不同.*qq_reply/s);
  const topicDrive = fs.readFileSync(new URL('../plugins/qq-components/ctx-chat-topic-drive/index.js', import.meta.url), 'utf8');
  assert.ok(topicDrive.includes('PRIVATE_FOLLOWUP_POLICY'));
  assert.ok(topicDrive.includes("ctx.registerTool('private_followup_send'"));
});
