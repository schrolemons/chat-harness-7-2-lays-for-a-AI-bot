import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlugin } from '../plugins/qq-components/ctx-memory-profile-store/index.js';
import { createPlugin as createMemberCard } from '../plugins/qq-components/ctx-member-card/index.js';

function fixture(run, legacy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'person-profiles-'));
  fs.mkdirSync(path.join(root, 'state'));
  if (legacy) fs.writeFileSync(path.join(root, 'state/user-profiles.json'), JSON.stringify(legacy));
  const tools = new Map();
  const load = () => createPlugin({ root, config: {}, registerTool: (name, spec) => tools.set(name, spec), log() {}, warn() {} });
  const plugin = load();
  try { run({ root, tools, plugin, load }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('person profiles inject only the private peer and keep groups free of automatic profile cards', () => fixture(({ tools, plugin }) => {
  plugin.hooks.onIncoming({ key: 'private:10001', userId: '10001', sender: '甲', text: '我喜欢看海' });
  plugin.hooks.onIncoming({ key: 'private:10002', userId: '10002', sender: '乙', text: '我喜欢看山' });
  const update = tools.get('profile_update').handler;
  assert.equal(update({ key: 'private:10001', userId: '10001', profile: { hobbies: '看海' } }).ok, true);
  assert.equal(update({ key: 'private:10002', userId: '10002', profile: { hobbies: '看山' } }).ok, true);
  const prompt = plugin.hooks.beforePrompt({ key: 'private:10001', reason: 'message' });
  assert.match(prompt, /看海/); assert.doesNotMatch(prompt, /看山/);
  assert.equal(plugin.hooks.beforePrompt({ key: 'group:9001', reason: 'message' }), '');
  assert.equal(createMemberCard().hooks.beforePrompt({ key: 'group:9001' }), '');
  assert.equal(tools.has('profile_promote_impression'), false);
}));

test('profile access follows the actual group speaker; group reads exclude private extension fields', () => fixture(({ tools, plugin }) => {
  const update = tools.get('profile_update').handler, get = tools.get('profile_get').handler;
  update({ key: 'private:10001', userId: '10001', profile: { hobbies: '看海', private_extension: '只在私聊参考' } });
  plugin.hooks.onIncoming({ key: 'group:9001', userId: '10001', sender: '甲', text: '你好' });
  const result = get({ key: 'group:9001', userId: '10001' });
  assert.equal(result.ok, true); assert.equal(result.profile.hobbies, '看海');
  assert.equal(result.profile.private_extension, undefined);
  const echoed = update({ key: 'group:9001', userId: '10001', profile: {} });
  assert.equal(echoed.ok, true); assert.equal(echoed.profile.private_extension, undefined, 'group update responses must not disclose private extension fields');
  assert.equal(update({ key: 'group:9001', userId: '10001', profile: { hobbies: '不能部分保存', private_extension: '越界改写' } }).ok, false);
  assert.equal(update({ key: 'group:9001', userId: '10001', profile: {}, deleteKeys: ['private_extension'] }).ok, false);
  const retained = get({ key: 'private:10001', userId: '10001' }).profile;
  assert.equal(retained.private_extension, '只在私聊参考'); assert.equal(retained.hobbies, '看海');
  assert.equal(update({ key: 'group:9001', userId: '10002', profile: { hobbies: '不能代填' } }).ok, false);
  plugin.hooks.onIncoming({ key: 'group:9001', userId: '10002', sender: '乙', text: '换人发言' });
  assert.equal(get({ key: 'group:9001', userId: '10001' }).ok, false);
  assert.equal(get({ key: 'private:10001', userId: '10002' }).ok, false);
  assert.equal(get({ key: 'private:10002', userId: '10002', adminCrossSession: true }).ok, true);
}));

test('JSON profile patches preserve unrelated fields and constrain extension deletion and value types', () => fixture(({ tools }) => {
  const update = tools.get('profile_update').handler, get = tools.get('profile_get').handler;
  const identity = { key: 'private:10001', userId: '10001' };
  assert.equal(update({ ...identity, profile: { hobbies: '看海', catchphrases: '慢慢来', custom_note: '保留' } }).ok, true);
  assert.equal(update({ ...identity, profile: { hobbies: '看海和摄影' }, deleteKeys: ['custom_note', 'catchphrases'] }).ok, true);
  const profile = get(identity).profile;
  assert.equal(profile.hobbies, '看海和摄影'); assert.equal(profile.catchphrases, '慢慢来');
  assert.equal(profile.custom_note, undefined);
  assert.equal(update({ ...identity, profile: { hobbies: ['数组不属于档案字符串'] } }).ok, false);
  assert.equal(get(identity).profile.hobbies, '看海和摄影');
}));

test('legacy profiles migrate once and do not overwrite later JSON edits after plugin reload', () => fixture(({ root, tools, load }) => {
  const identity = { key: 'private:10001', userId: '10001' };
  assert.equal(tools.get('profile_get').handler(identity).profile.hobbies, '看海');
  tools.get('profile_update').handler({ ...identity, profile: { hobbies: '新的爱好' } });
  fs.writeFileSync(path.join(root, 'state/user-profiles.json'), JSON.stringify({ users: {} }));
  load();
  assert.equal(tools.get('profile_get').handler(identity).profile.hobbies, '新的爱好');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'state/person-profiles.json'))).version, 2);
}, { users: { 'u:10001': { userId: '10001', names: ['甲'], keys: ['private:10001'], fields: { hobbies: ['看海'] } } } }));

test('a malformed existing profile store is reported without overwriting its original bytes', () => fixture(({ root, plugin }) => {
  const file = path.join(root, 'state/person-profiles.json');
  for (const text of ['{"profiles":', '{"profiles":[],"people":{}}']) {
    fs.writeFileSync(file, text);
    assert.throws(() => plugin.hooks.onIncoming({ key: 'private:10001', userId: '10001', text: '你好' }));
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
}));

test('UTF-8 BOM in a manually saved profile store preserves all existing people', () => fixture(({ root, tools }) => {
  const identity = { key: 'private:10001', userId: '10001' };
  tools.get('profile_update').handler({ ...identity, profile: { hobbies: '看海' } });
  const file = path.join(root, 'state/person-profiles.json');
  fs.writeFileSync(file, '\uFEFF' + fs.readFileSync(file, 'utf8'));
  assert.equal(tools.get('profile_get').handler(identity).profile.hobbies, '看海');
}));
