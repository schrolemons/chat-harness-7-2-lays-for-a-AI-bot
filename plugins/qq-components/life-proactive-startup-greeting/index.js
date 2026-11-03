// 启动问候问候插件：桥接启动触发 reason=startupGreeting，文案要求由本插件产出。

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  // 冷却：桥接一天会因端口漂移/正常退出重启很多次，每次重启都冒一句就成了刷屏。
  // 默认同一会话 3 小时内只冒一次；设成 0 可关掉冷却。
  const cooldownMinutes = Number(cfg.cooldownMinutes ?? 180);
  const cooldownMs = Number.isFinite(cooldownMinutes) ? Math.max(0, cooldownMinutes) * 60000 : 180 * 60000;
  const canGreet = (key, now = Date.now()) => {
    const lastAt = Number(ctx.state.get()?.lastAtByKey?.[String(key || '')]) || 0;
    return !(cooldownMs > 0 && lastAt && now - lastAt < cooldownMs);
  };
  return {
    // An empty beforePrompt result only removes this component's wording: the
    // wake-reasons component would still ask for a greeting. Veto the whole wake.
    canWake(payload = {}) {
      return payload.reason !== 'startupGreeting' || canGreet(payload.key);
    },
    services: {
      startupGreeting: {
        // The bridge reports accepted dispatch; assembling text is not delivery.
        markDispatched({ key, dispatchedAt = Date.now() } = {}) {
          key = String(key || '');
          const at = Number(dispatchedAt);
          if (!key || !Number.isFinite(at) || at <= 0) return { ok: false };
          const state = ctx.state.get() || {};
          const lastAtByKey = { ...(state.lastAtByKey || {}) };
          lastAtByKey[key] = Math.max(Number(lastAtByKey[key]) || 0, at);
          if (Object.keys(lastAtByKey).length > 200) delete lastAtByKey[Object.keys(lastAtByKey)[0]];
          ctx.state.set({ lastAtByKey });
          return { ok: true, dispatchedAt: lastAtByKey[key] };
        }
      }
    },
    hooks: {
      beforePrompt(payload) {
        if (String(payload?.reason || '') !== 'startupGreeting') return '';
        const key = String(payload?.key || '');
        if (!canGreet(key)) return '';
        const st = payload?.st || {};
        const where = key.startsWith('group:') ? '群里' : '私聊里';
        const unread = Array.isArray(st.unread) ? st.unread.filter(m => m?.replyDisposition !== 'history').length : 0;
        const hint = String(cfg.hint || '按当前时间简短问候，不声称有人发来消息').slice(0, 60);
        return [
          `【本轮启动问候｜${where}】桥接刚启动，本次为已授权的启动问候。`,
          `主动去${where}发一句简短问候（可用角度：${hint}）。`,
          '你在主动开口，不是在回复谁：换个说法别每次一样；不要接旧话题，不要用「你刚才/你按/你说」这种接话句式，也不要说「系统提示/我刚开机/桥接启动」这类词。',
          unread > 0 ? `注意：这里确实有 ${unread} 条未读，先正常回应它们，再补问候。` : '1 条就够，轻松场合可以再配 1 张表情包。',
          '收尾按正常潜水规则。'
        ].join('\n');
      }
    }
  };
}
