// Transport only; diary window and storage rules belong to ctx-memory-store.
export async function routeDiaryManagement({req,url,readBody,sendJson,pluginHost,tokenOk,toolEnabled,sessionAllowed}){
  if(url.pathname!=='/api/socialV2/diary')return false;
  if(!['GET','POST'].includes(req.method)){sendJson({ok:false,error:'方法不支持'},405);return true;}
  const input=req.method==='GET'?Object.fromEntries(url.searchParams):await readBody(),key=String(input.key||'');
  if(!/^(private|group):\d{1,20}$/.test(key)){sendJson({ok:false,error:'会话格式不正确'},400);return true;}
  const token=req.headers['x-agent-token'];
  if(token&&(!tokenOk(key,token)||!sessionAllowed(key)||!toolEnabled('memory'))){sendJson({ok:false,error:'会话令牌无效，或当前会话/记忆工具未启用'},403);return true;}
  let result=await pluginHost.callService('memory',req.method==='GET'?'diaryCurrent':'updateDiary',{key,day:input.day,text:input.text,revision:input.revision});
  if(req.method==='GET'&&result?.ok){
    const status=await pluginHost.callService('memory','diaryStatus',{key,day:result.day});
    result={...result,delivery:status||{ok:false},note:'text只代表所读日期；history是本会话已有归档，发送以delivery的确认回执为准'};
  }
  sendJson(result||{ok:false,error:'日记组件不可用'},!result?503:result.ok?200:result.day?409:400);return true;
}
