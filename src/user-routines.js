// 作息（routines）解析与固定展示块 —— 与画像存储解耦的纯函数模块。
//
// 为什么不放在 src/user-profile.js 里：桥接热加载插件时，插件入口带 ?generation= 重新 import，
// 但它静态引用的旧路径模块（src/user-profile.js）仍在 ESM 缓存里；把新函数放进旧文件，热加载后
// 插件会拿不到新导出。单独一个 new 路径的模块，插件热加载即可直接生效，也方便测试。
//
// 存储形态：fields.routines 一直是「短句数组」，旧数据形如「早餐7:30左右」「工作 9:00-18:00」。
// 新写入统一规范成「早餐 07:30（固定）· 爱吃甜」，但读取端必须同时吃得下旧短句：这里只解析、
// 不改写旧值，档案卡的固定「作息」块由 routineBlockLines() 生成。

export const ROUTINE_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', wake: '起床', sleep: '睡觉', work: '工作/上课' };
const ROUTINE_KIND_RES = [
  ['breakfast', /早餐|早饭/],
  ['lunch', /午餐|午饭|中饭/],
  ['dinner', /晚餐|晚饭/],
  ['wake', /起床|醒来/],
  ['sleep', /睡觉|入睡|睡眠|睡下/],
  ['work', /上班|工作|上课|有课|值班/]
];
const ROUTINE_LOOSE_RE = /大致|大概|大约|差不多|左右|偶尔|有时|不固定|不规律/;
const ROUTINE_FIXED_RE = /固定|每天|天天|雷打不动|基本都/;
const TASTE_WORD_RE = /(吃|喝|甜|辣|咸|酸|苦|清淡|重口|香菜|葱|蒜|海鲜|奶茶|咖啡|宵夜|零食|水果|素食|荤|忌口|酒)/;
const TASTE_STRIP_RE = /早餐|早饭|午餐|午饭|中饭|晚餐|晚饭|起床|醒来|睡觉|入睡|睡眠|睡下|上班|工作|上课|有课|值班|时间|固定|每天|天天|大致|大概|大约|差不多|左右|偶尔|有时|不固定|不规律|[的了吗呢啊吧呀哦]/g;
const TIME_TOKEN_RE = /([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)|([01]?\d|2[0-3])\s*[点時时]\s*(半|([0-5]?\d)\s*分?)?/g;
const pad2 = (n) => String(n).padStart(2, '0');

export function routineKind(value) {
  const text = String(value || '');
  const hit = ROUTINE_KIND_RES.find(([, re]) => re.test(text));
  return hit ? hit[0] : '';
}

function timeTokens(text) {
  const out = [];
  const re = new RegExp(TIME_TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    if (m[1] != null) out.push({ hour: Number(m[1]), minute: Number(m[2]) });
    else out.push({ hour: Number(m[3]), minute: m[4] === '半' ? 30 : Number(m[5] || 0) });
  }
  return out;
}

function routineTasteOf(text) {
  const rest = String(text || '').replace(new RegExp(TIME_TOKEN_RE.source, 'g'), ' ')
    .replace(TASTE_STRIP_RE, ' ')
    .replace(/[，,。.、;；:：()（）\[\]【】《》"'“”‘’/|｜~～\-—－\s]+/g, ' ')
    .trim();
  return rest.length >= 2 && TASTE_WORD_RE.test(rest) ? rest.slice(0, 20) : '';
}

/** 解析一条作息短句（旧数据也吃得下）：{ kind, text, display, exact, taste, start, end } */
export function parseRoutine(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const kind = routineKind(text);
  const times = timeTokens(text);
  const exact = ROUTINE_LOOSE_RE.test(text) ? '大致' : (ROUTINE_FIXED_RE.test(text) ? '固定' : '');
  const start = times[0] || null;
  const end = times[1] || null;
  const display = start
    ? `${pad2(start.hour)}:${pad2(start.minute)}` + (end ? `–${pad2(end.hour)}:${pad2(end.minute)}` : '') + (exact ? `（${exact}）` : '')
    : '';
  return { kind, text, display, exact, taste: routineTasteOf(text), start, end };
}

function canonicalRoutineString(item) {
  const label = ROUTINE_LABELS[item.kind] || item.text.slice(0, 12);
  const span = item.display.replace(/（.*?）$/, '');
  return `${label} ${span}${item.exact ? `（${item.exact}）` : ''}${item.taste ? ' · ' + item.taste : ''}`.trim().slice(0, 40);
}

/**
 * 写入侧归一化：字符串（旧格式）原样保留；结构化对象（{ kind|slot, time|start, end, exactness, taste }）
 * 转成规范短句，保证旧版存储读到的仍是字符串数组。
 */
export function normalizeRoutineEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  const kind = String(raw.kind || raw.slot || raw.type || '').toLowerCase();
  const label = ROUTINE_LABELS[kind] || String(raw.label || raw.name || '').trim();
  const time = String(raw.time || raw.at || raw.start || '').trim();
  const end = String(raw.end || raw.to || raw.until || '').trim();
  const exactRaw = String(raw.exactness || raw.exact || raw.fuzziness || raw.precision || '').trim();
  const exact = exactRaw ? (ROUTINE_LOOSE_RE.test(exactRaw) ? '大致' : (ROUTINE_FIXED_RE.test(exactRaw) ? '固定' : '')) : '';
  const taste = String(raw.taste || raw.flavor || raw.preference || '').trim();
  const span = time && end ? `${time}-${end}` : time;
  const parsed = parseRoutine([label, span, exact, taste].filter(Boolean).join(' '));
  if (!parsed || !parsed.display) return '';
  if (!parsed.kind && kind) parsed.kind = kind;
  return canonicalRoutineString(parsed);
}

/**
 * 收集一次写入里的全部作息入口：routines（短句/对象）、workWindows，以及 breakfast/lunch/dinner/wake/sleep。
 * @returns {string[]} 已归一化的规范短句数组（空项已剔除）
 */
export function collectRoutineEntries(facts = {}) {
  if (!facts || typeof facts !== 'object') return [];
  const out = [];
  if (Array.isArray(facts.routines)) out.push(...facts.routines);
  if (Array.isArray(facts.workWindows)) {
    for (const w of facts.workWindows) out.push(w && typeof w === 'object' ? { ...w, kind: 'work' } : '工作 ' + String(w || ''));
  }
  for (const slot of ['breakfast', 'lunch', 'dinner', 'wake', 'sleep']) {
    const v = facts[slot];
    if (v == null || v === '') continue;
    if (v && typeof v === 'object') { out.push({ ...v, kind: slot }); continue; }
    const text = String(v);
    const parsed = parseRoutine(text);
    out.push(parsed && (parsed.kind || routineKind(text)) ? text : `${ROUTINE_LABELS[slot]} ${text}`);
  }
  return out.map((raw) => normalizeRoutineEntry(raw)).filter(Boolean).slice(0, 12);
}

/** 把 fields.routines 归成固定槽位；同一槽位只取第一条，工作时段允许多段。 */
export function routineView(routines) {
  const view = { breakfast: null, lunch: null, dinner: null, wake: null, sleep: null, work: [], others: [] };
  for (const raw of Array.isArray(routines) ? routines : []) {
    const item = parseRoutine(raw);
    if (!item) continue;
    if (!item.kind) { view.others.push(item); continue; }
    if (item.kind === 'work') { view.work.push(item); continue; }
    if (!view[item.kind]) view[item.kind] = item;
  }
  view.has = !!(view.breakfast || view.lunch || view.dinner || view.wake || view.sleep || view.work.length || view.others.length);
  return view;
}

function stripTastePrefix(text) {
  return String(text || '').replace(/^(很|特别|超|比较)?(喜欢|爱吃|爱喝|爱|不喜欢|不爱吃|不爱喝|不爱|不吃|不喝|讨厌吃|讨厌喝|讨厌|忌口|不能吃)/, '').trim();
}

/** 口味单独可查：爱吃甜/辣、不吃什么，只从 likes / dislikes 里挑食物相关的短句。 */
export function foodTaste(fields = {}) {
  const pick = (list) => [...new Set((Array.isArray(list) ? list : [])
    .map((x) => stripTastePrefix(String(x || '').trim()))
    .filter((x) => x && x.length <= 20 && TASTE_WORD_RE.test(x)))].slice(0, 4);
  return { likes: pick(fields.likes), dislikes: pick(fields.dislikes) };
}

/**
 * 档案卡的固定「作息」块内容（没有标题、没有占位符，只输出有数据的行）。
 * @returns {string[]} 每行像「早餐 07:30（固定）· 甜」「口味：爱吃 甜、奶茶；不吃 香菜」
 */
export function routineBlockLines(routines, opts = {}) {
  const view = routineView(routines);
  const ft = foodTaste(opts.fields || {});
  if (!view.has && !ft.likes.length && !ft.dislikes.length) return [];
  const lines = [];
  const withTaste = (item) => {
    if (!item) return '';
    const taste = stripTastePrefix(item.taste);
    return item.display + (taste ? ' · ' + taste : '');
  };
  for (const key of ['breakfast', 'lunch', 'dinner']) {
    if (view[key]) lines.push(`${ROUTINE_LABELS[key]} ${withTaste(view[key])}`);
  }
  if (view.wake) lines.push(`起床 ${withTaste(view.wake)}`);
  if (view.sleep) lines.push(`睡觉 ${withTaste(view.sleep)}`);
  if (view.work.length) lines.push('工作/上课 ' + view.work.map((item) => withTaste(item)).join('；'));
  for (const item of view.others.slice(0, 3)) {
    lines.push(item.display ? `${item.display}${item.taste ? ' · ' + stripTastePrefix(item.taste) : ''}` : item.text.slice(0, 30));
  }
  const tastes = [];
  for (const key of ['breakfast', 'lunch', 'dinner']) {
    const item = view[key];
    if (item && item.taste) tastes.push(stripTastePrefix(item.taste));
  }
  tastes.push(...ft.likes);
  const liked = [...new Set(tastes.filter(Boolean))].slice(0, 6);
  const disliked = [...new Set(ft.dislikes.filter(Boolean))].slice(0, 4);
  if (liked.length || disliked.length) {
    const parts = [];
    if (liked.length) parts.push('爱吃 ' + liked.join('、'));
    if (disliked.length) parts.push('不吃/少吃 ' + disliked.join('、'));
    lines.push('口味：' + parts.join('；'));
  }
  return lines.slice(0, 10);
}
