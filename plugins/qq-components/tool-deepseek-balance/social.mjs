// Social projection and receipts. Account amounts never enter non-owner chats.
const labels={super_abundant:'API预算超级富足',normal:'API预算还有余量',low:'API预算偏少',critical:'API预算快见底',empty:'API预算空了',unavailable:'API预算暂时无法使用',unknown:'API预算余额未核实'};
const kinds={super_abundant:'超级富足',low:'偏少',critical:'快见底',empty:'空了',recovered:'补充后恢复了',replenished:'刚补充了',drop:'消耗明显'};
export const validMilkKey=key=>/^(private|group):[1-9]\d{0,19}$/.test(String(key||''));
const limitMap=map=>Object.fromEntries(Object.entries(map).slice(-256));
export const milkConversationRule="【API预算核实】对方询问当前预算、剩余额度或充值是否到账时，主动调用deepseek_balance核对，再按成功结果回应；旧快照不能冒充本轮查询，用户说已充值也不等于接口已确认。一次成功核对即可，失败本轮不重试，并说明状态未知，不把未知说成归零。普通闲聊不逐条查询、不反复报数，不擅自修改配置或心情值。";
export const milkVoice="【预算状态的说明方式】自然、准确地说明已核实的预算状态。偏低或用尽时简短说明服务限制和可选处理办法；恢复后确认当前可用状态。按当前风格表达，不反复催促充值、不渲染情绪、不夸大后果，也不把未核实的变化说成事实。";
export const milkChangeGuidance="【预算变化的说明】先看本次已核实的当前档位，再比较前后金额、净增和相对增幅。增加后仍不足时如实说明；从零恢复与原本充足时的小幅变化要区分。原值为零或负数时不计算无限增长。净增不等于充值流水，不编造充值明细。普通私聊和群聊不披露账户金额，不逐项播报内部字段，不自动改变心情或发送策略。";
export function createMilkSocial({read,write,clock=Date.now,currentStock}){
 const current=()=>{const s=read(),e=s.socialEvent;return !s.lastError&&e&&e.stage===(currentStock?.()||s.lastSuccess?.stock)?.stage&&clock()-e.at<=6*3600000?e:null;};
 return {
  observe(event,now){if(!event||!kinds[event.kind])return;write({socialEvent:{id:event.id,at:now,kind:event.kind,stage:event.stock.stage,relativeChange:event.relativeChange,before:event.before,after:event.stock,delta:event.delta}});},
  context(key,{fresh,stock,isOwner=false}={}){
   const s=read(),e=fresh?current():null;
   let text='【API预算状态】'+(fresh?(labels[stock?.stage]||labels.unknown):labels.unknown)+'。群聊和普通私聊只说API预算档位与变化，不披露账号金额、币种余额或本机信息。';
   if(e&&s.spokenMilk?.[key]!==e.id){text+='\n【这次可说的API预算变化】'+kinds[e.kind]+'；事件 '+e.id+'；发生于 '+new Date(e.at).toISOString()+'；变化时档位 '+(labels[e.stage]||e.stage)+'；相对变化 '+JSON.stringify(e.relativeChange||{baseline:'unknown',percent:null})+'。'+(isOwner&&e.before?.amount!==undefined?' 上次 '+e.before.currency+' '+e.before.amount+' → 变化后当时 '+e.after.currency+' '+e.after.amount+'；净变动 '+e.delta+'。':'')+'在下一次相关聊天或已允许的主动机会中自然提起一次；这段状态本身不额外启动模型，不绕过限额或宵禁。管理员定时告警由独立事件触发，不再重复转告其他会话。';
    if(!s.notedMilk?.[e.id])text+=' 建议用user_checking(action="note", milkEventId="'+e.id+'", text="自己对此次API预算变化想说的话")追加桌面便签；用自己的感受，不抄通知，不写聊天原文，同一事件只写一次。';
   }
   return text;
  },
  publicResult(result,key){
   if(result?.ok!==true)return {ok:false,error:'暂时无法核实API预算余额；未知不等于没有API预算。'};
   const e=current();if(e)write({milkQueries:limitMap({...read().milkQueries,[key]:{id:e.id,at:clock()}})});
   const project=event=>event?{id:event.id,at:event.at,kind:event.kind,stage:event.stage||event.after?.stage,relativeChange:event.relativeChange}:null;
   const change=project(result.milk?.change);
   const recentEvent=e&&e.id!==change?.id?project(e):null;
   return {ok:true,milk:{perspective:'当前API预算余额',stock:{stage:result.milk?.stock?.stage||'unknown'},checkedAt:result.milk?.checkedAt,change,recentEvent,responseGuidance:milkVoice+'\n'+milkChangeGuidance,desktopNote:e&&!read().notedMilk?.[e.id]?{milkEventId:e.id,hint:'建议用user_checking(action="note")记录这次变化和自己的感受；以此新事件ID为准，旧事件不再使用。'}:null}};
  },
  sent({key,success,messages=[]}={}){
   const s=read(),e=current(),q=s.milkQueries?.[key];if(!success||!e||!validMilkKey(key))return;
   const relevant=messages.some(t=>/API预算|可用预算|预算池|存量|余额/.test(String(t)))||(q?.id===e.id&&clock()-q.at<=120000);
   if(relevant)write({spokenMilk:limitMap({...s.spokenMilk,[key]:e.id})});
  },
  noteStatus({eventId}={}){const s=read();return {known:!!eventId&&s.socialEvent?.id===eventId,noted:!!s.notedMilk?.[eventId]};},
  noteWritten({eventId}={}){if(!eventId||read().socialEvent?.id!==eventId)return {ok:false};write({notedMilk:limitMap({...read().notedMilk,[eventId]:clock()})});return {ok:true};}
 };
}
