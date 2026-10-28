// 传话意图解析回归测试：node scripts/test-relay-intent.mjs
import { parseRelayCommand, stripRelayPrefix } from '../src/relay-intent.js';

// 模拟桥接的白名单解析：管理员 / 管理员 / 老板 可解析，其它不行
const KNOWN = new Set(['管理员', '管理员', '老板', '阿狸']);
const resolve = (name) => KNOWN.has(name);

const cases = [
  // [输入, 期望 name | null, 期望 content, 期望 weak]
  ['给管理员带句话，问问他吃了没', '管理员', '问问他吃了没', false],
  ['给我向管理员带句话，问问他吃了没', '管理员', '问问他吃了没', false],
  ['给管理员捎句话：晚安', '管理员', '晚安', false],
  ['给管理员带个话，明天见', '管理员', '明天见', false],
  ['帮我跟管理员说一声，明天见', '管理员', '明天见', false],
  ['帮我给管理员带句话', '管理员', '', false],
  ['传话给管理员：晚安', '管理员', '晚安', false],
  ['捎话给管理员，明天见', '管理员', '明天见', false],
  ['转告管理员，明天开会', '管理员', '明天开会', false],
  ['转达给管理员：收到了', '管理员', '收到了', false],
  ['告诉管理员明天来', '管理员', '明天来', false],
  ['问问你们管理员，他吃了吗', '管理员', '他吃了吗', true],
  ['帮我问问你们管理员他吃了没', '管理员', '他吃了没', true],
  ['问一下管理员吃了没', '管理员', '吃了没', true],
  ['跟老板说一声，我先撤了', '老板', '我先撤了', false],
  ['对了，顺便给管理员带句话，晚安', '管理员', '晚安', false],
  ['那我给管理员带句话，晚安', '管理员', '晚安', false],
  // 不该误判的日常说法
  ['给你们说个事', null, null, null],
  ['和大家说一声', null, null, null],
  ['告诉我一声', null, null, null],
  ['给你带句话', null, null, null],
  ['给你说个事', null, null, null],
  ['跟管理员说句实话', null, null, null],
  ['问问价格', '价格', '', true], // 弱意图：桥接侧解析不到目标时应当作普通聊天
  ['今天吃什么', null, null, null],
  ['传话能让你传到群聊，你能从群聊传到私聊吗', null, null, null],
  ['传话功能怎么用', null, null, null],
];

let failed = 0;
for (const [input, name, content, weak] of cases) {
  const got = parseRelayCommand(input, { resolve });
  const ok = name === null
    ? got === null
    : got && got.name === name && got.content === content && got.weak === weak;
  if (!ok) {
    failed += 1;
    console.error(`❌ ${JSON.stringify(input)} → ${JSON.stringify(got)}，期望 name=${name} content=${JSON.stringify(content)} weak=${weak}`);
  } else {
    console.log(`✅ ${JSON.stringify(input)} → ${JSON.stringify(got)}`);
  }
}

// 没有 resolve 回调时：带标点的仍要能解析，没标点的歧义句宁可不猜
const noResolveCases = [
  ['转告管理员，明天开会', '管理员', '明天开会'],
  ['告诉管理员明天来', null, null],
  ['传话给管理员：晚安', '管理员', '晚安'],
];
for (const [input, name, content] of noResolveCases) {
  const got = parseRelayCommand(input);
  const ok = name === null ? got === null : got && got.name === name && got.content === content;
  if (!ok) { failed += 1; console.error(`❌ 无 resolve：${JSON.stringify(input)} → ${JSON.stringify(got)}，期望 name=${name} content=${JSON.stringify(content)}`); }
}

const prefixCases = [
  ['嗯，帮我给管理员带句话', '给管理员带句话'],
  ['给我向管理员带句话', '向管理员带句话'],
];
for (const [input, expected] of prefixCases) {
  const got = stripRelayPrefix(input);
  if (got !== expected) { failed += 1; console.error(`❌ stripRelayPrefix(${JSON.stringify(input)}) = ${JSON.stringify(got)}，期望 ${JSON.stringify(expected)}`); }
}

if (failed) { console.error(`\n${failed} 个用例失败`); process.exit(1); }
console.log(`\n全部 ${cases.length + noResolveCases.length + prefixCases.length} 个用例通过`);
