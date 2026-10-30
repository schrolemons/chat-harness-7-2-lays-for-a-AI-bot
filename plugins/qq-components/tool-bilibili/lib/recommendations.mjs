import {randomUUID} from 'node:crypto';
import {chooseWeightedTopic,chooseTopicUploader,resolveShareConfig,pickVideos,mergeRecentBvids} from '../../../../src/bili-share.js';

const nameKey=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase();
const videoIds=text=>[...new Set((String(text||'').match(/\bBV[0-9A-Za-z]{10}\b/gi)||[]).map(id=>id.toUpperCase()))];
const dayAt=at=>{const d=new Date(at);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const validPlan=plan=>plan?.version===2&&/^(private|group):\d+$/.test(plan.key)&&Array.isArray(plan.draws)&&plan.draws.length>0&&plan.draws.length<=5;
const relevant=(row,topic)=>String(topic).split(/\s+/).filter(Boolean).some(word=>nameKey(row.title+' '+row.description).includes(nameKey(word)));

// Daily recommendation policy stays with the public-video component. Bridge
// capabilities only supply the existing pending packet; no new timer or MCP tool.
export function createRecommendationService(ctx,{search,random=Math.random,now=Date.now}){
 const readState=()=>ctx.state?.get?.().dailyBiliByKey||{};
 const readPlan=key=>ctx.capabilities?.readBiliSharePlan?.(key);
 return {
  draw({key,date=dayAt(now()),at=now(),config={}}={}){
   if(!/^(private|group):\d+$/.test(String(key||'')))return null;
   const resolved=resolveShareConfig(config);
   return {version:2,id:randomUUID(),key,date,at,maxItems:resolved.maxItems,keywords:resolved.keywords,
    knownUploaders:[...new Set(resolved.topicUploaders.map(row=>row.uploader))],items:[],resolved:false,
    draws:Array.from({length:resolved.maxItems},(_,slot)=>{
     const topic=chooseWeightedTopic(resolved.keywords,resolved.topicUploaders,random);
     return {slot:slot+1,topic,preferredUploader:chooseTopicUploader(topic,resolved.topicUploaders,random),status:'pending'};
    })};
  },
  async resolve({plan,excludeBvids=[]}={}){
   if(!validPlan(plan)||typeof search!=='function')return null;
   const result=structuredClone(plan),excluded=new Set([...excludeBvids,...(readState()[plan.key]?.recentBvids||[])].map(id=>String(id).toUpperCase()));
   const known=new Set((plan.knownUploaders||[]).map(nameKey));result.items=[];
   for(const draw of result.draws){
    delete draw.item;delete draw.error;delete draw.usedFallback;
    const candidates=async keyword=>{
     const response=await search({keyword,page:1,sort:'relevance',excludeBvids:[...excluded].slice(-100)});
     if(response?.status!=='ok'||!Array.isArray(response.items))throw Error('search_unconfirmed');
     return response.items.filter(row=>relevant(row,draw.topic));
    };
    try{
     let eligible;
     if(draw.preferredUploader){
      const targeted=await candidates(draw.topic+' '+draw.preferredUploader);
      eligible=pickVideos(targeted.filter(row=>nameKey(row.uploader)===nameKey(draw.preferredUploader)),{excludeBvids:[...excluded],maxItems:1});
      if(!eligible.length){draw.usedFallback=true;eligible=pickVideos(await candidates(draw.topic),{excludeBvids:[...excluded],maxItems:1});}
     }else{
      const broad=await candidates(draw.topic);
      eligible=pickVideos(broad.filter(row=>!known.has(nameKey(row.uploader))),{excludeBvids:[...excluded],maxItems:1});
     }
     if(!eligible.length){draw.status='no-qualified-video';continue;}
     const item={...eligible[0],slot:draw.slot,topic:draw.topic};
     excluded.add(item.bvid.toUpperCase());draw.item=item;draw.status='selected';result.items.push(item);
    }catch(error){draw.status='error';draw.error=String(error?.code||error?.message||'search_failed').slice(0,100);}
   }
   result.resolved=true;return result;
  },
  validateOutbound({key,sourceKey,reason,kind='text',text,planId}={}){
   if(String(reason||'').split(':')[0]!=='newsShare')return {ok:true};
   const plan=readPlan(key);
   if((sourceKey&&sourceKey!==key)||!validPlan(plan)||plan.key!==key||!plan.resolved||plan.date!==dayAt(now())||(planId&&planId!==plan.id))return {ok:false,reason:'recommendation_plan_unavailable'};
   const ids=videoIds(text),allowed=new Set((plan.items||[]).map(row=>row.bvid.toUpperCase()));
   if(kind!=='text'||!ids.length||ids.some(id=>!allowed.has(id)))return {ok:false,reason:'unverified_video'};
   const delivered=readState()[key];
   if(delivered?.planId===plan.id&&ids.some(id=>delivered.bvids.includes(id)))return {ok:false,reason:'video_already_delivered'};
   return {ok:true};
  },
  sent({key,originReason,wakeReason,text,success,recommendationPlanId}={}){
   if(success!==true||String(originReason||wakeReason||'').split(':')[0]!=='newsShare')return {ok:true,recorded:false};
   const plan=readPlan(key);if(!validPlan(plan)||!plan.resolved||(recommendationPlanId&&recommendationPlanId!==plan.id))return {ok:false};
   const allowed=new Set(plan.items.map(row=>row.bvid.toUpperCase())),ids=videoIds(text).filter(id=>allowed.has(id));
   if(!ids.length)return {ok:false};
   const state=readState(),old=state[key]||{},bvids=old.planId===plan.id?old.bvids||[]:[];
   state[key]={date:plan.date,planId:plan.id,bvids:[...new Set([...bvids,...ids])],recentBvids:mergeRecentBvids(old.recentBvids,ids)};
   ctx.state?.set?.({dailyBiliByKey:state});return {ok:true,recorded:true};
  }
 };
}
