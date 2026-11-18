const shanghaiDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
export function diarySchedule(now,config={}){
 const day=shanghaiDay(now),hour=Math.max(0,Math.min(23,Number(config.hour)??22)),minute=Math.max(0,Math.min(59,Number(config.minute)||0));
 const at=Date.parse(day+'T'+String(Number.isFinite(hour)?hour:22).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00+08:00');
 return {day,at,expiresAt:at+5*60000};
}
export function humanActiveOnDay(lastIncomingAt,day){return Number(lastIncomingAt)>0&&shanghaiDay(Number(lastIncomingAt))===day;}
