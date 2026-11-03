import {sessionTitle,isUnnamedTitle} from '../../src/session-titles.js';
import {FIXED_PRESETS} from '../../src/preset-policy.js';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\\/g,'/').toLowerCase();
const managedPresets=new Set([...Object.values(FIXED_PRESETS),'qq-admin','qq-chat-dev']);
export const inject=['sessions','sessionTitle'];
export function apply(ctx) {
  const owned=new WeakMap();
  function ensure(session) {
    const events=typeof session?.snapshotEvents==='function'?session.snapshotEvents():session?.events;
    if(!Array.isArray(events))return;
    const preset=events.findLast(e=>e.type==='agent-preset/selected')?.data?.agentPreset||'';
    const cwd=String(session.header?.cwd||'').replace(/\\/g,'/').toLowerCase();
    if(!cwd.startsWith(root+'state/')&&!managedPresets.has(preset))return;
    const current=ctx.sessionTitle.get(session);
    const isOwned=current&&owned.has(session)&&current.eventSeq===owned.get(session);
    if(current&&!isOwned&&(['user','provider'].includes(current.source?.kind)||!isUnnamedTitle(current.title)))return;
    const title=sessionTitle({sessionId:session.id,agentPreset:preset,cwd:session.header?.cwd});
    if(current?.title===title)return;
    // Purpose titles are explicit renames, not summaries derived from human messages.
    // Track our exact revision so a later user/provider title always wins.
    const renamed=ctx.sessionTitle.rename(session,title);
    owned.set(session,renamed.eventSeq);
  }
  const safeEnsure=session=>{try{ensure(session);}catch(error){ctx.logger?.warn?.('会话名称兜底失败：'+String(error?.message||error));}};
  ctx.on('session/created',safeEnsure,{global:true});
  ctx.on('session/event',(session,event)=>{if(event?.type==='agent-preset/selected')safeEnsure(session);},{global:true});
}
