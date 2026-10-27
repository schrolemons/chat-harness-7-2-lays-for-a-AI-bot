// 健康巡检：每 5 分钟跑一次（宿主按 schedule.everyMs 触发 onTick），
// 调 collectHealth 能力汇总各组件状态，谁 stale 就告警 owner。
// 告警去重：同一批 30 分钟内只报一次，避免刷屏。
export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  return {
    hooks: {
      async onTick() {
        const collect = ctx.capabilities?.collectHealth;
        const notify = ctx.capabilities?.notifyOwner;
        if (typeof collect !== 'function') return;
        let health = {};
        try { health = (await collect()) || {}; } catch { return; }
        const stale = [];
        for (const [name, h] of Object.entries(health)) {
          if (h && h.stale) stale.push(`${name}：${h.hint || '掉线'}`);
        }
        if (!stale.length) return;
        if (typeof notify !== 'function') return;
        const st = ctx.state.get();
        const lastAt = Number(st.lastAlertAt) || 0;
        const cooldown = Math.max(60000, Number(cfg.staleAlertCooldownMs) || 1800000);
        if (Date.now() - lastAt < cooldown) return;
        if ((await notify('⚠️ 组件掉线巡检\n' + stale.join('\n'))) === true) ctx.state.set({ lastAlertAt: Date.now(), lastStale: stale });
      }
    }
  };
}
