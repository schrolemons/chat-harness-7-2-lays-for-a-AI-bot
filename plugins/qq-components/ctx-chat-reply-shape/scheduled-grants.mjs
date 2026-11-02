// Only transport-supplied event facts are accepted. Message text never grants a burst.
export const SCHEDULED_GRANT_MS=120000,MAX_SCHEDULED_OVERFLOW=20;
export function scheduledSources({key,reason='',reminders=[],scheduledEvent,timeBubble,scheduledNotifications=[],agent,now=Date.now()}={}){
 const base=String(reason).split(':')[0],sources=[];
 const add=(id,until=now+SCHEDULED_GRANT_MS)=>{if(id&&Number.isFinite(until)&&until>now)sources.push({id:key+':'+id,expiresAt:Math.min(until,now+SCHEDULED_GRANT_MS)});};
 if(base==='reminder')for(const r of reminders){
  if(r?.id&&Number.isFinite(r.dueAt)&&Number.isFinite(r.requestedAt)&&r.requestedAt<=now&&now-r.requestedAt<SCHEDULED_GRANT_MS)
   add('reminder:'+r.id+':'+r.dueAt+':'+r.requestedAt,r.requestedAt+SCHEDULED_GRANT_MS);
 }
 if(base==='milkStock'&&scheduledEvent?.key===key&&scheduledEvent.plugin==='tool-deepseek-balance'&&scheduledEvent.reason===base&&!scheduledEvent.signal?.aborted)
  add('milkStock:'+scheduledEvent.id,scheduledEvent.id?scheduledEvent.expiresAt:0);
 if(base==='timeBubble'&&timeBubble?.id)add('timeBubble:'+timeBubble.id);
 if(base==='scheduledContact'&&String(reason).includes(':'))add('scheduledContact:'+String(reason).slice(reason.indexOf(':')+1));
 if(agent===false)for(const n of scheduledNotifications)if(n?.claimed===true&&n.key===key&&n.id)add('notification:'+n.id,n.expiresAt);
 return [...new Map(sources.map(s=>[s.id,s])).values()].slice(0,MAX_SCHEDULED_OVERFLOW);
}
export function availableScheduled(s,grant,key,now,allowExpired=false){
 if(!grant||grant.key!==key)return null;
 return grant.ids?.find(id=>{const g=s.scheduled?.[id];return g?.key===key&&(allowExpired||now<g.expiresAt)&&!g.operationId;})||null;
}
export function overflowAvailable(e,now){
 const overflow=[...e.receipts,...Object.values(e.reservations)].filter(r=>r.scheduledOverflow&&now-r.at<3600000);
 return overflow.length<MAX_SCHEDULED_OVERFLOW;
}
