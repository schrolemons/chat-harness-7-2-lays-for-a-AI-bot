import {messageFullyProcessedV2} from '../../../src/bridge-core/receipt-state.js';
const claim=text=>/(?:用户|你).{0,8}(?:又戳|戳得|戳了|戳这|戳AI助手|拍拍AI助手|这一拍|这一戳)|(?:这|那)一(?:下|拍|戳).{0,14}(?:收到|接住|打招呼)|(?:拍一拍|戳一戳).{0,12}(?:收到|接住)/.test(text);
const invitation=text=>/(?:想|要是|如果|可以|伸手|要不要|来).{0,12}(?:戳|拍)/.test(text);
export function createInteractionEvidence(){
 const states=new Map();
 return {
  current({key}={}){const st=states.get(key);return [...(st?.unread||[]),...(st?.recentMessages||[])].filter(m=>m&&!m.isSelf).map(m=>({seq:m.seq,kind:m.kind,poke:m.poke,seenAt:m.seenAt,repliedAt:m.repliedAt,replyDisposition:m.replyDisposition}));},
  observe(payload){if(!payload.key||!payload.st)return;states.set(payload.key,payload.st);if(states.size>256)states.delete(states.keys().next().value);},
  validateReply({key,kind,text='',sourceSeqs=[],successful=0}={}){
   if(kind!=='text'||!claim(String(text))||invitation(String(text)))return {ok:true};
   const st=states.get(key),rows=[...new Map([...(st?.recentMessages||[]),...(st?.unread||[])].filter(m=>m&&!m.isSelf).map(m=>[m.seq,m])).values()],sources=rows.filter(m=>sourceSeqs.includes(m.seq));
   // Textual roleplay supports a fictional reaction, but never becomes a
   // structured transport poke or creates a new receipt obligation.
   if(sources.some(m=>m.kind!=='poke'&&!m.poke&&/戳|拍|摸摸/.test(m.plain||m.text||'')))return {ok:true};
   const pokes=sources.filter(m=>(m.kind==='poke'||m.poke)&&m.poke?.targetIsSelf===true&&!messageFullyProcessedV2(m)&&m.replyDisposition!=='history');
   if(!pokes.length||successful>0)return {ok:false,reason:'poke_reply_without_new_event',hint:'所选来源不是新的未回应拍一拍，或同一拍一拍已有真实发送。不要把文字、点点、旧回执或助手说法编成新戳；回应所选原话，没有新内容就结束。'};
   const actors=new Set(pokes.map(m=>String(m.userId))),actorNames=pokes.map(m=>String(m.sender||'')).filter(Boolean),others=rows.filter(m=>!actors.has(String(m.userId))).map(m=>String(m.sender||'')).filter(n=>n.length>=2);
   if(others.some(n=>String(text).includes(n))&&!actorNames.some(n=>String(text).includes(n)))return {ok:false,reason:'poke_actor_mismatch',hint:'本次真实拍一拍来自'+JSON.stringify(pokes.map(m=>({seq:m.seq,userId:m.userId,sender:m.sender})))+'，不要归给其他发言者。'};
   return {ok:true};
  }
 };
}
