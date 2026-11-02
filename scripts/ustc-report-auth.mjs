import {classifySnapshot} from './campus-browser-session.mjs';

export function reportAuthError(){
 return Object.assign(new Error('学术报告平台需要重新登录，请完成研究生平台统一身份认证'),{error_type:'auth'});
}

export async function assertReportAuthenticated(page){
 const url=page.url();
 if(/\/cas\/(?:login|auth)|\/yjsrzfwapp\/dbLogin\//i.test(url))throw reportAuthError();
 const snapshot=await page.evaluate(()=>({url:location.href,title:document.title,
  text:document.body?.innerText?.slice(0,2000)||'',password:!!document.querySelector('input[type="password"]')})).catch(()=>null);
 if(snapshot&&(snapshot.password||/^(登录|用户登录|统一身份认证|sign in)$/i.test(snapshot.title?.trim()||'')&&classifySnapshot(snapshot,url)==='login'||
  snapshot.title==='登录'&&/请选择认证方式|统一身份认证|本地认证/.test(snapshot.text)))throw reportAuthError();
}

export function assertReportResponse(response){
 const status=response.status();
 if(status===401)throw reportAuthError();
 if(status!==200)throw new Error('学术报告查询失败：HTTP '+status);
}
