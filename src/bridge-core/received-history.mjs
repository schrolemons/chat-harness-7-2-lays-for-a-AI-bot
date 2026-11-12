// Instance-local bounded receipt cache, independent of wake and reply eligibility.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const valid=(botUin,key)=>/^[1-9]\d*$/.test(String(botUin))&&/^(private|group):[1-9]\d*$/.test(String(key));
export function createReceivedMessageCache({root,writeJson,limit=()=>100}){
 const location=(botUin,key)=>path.join(root,createHash('sha256').update(String(botUin)+'\0'+key).digest('hex')+'.json');
 const load=(botUin,key)=>{try{const data=JSON.parse(fs.readFileSync(location(botUin,key),'utf8'));return data.version===1&&data.botUin===String(botUin)&&data.key===key&&Array.isArray(data.messages)?data.messages:[];}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 return {
  record({botUin,key,event,receivedAt=Date.now()}){
   if(!valid(botUin,key)||event?.self_id!=null&&String(event.self_id)!==String(botUin))return false;
   const rows=load(botUin,key),id=event?.message_id??event?.msg_id??event?.message_seq;
   if(id!=null&&rows.some(row=>String(row.event.message_id??row.event.msg_id??row.event.message_seq)===String(id)))return false;
   rows.push({receivedAt,event});const count=Math.max(1,Math.min(1000,Math.floor(Number(limit())||100)));
   writeJson(location(botUin,key),{version:1,botUin:String(botUin),key,messages:rows.slice(-count)});return true;
  },
  read({botUin,key,limit:count=100,since=0,until=Date.now()}){
   if(!valid(botUin,key))return {ok:false,reason:'not_allowed',messages:[]};
   try{return {ok:true,source:'bridge-received',messages:load(botUin,key).filter(row=>row.receivedAt>=since&&row.receivedAt<=until).slice(-Math.max(1,Math.min(1000,Number(count)||100))).map(row=>({...row.event,historySource:'bridge-received',time:row.event.time||Math.floor(row.receivedAt/1000)}))};}
   catch{return {ok:false,reason:'received_cache_unavailable',messages:[]};}
  }
 };
}
