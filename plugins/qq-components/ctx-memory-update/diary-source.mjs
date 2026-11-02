// A diary uses timestamped activity from its own window, never the previous diary.
export function diaryEvidence(st={},window,now=Date.now()){
  if(!window?.start||!window?.end)return [];
  const start=Date.parse(window.start.replace(' ','T')+':00+08:00'),end=Date.parse(window.end.replace(' ','T')+':00+08:00');
  const rows=new Map();
  for(const messages of [st.recentMessages,st.unread])for(const m of Array.isArray(messages)?messages:[]){
    let at=Number(m?.time??m?.at);if(at>0&&at<1e11)at*=1000;
    if(!Number.isFinite(at)||at<start||at>=end||at>now)continue;
    const text=String(m.plain??m.text??'').trim();if(!text)continue;
    rows.set(m.messageId||m.seq||at+':'+text,{at,sender:m.isSelf?'bot':String(m.sender||m.userId||'用户'),text:text.slice(0,600)});
  }
  return [...rows.values()].sort((a,b)=>a.at-b.at);
}
