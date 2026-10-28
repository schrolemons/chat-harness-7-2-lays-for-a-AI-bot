import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..', '..');
export const GAMES_STORE_FILE = path.join(ROOT, 'state', 'games-store.json');
const BUILTINS = JSON.parse(fs.readFileSync(path.join(DIR, 'games.json'), 'utf8'));
const ACTION_RE = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_CUSTOM_GAMES = 50;

function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function readStore(file = GAMES_STORE_FILE) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { settings: plainObject(data.settings) ? data.settings : {}, customGames: Array.isArray(data.customGames) ? data.customGames : [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { settings: {}, customGames: [] };
    throw new Error(`Games 存档无法读取：${error.message}`);
  }
}

function writeStore(store, file = GAMES_STORE_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function validateJson(value, depth = 0) {
  if (depth > 6) throw new Error('游戏状态嵌套不能超过 6 层。');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (value.length > 64) throw new Error('游戏状态数组最多 64 项。');
    for (const item of value) validateJson(item, depth + 1);
    return;
  }
  if (plainObject(value)) {
    if (Object.keys(value).length > 64) throw new Error('游戏状态字段最多 64 个。');
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('游戏状态包含保留字段。');
      validateJson(item, depth + 1);
    }
    return;
  }
  throw new Error('游戏状态只能包含 JSON 值。');
}

export function validateCustomGame(input) {
  if (!plainObject(input)) throw new Error('游戏定义必须是 JSON 对象。');
  const game = clone(input);
  game.id = String(game.id ?? '').trim().toLowerCase();
  game.name = String(game.name ?? '').trim();
  game.summary = String(game.summary ?? '').trim();
  game.rules = String(game.rules ?? '').trim();
  if (!/^custom-[a-z0-9-]{2,34}$/.test(game.id)) throw new Error('自定义游戏 id 必须以 custom- 开头，只能含小写字母、数字和短横线。');
  if (!game.name || game.name.length > 60 || !game.summary || game.summary.length > 180 || !game.rules || game.rules.length > 4000) throw new Error('游戏名称、简介或规则为空或超出长度限制。');
  if (!plainObject(game.initialState)) throw new Error('initialState 必须是 JSON 对象。');
  validateJson(game.initialState);
  if (Buffer.byteLength(JSON.stringify(game)) > 24_000) throw new Error('单个游戏定义不能超过 24 KB。');
  if (!Array.isArray(game.actions) || game.actions.length < 1 || game.actions.length > 16) throw new Error('actions 必须包含 1 至 16 个动作。');
  const actionTypes = new Set();
  for (const action of game.actions) {
    if (!plainObject(action) || !ACTION_RE.test(String(action.type ?? '')) || actionTypes.has(action.type)) throw new Error('动作 type 必须唯一，并符合小写字母、数字或下划线格式。');
    actionTypes.add(action.type);
    action.label = String(action.label ?? '').trim();
    action.description = String(action.description ?? '').trim();
    if (!action.label || action.label.length > 60 || action.description.length > 240) throw new Error('动作名称不能为空，说明最多 240 字。');
    action.inputs = Array.isArray(action.inputs) ? action.inputs : [];
    if (action.inputs.length > 8) throw new Error('每个动作最多 8 个输入字段。');
    for (const inputDef of action.inputs) {
      if (!plainObject(inputDef) || !/^[a-z][a-zA-Z0-9_]{0,23}$/.test(String(inputDef.name ?? ''))) throw new Error('动作输入字段名不合法。');
      if (!['string', 'number', 'choice'].includes(inputDef.type)) throw new Error('动作输入 type 仅支持 string、number、choice。');
      if (inputDef.type === 'string' && (!Number.isInteger(inputDef.maxLength ?? 80) || Number(inputDef.maxLength ?? 80) < 1 || Number(inputDef.maxLength ?? 80) > 200)) throw new Error('文本输入长度限制必须在 1 至 200 字。');
      if (inputDef.type === 'number' && (!Number.isFinite(inputDef.min) || !Number.isFinite(inputDef.max) || inputDef.min > inputDef.max || inputDef.max - inputDef.min > 10000)) throw new Error('数字输入需要有限且有界的 min/max。');
      if (inputDef.type === 'choice' && (!Array.isArray(inputDef.options) || inputDef.options.length < 2 || inputDef.options.length > 12 || inputDef.options.some(v => typeof v !== 'string' || v.length > 60))) throw new Error('choice 输入需要 2 至 12 个短选项。');
    }
    action.effects = Array.isArray(action.effects) ? action.effects : [];
    if (action.effects.length > 16) throw new Error('每个动作最多 16 个状态效果。');
    for (const effect of action.effects) validateEffect(effect, game.initialState, action.inputs);
    action.message = String(action.message ?? '');
    if (action.message.length > 500) throw new Error('动作结果文本最多 500 字。');
    action.endsGame = action.endsGame === true;
  }
  return game;
}

