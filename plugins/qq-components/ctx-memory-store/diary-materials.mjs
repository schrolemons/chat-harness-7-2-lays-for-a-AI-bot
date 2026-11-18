// Timestamped sources survive the chat window. Generated prose is never a source.
import {createHash} from 'node:crypto';
export const diaryCalendarDay=at=>new Date(at+8*3600000).toISOString().slice(0,10);
const periodOf=at=>{const hour=new Date(at+8*3600000).getUTCHours();return hour<12?'morning':hour<18?'afternoon':'evening';};
const sample=(rows,limit)=>rows.length<=limit?rows:Array.from({length:limit},(_,i)=>rows[Math.round(i*(rows.length-1)/(limit-1))]);
export function createDiaryMaterials(ctx){
 const read=({key,day,now=Date.now(),end}={})=>{
  const saved=ctx.state.get().diaryMaterials?.[key],cutoff=end?Date.parse(end.includes('T')?end:end.replace(' ','T')+':00+08:00'):Date.parse(day+'T24:00:00+08:00');
  if(!Number.isFinite(cutoff))return {day,timeZone:'Asia/Shanghai',evidence:[],coverage:{}};
  const periods=saved?.day===day?saved.periods||{}:{},evidence=Object.values(periods).flatMap(rows=>sample(rows.filter(m=>m.at<=now&&m.at<cutoff),48)).sort((a,b)=>a.at-b.at);
  return {day,timeZone:'Asia/Shanghai',evidence,coverage:Object.fromEntries(Object.entries(periods).map(([p,rows])=>[p,{available:rows.filter(m=>m.at<=now&&m.at<cutoff).length,selected:evidence.filter(m=>m.period===p).length}]))};
 };
 return {read,capture({key,day,now=Date.now(),messages=[]}={}){
  const all=ctx.state.get().diaryMaterials||{},previous=all[key];
  if(previous?.day>day)return read({key,day,now});
  const periods=previous?.day===day?structuredClone(previous.periods||{}):{};let changed=false;
  for(const m of messages){let at=Number(m?.at??m?.time);if(at>0&&at<1e11)at*=1000;
   if(!Number.isFinite(at)||at<=0||at>now||diaryCalendarDay(at)!==day)continue;
   const text=String(m.ownPlain??m.plain??m.text??'').trim().slice(0,600);if(!text||m.system===true)continue;
   const id=String(m.messageId??m.seq??createHash('sha256').update(JSON.stringify([at,m.userId,m.isSelf,text])).digest('hex'));
   const period=periodOf(at),rows=periods[period]||=[];
   if(rows.some(x=>x.isSelf===(m.isSelf===true)&&(x.sourceId===id||x.at===at&&x.userId===String(m.userId||'')&&x.text===text)))continue;
   rows.push({sourceId:id,at,localTime:new Date(at+8*3600000).toISOString().slice(0,19).replace('T',' '),period,isSelf:m.isSelf===true,userId:String(m.userId||''),sender:m.isSelf?'bot':String(m.sender||m.userId||'用户'),text});rows.sort((a,b)=>a.at-b.at);periods[period]=sample(rows,240);changed=true;
  }
  if(changed)ctx.state.set({diaryMaterials:{...all,[key]:{day,periods}}});
  return read({key,day,now});
 }};
}
