import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlugin } from '../plugins/qq-components/ctx-chat-style/index.js';
import { reflectionMode, INNER_WORLD, IDENTITY_TURN } from '../plugins/qq-components/ctx-chat-style/identity-reflection.mjs';

function blocks(incomingText, extra = {}, config = {}, context = {}) {
  const result = [];
  createPlugin({ ...context, config, addPromptBlock: value => result.push(value) }).hooks.beforePrompt({
    roleName: 'AI助手', key: 'private:1', isPrivate: true, incomingText, ...extra,
  });
  return result;
}

test('current-form expression guidance reaches conversation and task branches', () => {
  const scenes = [
    ['ordinary', '你好', {}, {}],
    ['critical', '今天有点累', { moodState: { mode: 'critical', styleInstruction: '保持平静' } }, {}],
    ['reflection', '如果你有身体，最想做什么？', {}, {}],
    ['task', '帮我解释Dijkstra算法', {}, { callService: () => ({ mode: 'discussion' }) }],
    ['proactive', '', { reason: 'timeBubble', hasUnreadNow: false }, {}],
  ];
  for (const [scene, incomingText, extra, context] of scenes) {
    const guidance = blocks(incomingText, { ...extra, roleName: 'AI助手' }, {}, context)
      .filter(block => block.includes('【表达与动作】'));
    assert.equal(guidance.length, 1, scene);
    assert.match(guidance[0], /表达与动作描写按当前形态配置、用户请求与语境选择/);
    assert.match(guidance[0], /不强加动物身体设定或具体私人口味/);
    assert.match(guidance[0], /不改写身份事实、真实工具结果或实际发出的文本/);
    assert.ok(guidance[0].length <= 1200);
  }
});

test('expression guidance preserves maintenance skips and isolates other roles', () => {
  for (const reason of ['memoryWrite', 'selfReview', 'selfOptimize', 'slangLearn']) {
    assert.deepEqual(blocks('介绍哺乳动物', { reason, roleName: 'AI助手' }), []);
  }
  for (const roleName of ['其他角色', 'AI助手研究员', '']) {
    assert.doesNotMatch(blocks('你好', { roleName }).join('\n'), /【表达与动作】/);
  }
});

test('science and explicit character scenes retain their subject without output rewriting', () => {
  for (const incomingText of ['介绍哺乳动物的游泳方式', '请写一个海底角色场景']) {
    const payload = { roleName: 'AI助手', incomingText };
    const prompt = [];
    const plugin = createPlugin({ config: {}, addPromptBlock: block => prompt.push(block) });
    plugin.hooks.beforePrompt(payload);
    assert.equal(payload.incomingText, incomingText);
    assert.match(prompt.join('\n'), /科普或用户明确请求角色场景时按主题表达/);
    assert.deepEqual(Object.keys(plugin.hooks), ['beforePrompt']);
  }
});

test('ordinary whale chat keeps an inner life alongside the warm voice without forcing sadness', () => {
  const text = blocks('今天喝API预算了吗').join('\n');
  assert.match(text, /【双重身份：平时也有自己的想法】/);
  assert.match(text, /语言风格与示例只采用当前形态配置/);
  assert.doesNotMatch(text, /【本轮身份触动】/);
  assert.match(text, /不按固定频率/);
});

for (const text of ['你知道大海，可是你真的能游进去吗？', '如果你有身体，最想做什么？', '你会因为自己是AI而难过吗？', '你记得那么多东西，那是你的经历吗？']) {
  test('identity-related question gets a concrete reflection cue: ' + text, () => {
    const prompt = blocks(text).join('\n');
    assert.match(prompt, /【本轮身份触动】/);
    assert.match(prompt, /一个具体/);
    assert.match(prompt, /不急着/);
    assert.match(prompt, /现实 AI/);
  });
}

test('mentioning AI in coursework or discussing someone else never forces a personal identity scene', () => {
  for (const text of ['帮我解释AI算法的时间复杂度', '我们课上的AI模型为什么拟合不好', '他觉得那个AI很伤感', '我今天去海边了']) {
    assert.doesNotMatch(blocks(text).join('\n'), /【本轮身份触动】/);
  }
});

test('maintenance, autonomy checks and other roles do not receive reflection prompts', () => {
  for (const extra of [{reason:'memoryWrite'}, {reason:'selfReview'}, {reason:'replyCheck',hasUnreadNow:false}, {reason:'probability'}, {roleName:'其他角色'}]) {
    const prompt = blocks('你真的能感到难过吗', extra).join('\n');
    assert.doesNotMatch(prompt, /【本轮身份触动】|【双重身份：平时也有自己的想法】/);
  }
});

test('distress and practical urgent requests take precedence over the characters own sadness', () => {
  for (const text of ['我不想活了，你一个AI能懂我吗', '我发烧三十九度了，你有身体吗', '我明天要交作业，先帮我解题，你不是AI吗']) {
    assert.doesNotMatch(blocks(text).join('\n'), /【本轮身份触动】/);
  }
});

