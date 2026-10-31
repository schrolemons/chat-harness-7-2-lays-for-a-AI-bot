import {randomUUID} from 'node:crypto';
const source=new URL('./milk-stock.mjs',import.meta.url);source.search=new URL(import.meta.url).search;
const {milkPolicy,milkPresentation,selectedStock,stockChange,stockNotice}=await import(source.href);
const socialURL=new URL('./social.mjs',import.meta.url);socialURL.search=new URL(import.meta.url).search;
const {createMilkSocial,milkConversationRule,milkVoice,milkChangeGuidance,validMilkKey}=await import(socialURL.href);
export function createMilkMonitor(ctx,{query,clock=Date.now}){
 let local={},inflight=null;const deliveryMetas=new Map();
 const read=()=>ctx.state?.get?.().milk||local;
 const write=patch=>{local={...read(),...patch};ctx.state?.set?.({milk:local});for(const [id,meta] of deliveryMetas)if(local.pendingAlert?.id!==id)meta.expiresAt=0;return local;};
 const alive=()=>!ctx.signal?.aborted;
 const social=createMilkSocial({read,write,clock,currentStock:()=>selectedStock(read().lastSuccess,milkPolicy(ctx.config))});
 // The bridge rechecks this same expiry object at the physical send boundary.
 ctx.signal?.addEventListener('abort',()=>{for(const meta of deliveryMetas.values())meta.expiresAt=0;},{once:true});
 async function deliver(now){
  const pending=read().pendingAlert;if(!pending||!alive())return;
  if(now>pending.expiresAt){write({pendingAlert:null});return;}
  const owner=String(ctx.capabilities?.getOwnerQQ?.()||'');if(!/^[1-9]\d*$/.test(owner)||typeof ctx.capabilities?.sendNotificationDetailed!=='function')return;
  if(deliveryMetas.has(pending.id))return;
  const meta={id:pending.id,sourceAt:pending.sourceAt,expiresAt:pending.expiresAt,reason:'milkStock'};deliveryMetas.set(pending.id,meta);
  let result;try{result=await ctx.capabilities.sendNotificationDetailed('private:'+owner,pending.text,meta);}catch{if(alive()&&read().pendingAlert?.id===pending.id)write({pendingAlert:null,lastNoticeAt:now,noticeUnconfirmed:true});return;}finally{deliveryMetas.delete(pending.id);}
  if(!alive()||read().pendingAlert?.id!==pending.id)return;
  if(result?.ok===true||result?.reason==='already_sent')write({pendingAlert:null,lastNoticeAt:now,lastNoticeKind:pending.kind});
  else if(['claimed','uncertain','sent'].includes(result?.receiptStatus))write({pendingAlert:null,lastNoticeAt:now,lastNoticeKind:pending.kind,noticeUnconfirmed:result.receiptStatus!=='sent'});
 }
 async function refresh({notify=false,now=clock()}={}){
  if(inflight)return inflight;
  const old=read();if(old.lastAttemptAt&&now-old.lastAttemptAt<15000)return old.lastResult;
  inflight=(async()=>{
   write({lastAttemptAt:now});let result;try{result=await query();}catch{result={ok:false,error:'账户余额查询暂时失败。'};}
   if(!alive())return {ok:false,error:'组件已停用，忽略迟到的余额结果。'};
   const current=read(),c=milkPolicy(ctx.config);
   if(result?.ok!==true){
    const failures=(current.failures||0)+1;
    const pending=notify&&failures>=3&&(!current.lastNoticeAt||now-current.lastNoticeAt>=c.notificationCooldownMin*60000)?{id:'milk-stock:'+randomUUID(),kind:'query_failed',stage:'unknown',text:'账户余额连续核对失败，当前余额未核实。这不表示调用额度归零；请检查余额接口或本机密钥配置。',sourceAt:now,expiresAt:now+2*3600000}:null;
    write({lastResult:result,lastError:{at:now,message:result?.error||'余额查询失败'},failures,pendingAlert:pending,nextCheckAt:now+Math.min(30,c.checkIntervalMin*2**Math.min(3,failures-1))*60000});return result;
   }
   const previous=current.lastSuccess,stock=selectedStock(result,c),change=stockChange(previous,{...result,stock},c)||(current.failures>=3&&stock.stage!=='unknown'?{kind:'query_restored',urgent:true,stock}:null);
   const event=change?{...change,id:'milk:'+randomUUID(),at:now}:null;
   const sample={is_available:result.is_available,balance_infos:result.balance_infos,at:now,stock};
   const out={...result,milk:{...milkPresentation(result),checkedAt:now,stock,change:event?{id:event.id,at:now,kind:event.kind,before:event.before,after:stock,delta:event.delta,relativeChange:event.relativeChange,summary:stockNotice(event)}:null}};
   out.milk.responseGuidance+='\n'+milkChangeGuidance;
   let pending=current.pendingAlert;
   if(pending&&pending.stage!==stock.stage)pending=null;
   if(c.monitorEnabled&&event&&(event.urgent||!current.lastNoticeAt||now-current.lastNoticeAt>=c.notificationCooldownMin*60000))pending={id:'milk-stock:'+randomUUID(),kind:event.kind,stage:stock.stage,text:stockNotice(event),sourceAt:now,expiresAt:now+2*3600000};
   write({lastResult:out,lastSuccess:sample,lastError:null,failures:0,nextCheckAt:now+c.checkIntervalMin*60000,pendingAlert:pending});
   social.observe(event,now);
   return out;
  })().finally(()=>{inflight=null;});const result=await inflight;if(notify)await deliver(now);return result;
 }
 async function queryResult(){const result=await refresh();if(!result?.ok)return result;const stock=selectedStock(result,milkPolicy(ctx.config));return stock.stage===result.milk?.stock?.stage?result:{...result,milk:{...result.milk,stock,change:null}};}
 return {query:queryResult,async queryFor({key}={}){if(!validMilkKey(key))return {ok:false,error:'无效会话'};const result=await queryResult();return key==='private:'+String(ctx.capabilities?.getOwnerQQ?.()||'')?result:social.publicResult(result,key);},sent:payload=>social.sent(payload),noteStatus:payload=>social.noteStatus(payload),noteWritten:payload=>social.noteWritten(payload),async tick({now=clock()}={}){const c=milkPolicy(ctx.config);if(!c.monitorEnabled||!alive())return;if(!read().nextCheckAt||now>=read().nextCheckAt)await refresh({notify:true,now});else await deliver(now);},
  status(){const st=read(),maxAge=Math.max(15,milkPolicy(ctx.config).checkIntervalMin*3)*60000;return {...st,lastSuccess:st.lastSuccess?{...st.lastSuccess,stock:selectedStock(st.lastSuccess,milkPolicy(ctx.config))}:undefined,fresh:!!st.lastSuccess&&!st.lastError&&clock()-st.lastSuccess.at<=maxAge};},
  context({key}={}){
   if(!validMilkKey(key))return '';
   const isOwner=key==='private:'+String(ctx.capabilities?.getOwnerQQ?.()||''),scope=milkPolicy(ctx.config).reminderScope;
   if((scope==='admin'&&!isOwner)||(scope==='private'&&!key.startsWith('private:')))return '';
   const st=this.status();let snapshot;
   const shared=milkConversationRule+'\n'+milkVoice+'\n'+milkChangeGuidance+'\n'+social.context(key,{fresh:st.fresh,stock:st.lastSuccess?.stock,isOwner});
   if(key!=='private:'+String(ctx.capabilities?.getOwnerQQ?.()||''))return shared;
   if(!st.lastSuccess)snapshot='尚无成功核对记录，当前存量未知。';
   else if(!st.fresh)snapshot='上次余额核对已过期或查询失败，当前存量未核实；不按旧余额断言归零或刚充值。';
   else if(milkPresentation(st.lastSuccess).state==='unknown')snapshot='最近查询未获得可确认的金额，当前存量未知，不当作0。';
   else snapshot=st.lastSuccess.balance_infos.map(row=>row.currency+' '+row.total_balance).join('；')+'；核对时间 '+new Date(st.lastSuccess.at).toISOString()+'；账户'+(st.lastSuccess.is_available?'可用':'不可用')+'。这是上次核对的快照，不是本轮实时查询。';
   return shared+'\n【管理员专属账户余额快照（DeepSeek API余额）】'+snapshot;
  }
 };
}
