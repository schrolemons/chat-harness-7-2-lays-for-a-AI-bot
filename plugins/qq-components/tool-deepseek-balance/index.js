const ENDPOINT = 'https://api.deepseek.com/user/balance';
const BALANCE_FIELDS = ['currency', 'total_balance', 'granted_balance', 'topped_up_balance'];

export function createPlugin(ctx) {
  ctx.registerTool('deepseek_balance', {
    description: '仅管理员私聊可调用。查询当前 DeepSeek API 账号余额和可用状态；不修改账户。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const apiKey = String(process.env.DEEP_SEEK_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
      if (!apiKey) return { ok: false, error: 'DEEP_SEEK_KEY 或 DEEPSEEK_API_KEY 环境变量未设置。' };

      let response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15000)
        });
      } catch {
        return { ok: false, error: '连接 DeepSeek 余额接口失败或请求超时。' };
      }
      if (!response.ok) return { ok: false, error: `DeepSeek 余额接口返回 HTTP ${response.status}。` };

      let data;
      try { data = await response.json(); }
      catch { return { ok: false, error: 'DeepSeek 余额接口返回了无效 JSON。' }; }
      if (typeof data?.is_available !== 'boolean' || !Array.isArray(data?.balance_infos)) {
        return { ok: false, error: 'DeepSeek 余额接口响应缺少预期字段。' };
      }
      const balance_infos = data.balance_infos.map((item) => Object.fromEntries(
        BALANCE_FIELDS.filter((field) => typeof item?.[field] === 'string').map((field) => [field, item[field]])
      ));
      return { ok: true, is_available: data.is_available, balance_infos };
    }
  });
  return {};
}
