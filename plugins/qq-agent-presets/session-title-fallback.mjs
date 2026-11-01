import {sessionTitle,isUnnamedTitle} from '../../src/session-titles.js';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\\/g,'/').toLowerCase();
export const inject=['sessions','sessionTitle'];
export function apply(ctx) {
  const owned=new WeakSet();
  function ensure(session) {
    const events=typeof session?.snapshotEvents==='function'?session.snapshotEvents():session?.events;
    if(!Array.isArray(events))return;
    const preset=events.findLast(e=>e.type==='agent-preset/selected')?.data?.agentPreset||'';
    const cwd=String(session.header?.cwd||'').replace(/\\/g,'/').toLowerCase();
    if(!cwd.startsWith(root+'state/')&&!/^(?:qq-|campus-summary$)/.test(preset))return;
    const current=ctx.sessionTitle.get(session);
    if(current&&!isUnnamedTitle(current.title)&&(!owned.has(session)||current.source.kind!=='fallback'))return;
    const title=sessionTitle({sessionId:session.id,agentPreset:preset,cwd:session.header?.cwd});
    if(current?.title===title)return;
    // Managed background sessions use purpose titles; user/provider titles always win.
    session.append('session/title',{title,messageSeqs:[],source:{kind:'fallback'}});
    owned.add(session);
  }
  const safeEnsure=session=>{try{ensure(session);}catch(error){ctx.logger?.warn?.('会话名称兜底失败：'+String(error?.message||error));}};
  ctx.on('session/created',safeEnsure,{global:true});
  ctx.on('session/event',(session,event)=>{if(event?.type==='agent-preset/selected')safeEnsure(session);},{global:true});
}
