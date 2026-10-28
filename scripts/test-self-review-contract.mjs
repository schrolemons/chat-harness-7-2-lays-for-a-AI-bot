import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPluginHost } from '../src/plugin-host.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridge = fs.readFileSync(path.join(ROOT, 'src', 'bridge.js'), 'utf8');
const consoleHtml = fs.readFileSync(path.join(ROOT, 'public', 'console.html'), 'utf8');
const selfReviewScript = fs.readFileSync(path.join(ROOT, 'scripts', 'self-review.mjs'), 'utf8');
const pluginDir = path.join(ROOT, 'plugins', 'qq-components', 'obs-self-review');

test('self-review report honors the configured optimization memory path', () => {
  assert.match(selfReviewScript, /socialV2\?\.selfReview\?\.memoryFile/);
  assert.match(bridge, /optimizationMemoryPathV2\(\)/);
});

test('periodic findings do not trigger user-requested repair automatically', () => {
  assert.doesNotMatch(bridge, /maybeTriggerSelfOptimizeV2\(result\)/);
  assert.match(bridge, /pendingSelfReview\s*=\s*true/);
  assert.match(bridge, /sendWakePromptV2\([^\n]*'selfReview'/);
});

test('console clearly distinguishes scheduled self-update from explicit feedback repair', () => {
  assert.ok(consoleHtml.includes('自我更新（定期收集问题、分析会话并进行自查改进）'));
  assert.ok(consoleHtml.includes('用户主动提出反馈或修复时，才按其指出的问题定向修复'));
  assert.ok(consoleHtml.includes('Number(r.chars)'));
  assert.ok(consoleHtml.includes('r.path ||'));
});

test('explicit user feedback is passed to owner repair and incidental mentions do not trigger it', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'self-review-contract-'));
  const testPluginDir = path.join(testRoot, 'plugins', 'qq-components', 'obs-self-review');
  fs.mkdirSync(testPluginDir, { recursive: true });
  for (const name of ['plugin.json', 'index.js', 'skill.md']) fs.copyFileSync(path.join(pluginDir, name), path.join(testPluginDir, name));
  const calls = [];
  const host = createPluginHost({ root: testRoot, capabilities: {
    getOwnerQQ: () => '12345',
    getSelfReviewConfig: () => ({ autoOptimize: true, optimizeCooldownHours: 2 }),
    requestPluginPrompt: (prompt, opts) => { calls.push({ prompt, opts }); return true; }
  } });
  await host.loadAll();
  try {
    host.emitIncoming({ key: 'group:888', isOwner: false, userId: '77', sender: '小明', text: '帮我修复最近回复太冷淡的问题' });
    host.emitIncoming({ key: 'group:888', isOwner: false, userId: '78', sender: '小红', text: '日志里提到了修复两个字，但我只是在转述' });
    assert.equal(calls.length, 1);
    assert.match(calls[0].prompt, /最近回复太冷淡/);
    assert.match(calls[0].prompt, /state\/memory\/_optimization\.md/);
    assert.match(calls[0].prompt, /小明/);
    assert.equal(calls[0].opts.key, 'private:12345');
    assert.equal(calls[0].opts.plugin, manifest.id);
  } finally { await host.dispose(); fs.rmSync(testRoot, { recursive: true, force: true }); }
});
