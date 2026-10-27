// 浏览器管理插件（E 层）：双模 —— 无头监控/操控 + 可见窗口做关键授权。
//
// 语义（管理员明确）：
//   · 监控、操控、只读抓取 → 无头（headless），复用本机登录态，不重登；
//   · 需要激活登录态或关键授权（登录、验证码、购物结算、支付确认）→ 弹出可见窗口，让用户看到并亲自操作。
// 实际浏览器动作仍走 Playwright MCP（真实 Edge + puppeteer-core），本插件管口径与切换策略。

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const rules = Array.isArray(cfg.rules) && cfg.rules.length ? cfg.rules.map(String).filter(Boolean).slice(0, 12) : [];
  const headlessFor = String(cfg.headlessFor || 'monitor|automate|scrape-readonly');
  const visibleFor = String(cfg.visibleFor || 'login|auth|purchase|checkout|captcha|payment-confirm');
  const allowUrls = Array.isArray(cfg.allowUrls) ? cfg.allowUrls.map(String).filter(Boolean) : [];
  const blockUrls = Array.isArray(cfg.blockUrls) ? cfg.blockUrls.map(String).filter(Boolean) : [];

  ctx.registerTool('browser_policy', {
    description: '查询浏览器双模策略（哪些走无头、哪些弹可见窗口）',
    handler: () => ({ ok: true, mode: 'dual', headlessFor, visibleFor, allowUrls, blockUrls, rules })
  });

  return {
    hooks: {
      beforePrompt(payload) {
        const hit = /(浏览器|网页|网站|抓取|登录|验证码|购物|支付|风控|无头)/.test(String(payload?.incomingText || '') + String(payload?.reason || ''));
        if (!hit) return '';
        return [
          '【浏览器使用｜双模】',
          `- 无头（headless）：${headlessFor} —— 复用本机登录态，不自动填账号密码，不重登。`,
          `- 可见窗口（用户操作）：${visibleFor} —— 停下来让用户自己完成，你只负责把窗口打开、指到这一步。`,
          `- 允许访问的网址：${allowUrls.join('、') || '未设置'}。禁止访问的网址：${blockUrls.join('、') || '未设置'}。`,
          ...rules.map((r) => '- ' + r),
          '切换原则：拿不准是不是“关键授权”时，宁可弹可见窗口，也不要在无头里替用户点。'
        ].join('\n');
      }
    }
  };
}
