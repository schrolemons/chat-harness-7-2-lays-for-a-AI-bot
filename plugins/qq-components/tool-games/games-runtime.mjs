import { randomInt as cryptoRandomInt, randomUUID as cryptoRandomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listGames, getBuiltInGameDefinitions } from './games-store.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFINITIONS = getBuiltInGameDefinitions();
export const GAMES_TOOL_DESCRIPTIONS = Object.freeze({
  ...DEFINITIONS.toolDescriptions,
  games_create: '根据用户明确提出的游戏描述，生成受限 JSON GameAdapter（id/name/summary/rules/initialState/actions/effects），不得写入个人敏感信息，并保存为自定义游戏。仅允许固定状态转移 DSL；不可生成或执行 JavaScript、脚本、网络、QQ 或文件访问逻辑。保存后默认启用，可在 console 修改或删除。',
});
const DEFAULT_TTL_MS = 20 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 100;
const MAX_ANSWER_CHARS = 80;

function error(code, message) { return { ok: false, code, error: message }; }
function cleanAnswer(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/[\s，。！？、,.!?：:；;]/g, '');
}

export function createGamesRuntime(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const randomUUID = typeof options.randomUUID === 'function' ? options.randomUUID : cryptoRandomUUID;
  const randomInt = typeof options.randomInt === 'function' ? options.randomInt : cryptoRandomInt;
  const registryFile = options.registryFile;
  const ttlMs = Math.max(1, Number(options.ttlMs) || DEFAULT_TTL_MS);
  const maxSessions = Math.min(100, Math.max(1, Number(options.maxSessions) || DEFAULT_MAX_SESSIONS));
  const sessions = new Map();

  function purgeExpired() {
    const time = now();
    for (const [id, session] of sessions) if (session.expiresAt <= time) sessions.delete(id);
  }

  function getSession(sessionId) {
    purgeExpired();
    const session = sessions.get(String(sessionId ?? ''));
    return session || null;
  }

  function publicSession(session) {
    return {
      sessionId: session.id,
      gameId: session.gameId,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      moves: session.moves,
    };
  }

  function legalActions(game) {
    return game.custom ? game.actions.map(({ type, label, description, inputs }) => ({ type, label, description, inputs })) : game.actions.map(type => ({ type }));
  }

  function catalog() {
    return {
      ok: true,
      games: listGames(registryFile).filter(game => game.enabled),
      limits: [...DEFINITIONS.limits],
      sparkPrompt: DEFINITIONS.sparkPrompt,
    };
  }

  function start({ gameId, consentConfirmed = false } = {}) {
    purgeExpired();
    const game = listGames(registryFile).find(item => item.id === String(gameId ?? ''));
    if (!game) return error('UNKNOWN_GAME', '没有这个小游戏。');
    if (!game.enabled) return error('GAME_DISABLED', '这个游戏目前已在 console 中停用。');
    if (sessions.size >= maxSessions) return error('SESSION_LIMIT', '当前互动较多，请稍后再开新局。');
    if (game.id === 'spark' && consentConfirmed !== true) {
      return error('CONSENT_REQUIRED', '放电互动需要参与者本人明确表示愿意；第三人不能代替同意。');
    }

    const id = String(randomUUID());
    if (sessions.has(id)) return error('SESSION_ID_COLLISION', '无法创建独立游戏会话，请重试。');
    const session = {
      id,
      gameId: game.id,
      status: 'active',
      createdAt: now(),
      expiresAt: now() + ttlMs,
      moves: 0,
      attempts: 0,
      game: structuredClone(game),
      state: game.custom ? structuredClone(game.initialState) : null,
    };
    sessions.set(id, session);
    const message = game.id === 'spark'
      ? '好呀，只让一颗虚构的小火花在空气里啪地亮一下——纯文字玩具效果。'
      : game.id === 'dice'
        ? `骰子对决开始啦，输入 roll 掷一颗 ${game.parameters.sides} 面骰；没有筹码，也没有输赢惩罚。`
        : game.id === 'riddle'
          ? DEFINITIONS.riddle.question
          : `「${game.name}」开始啦。${game.rules}`;
    return {
      ok: true,
      ...publicSession(session),
      ...(game.custom ? { gameState: structuredClone(session.state), legalActions: legalActions(game) } : {}),
      message,
    };
  }

  function action({ sessionId, action: actionName, answer, payload = {} } = {}) {
    const session = getSession(sessionId);
    if (!session) return error('SESSION_NOT_FOUND', '游戏会话不存在或已过期。');
    if (session.status !== 'active') return error('SESSION_NOT_ACTIVE', '这局已经结束。');
    if (session.moves >= 100) return error('MOVE_LIMIT', '单局动作达到上限，请结束后重新开始。');
    const actionValue = String(actionName ?? '');

    if (session.gameId === 'spark') {
      if (actionValue !== 'spark') return error('ACTION_NOT_ALLOWED', '小火花只接受 spark 操作；拒绝或停止时请结束游戏。');
      session.moves++;
      const p = session.game.parameters;
      const sparks = randomInt(p.minSparks, p.maxSparks + 1);
      const glowLevel = randomInt(p.minGlowLevel, p.maxGlowLevel + 1);
      const cadenceMs = randomInt(p.minCadenceMs, p.maxCadenceMs + 1);
      const durationSec = randomInt(p.minDurationSec, p.maxDurationSec + 1);
      const cadence = cadenceMs < 700 ? '轻快地' : cadenceMs > 1300 ? '慢悠悠地' : '一闪一闪地';
      const glow = ['柔柔的微光', '明亮的闪光', '星芒般的亮闪'][glowLevel - 1];
      return { ok: true, ...publicSession(session), fictionalEffect: { sparks, glowLevel, cadenceMs, durationSec }, message: `啪——${sparks} 颗虚构小火花带着${glow}${cadence}在空气里闪了约 ${durationSec} 秒，像玩具特效一样散开。` };
    }
    if (session.gameId === 'dice') {
      if (actionValue !== 'roll') return error('ACTION_NOT_ALLOWED', '骰子对决只接受 roll 操作。');
      session.moves++;
      const sides = session.game.parameters.sides;
      const roll = Math.max(1, Math.min(sides, Number(randomInt(1, sides + 1)) || 1));
      return { ok: true, ...publicSession(session), roll, message: `骰子落定：${roll} 点。` };
    }
    if (session.gameId === 'riddle') {
      if (actionValue === 'hint') {
        session.moves++;
        return { ok: true, ...publicSession(session), hint: DEFINITIONS.riddle.hint };
      }
      if (actionValue !== 'answer') return error('ACTION_NOT_ALLOWED', '短谜题只接受 hint 或 answer 操作。');
      const answerText = String(answer ?? '').trim();
      if (!answerText || answerText.length > MAX_ANSWER_CHARS) return error('INVALID_ANSWER', `答案长度必须为 1 至 ${MAX_ANSWER_CHARS} 个字符。`);
      session.moves++;
      session.attempts++;
      const correctAnswers = new Set(DEFINITIONS.riddle.answers.map(cleanAnswer));
      const correct = correctAnswers.has(cleanAnswer(answerText));
      if (correct) session.status = 'completed';
      else if (session.attempts >= session.game.parameters.maxAttempts) session.status = 'completed';
      return {
        ok: true,
        ...publicSession(session),
        correct,
        attemptsRemaining: Math.max(0, session.game.parameters.maxAttempts - session.attempts),
        message: correct ? '猜对啦，答案是影子。' : session.status === 'completed' ? '这局结束啦，答案是影子。' : '还没猜中，可以再试或要一个提示。',
      };
    }
    if (session.game.custom) return applyCustomAction(session, actionName, payload);
    return error('UNKNOWN_GAME', '游戏类型不存在。');
  }

  function applyCustomAction(session, actionName, input) {
    const actionDef = session.game.actions.find(item => item.type === actionName);
    if (!actionDef) return error('ACTION_NOT_ALLOWED', '该动作不在游戏合法动作列表中。');
    const supplied = { ...input };
    const allowedInputs = new Set(actionDef.inputs.map(item => item.name));
    if (Object.keys(supplied).some(key => !allowedInputs.has(key))) return error('INVALID_ACTION', '动作包含未声明的输入字段。');
    for (const field of actionDef.inputs) {
      const value = supplied[field.name];
      if (field.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length > Number(field.maxLength ?? 80))) return error('INVALID_ACTION', `输入 ${field.name} 必须是 1 至 ${Number(field.maxLength ?? 80)} 个字符。`);
      if (field.type === 'number' && (!Number.isFinite(value) || value < field.min || value > field.max)) return error('INVALID_ACTION', `输入 ${field.name} 超出允许范围。`);
      if (field.type === 'choice' && !field.options.includes(value)) return error('INVALID_ACTION', `输入 ${field.name} 不在合法选项中。`);
    }
    const nextState = structuredClone(session.state);
    for (const effect of actionDef.effects) {
      if (effect.op === 'set') nextState[effect.field] = Object.hasOwn(effect, 'input') ? supplied[effect.input] : structuredClone(effect.value);
      else if (effect.op === 'increment') nextState[effect.field] = Math.max(effect.min, Math.min(effect.max, nextState[effect.field] + (effect.by ?? 1)));
      else if (effect.op === 'randomInt') nextState[effect.field] = randomInt(effect.min, effect.max + 1);
    }
    session.state = nextState;
    session.moves++;
    if (actionDef.endsGame) session.status = 'completed';
    return { ok: true, ...publicSession(session), gameState: structuredClone(session.state), message: actionDef.message || `已执行「${actionDef.label}」。` };
  }

  function status({ sessionId } = {}) {
    const session = getSession(sessionId);
    return session ? {
      ok: true,
      ...publicSession(session),
      ...(session.game.custom ? { gameState: structuredClone(session.state), legalActions: legalActions(session.game) } : {}),
    } : error('SESSION_NOT_FOUND', '游戏会话不存在或已过期。');
  }

  function stop({ sessionId } = {}) {
    const session = getSession(sessionId);
    if (!session) return error('SESSION_NOT_FOUND', '游戏会话不存在或已过期。');
    session.status = 'stopped';
    sessions.delete(session.id);
    return { ok: true, sessionId: session.id, gameId: session.gameId, status: 'stopped', message: '游戏已结束。' };
  }

  return { catalog, start, action, status, stop, get activeSessionCount() { purgeExpired(); return sessions.size; } };
}
