// 开机起床问候插件：桥接启动触发 reason=startupGreeting，文案要求由本插件产出。

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  // 冷却：桥接一天会因端口漂移/正常退出重启很多次，每次重启都冒一句就成了刷屏。
  // 默认同一会话 3 小时内只冒一次；设成 0 可关掉冷却。
  const cooldownMinutes = Number(cfg.cooldownMinutes ?? 180);
  const cooldownMs = Number.isFinite(cooldownMinutes) ? Math.max(0, cooldownMinutes) * 60000 : 180 * 60000;
  return {
    hooks: {
      beforePrompt(payload) {
        if (String(payload?.reason || '') !== 'startupGreeting') return '';
        const key = String(payload?.key || '');
        const state = ctx.state.get() || {};
        const now = Date.now();
        const lastAt = Number(state.lastAtByKey?.[key]) || 0;
        if (cooldownMs > 0 && lastAt && now - lastAt < cooldownMs) return '';
        const lastAtByKey = { ...(state.lastAtByKey || {}), [key]: now };
        if (Object.keys(lastAtByKey).length > 200) delete lastAtByKey[Object.keys(lastAtByKey)[0]];
        ctx.state.set({ lastAtByKey });
        const st = payload?.st || {};
        const where = key.startsWith('group:') ? '群里' : '私聊里';
        const unread = Array.isArray(st.unread) ? st.unread.length : 0;
        const hint = String(cfg.hint || '刚开机算刚睡醒：早安、还有点困、想喝牛奶').slice(0, 60);
        return [
          `【本轮开机起床｜${where}】桥接刚启动，你现在等于刚睡醒。`,
          `主动去${where}冒一句起床话（可用角度：${hint}）。`,
          '你在主动开口，不是在回复谁：换个说法别每次一样；不要接旧话题，不要用「你刚才/你按/你说」这种接话句式，也不要说「系统提示/我刚开机/桥接启动」这类词。',
          unread > 0 ? `注意：这里确实有 ${unread} 条未读，先正常回应它们，再补起床话。` : '1 条就够，轻松场合可以再配 1 张表情包。',
          '收尾按正常潜水规则。'
        ].join('\n');
      }
    }
  };
}
