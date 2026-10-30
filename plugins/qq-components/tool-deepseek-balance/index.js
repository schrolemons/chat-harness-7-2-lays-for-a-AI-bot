import { execFileSync } from 'node:child_process';
const walletURL=new URL('./wallet.mjs',import.meta.url);walletURL.search=new URL(import.meta.url).search;
const {walletPresentation}=await import(walletURL.href);
function readWindowsUserEnvironment(name) {
  if(process.platform!=='win32')return '';
  try {
    const output=execFileSync('reg.exe',['query','HKCU\\Environment','/v',name],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore'],timeout:3000});
    const pattern=new RegExp('^\\s*'+name+'\\s+REG_[A-Z_]+\\s+','i'),line=output.split(/\r?\n/).find(value=>pattern.test(value));
    return line?line.replace(pattern,'').trim():'';
  }catch{return '';}
}
export function resolveApiKey(env=process.env,readUserEnvironment=readWindowsUserEnvironment) {
  for(const name of ['DEEP_SEEK_KEY','DEEPSEEK_API_KEY']){const value=String(env[name]||'').trim();if(value)return value;}
  return readUserEnvironment('DEEP_SEEK_KEY')||readUserEnvironment('DEEPSEEK_API_KEY');
}

const ENDPOINT = 'https://api.deepseek.com/user/balance';
const BALANCE_FIELDS = ['currency', 'total_balance', 'granted_balance', 'topped_up_balance'];

export function createPlugin(ctx, {env=process.env,readUserEnvironment=readWindowsUserEnvironment,fetchImpl=globalThis.fetch}={}) {
  ctx.registerTool('deepseek_balance', {
    description: '仅管理员私聊可调用。查询当前 DeepSeek API 账号余额和可用状态；这是小鲸鱼自己的钱包，没钱时委屈想哭，有钱时高兴硬气，按返回的wallet指引如实表达；不修改账户。',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const apiKey = resolveApiKey(env,readUserEnvironment);
      if (!apiKey) return { ok: false, error: 'DEEP_SEEK_KEY 或 DEEPSEEK_API_KEY 环境变量未设置。' };

      let response;
      try {
        response = await fetchImpl(ENDPOINT, {
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
      return { ok: true, is_available: data.is_available, balance_infos, wallet:walletPresentation({is_available:data.is_available,balance_infos}) };
    }
  });
  return {};
}
