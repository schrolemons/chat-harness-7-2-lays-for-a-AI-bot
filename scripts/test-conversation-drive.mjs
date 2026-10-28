import assert from 'node:assert/strict';
import test from 'node:test';
import { planConversationDrive } from '../src/conversation-drive.js';

test('eligible private and group turns defer the followup choice to the model', () => {
  for (const isGroup of [false, true]) {
    const plan = planConversationDrive({
      isGroup,
      now: 1_000_000,
      config: { followUpProbability: 0 },
      state: { unread: [{ plain: '我最近在学做面包', userId: '2' }], recentMessages: [] }
    });
    assert.equal(plan.kind, 'followup');
    assert.match(plan.line, /由你判断|你自己判断/);
  }
});
