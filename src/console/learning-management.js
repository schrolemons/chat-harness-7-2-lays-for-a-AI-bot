// Authenticated transport; scope, matching and projection rules live in the learning components.
export async function routeLearningManagement({req,url,readBody,sendJson,pluginHost,tokenOk,sessionAllowed,toolEnabled}) {
  if(url.pathname==='/api/learning/sources'&&req.method==='GET'){sendJson({ok:true,scopeVersion:1,limit:{min:0,max:40},kinds:['term','slang','alias']});return true;}
  const query=/^\/api\/socialV2\/(term|alias|slang)\/query$/.exec(url.pathname);
  const editing=url.pathname==='/api/socialV2/knowledge-sources';
  if(!query&&!editing)return false;
  if(req.method!==(editing?'POST':'GET')){sendJson({ok:false,error:'方法不支持'},405);return true;}
  const input=editing?await readBody():Object.fromEntries(url.searchParams),key=String(input.key||'');
  if(!/^(group|private):[1-9]\d{0,19}$/.test(key)){sendJson({ok:false,error:'会话格式无效'},400);return true;}
  if(req.headers['x-agent-token']&&!tokenOk(key,req.headers['x-agent-token'])){sendJson({ok:false,error:'令牌必须属于当前会话'},403);return true;}
  if(!sessionAllowed(key)){sendJson({ok:false,error:'当前模式不允许此会话'},403);return true;}
  const kind=editing?input.kind:query[1],service={term:'terms',alias:'aliases',slang:'slang'}[kind],flag={term:'termQuery',alias:'aliasQuery',slang:'slangQuery'}[kind];
  if(!service){sendJson({ok:false,error:'资料类型无效'},400);return true;}
  if(req.headers['x-agent-token']&&(!toolEnabled(flag)||editing&&!toolEnabled('learningSources'))){sendJson({ok:false,error:'相关资料工具未启用'},403);return true;}
  const args=editing?{key,id:String(input.id||''),action:input.action}:{key,q:String(input.q||'').slice(0,200)};
  const out=await pluginHost.callService(service,editing?'updateSources':'query',args);
  if(!out){sendJson({ok:false,error:'资料组件当前不可用'},503);return true;}
  sendJson({...out,key,...(!editing&&out.ok?{total:out.entries?.length||0}:{})},out.ok?200:400);
  return true;
}
