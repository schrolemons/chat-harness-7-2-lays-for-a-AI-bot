// 角色卡清洗组件回归测试：node scripts/test-role-card-component.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/ctx-role-card/index.js';
import { createPluginHost } from '../src/plugin-host.js';
import { cleanRoleHint } from '../src/role-hint.js';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

const raw = [
  '用 [SILENT] 结束这句话。',
  '## 一、你是谁',
  '你是大肥鱼。',
  '## 三、回复示例',
  '群友：在干嘛',
  '你：咚咚咚 干饭中',
  ''
].join('\n');
const cleaned = cleanRoleHint(raw);
check('去掉 GEN1 指令行', !cleaned.includes('[SILENT]'));
check('保留普通行', cleaned.includes('你是大肥鱼'));
check('示例区空格转逗号', cleaned.includes('咚咚咚，干饭中'));

const plugin = createPlugin({ warn: (m) => console.error('warn:', m) });
check('服务返回清洗结果', plugin.services['role-card'].clean(raw).includes('咚咚咚，干饭中'));
check('空输入返回空', plugin.services['role-card'].clean('') === '');

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
check('宿主暴露 role-card 服务', host.hasService('role-card', 'clean') === true);
check('宿主服务可用', host.callService('role-card', 'clean', raw).includes('咚咚咚，干饭中'));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
const fn = bridge.indexOf('function currentRoleHintV2');
const seg = bridge.slice(fn, fn + 4000);
check('bridge 改为调服务', seg.includes("pluginHost.callService('role-card', 'clean', raw)"));
check('bridge 不再内联示例转换', !seg.includes('convertExampleSpacesToComma'));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n角色卡组件测试通过');
