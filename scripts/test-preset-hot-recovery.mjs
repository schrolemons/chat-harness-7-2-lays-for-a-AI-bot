import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
const refresh = source.slice(source.indexOf('  async function refreshPresetList()'), source.indexOf('\n  /** 传话：', source.indexOf('  async function refreshPresetList()')));
const health = source.slice(source.indexOf('  const checkDsh = async () => {'), source.indexOf('\n  function startDshWatch()', source.indexOf('  const checkDsh = async () => {')));

function fixture() {
  const state = { now: 1000, list: [{ id: 'standard' }], fail: false, calls: 0 };
  const context = vm.createContext({
    Date: { now: () => state.now }, log() {}, unwrap: value => value,
    api: { settings: { describe: async () => ({}) }, agentPresets: { list: async () => {
      state.calls++; if (state.fail) throw Error('temporarily unavailable');
      return { presets: state.list };
    }}}, refreshMode: async () => {}, reconcileSessionPolicies() {},
    dshReady: false, dshPresetIds: [], dshDefaultPreset: '', lastPresetRefreshAt: 0,
    currentMode: 'chat', lastMode: 'chat', flushQueue: async () => {},
  });
  vm.runInContext(refresh + '\n' + health + '\nglobalThis.tick=checkDsh;', context);
  return { state, context };
}

test('restored presets become available while DSH stays online, without restarting bridge', async () => {
  const { state, context } = fixture();
  await context.tick();
  assert.equal(context.dshReady, true);
  state.list.push({ id: 'qq-chat-v2' });
  state.now += 31000;
  await context.tick();
  assert.ok(context.dshPresetIds.includes('qq-chat-v2'), 'bridge must stop using the pre-recovery preset list');
});

test('preset refresh is bounded and a failed refresh preserves the last known list', async () => {
  const { state, context } = fixture();
  await context.tick();
  state.now += 5000;
  await context.tick();
  assert.equal(state.calls, 1);
  state.fail = true;
  state.now += 31000;
  await context.tick();
  assert.deepEqual(Array.from(context.dshPresetIds), ['standard']);
  state.fail = false;
  state.list.push({ id: 'qq-chat-v2' });
  state.now += 5000;
  await context.tick();
  assert.ok(context.dshPresetIds.includes('qq-chat-v2'));
});

test('launcher client has the package export required by the DSH module loader', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../plugins/qq-launcher/package.json', import.meta.url)));
  assert.equal(pkg.exports?.['./client'], './lib/client.js');
});
