import { readConsoleTestSource } from './console-test-source.mjs';
// 控制台静态校验：在无法跑 Playwright 的环境里，替代性地检查 HTML/JS 结构契约。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_CONFIG_FLAGS } from '../src/tools/flags.js';
// 独立发语音工具在仓库上一级（不在本仓库里）：位置解析与"不在时怎么跳过"走共享口径。
import { hasVoiceTool, skipVoiceTool, voiceToolPath } from './voice-tool-locator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readConsoleTestSource();

let bad = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  OK   ${name}${extra ? ' — ' + extra : ''}`);
  else { bad++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('## 元素 ID');
const ids = [...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
ok(dups.length === 0, 'ID 唯一', dups.length ? `重复：${dups.join(', ')}` : `共 ${ids.length} 个`);
for (const id of ['voiceList', 'voiceRefreshBtn', 'voiceSendBtn', 'voiceSendTarget', 'voiceSendDryRun', 'voiceMsg']) {
  const n = (html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length;
  ok(n === 1, `语音面板元素 ${id}`, `${n} 处`);
}

console.log('## 视图 / 页面契约');
const views = [...new Set([...html.matchAll(/data-view="([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
const pages = [...new Set([...html.matchAll(/data-page="([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
ok(JSON.stringify(views) === JSON.stringify(pages), 'data-view 与 data-page 一一对应', `${views.length} 个：${views.join(', ')}`);

console.log('## 二代模式的统一入口');
const modeSection = html.match(/<section id="section-mode"[\s\S]*?<\/section>/)?.[0] || '';
ok(!/v2AgentPreset|v2ProvideRecommendations/.test(modeSection), '运行模式不再提供 agentPreset 或额外推荐参数开关');
ok(!/v2AgentPreset|v2ProvideRecommendations|provideRecommendations:\s*document/.test(html), '控制台不再采集或提交二代预设/推荐开关');
ok(/id="section-setting-l-0"[^>]*data-page="setting-l-0"/.test(html) && /id="v2DoubleStampWindowCount"/.test(html), '生命周期组件页保留实际可编辑的双戳参数');
ok(!ids.includes('v2SendHint') && /data-component-slot="ctx-chat-reply-shape"/.test(html), '发送数量与间隔只由唯一发送计划组件管理');
ok(/send: activeTurnEnvelopes[\s\S]{0,160}callService\('replyPlan','policy'\)/.test(fs.readFileSync(path.join(ROOT,'src','bridge.js'),'utf8')), 'qq_get_prompt 返回实际发送计划，不恢复退役提示参数');

console.log('## 工具开关');
const inventory = fs.readFileSync(path.join(ROOT, 'console/layers/T/tool-inventory.js'), 'utf8');
const tools = [...new Set(Object.values(TOOL_CONFIG_FLAGS))];
ok(tools.includes('sendVoice') && /Object\.entries\(TOOL_CONFIG_FLAGS\)/.test(inventory) && /id="v2Tools"/.test(html), '工具开关由唯一 MCP 注册映射生成', `共 ${tools.length} 个开关`);
ok(/groups\.has\(flag\)/.test(inventory) && /groups\.get\(flag\)\.push\(name\)/.test(inventory), '工具分组仍按唯一flag去重，分组不增生开关');
ok(/api\('\/api\/tools\/catalog'\)/.test(inventory) && /botInjectedSessions>0/.test(inventory), '工具目录读取真实注入证据');

console.log('## 双戳窗口回查控制');
ok(ids.includes('v2DoubleStampEnabled'), '双戳窗口回查启用开关存在');
ok(ids.includes('v2DoubleStampWindowCount') && !ids.includes('v2DoubleStampWindow'), '双戳回查按条数输入，无旧毫秒输入');
ok(/getElementById\('v2DoubleStampEnabled'\)\.checked = ds\.enabled !== false/.test(html), '双戳启用状态从配置载入');
ok(/doubleStamp:\s*\{\s*enabled:\s*document\.getElementById\('v2DoubleStampEnabled'\)\.checked,\s*windowCount:/.test(html), '双戳开关与条数写入配置 payload');
ok(/不按秒数计/.test(html) && /Harness 验证并立即更新 repliedAt/.test(html), '界面说明消息窗口单位和逐条回执验证');

console.log('## 已移除会话快速选择的启动接线');
ok(!/\bloadV2SessionOptions\s*\(/.test(html), '启动流程不再调用已移除的白名单会话快速选择加载器');

console.log('## 语音面板接线');
ok(/id="voiceRefreshBtn"/.test(html) && /getElementById\('voiceRefreshBtn'\)\.addEventListener/.test(html), '刷新按钮已绑定事件');
ok(/getElementById\('voiceSendBtn'\)\.addEventListener/.test(html), '试发按钮已绑定事件');
ok(/api\('\/api\/voice\/list/.test(html), '面板调用 /api/voice/list（操作者通道，无需 key）');
ok(/api\('\/api\/voice\/send'/.test(html), '面板调用 /api/voice/send');
ok(/typeof loadVoiceLibrary === 'function'|async function loadVoiceLibrary/.test(html), 'loadVoiceLibrary 已定义');

console.log('## JS 语法');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
for (const [index, script] of scripts.entries()) {
  try { new Function(script); }
  catch (e) { ok(false, `script ${index + 1} 语法`, e.message); }
}
ok(scripts.length > 1, '所有拥有模块的 script 语法均检查', `${scripts.length} 个模块/内联脚本`);

console.log('## 语音图形界面的音量控件');
if (!hasVoiceTool()) {
  // 这一整段查的是独立工具自己的页面（voice.html），仓库里没有它。
  skipVoiceTool('voice.html 的音量控件断言（volRange/volLabel/volReset/normBox/loudnessSel/previewBtn、滑块范围、事件绑定、前端 JS 可解析）');
} else {
  const voice = fs.readFileSync(voiceToolPath('public', 'voice.html'), 'utf8');
  const ids = [...voice.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
  const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  ok(dups.length === 0, 'voice.html ID 唯一', dups.length ? `重复：${dups.join(', ')}` : `共 ${ids.length} 个`);
  for (const id of ['volRange', 'volLabel', 'volReset', 'normBox', 'loudnessSel', 'previewBtn']) {
    ok(ids.includes(id), `音量控件 ${id}`);
  }
  ok(/id="volRange"[^>]*min="10"[^>]*max="400"/.test(voice), '滑块范围 10%~400%');
  ok(/volRange'\)\.addEventListener\('input'/.test(voice), '滑块 input 事件已绑定');
  ok(/previewBtn'\)\.addEventListener/.test(voice), '试听按钮已绑定');
  ok(/api\/preview/.test(voice), '试听调 /api/preview（听处理后的效果）');
  ok(/body\.normalize = true/.test(voice) && /body\.volume = volValue\(\)/.test(voice), '发送时带上音量设置');
  const scripts = [...voice.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  try { new Function(scripts[0]); ok(true, 'voice.html 前端 JS 可解析'); }
  catch (e) { ok(false, 'voice.html 前端 JS 可解析', e.message); }
}

console.log('## fixture mock 覆盖');
const fixture = fs.readFileSync(path.join(ROOT, 'scripts', 'console-ui-fixture.mjs'), 'utf8');
ok(fixture.includes("case '/api/socialV2/voices'"), 'fixture mock 了 /api/socialV2/voices');
ok(fixture.includes("case '/api/voice/send'"), 'fixture mock 了 /api/voice/send');

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
if (bad > 0) process.exit(1);
