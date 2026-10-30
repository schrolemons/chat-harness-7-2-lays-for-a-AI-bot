// 管理员开发模式组件回归测试：node scripts/test-admin-dev-component.mjs
import fs from 'node:fs';
import { createPlugin } from '../plugins/qq-components/gov-admin-dev-mode/index.js';
import { createPluginHost } from '../src/plugin-host.js';

let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { console.log('✅ ' + name); return; }
  failed += 1;
  console.error('❌ ' + name + (detail ? ' — ' + detail : ''));
};

const plugin = createPlugin({ warn: (m) => console.error('warn:', m) });
const text = plugin.services['admin-dev'].line({ aliasEntries: '十二=private:20002', rootEscaped: 'C:\\\\repo' });
check('包含管理员开发模式', text.includes('管理员开发模式'));
check('包含昵称对照', text.includes('十二=private:20002'));
check('包含根路径', text.includes('C:\\\\repo'));
check('包含传话/真实发送约束', text.includes('传话') && text.includes('带到了'));
check('空参数不崩', typeof plugin.services['admin-dev'].line({}) === 'string');

const host = createPluginHost({ root: process.cwd(), capabilities: {} });
const summary = await host.loadAll();
check('插件宿主加载（至少 27 个）', summary.count >= 27, 'count=' + summary.count);
check('宿主加载无警告', summary.warnings.length === 0, JSON.stringify(summary.warnings));
check('宿主暴露 admin-dev 服务', host.hasService('admin-dev', 'line') === true);
check('宿主服务可用', String(host.callService('admin-dev', 'line', { aliasEntries: 'x=1', rootEscaped: '/r' })).includes('管理员开发模式'));

const bridge = fs.readFileSync('src/bridge.js', 'utf8');
check('bridge 改为调服务', bridge.includes("pluginHost.callService('admin-dev', 'line'"));
check('bridge 不再内联开发模式长文案', !bridge.includes('【管理员开发模式】'));

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n管理员开发模式组件测试通过');