function validateEffect(effect, state, inputs) {
  if (!plainObject(effect) || !Object.hasOwn(state, effect.field)) throw new Error('effect 必须更新 initialState 中已声明的字段。');
  if (effect.op === 'set') {
    if (Object.hasOwn(effect, 'input')) {
      const input = inputs.find(item => item.name === effect.input);
      if (!input) throw new Error('set 引用的 input 不存在。');
      const targetType = typeof state[effect.field];
      const inputType = input.type === 'number' ? 'number' : 'string';
      if (targetType !== inputType) throw new Error('set 引用的 input 必须与目标状态字段类型一致。');
    } else {
      validateJson(effect.value);
      if ((effect.value === null ? 'null' : typeof effect.value) !== (state[effect.field] === null ? 'null' : typeof state[effect.field])) throw new Error('set 的 value 必须与初始状态字段类型一致。');
    }
  } else if (effect.op === 'increment') {
    if (typeof state[effect.field] !== 'number' || !Number.isFinite(effect.by ?? 1) || !Number.isFinite(effect.min) || !Number.isFinite(effect.max) || effect.min > effect.max) throw new Error('increment 需要数值字段、by、min 和 max。');
  } else if (effect.op === 'randomInt') {
    if (typeof state[effect.field] !== 'number' || !Number.isInteger(effect.min) || !Number.isInteger(effect.max) || effect.min > effect.max || effect.max - effect.min > 1000) throw new Error('randomInt 需要数值字段和不超过 1000 的整数范围。');
  } else throw new Error('effect op 仅支持 set、increment、randomInt。');
}

