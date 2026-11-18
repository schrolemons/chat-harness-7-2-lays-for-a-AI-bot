import {replaceSurface} from './history.mjs';

// QQ delivery is recorded independently in canonical dialogue. These are old,
// internal model plans, not the bot's actual messages. Keep current/recent work
// and every call/result; append projections without deleting journal events.
export function compactHistoricalChatNarration(session,position,{keepRecentTurns=2}={}){
 const signedTurns=new Set();let turn;
 for(const event of session.snapshotEvents()){
  if(event.type==='turn/start')turn=event.data.turn;
  const source=event.type==='user/message'?event.data.source:null;
  if(source&&/^qq-context-(?:dialogue|task|latest|current)$/.test(source.kind))signedTurns.add(turn);
 }
 let count=0,savedChars=0;
 for(const seq of [...session.surface.nodes]){
  const event=session.eventAt(seq),data=event?.data;
  if(event?.type!=='assistant/message'||!signedTurns.has(data.turn)||data.turn>=position.turn-keepRecentTurns)continue;
  const message=data.message,content=(message?.content||[]).filter(b=>!['text','thinking','reasoning'].includes(b.type));
  if(content.length===(message?.content||[]).length)continue;
  // A native assistant event embeds its provider stream and cannot cite a
  // replacement source. Keep mixed tool/media messages intact, including the
  // original stream and native call identity. Only pure narration can retire.
  if(content.length)continue;
  savedChars+=(message.content||[]).filter(b=>['text','thinking','reasoning'].includes(b.type)).reduce((n,b)=>n+String(b.text||b.thinking||'').length,0);
  replaceSurface(session,seq,{...message,content:[]},position);
  count++;
 }
 return {count,savedChars};
}
