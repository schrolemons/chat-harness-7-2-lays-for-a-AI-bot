// life-relay-message（L 层｜传话组件）
//
// 把「给 XX 带句话 / 问问你们管理员」这类跑腿请求从桥接主程序里抽出来：
//   · 意图解析：src/relay-intent.js（纯函数，带单测）
//   · 目标解析：桥接能力 resolveRelayTarget（白名单 + 别名表 + 管理员角色称呼）
//   · 内容闸门/限频/发送：桥接能力 relaySend（环境能力，组件不直连 QQ）
//   · pending 状态：本插件自己的 state/plugins/life-relay-message.json
//
// 桥接只做两件事：把入站消息交给本组件（relayIncoming），拿到 handled 就跳过 AI 回合。
// 这样「传话」= 可插拔组件：能在插件管理页启停、有自己的 skill.md、改规则不用动 bridge。

import { parseRelayCommand } from '../../../src/relay-intent.js';

const PENDING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MIN_INTERVAL_MIN = 10;
const HANDLED_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
const HANDLED_MESSAGE_LIMIT = 300;
const STANDALONE_ACTION_RE = /(?:去群里|群里).*(?:电|戳|拍)|(?:电电|电一下|戳一戳|拍一拍)|^(?:问问|问一下|帮我问|查一下|看看|去群里)/;
const LINK_TTL_MS = 10 * 60 * 1000;

