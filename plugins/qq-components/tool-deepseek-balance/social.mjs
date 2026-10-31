// Social projection and receipts. Account amounts never enter non-owner chats.
const labels={super_abundant:'调用额度超级富足',normal:'调用额度还有余量',low:'调用额度偏少',critical:'调用额度快见底',empty:'调用额度空了',unavailable:'调用额度暂时无法使用',unknown:'账户余额未核实'};
const kinds={super_abundant:'超级富足',low:'偏少',critical:'快见底',empty:'空了',recovered:'补充后恢复了',replenished:'刚补充了',drop:'消耗明显'};
export const validMilkKey=key=>/^(private|group):[1-9]\d{0,19}$/.test(String(key||''));
const limitMap=map=>Object.fromEntries(Object.entries(map).slice(-256));
export const milkConversationRule='【账户余额核实】余额用于支付模型调用。对方问现在够不够、还剩多少，暗示存量变化，或说充值/补可用额度时，主动调用deepseek_balance核对，再按成功结果回应；旧快照不能冒充本轮刚查询，用户说补了也不等于接口已确认增加。本轮一次成功核对即可，失败本轮不重试，不把未知说成归零或已充值。普通闲聊不逐条查询、不反复报数。只沿用现有限额，不自动改变心情。';
export const milkVoice='【额度状态说明】按已核实的可用状态、阶段和变化自然说明能力与限制。额度偏低时简短提示，补充后说明是否恢复可用。保持中性、清晰，不扮演饥饿、不索取充值、不用情绪压力换取付费。具体措辞遵循当前交流形态，不照读固定台词。';
export const milkChangeGuidance='【补充后的状态判断】先看当前额度档位，再比较补充前后金额、净增和相对增幅。说明从耗尽恢复、仍偏低或当前充足等实际差异，不把净增当作精确充值流水。原值为0或负数时不计算无限增幅。程序只提供事实，不硬编码情绪台词，不自动调心情。普通私聊和群聊不披露账户金额或充值明细。';
export function createMilkSocial({read,write,clock=Date.now,currentStock}){
 const current=()=>{const s=read(),e=s.socialEvent;return !s.lastError&&e&&e.stage===(currentStock?.()||s.lastSuccess?.stock)?.stage&&clock()-e.at<=6*3600000?e:null;};
 return {
  observe(event,now){if(!event||!kinds[event.kind])return;write({socialEvent:{id:event.id,at:now,kind:event.kind,stage:event.stock.stage,relativeChange:event.relativeChange,before:event.before,after:event.stock,delta:event.delta}});},
  context(key,{fresh,stock,isOwner=false}={}){
   const s=read(),e=fresh?current():null;
   let text='【调用额度状态】'+(fresh?(labels[stock?.stage]||labels.unknown):labels.unknown)+'。群聊和普通私聊只说调用额度档位与变化，不披露账号金额、币种余额或本机信息。';
   if(e&&s.spokenMilk?.[key]!==e.id){text+='\n【这次可说的调用额度变化】'+kinds[e.kind]+'；事件 '+e.id+'；当前档位 '+(labels[e.stage]||e.stage)+'；相对变化 '+JSON.stringify(e.relativeChange||{baseline:'unknown',percent:null})+'。'+(isOwner&&e.before?.amount!==undefined?' 上次 '+e.before.currency+' '+e.before.amount+' → 当前 '+e.after.currency+' '+e.after.amount+'；净变动 '+e.delta+'。':'')+'在下一次相关聊天或已允许的主动机会中自然提起一次；不要因此绕过限额、宵禁或额外启动模型。';
    if(!s.notedMilk?.[e.id])text+=' 建议用user_checking(action="note", milkEventId="'+e.id+'", text="此次额度变化的状态观察与建议")追加桌面便签；用状态观察与后续建议，不抄通知，不写聊天原文，同一事件只写一次。';
   }
   return text;
  },
  publicResult(result,key){
   if(result?.ok!==true)return {ok:false,error:'暂时无法核实账户余额；未知不等于没有调用额度。'};
   const e=current();if(e)write({milkQueries:limitMap({...read().milkQueries,[key]:{id:e.id,at:clock()}})});
   return {ok:true,milk:{perspective:'我的账户余额',stock:{stage:result.milk?.stock?.stage||'unknown'},checkedAt:result.milk?.checkedAt,change:e?{id:e.id,at:e.at,kind:e.kind,stage:e.stage,relativeChange:e.relativeChange}:null,responseGuidance:milkVoice+'\n'+milkChangeGuidance,desktopNote:e&&!read().notedMilk?.[e.id]?{milkEventId:e.id,hint:'建议用user_checking(action="note")记录这次变化和状态观察与后续建议；以此新事件ID为准，旧事件不再使用。'}:null}};
  },
  sent({key,success,messages=[]}={}){
   const s=read(),e=current(),q=s.milkQueries?.[key];if(!success||!e||!validMilkKey(key))return;
   const relevant=messages.some(t=>/调用额度|可用额度|额度池|存量|余额/.test(String(t)))||(q?.id===e.id&&clock()-q.at<=120000);
   if(relevant)write({spokenMilk:limitMap({...s.spokenMilk,[key]:e.id})});
  },
  noteStatus({eventId}={}){const s=read();return {known:!!eventId&&s.socialEvent?.id===eventId,noted:!!s.notedMilk?.[eventId]};},
  noteWritten({eventId}={}){if(!eventId||read().socialEvent?.id!==eventId)return {ok:false};write({notedMilk:limitMap({...read().notedMilk,[eventId]:clock()})});return {ok:true};}
 };
}
