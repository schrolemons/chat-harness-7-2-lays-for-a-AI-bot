import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlugin } from '../plugins/qq-components/life-campus-watch/index.js';
import { acquireLease } from './campus-browser-session.mjs';

function setup(t, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-schedule-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let state = {}; const runs = [];
  const ctx = { root, config: { webWatchEnabled:true, watchUrls:['示例 | https://example.invalid/'], ...config }, registerTool() {}, state: { get: () => state, set: patch => state = { ...state, ...patch } }, capabilities: { spawnCampusWatch: args => { runs.push(args); return true; } } };
  return { root, runs, plugin: createPlugin(ctx) };
}

test('no enabled monitor or script target leaves the scheduler idle', t => {
  const { runs, plugin } = setup(t, {webWatchEnabled:false,watchUrls:[],scriptCollabEnabled:false,scriptPaths:[],enabledScripts:'',lecturesEnabled:false});
  plugin.hooks.onTick({now:1800000000000});assert.deepEqual(runs,[]);
});

test('active login blocks every tick without consuming full-check due time', t => {
  const { root, runs, plugin } = setup(t); const release = acquireLease(path.join(root, 'state', 'login-window.lock'));
  plugin.hooks.onTick({ now: 1800000000000 }); assert.equal(runs.length, 0);
  release(); plugin.hooks.onTick({ now: 1800000060000 }); assert.deepEqual(runs, [[]]);
});

test('web-only monitoring does not spawn minute browser checks between full checks', t => {
  const { runs, plugin } = setup(t, { fullCheckMinutes: 30 }); const now = 1800000000000;
  plugin.hooks.onTick({ now });
  for (let minutes = 1; minutes < 30; minutes++) plugin.hooks.onTick({ now: now + minutes * 60000 });
  assert.deepEqual(runs, [[]]);
  plugin.hooks.onTick({ now: now + 30 * 60000 }); assert.deepEqual(runs, [[], []]);
});

test('active monitor lease suppresses overlap even after the former lease TTL', t => {
  const { root, runs, plugin } = setup(t); const file = path.join(root, 'state', 'campus-watch.lock'); const release = acquireLease(file);
  fs.utimesSync(file, new Date(0), new Date(0)); plugin.hooks.onTick({ now: 1800000000000 }); assert.equal(runs.length, 0); release();
});
