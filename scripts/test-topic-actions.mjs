import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../plugins/qq-components/ctx-chat-topic-drive/topic-actions.mjs');
function fixture(createTopicActions, config = {}) {
  let data = {};
  const ctx = { config, state: { get: () => data, set: p => Object.assign(data, p) } };
  return { ctx, actions: createTopicActions(ctx, config), state: () => data };
}
test('a=.5/b=.2 chooses followup/newTopic/wait once for the same timeout; end/new input never draw', async () => {
  const { createTopicActions } = await load();
  for (const key of ['private:1', 'group:2']) for (const [roll, expected] of [[.2, 'followup'], [.6, 'newTopic'], [.9, 'wait']]) {
    const f = fixture(createTopicActions), args = { key, scope: 'session:1', seq: 3, emptyWaits: 1, endRound: false, now: 10000000 };
    assert.equal(f.actions.afterWait({ ...args, random: () => roll }).action, expected);
    assert.equal(f.actions.afterWait({ ...args, random: () => .99 }).action, expected, 'no reroll');
    assert.equal(f.actions.afterWait({ ...args, endRound: true, random: () => { throw Error('must not draw'); } }).action, 'wait');
  }
});
test('cooldown/hour cap return wait without renormalizing, and proposals never spend quota', async () => {
  const { createTopicActions } = await load();
  const f = fixture(createTopicActions), now = 10000000, key = 'private:1';
  f.ctx.state.set({ driveByKey: { [key]: { driveFollowUpAt: now - 1000, driveNewTopicAt: now - 1000, driveNewTopicTimes: [now - 1000, now - 2000] } } });
  for (const [n, roll] of [[1, .1], [2, .6]]) assert.equal(f.actions.afterWait({ key, scope: 's:1', seq: 0, emptyWaits: n, endRound: false, now, random: () => roll }).action, 'wait');
  assert.equal(f.state().driveByKey[key].driveNewTopicTimes.length, 2);
});
test('normal optional sends and low-content nudges obey the same cooldown; replies remain possible', async () => {
  const { createTopicActions } = await load();
  const f = fixture(createTopicActions), key = 'private:1', now = 10000000;
  f.ctx.state.set({ driveByKey: { [key]: { driveFollowUpAt: now - 1000, driveNewTopicAt: now - 1000 } } });
  assert.equal(f.actions.reserve({ key, scope: 's:1', operationId: 'a', kind: 'followup', text: '后来怎么样？', now }).ok, false);
  assert.equal(f.actions.reserve({ key, scope: 's:1', operationId: 'b', text: '用户还在吗....', now }).ok, false);
  assert.equal(f.actions.reserve({ key, scope: 's:1', operationId: 'c', kind: 'newTopic', text: '换个话题', now }).ok, false);
  assert.equal(f.actions.reserve({ key, scope: 's:1', operationId: 'd', kind: 'reply', text: '答案是42。', now }).ok, true);
  assert.equal(f.actions.reserve({ key, operationId: 'e', originReason: 'privateFollowup', text: '群里那件事后来呢？', now }).ok, true, 'cross-private uses independent limits');
});
test('timeout branch binds actual sends, blocks the wait branch, revokes stale leases on human input', async () => {
  const { createTopicActions } = await load();
  const f = fixture(createTopicActions), args = { key: 'group:2', scope: 's:1', seq: 0, emptyWaits: 1, endRound: false, now: 10000000 };
  f.actions.afterWait({ ...args, random: () => .6 });
  const lease = f.actions.reserve({ key: args.key, scope: args.scope, operationId: 'op', text: '想聊点新事', now: args.now });
  assert.equal(lease.kind, 'newTopic');
  assert.equal(f.actions.authorize({ key: args.key, lease }).ok, true);
  f.actions.incoming({ key: args.key });
  assert.equal(f.actions.authorize({ key: args.key, lease }).ok, false);
  f.actions.afterWait({ ...args, seq: 1, emptyWaits: 2, random: () => .9 });
  assert.equal(f.actions.reserve({ key: args.key, scope: args.scope, operationId: 'op2', text: '用户还在吗', now: args.now }).ok, false);
});
test('configuration rejects invalid a/b and weights over one; zero weights mean waiting', async () => {
  const { createTopicActions } = await load();
  const f = fixture(createTopicActions);
  for (const c of [{ followupWeight: -.1 }, { newTopicWeight: 1.1 }, { followupWeight: .8, newTopicWeight: .3 }]) assert.equal(f.actions.validateConfig(c).ok, false);
  const zero = fixture(createTopicActions, { followupWeight: 0, newTopicWeight: 0 });
  assert.equal(zero.actions.afterWait({ key: 'private:1', scope: 's:1', seq: 0, emptyWaits: 1, endRound: false, random: () => 0 }).action, 'wait');
});