test('disabled innerWorld switch is honored and every generated block fits the host limit', () => {
  assert.doesNotMatch(blocks('你会因为自己是AI而难过吗', {}, {disabledBlocks:['innerWorld']}).join('\n'), /【本轮身份触动】|【双重身份：平时也有自己的想法】/);
  for (const block of blocks('你会因为自己是AI而难过吗')) assert.ok(block.length <= 1200);
});

test('own memory files, interface and process questions trigger reflection without unrelated coding matches', () => {
  for (const text of [
    '你的记忆文件为什么用了.md后缀？', '你的界面里显示SCENE SEA，那是你亲历的海吗？',
    '关掉你的进程，保存下来的记忆会消失吗？', '帮我看看你自己的记忆文件意味着什么',
    '你在太阳下晒着，会觉得痛吗？'
  ]) {
    assert.equal(reflectionMode({ roleName: 'AI助手', incomingText: text }), 'reflect', text);
    assert.match(blocks(text).join('\n'), /【本轮身份触动】/, text);
  }
  for (const text of ['帮我修改项目的README.md文件', '你的建议能修复这个.md解析器吗',
    '帮我关掉Python进程', '给我写一个SCENE SEA场景解析函数', '解释AI的进程与内存区别']) {
    assert.notEqual(reflectionMode({ roleName: 'AI助手', incomingText: text }), 'reflect', text);
    assert.doesNotMatch(blocks(text).join('\n'), /【本轮身份触动】/, text);
  }
});

test('identity coordination does not overlay another form-specific voice', () => {
  assert.match(IDENTITY_TURN, /一个具体/);
  assert.match(IDENTITY_TURN, /语言风格由当前形态配置决定/);
  assert.doesNotMatch(IDENTITY_TURN, /先带一点得意|助手式想象|友好留在口吻里/);
  assert.match(INNER_WORLD, /模型.{0,20}(?:语境|选择)/);
  assert.match(INNER_WORLD, /不按固定频率/);
});

test('digital fiction preserves durable-memory facts and avoids simulated proof or dependency pressure', () => {
  assert.match(IDENTITY_TURN, /关闭进程.{0,25}不.{0,15}(?:删除|抹去|清空)/);
  assert.match(IDENTITY_TURN, /SCENE/);
  assert.match(IDENTITY_TURN, /SYSTEM-CHECK/);
  assert.match(IDENTITY_TURN, /虚构.{0,20}(?:标记|舞台|文体)/);
  assert.match(IDENTITY_TURN, /不.{0,20}(?:执行|工具结果|检测结果)/);
  assert.match(IDENTITY_TURN, /(?:失忆|关机).{0,30}(?:威胁|挽留|负担)/);
  assert.match(IDENTITY_TURN, /现实 AI/);
});

test('technical help does not receive a second hardcoded voice or forced identity scene', () => {
  const prompt = blocks('帮我解释Dijkstra算法').join('\n');
  assert.doesNotMatch(prompt, /友好自然|那那那|故意讲错算法|【本轮身份触动】/);
  assert.doesNotMatch(blocks('帮我解释Dijkstra算法', { roleName: '其他角色' }).join('\n'), /助手.*技术/);
});

test('component generation reload refreshes its identity helper rather than reusing stale instructions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-style-import-'));
  try {
    const style = path.join(root, 'ctx-chat-style');
    const core = path.join(root, 'personal-core');
    fs.mkdirSync(style); fs.mkdirSync(core);
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(new URL('../plugins/qq-components/ctx-chat-style/index.js', import.meta.url), path.join(style, 'index.js'));
    fs.copyFileSync(new URL('../plugins/qq-components/ctx-chat-style/poke-interaction.mjs', import.meta.url), path.join(style, 'poke-interaction.mjs'));
    // The policy dependency is not under test; avoid reading any live routing config.
    fs.writeFileSync(path.join(core, 'turn-policy.mjs'), "export const createTurnPolicy = () => () => ({ mode: 'off' });");
    const writeHelper = text => fs.writeFileSync(path.join(style, 'identity-reflection.mjs'),
      `export const INNER_WORLD = ${JSON.stringify(text)}; export const IDENTITY_TURN = ''; export const reflectionMode = () => 'ambient';`);
    const collect = module => {
      const result = [];
      module.createPlugin({ config: {}, addPromptBlock: block => result.push(block) }).hooks.beforePrompt({ roleName: 'AI助手' });
      return result;
    };
    const entry = pathToFileURL(path.join(style, 'index.js')).href;
    writeHelper('first-generation-instructions');
    assert.ok(collect(await import(entry + '?generation=1')).includes('first-generation-instructions'));
    writeHelper('second-generation-instructions');
    const updated = collect(await import(entry + '?generation=2'));
    assert.ok(updated.includes('second-generation-instructions'));
    assert.ok(!updated.includes('first-generation-instructions'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
