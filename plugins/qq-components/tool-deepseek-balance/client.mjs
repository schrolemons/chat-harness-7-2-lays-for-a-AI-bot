import {execFileSync} from 'node:child_process';
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

export function createBalanceQuery({env=process.env,readUserEnvironment=readWindowsUserEnvironment,fetchImpl=globalThis.fetch,signal}={}){
 return async()=>{
  const apiKey=resolveApiKey(env,readUserEnvironment);if(!apiKey)return {ok:false,error:'DEEP_SEEK_KEY 或 DEEPSEEK_API_KEY 环境变量未设置。'};
  let response;try{response=await fetchImpl('https://api.deepseek.com/user/balance',{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+apiKey},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch{return {ok:false,error:'连接 DeepSeek 余额接口失败或请求超时。'};}
  if(!response.ok)return {ok:false,error:'DeepSeek 余额接口返回 HTTP '+response.status+'。'};
  let data;try{data=await response.json();}catch{return {ok:false,error:'DeepSeek 余额接口返回了无效 JSON。'};}
  if(typeof data?.is_available!=='boolean'||!Array.isArray(data.balance_infos))return {ok:false,error:'DeepSeek 余额接口响应缺少预期字段。'};
  const fields=['currency','total_balance','granted_balance','topped_up_balance'];
  return {ok:true,is_available:data.is_available,balance_infos:data.balance_infos.slice(0,8).map(row=>Object.fromEntries(fields.filter(field=>typeof row?.[field]==='string'&&row[field].length<=520).map(field=>[field,row[field]])))};
 };
}
