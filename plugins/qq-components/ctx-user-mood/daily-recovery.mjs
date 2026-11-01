const { DAILY_RECOVERY_HOUR } = await import((()=>{const u=new URL('./policy.mjs',import.meta.url);u.search=new URL(import.meta.url).search;return u.href;})());
const { recordHistory } = await import((()=>{const u=new URL('./history.mjs',import.meta.url);u.search=new URL(import.meta.url).search;return u.href;})());
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
export const recoveryDay=(now,policy={})=>formatter.format(now-(policy.dailyRecoveryHour??DAILY_RECOVERY_HOUR)*60*60*1000);

// The marker and score event share the ledger's atomic transaction. A missed
// deadline is applied once when the server resumes, never once per missed day.
export function recoverDaily(ledger,policy,now) {
  const keys=[];
  if(!policy.enabled)return keys;
  const day=recoveryDay(now,policy);
  for(const [key,entry] of Object.entries(ledger.conversations)){
    if(entry.lastRecoveryDay&&entry.lastRecoveryDay>=day)continue;
    const before=entry.score;
    entry.score=Math.max(entry.score,policy.dailyFloor);
    entry.lastRecoveryDay=day;
    entry.updatedAt=Math.max(entry.updatedAt||0,now);
    const hour=String(policy.dailyRecoveryHour).padStart(2,'0');
    recordHistory(entry,{at:now,source:'daily-recovery',before,recoveryDay:day,dailyFloor:policy.dailyFloor,dailyRecoveryHour:policy.dailyRecoveryHour,reason:`上海时间每日${hour}:00保底到${policy.dailyFloor}；错过时恢复运行后补做`});
    keys.push(key);
  }
  return keys;
}
