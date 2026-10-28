// Regression: a partial contact-name substring must never resolve to a recipient.
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import { parseRelayCommand } from '../src/relay-intent.js';

const h = await bridgeHarness({
  config: {
    ownerQQ: 123,
    allow: { private: ['123', '10611'], groups: ['456'] },
    socialV2: { relayAliases: {} },
  },
});

try {
  h.appendSocialV2Message('group:456', '成员丙', '早上好', '早上好', false, false, 'fixture-contact');

  assert.equal(h.taskCaps.resolveRelayTarget('成'), null, 'one-character prefix is ambiguous and must not resolve');
  assert.equal(h.taskCaps.resolveRelayTarget('成员丙'), 'group:456', 'full sender name should resolve');
  h.setMode('reserved2');
  assert.equal(h.taskCaps.isRelayAliasLinked('成员乙'), false, 'an unconfirmed nickname must not resolve as a linked alias');
  const contacts = await h.taskCaps.searchRelayContacts('成员乙');
  assert.ok(contacts.some((contact) => contact.userId === '10611' && contact.nickname === '成员乙哥哥'), 'contact search returns exact QQ identity for review');
  assert.ok(!contacts.some((contact) => contact.userId === '999'), 'contact search excludes contacts outside the allow list');
  const linked = await h.taskCaps.linkRelayAlias({ alias: '成员乙', targetKey: 'private:10611' });
  assert.equal(linked.ok, true, JSON.stringify(linked));
  assert.equal(h.taskCaps.isRelayAliasLinked('成员乙'), true, 'owner-confirmed alias is persisted as linked');
  assert.equal(h.taskCaps.resolveRelayTarget('成员乙'), 'private:10611', 'confirmed nickname alias resolves to the contact');

  const parsed = parseRelayCommand('问问成员丙醒没醒', {
    resolve: (name) => !!h.taskCaps.resolveRelayTarget(name),
  });
  assert.deepEqual(parsed, { name: '成员丙', content: '醒没醒', weak: true });
} finally {
  await h.close();
}

console.log('Relay target resolver regression passed');
