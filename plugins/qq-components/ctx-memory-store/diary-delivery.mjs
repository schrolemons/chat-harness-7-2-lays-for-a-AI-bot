// Diary dates label the END of a configured Beijing-time window. Sending time
// is a separate fact, established only by the central transport receipt.
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
export function diaryClock(config={}){
  const hour=Number(config.hour),minute=Number(config.minute);
  return {hour:Math.min(23,Math.max(0,Number.isFinite(hour)?Math.trunc(hour):22)),minute:Math.min(59,Math.max(0,Number.isFinite(minute)?Math.trunc(minute):0))};
}
const shift=(day,days)=>new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
export function diaryTargetDay(now=Date.now(),config={}){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const date=parts.year+'-'+parts.month+'-'+parts.day,{hour,minute}=diaryClock(config);
  return Number(parts.hour)*60+Number(parts.minute)>=hour*60+minute?shift(date,1):date;
}
export function diaryWindow(day,config={}){
  if(!datePattern.test(String(day)))return null;
  const {hour,minute}=diaryClock(config),clock=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0'),start=shift(day,-1)+' '+clock,end=day+' '+clock;
  return {day,start,end,label:start+' 至 '+end};
}
export function diaryPreviousDay(now,config){return shift(diaryTargetDay(now,config),-1);}
export function diaryHeading(day,config){
  return '【'+day+' 日日记】\n时间窗：'+(diaryWindow(day,config)?.label||'')+'\n';
}
export function diaryPartLimit(config={}){
  return Math.max(50,Math.min(500,Math.floor(Number(config.maxChars)||500)));
}
export function diaryDraftLimit(day,config){
  return Math.max(50,Math.min(350,diaryPartLimit(config)-diaryHeading(day,config).length));
}
const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function diaryReceiptIds({key,day,notes='',indexed=[]}){
  const pattern=new RegExp('diary:'+escape(key)+':\\d{4}-\\d{2}-\\d{2}(?::manual:[a-zA-Z0-9-]{8,80}|:scheduled|:catchup)?','g');
  const ids=[...(datePattern.test(String(day))?['diary:'+key+':'+day,'diary:'+key+':'+day+':scheduled','diary:'+key+':'+day+':catchup']:[]),...indexed,...String(notes).matchAll(pattern)].map(id=>Array.isArray(id)?id[0]:id);
  const exact=new RegExp('^diary:'+escape(key)+':'+(day?escape(day):'\\d{4}-\\d{2}-\\d{2}')+'(?::manual:[a-zA-Z0-9-]{8,80}|:scheduled|:catchup)?$');
  return [...new Set(ids.filter(id=>typeof id==='string'&&exact.test(id)))];
}
export async function resolveDiaryDelivery({key,day,notes='',indexed=[],recorded=false,archiveOnly=false,lookup}){
  if(typeof lookup!=='function')return {sentForDay:false,deliveryStatus:'unavailable',sentAt:0};
  const ids=diaryReceiptIds({key,day,notes,indexed});
  const results=await Promise.all(ids.map(async id=>{try{return {id,...await lookup(id)};}catch{return {id,ok:false};}}));
  const sent=results.filter(r=>r.ok===true&&r.status==='sent').sort((a,b)=>(Number(b.finishedAt)||0)-(Number(a.finishedAt)||0))[0];
  if(sent)return {sentForDay:true,deliveryStatus:'sent',sentAt:Number(sent.finishedAt)||0,deliveryId:sent.id};
  const pending=results.find(r=>r.ok===true&&r.status==='claimed')||results.find(r=>r.ok===true&&r.status==='uncertain');
  const deliveryStatus=pending?.status||((!results.length||results.some(r=>r.ok!==true))?'unavailable':recorded?'legacy_unconfirmed':archiveOnly?'archive_only':'absent');
  return {sentForDay:false,deliveryStatus,sentAt:0};
}
