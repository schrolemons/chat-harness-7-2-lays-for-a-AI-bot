import {randomUUID} from 'node:crypto';
const source=new URL('./milk-stock.mjs',import.meta.url);source.search=new URL(import.meta.url).search;
const {milkPolicy,milkPresentation,selectedStock,stockChange,stockNotice}=await import(source.href);
const socialURL=new URL('./social.mjs',import.meta.url);socialURL.search=new URL(import.meta.url).search;
const {createMilkSocial,milkConversationRule,milkVoice,milkChangeGuidance,validMilkKey}=await import(socialURL.href);
export function createMilkMonitor(ctx,{query,clock=Date.now}){
 let local={},inflight=null;const deliveryMetas=new Map();
 const read=()=>ctx.state?.get?.().milk||local;
 const write=patch=>{local={...read(),...patch};ctx.state?.set?.({milk:local});for(const [id,meta] of deliveryMetas)if(local.pendingAlert?.id!==id&&local.scheduledNotice?.id!==id){meta.expiresAt=0;deliveryMetas.delete(id);}return local;};
 const alive=()=>!ctx.signal?.aborted;
 const social=createMilkSocial({read,write,clock,currentStock:()=>selectedStock(read().lastSuccess,milkPolicy(ctx.config))});
 // The bridge rechecks this same expiry object at the physical send boundary.
 ctx.signal?.addEventListener('abort',()=>{for(const meta of deliveryMetas.values())meta.expiresAt=0;},{once:true});
 function reconcileSpoken(){
  if(!alive())return;
  const s=read(),event=s.socialEvent,owner=String(ctx.capabilities?.getOwnerQQ?.()||''),key='private:'+owner;
  if(!/^[1-9]\d*$/.test(owner)||!event?.id||s.spokenMilk?.[key]!==event.id)return;
  // Old persisted notices predate eventId. Only exact source facts may join them.
  const same=n=>n&&(n.eventId?n.eventId===event.id:n.sourceAt===event.at&&n.kind===event.kind&&n.stage===event.stage);
  const pending=same(s.pendingAlert),notice=same(s.scheduledNotice)&&!['sent','covered'].includes(s.scheduledNotice.status);
  if(!pending&&!notice)return;
  const patch={};if(pending)patch.pendingAlert=null;
  const covered=notice?s.scheduledNotice:pending&&!s.scheduledNotice?s.pendingAlert:null;
  if(covered)patch.scheduledNotice={...covered,key,eventId:event.id,status:'covered',coveredAt:clock(),coveredByEventId:event.id};
  // Keep a distinct covered receipt; never invent a scheduled physical sentAt.
  for(const id of [pending&&s.pendingAlert.id,notice&&s.scheduledNotice.id]){
   const meta=deliveryMetas.get(id);if(meta){meta.expiresAt=0;deliveryMetas.delete(id);}
  }
  write(patch);
 }
 async function deliver(now){
  reconcileSpoken();
  const pending=read().pendingAlert;if(!pending||!alive())return;
  if(now>pending.expiresAt){write({pendingAlert:null});return;}
  if(now<(pending.notBefore||0))return;
  if(read().lastError&&pending.kind!=='query_failed')return; // Keep the verified event, but revalidate before speaking after a failed sample.
  if(deliveryMetas.has(pending.id))return;
  if(read().scheduledNotice?.id===pending.id){write({pendingAlert:null});return;} // Crash/reload after dispatch: outcome may be unknown.
  const owner=String(ctx.capabilities?.getOwnerQQ?.()||'');if(!/^[1-9]\d*$/.test(owner)||typeof ctx.capabilities?.requestScheduledConversation!=='function')return;
  const key='private:'+owner;
  const meta={...pending,key,allowedKinds:['text'],plugin:'tool-deepseek-balance',signal:ctx.signal,reason:'milkStock',onDelivered:fact=>{
   if(!alive()||meta.expiresAt<clock()||fact?.key!==key||fact?.success!==true||read().scheduledNotice?.id!==pending.id||read().scheduledNotice.status==='sent')return;
   write({scheduledNotice:{...read().scheduledNotice,status:'sent',sentAt:fact.sentAt},lastNoticeAt:fact.sentAt||clock(),noticeUnconfirmed:false});
   social.sent({key,success:true,messages:[fact.text]});
  }};deliveryMetas.set(pending.id,meta);
  // Persist before dispatch. An accepted/unknown model request is never replayed as a fixed notice.
  write({scheduledNotice:{...pending,key,status:'dispatching'}});
  let result;try{result=await ctx.capabilities.requestScheduledConversation(key,meta);}catch{if(alive()&&read().pendingAlert?.id===pending.id)write({pendingAlert:null,scheduledNotice:{...read().scheduledNotice,status:'uncertain'},lastNoticeAt:now,noticeUnconfirmed:true});return;}
  if(!alive()||read().pendingAlert?.id!==pending.id)return;
  if(result?.ok===true)write({pendingAlert:null,scheduledNotice:{...read().scheduledNotice,status:read().scheduledNotice.status==='sent'?'sent':'accepted'},lastNoticeAt:now,lastNoticeKind:pending.kind});
  else {deliveryMetas.delete(pending.id);meta.expiresAt=0;write({scheduledNotice:null});}
 }
 async function refresh({notify=false,now=clock()}={}){
  if(inflight)return inflight;
  const old=read();if(old.lastAttemptAt&&now-old.lastAttemptAt<15000)return old.lastResult;
  inflight=(async()=>{
   write({lastAttemptAt:now});let result;try{result=await query();}catch{result={ok:false,error:'API预算余额查询暂时失败。'};}
   if(!alive())return {ok:false,error:'组件已停用，忽略迟到的余额结果。'};
   const current=read(),c=milkPolicy(ctx.config);
   if(result?.ok!==true){
    const failures=(current.failures||0)+1;
    const diagnostic=!current.pendingAlert&&notify&&failures>=3&&(!current.lastNoticeAt||now-current.lastNoticeAt>=c.notificationCooldownMin*60000);
    const pending=diagnostic?{id:'milk-stock:'+randomUUID(),kind:'query_failed',stage:'unknown',text:'API预算余额连续核对失败，当前余额未核实。这不表示API预算归零；请检查余额接口或本机密钥配置。',sourceAt:now,expiresAt:now+2*3600000}:current.pendingAlert;
    write({lastResult:result,lastError:{at:now,message:result?.error||'余额查询失败'},failures,pendingAlert:pending,scheduledNotice:diagnostic?null:current.scheduledNotice,nextCheckAt:now+Math.min(30,c.checkIntervalMin*2**Math.min(3,failures-1))*60000});return result;
   }
   const previous=current.lastSuccess,stock=selectedStock(result,c),change=stockChange(previous,{...result,stock},c)||(current.failures>=3&&stock.stage!=='unknown'?{kind:'query_restored',urgent:true,stock}:null);
   const checkedAt=Math.max(now,clock(),Number(previous?.at)||0);
   const event=change?{...change,id:'milk:'+randomUUID(),at:checkedAt}:null;
   const sample={is_available:result.is_available,balance_infos:result.balance_infos,at:checkedAt,stock};
   const out={...result,milk:{...milkPresentation(result),checkedAt,stock,change:event?{id:event.id,at:checkedAt,kind:event.kind,before:event.before,after:stock,delta:event.delta,relativeChange:event.relativeChange,summary:stockNotice(event)}:null}};
   out.milk.responseGuidance+='\n'+milkChangeGuidance;
   let pending=current.pendingAlert;
   if(pending&&pending.stage!==stock.stage)pending=null;
   if(c.monitorEnabled&&event)pending={id:'milk-stock:'+randomUUID(),eventId:event.id,kind:event.kind,stage:stock.stage,text:stockNotice(event),sourceAt:checkedAt,expiresAt:checkedAt+2*3600000,notBefore:event.urgent?checkedAt:Math.max(checkedAt,(current.lastNoticeAt||0)+c.notificationCooldownMin*60000)};
   const scheduledNotice=current.scheduledNotice?.stage===stock.stage&&!event?current.scheduledNotice:null;
   write({lastResult:out,lastSuccess:sample,lastError:null,failures:0,nextCheckAt:checkedAt+c.checkIntervalMin*60000,pendingAlert:pending,scheduledNotice});
   social.observe(event,checkedAt);
   return out;
  })().finally(()=>{inflight=null;});const result=await inflight;if(notify)await deliver(now);return result;
 }
 async function queryResult(){const result=await refresh();if(!result?.ok)return result;
  // Manual and automatic reads share one baseline and one event. Dispatch promptly
  // without coupling the balance response to a possibly slow model admission.
  if(milkPolicy(ctx.config).monitorEnabled){
   const pending=read().pendingAlert;
   if(pending?.notBefore>clock())write({pendingAlert:{...pending,notBefore:clock()}});
   void deliver(clock()).catch(()=>ctx.warn?.('API预算变化投递暂未完成，保留待处理事件'));
  }
  const stock=selectedStock(result,milkPolicy(ctx.config));return stock.stage===result.milk?.stock?.stage?result:{...result,milk:{...result.milk,stock,change:null}};}
 return {query:queryResult,async queryFor({key}={}){if(!validMilkKey(key))return {ok:false,error:'无效会话'};const result=await queryResult();return key==='private:'+String(ctx.capabilities?.getOwnerQQ?.()||'')?result:social.publicResult(result,key);},sent:payload=>{social.sent(payload);reconcileSpoken();},noteStatus:payload=>social.noteStatus(payload),noteWritten:payload=>social.noteWritten(payload),async tick({now=clock()}={}){const c=milkPolicy(ctx.config);if(!c.monitorEnabled||!alive())return;reconcileSpoken();if(!read().nextCheckAt||now>=read().nextCheckAt)await refresh({notify:true,now});else await deliver(now);},
  wakeTail({key,reason,scheduledEvent}={}){
   const n=read().scheduledNotice;
   if(reason!=='milkStock'||!alive()||n?.status==='covered'||key!=='private:'+String(ctx.capabilities?.getOwnerQQ?.()||'')||n?.id!==scheduledEvent?.id||scheduledEvent.expiresAt<clock())return '';
   const style=String(milkPolicy(ctx.config).alertStyle || '').trim();
   return '【定时主动会话：API预算告警】这次由API预算定时核对事件触发，不是用户来信，也不抽主动概率。已核实的事件事实：'+n.text+'\n'+(style?'【已配置的预警语义】'+style:milkVoice)+'\n'+milkChangeGuidance+'\n'+'沿用当前人设卡、对话示范和心情，用发送工具只发一条短句，不照读技术通知，不反复讨要或夸大后果。查询失败只说未核实，不说归零。无需再查余额，不额外发图片、表情或追问，不处理或标记无关的待处理消息；核实本条实际发送结果后直接结束。成功发送才算一次主动会话并刷新主动概率模型；接收请求不等于已送达。';
  },
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
   return shared+'\n【管理员专属API预算余额快照（DeepSeek API余额）】'+snapshot;
  }
 };
}
