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

  return {
    hooks: {
      relayIncoming(payload) {
        if (!payload || payload.allowed !== true) return null;
        const key = String(payload.key || '');
        const text = String(payload.plainContent || '').trim();
        const imageIds = Array.isArray(payload.imageIds) ? payload.imageIds.slice(0, 5) : [];
        if (!key || (!text && imageIds.length === 0)) return null;

        const pending = readPending();
        const pr = pending[key] && typeof pending[key] === 'object' ? pending[key] : null;
        const now = Date.now();

        // 1) 新的传话命令优先（即使上一条 pending 还没完成）
        const cmd = parseRelayCommand(text, { resolve: (name) => !!resolveTarget(name) });
        if (cmd) {
          const target = resolveTarget(cmd.name);
          const content = String(cmd.content || '').trim();
          if (target && target !== key) {
            delete pending[key];
            writePending(pending);
            if (content || imageIds.length) {
              const queued = deliver(key, target, cmd.name, content, payload.isOwner === true, imageIds);
              return queued ? { handled: true, action: 'relay', target } : { handled: true, action: 'relay-rate-limited', target };
            }
            pending[key] = { target, name: cmd.name, awaitingContent: true, at: now };
            writePending(pending);
            void sendText(key, '好，我帮你传给「' + cmd.name + '」。下一条消息直接发内容，我原样转达。');
            ctx.log('等待传话内容 -> ' + target);
            return { handled: true, action: 'await-content', target };
          }
          if (!cmd.weak) {
            // 强意图但解析不到人：记住名字/内容，等 QQ 号
            pending[key] = { name: cmd.name, content, at: now };
            writePending(pending);
            void sendText(key, content
              ? '没找到「' + cmd.name + '」，给我 QQ 号或群号，我把「' + content.slice(0, 20) + '…」传过去。'
              : '没找到「' + cmd.name + '」，给我 QQ 号或群号（例：123456789）。');
            ctx.log('传话目标未解析，等待 QQ 号：' + cmd.name);
            return { handled: true, action: 'await-target', name: cmd.name };
          }
          // 弱意图（问问/问一下）解析不到人：不拦，当普通聊天
          return null;
        }

        // 2) 上一条待补充的传话
        if (pr) {
          if (now - Number(pr.at || 0) > PENDING_TTL_MS) {
            delete pending[key];
            writePending(pending);
            return null;
          }
          if (pr.target && pr.awaitingContent) {
            delete pending[key];
            writePending(pending);
            deliver(key, pr.target, pr.name, text, payload.isOwner === true, imageIds);
            return { handled: true, action: 'relay-pending-content', target: pr.target };
          }
          if (!pr.target) {
            const target = resolveTarget(text);
            if (target && target !== key) {
              const content = String(pr.content || '').trim();
              delete pending[key];
              writePending(pending);
              if (content || imageIds.length) {
                deliver(key, target, pr.name, content, payload.isOwner === true, imageIds);
                return { handled: true, action: 'relay-pending-target', target };
              }
              pending[key] = { target, name: pr.name, awaitingContent: true, at: now };
              writePending(pending);
              void sendText(key, '目标找到了：' + target + '。下一条消息发内容，我转达。');
              return { handled: true, action: 'await-content', target };
            }
            void sendText(key, '还是没对上人。给我 QQ 号或群号（例：123456789），或者先说「给 123456789 带句话」。');
            return { handled: true, action: 'await-target-retry' };
          }
        }
        return null;
      }
    }
  };
}