function validateParameters(id, parameters = {}) {
  if (!plainObject(parameters)) throw new Error('parameters 必须是 JSON 对象。');
  if (id === 'spark') {
    const allowed = ['minSparks', 'maxSparks', 'minGlowLevel', 'maxGlowLevel', 'minCadenceMs', 'maxCadenceMs', 'minDurationSec', 'maxDurationSec'];
    if (Object.keys(parameters).some(key => !allowed.includes(key))) throw new Error('小火花参数含未知字段。');
    const p = { ...BUILTINS.defaults.spark.parameters, ...parameters };
    for (const key of allowed) if (!Number.isInteger(p[key])) throw new Error(`${key} 必须是整数。`);
    if (p.minSparks < 1 || p.maxSparks > 5 || p.minSparks > p.maxSparks) throw new Error('虚构火花数量只能在 1 至 5 颗内配置。');
    if (p.minGlowLevel < 1 || p.maxGlowLevel > 3 || p.minGlowLevel > p.maxGlowLevel) throw new Error('虚构特效亮度只能在 1 至 3 级内配置。');
    if (p.minCadenceMs < 250 || p.maxCadenceMs > 5000 || p.minCadenceMs > p.maxCadenceMs) throw new Error('叙述节奏范围必须在 250 至 5000 毫秒内。');
    if (p.minDurationSec < 1 || p.maxDurationSec > 5 || p.minDurationSec > p.maxDurationSec) throw new Error('叙述时长只能在 1 至 5 秒内配置。');
    return p;
  }
  if (id === 'dice') {
    if (Object.keys(parameters).some(key => key !== 'sides')) throw new Error('骰子参数含未知字段。');
    const sides = Number(parameters.sides ?? BUILTINS.defaults.dice.parameters.sides);
    if (!Number.isInteger(sides) || sides < 2 || sides > 20) throw new Error('骰子面数只能是 2 至 20 的整数。');
    return { sides };
  }
  if (id === 'riddle') {
    if (Object.keys(parameters).some(key => key !== 'maxAttempts')) throw new Error('谜题参数含未知字段。');
    const maxAttempts = Number(parameters.maxAttempts ?? BUILTINS.defaults.riddle.parameters.maxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('谜题次数只能是 1 至 10 的整数。');
    return { maxAttempts };
  }
  if (Object.keys(parameters).length) throw new Error('自定义游戏不支持额外运行参数，请在 adapter 中定义状态和动作。');
  return {};
}

export function listGames(file = GAMES_STORE_FILE) {
  const store = readStore(file);
  const builtins = BUILTINS.games.map(game => {
    const saved = store.settings[game.id] || {};
    const parameters = validateParameters(game.id, saved.parameters || {});
    const summary = game.id === 'dice' ? `掷一颗 ${parameters.sides} 面骰，比比点数，不涉及真实筹码或输赢惩罚。`
      : game.id === 'riddle' ? `猜一个固定谜题；最多 ${parameters.maxAttempts} 次作答，可随时查看提示或结束。`
        : game.summary;
    return { ...clone(game), summary, rules: BUILTINS.rules[game.id], enabled: saved.enabled !== false, parameters, custom: false };
  });
  const customGames = store.customGames.map(item => {
    const game = validateCustomGame(item);
    const saved = store.settings[game.id] || {};
    return { ...game, enabled: saved.enabled !== false, parameters: {}, custom: true };
  });
  return [...builtins, ...customGames];
}

export function setGameSettings(id, input, file = GAMES_STORE_FILE) {
  const games = listGames(file);
  const game = games.find(item => item.id === String(id ?? ''));
  if (!game) throw new Error('找不到游戏。');
  if (!plainObject(input)) throw new Error('设置必须是 JSON 对象。');
  if (Object.keys(input).some(key => !['enabled', 'parameters'].includes(key))) throw new Error('只允许修改 enabled 和 parameters。');
  const store = readStore(file);
  const current = store.settings[game.id] || {};
  const next = { enabled: input.enabled === undefined ? current.enabled !== false : input.enabled === true, parameters: current.parameters || {} };
  if (input.parameters !== undefined) next.parameters = validateParameters(game.id, input.parameters);
  store.settings[game.id] = next;
  writeStore(store, file);
  return listGames(file).find(item => item.id === game.id);
}

export function saveCustomGame(input, file = GAMES_STORE_FILE) {
  const game = validateCustomGame(input);
  const store = readStore(file);
  if (BUILTINS.games.some(item => item.id === game.id)) throw new Error('自定义游戏 id 不能与内置游戏重复。');
  const index = store.customGames.findIndex(item => item.id === game.id);
  if (index < 0 && store.customGames.length >= MAX_CUSTOM_GAMES) throw new Error(`最多保存 ${MAX_CUSTOM_GAMES} 个自定义游戏。`);
  if (index < 0) store.customGames.push(game); else store.customGames[index] = game;
  store.settings[game.id] = { enabled: true, parameters: {} };
  writeStore(store, file);
  return listGames(file).find(item => item.id === game.id);
}

export function deleteCustomGame(id, file = GAMES_STORE_FILE) {
  const store = readStore(file);
  const before = store.customGames.length;
  store.customGames = store.customGames.filter(item => item.id !== String(id ?? ''));
  if (store.customGames.length === before) throw new Error('只能删除已保存的自定义游戏。');
  delete store.settings[id];
  writeStore(store, file);
  return true;
}

export function getBuiltInGameDefinitions() { return clone(BUILTINS); }
