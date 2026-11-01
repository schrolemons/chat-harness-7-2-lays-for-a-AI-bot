const LABELS = {'qq-chat':'AI助手一代聊天','qq-chat-v2':'AI助手二代仿真','qq-admin':'AI助手管理员','qq-chat-dev':'AI助手管理员','qq-learning':'知识与黑话学习','qq-task-worker':'独立任务','campus-summary':'网页更新整理'};
export function isUnnamedTitle(title) { return !String(title??'').trim() || /^(?:未命名(?:会话)?|untitled|new chat)$/i.test(String(title).trim()); }
export function sessionTitle({sessionId='',agentPreset='',cwd='',title='',key=''}={}) {
  const clean=value=>String(value).replace(/[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').replace(/\s+/g,' ').trim();
  if (!isUnnamedTitle(title)) return [...clean(title)].slice(0,70).join('');
  const short=String(sessionId).replace(/^session-/,'').slice(0,8);
  const parts=String(cwd).replace(/\\/g,'/').split('/').filter(Boolean);
  let label=LABELS[agentPreset]||'DSH 会话';
  if(parts.includes('audits')||parts.some(p=>/^(?:probe|canary|verify)[-_]/.test(p)))label='验证 · '+clean(parts.at(-1));
  if(key)label=(String(key).startsWith('group:')?'QQ 群聊 · ':'QQ 私聊 · ')+clean(key.split(':')[1]);
  return [...(label+(short?' · '+short:''))].slice(0,70).join('');
}
export async function createTitledSession(api,create,payload={},signal) {
  const {title,...request}=payload;
  const response=await create(request,signal);
  if(!response.result?.ok)return response;
  const sessionId=response.result.value.sessionId;
  const next=sessionTitle({...request,title,sessionId});
  let failure;
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const renamed=await api.sessions.rename({sessionId,title:next},signal);
      if(!renamed.result?.ok)throw Error(renamed.result?.error?.message||'DSH 会话命名失败');
      return response;
    }catch(error){failure=error;}
  }
  // Creation succeeded: never let a caller start a model turn on an unnamed orphan.
  try {await api.workspace.archiveSession({sessionId});}catch(archiveError){throw Error('会话命名与归档均失败：'+sessionId,{cause:archiveError});}
  throw Error('会话命名失败，空会话已归档：'+sessionId,{cause:failure});
}
