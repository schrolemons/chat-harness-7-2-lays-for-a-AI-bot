const messageReasons=new Set(['private','message','probability','atMention','nameMention','question','poke','keyword','bootstrap','reply','anyMessage','speaker']);
// A queued wake is redundant once the running model has actually seen its
// optional context or answered its required input. Keep raw history/stamps.
export function pruneObservedWakeBacklog(st){
 if(!st||!Array.isArray(st.pendingWakeReasons))return 0;
 const rows=[...new Map([...(st.recentMessages||[]),...(st.unread||[])].filter(m=>!m.isSelf&&Number.isSafeInteger(m.seq)).map(m=>[m.seq,m])).values()];
 const known=new Set(rows.map(m=>m.seq));
 // A model-facing filtered view must not retire a wake for invisible ingress.
 if(Number(st.lastUnreadSeq)>0&&!known.has(Number(st.lastUnreadSeq)))return 0;
 const before=st.pendingWakeReasons.length;
 st.pendingWakeReasons=st.pendingWakeReasons.filter(item=>{
  if(!messageReasons.has(String(item?.reason||'').split(':')[0])||!known.has(Number(item.seq)))return true;
  return rows.some(m=>m.seq>=Number(item.seq)&&m.quotaAdmission!=='rejected'
   &&(m.quotaAdmission==='pending'||!m.repliedAt&&!m.resolvedAt&&!(m.replyDisposition==='history'&&Number(m.seenAt)>0)));
 });
 return before-st.pendingWakeReasons.length;
}
