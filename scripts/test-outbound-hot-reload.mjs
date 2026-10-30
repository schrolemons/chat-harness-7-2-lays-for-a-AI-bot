import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-outbound-reload-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, text) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  write('package.json', '{"type":"module"}');
  const files = ['life-wake-reasons/index.js', 'life-wake-reasons/proactive.mjs', 'life-wake-reasons/proactive-policy.mjs', 'ctx-chat-topic-drive/index.js', 'ctx-chat-topic-drive/followup-policy.mjs', 'ctx-chat-topic-drive/topic-actions.mjs', 'ctx-chat-topic-drive/private-followup.mjs', 'life-wake-reasons/group-wake.mjs'];
  for (const file of files) write(`plugins/qq-components/${file}`, fs.readFileSync(path.join(sourceRoot, 'plugins/qq-components', file), 'utf8'));
  write('plugins/qq-components/ctx-chat-reply-shape/engagement.mjs', fs.readFileSync(path.join(sourceRoot, 'plugins/qq-components/ctx-chat-reply-shape/engagement.mjs'), 'utf8'));
  write('src/conversation-drive.js', fs.readFileSync(path.join(sourceRoot, 'src/conversation-drive.js'), 'utf8'));
  // Foreign SCHNIE/receipt prompt behavior is outside this source-freshness test.
  write('plugins/qq-components/schnie-core/turn-policy.mjs', 'export const createTurnPolicy = () => () => ({mode:"off"});');
  write('src/qq-reply-policy.js', 'export const PRIVATE_FOLLOWUP_POLICY = "本轮私聊追问";');
  write('state/person-profiles.json', JSON.stringify({ people: { '5': { keys: ['group:10', 'private:5'] } } }));
  const replace = (relative, from, to) => { const file = path.join(root, relative), old = fs.readFileSync(file, 'utf8'); assert.ok(old.includes(from), 'source mutation target exists'); fs.writeFileSync(file, old.replace(from, to)); };
  let state = {}; const tools = new Map();
  const ctx = { root, config: { curfewEnabled: false }, state: { get: () => state, set: patch => { state = { ...state, ...patch }; } }, capabilities: {}, registerTool: (name,spec) => tools.set(name,spec), log() {}, warn() {} };
  const load = async (id, generation) => (await import(pathToFileURL(path.join(root, `plugins/qq-components/${id}/index.js`)).href + `?generation=${generation}`)).createPlugin(ctx);
  return { root, ctx, replace, load, tools };
}
test('entry generation refreshes proactive helper, nested policy and validation together', async t => {
  const f = fixture(t), first = await f.load('life-wake-reasons', 1);
  assert.equal(first.services.proactive.policy().initialProbability, .15);
  assert.equal(first.validateConfig({ probabilityMax: .2 }).ok, true);
  f.replace('plugins/qq-components/life-wake-reasons/proactive-policy.mjs', 'initialProbability: .15', 'initialProbability: .25');
  const second = await f.load('life-wake-reasons', 2);
  assert.equal(second.services.proactive.policy().initialProbability, .25);
  assert.equal(second.validateConfig({ probabilityMax: .2 }).ok, false);
});
test('topic entry generation refreshes the shared semantic selector source', async t => {
  const f = fixture(t), payload = { key: 'private:1', reason: 'message', st: { unread: [{ text: '我开始写小说了', time: 100 }] } };
  const first = await f.load('ctx-chat-topic-drive', 1); assert.match(first.hooks.beforePrompt(payload), /可选追问/);
  f.replace('src/conversation-drive.js', '会话推进｜可选追问', '会话推进｜更新后的追问');
  const second = await f.load('ctx-chat-topic-drive', 2); assert.match(second.hooks.beforePrompt(payload), /更新后的追问/);
});
test('topic entry generation refreshes the stricter private followup policy source', async t => {
  const f = fixture(t), payload = { key: 'group:10', reason: 'message', st: { unread: [{ userId: '5', text: '今天忙了一天', time: 100 }] } };
  const first = await f.load('ctx-chat-topic-drive', 1); assert.match(first.hooks.beforePrompt(payload), /至少间隔 180 分钟/);
  f.replace('plugins/qq-components/ctx-chat-topic-drive/followup-policy.mjs', 'Math.max(globalInterval, sessionInterval)', 'Math.max(globalInterval, sessionInterval) + 1');
  const second = await f.load('ctx-chat-topic-drive', 2); assert.match(second.hooks.beforePrompt(payload), /至少间隔 181 分钟/);
  second.hooks.onIncoming({key:'group:10',userId:'5',at:Date.now()});
  const result=await f.tools.get('private_followup_send').handler({groupKey:'group:10',userId:'5',text:'后来怎么样？'});
  assert.equal(result.limits.minIntervalMinutes,181,'actual tool shares the same refreshed private-followup policy');
});
