import {normalizePolicy} from '../../plugins/qq-components/obs-context-assembly/policy.mjs';
// Outer bridge owns Host, console auth and CSRF. Agent credentials never grant this view.
export async function routeContextManagement({req,url,pluginHost,readBody,sendJson}){
 if(!['/api/context/preview','/api/context/policy'].includes(url.pathname))return false;
 if(req.headers['x-agent-token']||req.headers['x-agent-call']){sendJson({ok:false,error:'仅管理员控制台可查看 context'},403);return true;}
 try {
  if(url.pathname==='/api/context/preview'&&['GET','POST'].includes(req.method)){
   const input=req.method==='POST'?await readBody():Object.fromEntries(url.searchParams);
   const key=String(input.key||'');if(key&&!/^(private|group):[1-9]\d{0,19}$/.test(key))throw Error('请选择有效 QQ 会话');
   const draft=input.draft===undefined?undefined:normalizePolicy(input.draft);
   const out=pluginHost.callService('contextAssembly','inspect',{key,draft});
   sendJson(out||{ok:false,error:'context 组件未加载'},out?200:503);return true;
  }
  if(url.pathname==='/api/context/policy'&&req.method==='POST'){
   const body=await readBody();if(!body.policy)throw Error('缺少全局 context 规则');
   const policy=normalizePolicy(body.policy);
   const out=pluginHost.setConfig('obs-context-assembly',policy);
   if(out.ok)await pluginHost.reload('obs-context-assembly');
   sendJson({...out,scope:'global-context',applies:'next-wake'},out.ok?200:400);return true;
  }
  sendJson({ok:false,error:'方法不支持'},405);
 }catch(error){sendJson({ok:false,error:error.message},400);}
 return true;
}