export function createPlugin(ctx) {
  const cap = ctx.capabilities || {};
  const minIntervalMin = Math.max(1, Math.min(1440, Number((ctx.config || {}).minIntervalMin) || DEFAULT_MIN_INTERVAL_MIN));
  const minIntervalMs = minIntervalMin * 60 * 1000;

  function readPending() {
    const st = ctx.state.get();
    return st && st.pending && typeof st.pending === 'object' ? st.pending : {};
  }
  function writePending(pending) {
    ctx.state.set({ pending });
  }

  function readPendingLinks() {
    const st = ctx.state.get();
    return st && st.pendingLinks && typeof st.pendingLinks === 'object' ? st.pendingLinks : {};
  }
  function writePendingLinks(pendingLinks) { ctx.state.set({ pendingLinks }); }

  const normalizeName = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  function isLinkedAlias(name) {
    try {
      if (typeof cap.isRelayAliasLinked === 'function') return cap.isRelayAliasLinked(String(name || '')) === true;
      return !!resolveTarget(name);
    } catch { return false; }
  }
  async function searchContacts(query) {
    if (typeof cap.searchRelayContacts !== 'function') return [];
    try {
      const result = await cap.searchRelayContacts({ query: String(query || '') });
      return Array.isArray(result) ? result : Array.isArray(result?.contacts) ? result.contacts : [];
    } catch (error) {
      ctx.warn('联系人搜索失败：' + (error?.message ?? error));
      return [];
    }
  }
  function contactCandidates(query, contacts) {
    const q = normalizeName(query);
    if (!q) return [];
    const byTarget = new Map();
    for (const contact of contacts) {
      const targetKey = String(contact?.targetKey || (contact?.userId ? 'private:' + contact.userId : ''));
      const userId = String(contact?.userId || /^private:(\d+)$/.exec(targetKey)?.[1] || '');
      if (!/^private:\d+$/.test(targetKey) || !/^\d{5,12}$/.test(userId)) continue;
      const labels = [contact.nickname, contact.remark, contact.card].map(normalizeName).filter(Boolean);
      let score = 0;
      for (const label of labels) {
        if (label === q) score = Math.max(score, 100);
        else if (label.includes(q)) score = Math.max(score, 70);
        else if (q.includes(label) && label.length >= 2) score = Math.max(score, 45);
      }
      if (!score) continue;
      const old = byTarget.get(targetKey);
      if (!old || score > old.score) byTarget.set(targetKey, { targetKey, userId, nickname: String(contact.nickname || contact.remark || userId), remark: String(contact.remark || ''), score });
    }
    const ranked = [...byTarget.values()].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
    if (!ranked.length) return [];
    const best = ranked[0].score;
    return ranked.filter((contact) => contact.score === best).slice(0, 5);
  }

  function parseRelayText(text, contacts) {
    const resolver = (name) => {
      if (isLinkedAlias(name)) return !!resolveTarget(name);
      const q = normalizeName(name);
      return !!q && contacts.some((contact) => [contact.nickname, contact.remark].some((label) => normalizeName(label) === q));
    };
    let command = parseRelayCommand(text, { resolve: resolver });
    // “问问成员乙醒没醒”一类弱意图没有标点边界：先把常见问句尾语切开，
    // 然后按近似联系人搜索并确认；不会把模糊称呼直接当作收件人。
    if (command?.weak && !command.content) {
      const rest = String(text || '').trim().replace(/^(?:嗯|哦|诶|欸|哎|唉|好|行|那|对了|顺便|帮我|请你|请|问问|问一下|问下|问一问|打听一下|打听打听)+\s*/, '');
      const suffix = /(醒没醒|醒了吗|醒了没|醒了没有|睡没睡|睡了吗|吃了没|吃了吗|吃了没有|在吗|在不在|回来了吗|回来了没|到家了吗|到家没|忙吗|有空吗)[？?。！!]*$/u.exec(rest);
      if (suffix && rest.length > suffix[0].length) command = { name: rest.slice(0, -suffix[0].length).trim(), content: suffix[1], weak: true };
    }
    return command;
  }

  function claimIncomingMessage(key, messageId) {
    if (messageId == null || String(messageId).trim() === '') return true;
    const id = String(messageId);
    const now = Date.now();
    const state = ctx.state.get() || {};
    const old = Array.isArray(state.handledRelayMessages) ? state.handledRelayMessages : [];
    const recent = old.filter((entry) => entry && now - Number(entry.at || 0) < HANDLED_MESSAGE_TTL_MS);
    const fingerprint = key + '\u0000' + id;
    if (recent.some((entry) => entry.fingerprint === fingerprint)) return false;
    recent.push({ fingerprint, at: now });
    ctx.state.set({ handledRelayMessages: recent.slice(-HANDLED_MESSAGE_LIMIT) });
    return true;
  }

  async function sendText(key, text) {
    if (typeof cap.sendSessionText !== 'function') return false;
    try { return await cap.sendSessionText(key, text); } catch (error) { ctx.warn('传话提示发送失败：' + (error?.message ?? error)); return false; }
  }

  function deliver(fromKey, targetKey, name, body, isOwner, imageIds = []) {
    if (typeof cap.relaySend !== 'function') {
      ctx.warn('桥接未提供 relaySend 能力，传话无法执行');
      return false;
    }
    if (!isOwner) {
      const st = ctx.state.get() || {};
      const lastRelayAt = st.lastRelayAt && typeof st.lastRelayAt === 'object' ? st.lastRelayAt : {};
      const elapsed = Date.now() - Number(lastRelayAt[fromKey] || 0);
      if (elapsed < minIntervalMs) {
        void sendText(fromKey, '传话间隔还差 ' + Math.ceil((minIntervalMs - elapsed) / 60000) + ' 分钟，请稍后再发。');
        return false;
      }
      ctx.state.set({ lastRelayAt: { ...lastRelayAt, [fromKey]: Date.now() } });
    }
    Promise.resolve().then(() => cap.relaySend({ fromKey, targetKey, name, body, imageIds }))
      .catch((error) => ctx.warn('传话发送失败：' + (error?.message ?? error)));
    return true;
  }

  function resolveTarget(name) {
    if (typeof cap.resolveRelayTarget !== 'function') return null;
    try { return cap.resolveRelayTarget(String(name || '')) || null; } catch { return null; }
  }

  function handled(payload, result) {
    try { payload?.onHandled?.(result); } catch (error) { ctx.warn('标记传话原消息失败：' + (error?.message ?? error)); }
    return { handled: true, ...result };
  }

  return {
    hooks: {
      async relayIncoming(payload) {
        if (!payload || payload.allowed !== true) return null;
        const key = String(payload.key || '');
        const text = String(payload.plainContent || '').trim();
        const imageIds = Array.isArray(payload.imageIds) ? payload.imageIds.slice(0,5) : [];
        if (!key || (!text && !imageIds.length)) return null;

        const pending = readPending();
        let pr = pending[key] && typeof pending[key] === 'object' ? pending[key] : null;
        const pendingLinks = readPendingLinks();
        let link = pendingLinks[key] && typeof pendingLinks[key] === 'object' ? pendingLinks[key] : null;
        const now = Date.now();
        const claim = () => claimIncomingMessage(key, payload.messageId);
        const duplicate = () => handled(payload, { action: 'duplicate-ignored' });
        const clearLink = () => { delete pendingLinks[key]; writePendingLinks(pendingLinks); link = null; };
        const clearContentPending = () => { delete pending[key]; writePending(pending); pr = null; };
        const matchesNumber = (value) => /^(?:(?:private|group):)?\d{5,12}$/.test(String(value || '').trim());
        const toTargetKey = (value) => {
          const raw = String(value || '').trim();
          const resolved = resolveTarget(raw);
          return resolved && resolved !== key ? resolved : null;
        };
        const promptLinkConfirm = (entry) => {
          const shownName = entry.nickname || entry.remark || entry.userId;
          void sendText(key, '我在 QQ 联系人里找到「' + shownName + '」，QQ 号是 ' + entry.userId + '。你说的「' + entry.alias + '」是这个人吗？回复“确认”后我会建立这个称呼和 QQ 的链接，再转达原话；回复“取消”不会发送。');
        };
        const finishLinkedRelay = async (entry) => {
          let linked;
          try {
            linked = typeof cap.linkRelayAlias === 'function'
              ? await cap.linkRelayAlias({ alias: entry.alias, targetKey: entry.targetKey, nickname: entry.nickname, userId: entry.userId })
              : { ok: false, error: '桥接暂不支持保存昵称链接' };
          } catch (error) { linked = { ok: false, error: error?.message ?? String(error) }; }
          if (!linked?.ok) {
            void sendText(key, '昵称链接没有保存成功，所以我没有转达。你可以再确认一次，或先给我 QQ 号。');
            ctx.warn('保存传话别名失败：' + String(linked?.error || 'unknown'));
            return handled(payload, { action: 'alias-link-failed' });
          }
          clearLink();
          clearContentPending();
          if (entry.content || (entry.imageIds || []).length) {
            deliver(key, entry.targetKey, entry.alias, entry.content, payload.isOwner === true, entry.imageIds || []);
            return handled(payload, { action: 'relay', target: entry.targetKey, aliasLinked: true });
          }
          pending[key] = { target: entry.targetKey, name: entry.alias, awaitingContent: true, at: Date.now() };
          writePending(pending);
          void sendText(key, '已把「' + entry.alias + '」链接到 QQ ' + entry.userId + '。下一条消息发传话内容，我再转达。');
          return handled(payload, { action: 'await-content', target: entry.targetKey, aliasLinked: true });
        };

        if (link && now - Number(link.at || 0) > LINK_TTL_MS) { clearLink(); link = null; }
        if (link) {
          if (/^(?:取消|算了|不是|不对|否|no|不要|别发)[！!。\s]*$/i.test(text)) {
            if (!claim()) return duplicate();
            clearLink();
            void sendText(key, '好，已取消；我没有转达。');
            return handled(payload, { action: 'alias-link-cancelled' });
          }
          if (/^(?:确认|是|对|没错|可以|就是他|就是她|就是这个|嗯|好|yes|y)[！!。\s]*$/i.test(text)) {
            if (!link.targetKey || link.phase !== 'confirm') {
              void sendText(key, '我还没有确定 QQ 号；请先给我 QQ 号，或回复候选列表里的号码。');
              return handled(payload, { action: 'await-target' });
            }
            if (!claim()) return duplicate();
            return finishLinkedRelay(link);
          }
          if (link.phase === 'choose' || link.phase === 'number') {
            const targetKey = matchesNumber(text) ? toTargetKey(text) : null;
            if (targetKey) {
              if (!claim()) return duplicate();
              const userId = targetKey.slice(targetKey.indexOf(':') + 1);
              const selected = (link.candidates || []).find((candidate) => candidate.targetKey === targetKey);
              const candidate = selected || { targetKey, userId, nickname: userId, remark: '' };
              link = { ...link, phase: 'confirm', targetKey, userId, nickname: candidate.nickname, remark: candidate.remark, at: now };
              pendingLinks[key] = link; writePendingLinks(pendingLinks);
              promptLinkConfirm(link);
              return handled(payload, { action: 'await-alias-confirmation', target: targetKey });
            }
            // 非号码回复通常是新话题；释放旧链接状态，再按新消息处理。
            clearLink();
            link = null;
          } else if (link.phase === 'confirm' && matchesNumber(text)) {
            const targetKey = toTargetKey(text);
            if (targetKey) {
              if (!claim()) return duplicate();
              const userId = targetKey.slice(targetKey.indexOf(':') + 1);
              link = { ...link, targetKey, userId, nickname: userId, at: now };
              pendingLinks[key] = link; writePendingLinks(pendingLinks);
              promptLinkConfirm(link);
              return handled(payload, { action: 'await-alias-confirmation', target: targetKey });
            }
          } else if (link.phase === 'content') {
            if (STANDALONE_ACTION_RE.test(text)) { clearLink(); link = null; }
            else {
              if (!claim()) return duplicate();
              link.content = text || '[图片]';
              return finishLinkedRelay(link);
            }
          } else if (!parseRelayCommand(text, { resolve: (name) => !!resolveTarget(name) })) {
            clearLink();
            link = null;
          }
        }

        // 1) 新的传话命令优先（即使上一条 pending 还没完成）
        const relayLead = /^(?:嗯|哦|诶|欸|哎|唉|好|行|那|对了|顺便|帮我|请你|请|给|跟|和|对|向|传话|捎话|带话|递话|转告|转达|告诉|通知|问问|问一下|问下|问一问|打听)/u.test(text);
        const contacts = relayLead ? await searchContacts('') : [];
        const cmd = parseRelayText(text, contacts);
        if (cmd) {
          const target = resolveTarget(cmd.name);
          const content = String(cmd.content || '').trim();
          const linked = isLinkedAlias(cmd.name);
          const explicitId = matchesNumber(cmd.name) || /^(?:private|group):\d+$/.test(cmd.name);
          const explicitRole = /^(?:管理员|管理猿|老板|主人|群主|owner|admin|站长)$/i.test(cmd.name);
          if (target && target !== key && (linked || explicitId || explicitRole)) {
            if (!claim()) return duplicate();
            clearContentPending();
            clearLink();
            if (content || imageIds.length) {
              deliver(key, target, cmd.name, content, payload.isOwner === true, imageIds);
              return handled(payload, { action: 'relay', target });
            }
            pending[key] = { target, name: cmd.name, awaitingContent: true, at: now };
            writePending(pending);
            void sendText(key, '好，我帮你传给「' + cmd.name + '」。下一条消息直接发内容，我原样转达。');
            ctx.log('等待传话内容 -> ' + target);
            return handled(payload, { action: 'await-content', target });
          }

          let candidates = contactCandidates(cmd.name, contacts);
          // 曾聊过的私聊昵称也是搜索结果；它仍须由管理员确认一次才成为链接。
          if (!candidates.length && target && target !== key && /^private:\d+$/.test(target)) {
            const userId = target.slice('private:'.length);
            candidates = [{ targetKey: target, userId, nickname: cmd.name, remark: '', score: 50 }];
          }
          if (candidates.length) {
            if (!claim()) return duplicate();
            clearContentPending();
            if (candidates.length > 1) {
              link = { phase: 'choose', alias: cmd.name, content, imageIds, candidates, at: now };
              pendingLinks[key] = link; writePendingLinks(pendingLinks);
              const options = candidates.map((candidate) => '「' + candidate.nickname + '」QQ ' + candidate.userId).join('；');
              void sendText(key, '我找到多个相近联系人：' + options + '。请回复你要找的 QQ 号；我会再请你确认昵称链接，确认前不会传话。');
              return handled(payload, { action: 'await-target-choice', candidates: candidates.length });
            }
            const candidate = candidates[0];
            link = {
              phase: 'confirm', alias: cmd.name, targetKey: candidate.targetKey,
              userId: candidate.userId, nickname: candidate.nickname, remark: candidate.remark,
              content, imageIds, candidates, at: now
            };
            pendingLinks[key] = link; writePendingLinks(pendingLinks);
            promptLinkConfirm(link);
            return handled(payload, { action: 'await-alias-confirmation', target: candidate.targetKey, candidates: candidates.length });
          }
          if (cmd.weak && !content) {
            clearContentPending();
            return null;
          }
          if (!claim()) return duplicate();
          clearContentPending();
          link = { phase: 'number', alias: cmd.name, content, imageIds, candidates: [], at: now };
          pendingLinks[key] = link; writePendingLinks(pendingLinks);
          void sendText(key, '我暂时没搜到「' + cmd.name + '」对应的 QQ 联系人。请给我 QQ 号或准确昵称；我会先展示号码请你确认，确认并建立链接前不会传话。');
          ctx.log('传话联系人未命中，等待 QQ 号并确认别名：' + cmd.name);
          return handled(payload, { action: 'await-target', name: cmd.name });
        }

        // 新对话会替换旧的内容 pending，避免“电一下”等动作被当成传话正文。
        if (link && STANDALONE_ACTION_RE.test(text)) { clearLink(); link = null; }

        // 2) 上一条待补充的传话
        if (pr) {
          if (now - Number(pr.at || 0) > PENDING_TTL_MS) {
            delete pending[key];
            writePending(pending);
            return null;
          }
          if (pr.target && pr.awaitingContent) {
            if (STANDALONE_ACTION_RE.test(text)) {
              delete pending[key];
              writePending(pending);
              return null;
            }
            if (!claim()) return duplicate();
            delete pending[key];
            writePending(pending);
            deliver(key, pr.target, pr.name, text || '[图片]', payload.isOwner === true, imageIds);
            return handled(payload, { action: 'relay-pending-content', target: pr.target });
          }
          if (!pr.target) {
            // 目标未解析时只把明确的 QQ/群号当作补充；普通句子属于新消息，
            // 清掉旧上下文并交给正常对话，避免把「电电成员乙」误当成目标输入。
            if (!/^(?:(?:private|group):)?\d{5,12}$/.test(text)) {
              delete pending[key];
              writePending(pending);
              return null;
            }
            const target = resolveTarget(text);
            if (target && target !== key) {
              if (!claim()) return duplicate();
              const content = String(pr.content || '').trim();
              delete pending[key];
              writePending(pending);
              if (content) {
                deliver(key, target, pr.name, content, payload.isOwner === true);
                return handled(payload, { action: 'relay-pending-target', target });
              }
              pending[key] = { target, name: pr.name, awaitingContent: true, at: now };
              writePending(pending);
              void sendText(key, '目标找到了：' + target + '。下一条消息发内容，我转达。');
              return handled(payload, { action: 'await-content', target });
            }
            if (!claim()) return duplicate();
            void sendText(key, '还是没对上人。给我 QQ 号或群号（例：608），或者先说「给 608 带句话」。');
            return handled(payload, { action: 'await-target-retry' });
          }
        }
        return null;
      }
    }
  };
}
