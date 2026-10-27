// ctx-member-card（C 层｜上下文管理：人物小档案）
//
// 机主诉求：像参考项目那样给每个人一张「小档案」，让我在称呼、偏好、雷点上不用每轮现猜。
// 数据来源：state/user-profiles.json（桥接已经在维护的画像库，含 names / notes / fields）。
//
// 策略：
//   · 只看当前会话最近说话的人（unread + recentMessages 的发送者），按 lastSeenAt 倒序；
//   · 每人一张卡，最多 maxCards 张、每张最多 maxNotes 条最近记录；
//   · 群聊里同一个人只出现一次；总长受 maxChars 控制，超了就少放几张，绝不截半句。
//   · 本人明确分享的作息（三餐时间＋口味、起床/入睡、工作上课时段）只在该用户的私聊里单独成块。

import fs from 'node:fs';
import path from 'node:path';
import { routineBlockLines } from '../../../src/user-routines.js';

function readProfiles(root) {
  try {
    const file = path.join(root, 'state', 'user-profiles.json');
    const raw = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj.users === 'object' ? obj.users : {};
  } catch {
    return {};
  }
}

function sendersOf(st) {
  const out = [];
  const push = (m) => {
    if (!m || m.isSelf) return;
    const id = String(m.userId || m.user_id || '').trim();
    if (/^\d+$/.test(id)) out.push(id);
  };
  if (Array.isArray(st?.unread)) st.unread.forEach(push);
  if (Array.isArray(st?.recentMessages)) st.recentMessages.forEach(push);
  return out;
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export function createPlugin(ctx) {
  const root = ctx.root || process.cwd();
  const cfg = () => ctx.config || {};

  function buildCard(profile, opts) {
    const names = Array.isArray(profile.names) ? profile.names.filter(Boolean) : [];
    const display = names[0] || profile.userId || '某人';
    const aliases = names.slice(1, 4);
    const bits = [];
    if (aliases.length) bits.push('也叫' + aliases.join('、'));
    const count = Number(profile.messageCount) || 0;
    if (count > 0) bits.push(`聊过 ${count} 条`);
    if (profile.isOwner) bits.push('是主人');
    if (opts.showWarmConnection && Number(profile.warmConnectionAt) > 0) bits.push('小鲸鱼对他有亲近感');

    const notes = (Array.isArray(profile.notes) ? profile.notes : [])
      .map((n) => String(n && n.text ? n.text : n || '').trim())
      .filter(Boolean)
      .slice(-Math.max(1, opts.maxNotes));

    const fields = profile.fields && typeof profile.fields === 'object' ? profile.fields : {};
    const likes = Array.isArray(fields.likes) ? fields.likes.filter(Boolean).slice(0, 2) : [];
    const dislikes = Array.isArray(fields.dislikes) ? fields.dislikes.filter(Boolean).slice(0, 2) : [];
    const quotes = Array.isArray(fields.quotes) ? fields.quotes.filter(Boolean).slice(-1) : [];
    const routines = Array.isArray(fields.routines) ? fields.routines.filter(Boolean) : [];
    if (likes.length) bits.push('喜欢' + likes.join('、'));
    if (dislikes.length) bits.push('不喜欢' + dislikes.join('、'));
    if (quotes.length) bits.push('说过「' + clip(quotes[0], 30) + '」');

    // 固定「作息」块：只在这个人自己的私聊里出现；有数据才出现，空的不占位、不输出占位符。
    const routineLines = opts.showPrivateRoutine ? routineBlockLines(routines, { fields }).slice(0, 8) : [];
    const routineBlock = routineLines.length
      ? '\n  〔作息·仅本私聊〕' + routineLines.map((line) => '\n    · ' + clip(line, 60)).join('')
      : '';

    const head = `- ${display}${bits.length ? '（' + bits.join('；') + '）' : ''}`;
    const noteLine = notes.length ? '\n  · ' + notes.map((n) => clip(n, 46)).join('\n  · ') : '';
    return head + routineBlock + noteLine;
  }

  /** 控制台用：按会话 key 预览会挑哪几个人、卡片原文 */
  function preview(key, st) {
    const c = cfg();
    const profiles = readProfiles(root);
    const fake = st && typeof st === 'object' ? st : null;
    let ids = fake ? sendersOf(fake) : [];
    if (!ids.length && key) {
      ids = Object.values(profiles)
        .filter((p) => Array.isArray(p.keys) && p.keys.includes(String(key)))
        .sort((a, b) => (Number(b.lastSeenAt) || 0) - (Number(a.lastSeenAt) || 0))
        .map((p) => String(p.userId || ''));
    }
    const seen = new Set();
    const opts = { maxNotes: Math.max(1, Number(c.maxNotes) || 2) };
    const cards = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = profiles['u:' + id];
      if (!p) continue;
      if (p.isOwner && c.skipOwner) continue;
      cards.push({
        userId: id,
        text: buildCard(p, {
          ...opts,
          showWarmConnection: String(key).startsWith('group:'),
          showPrivateRoutine: String(key) === 'private:' + id
        })
      });
    }
    return {
      ok: true,
      key: String(key || ''),
      maxCards: Math.max(1, Number(c.maxCards) || 3),
      maxChars: Math.max(200, Number(c.maxChars) || 900),
      picked: cards.map((x) => x.userId).slice(0, Math.max(1, Number(c.maxCards) || 3)),
      cards: cards.slice(0, Math.max(1, Number(c.maxCards) || 3))
    };
  }

  // 控制台可用 /api/plugins/call 调：{ tool: "member_card", input: { key } }
  if (typeof ctx.registerTool === 'function') {
    ctx.registerTool('member_card', {
      description: '预览「人物小档案」：按会话 key 或当前会话最近说话的人，返回会注入哪几张卡、卡片原文。',
      schema: {
        type: 'object',
        properties: { key: { type: 'string', description: '私聊 private:QQ号 / 群 group:群号' } }
      },
      handler: (input = {}) => preview(input.key, input.st)
    });
  }

  return {
    services: { memberCard: { preview } },
    hooks: {
      beforePrompt(payload = {}) {
        const c = cfg();
        if (c.enabled === false) return '';
        const key = String(payload.key || '');
        if (!key) return '';
        if (!c.includeGroups && key.startsWith('group:')) return '';

        const profiles = readProfiles(root);
        if (!profiles || !Object.keys(profiles).length) return '';

        const seen = new Set();
        const picked = [];
        for (const id of sendersOf(payload.st)) {
          if (seen.has(id)) continue;
          seen.add(id);
          const p = profiles['u:' + id];
          if (!p) continue;
          if (p.isOwner && c.skipOwner) continue;
          picked.push(p);
        }
        if (!picked.length) return '';

        picked.sort((a, b) => (Number(b.lastSeenAt) || 0) - (Number(a.lastSeenAt) || 0));
        const maxCards = Math.max(1, Number(c.maxCards) || 3);
        const maxChars = Math.max(200, Number(c.maxChars) || 900);
        const opts = { maxNotes: Math.max(1, Number(c.maxNotes) || 2) };

        const lines = [];
        let used = 0;
        for (const p of picked.slice(0, maxCards)) {
          const card = buildCard(p, { ...opts, showWarmConnection: key.startsWith('group:'), showPrivateRoutine: key === 'private:' + String(p.userId || '') });
          if (used + card.length > maxChars) break;
          lines.push(card);
          used += card.length;
        }
        if (!lines.length) return '';
        return '【人物小档案】这几个人最近说过话，称呼和偏好可以直接用，不用现问。'
          + '作息块（三餐时间＋口味、起床/入睡、工作上课时段）只在该用户自己的私聊里出现：只按本人明确说过的时间，到点附近可以顺口贴合一句，不催吃饭、不催睡觉、不说教，不假定对方有空，刚聊完不叠加；临时变动只写当前会话轻量记忆，不改稳定作息；绝不跨会话、绝不在群里提他的作息。\n'
          + lines.join('\n');
      }
    }
  };
}
