// Keep decimal amounts exact; balances in different currencies are never added.
export function decimal(value){
 const match=/^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(value??'').trim());
 if(!match||match[0].length>520)return null;
 const fraction=match[3]||'';return {units:BigInt((match[1]==='-'?'-':'')+match[2]+fraction),scale:fraction.length};
}
export function compare(a,b){const x=decimal(a),y=decimal(b);if(!x||!y)return null;const scale=Math.max(x.scale,y.scale),left=x.units*10n**BigInt(scale-x.scale),right=y.units*10n**BigInt(scale-y.scale);return left<right?-1:left>right?1:0;}
export function difference(a,b){const x=decimal(a),y=decimal(b);if(!x||!y)return null;const scale=Math.max(x.scale,y.scale),units=x.units*10n**BigInt(scale-x.scale)-y.units*10n**BigInt(scale-y.scale),absolute=(units<0n?-units:units).toString().padStart(scale+1,'0');return (units<0n?'-':'')+(scale?absolute.slice(0,-scale)+'.'+absolute.slice(-scale):absolute);}
export const DEFAULTS=Object.freeze({monitorEnabled:true,checkIntervalMin:5,currency:'CNY',abundantBalance:20,lowBalance:5,criticalBalance:1,reminderScope:'all',dropAlertAmount:5,notificationCooldownMin:30});
export function milkPolicy(config={}){return {...DEFAULTS,...config};}
export function validateMilkPolicy(config){
 const c=milkPolicy(config),errors=[];
 if(typeof c.monitorEnabled!=='boolean')errors.push('自动检查必须为布尔值');
 for(const [key,min,max] of [['checkIntervalMin',1,1440],['notificationCooldownMin',1,1440]])if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)errors.push(key+'必须为'+min+'–'+max+'的整数');
 for(const key of ['abundantBalance','lowBalance','criticalBalance','dropAlertAmount'])if(typeof c[key]!=='number'||!Number.isFinite(c[key])||c[key]<0||c[key]>1000000||!decimal(String(c[key]))||decimal(String(c[key])).scale>2)errors.push(key+'必须是0–1000000、最多两位小数的金额');
 if(c.criticalBalance>c.lowBalance)errors.push('见底阈值不能高于低库存阈值');
 if(c.abundantBalance<=c.lowBalance)errors.push('富足阈值必须高于偏少阈值');
 if(!['admin','private','all'].includes(c.reminderScope))errors.push('提醒范围必须是仅管理员、仅私聊或全部');
 if(!['CNY','USD'].includes(c.currency))errors.push('提醒币种必须为CNY或USD');
 return {ok:!errors.length,errors};
}
export function selectedStock(account,config={}){
 const c=milkPolicy(config),rows=(account?.balance_infos||[]).filter(row=>row.currency===c.currency);
 if(rows.length!==1||decimal(rows[0].total_balance)===null)return {stage:'unknown',currency:c.currency};
 const amount=rows[0].total_balance;
 const stage=compare(amount,'0')<=0?'empty':account.is_available===false?'unavailable':compare(amount,String(c.criticalBalance))<=0?'critical':compare(amount,String(c.lowBalance))<=0?'low':compare(amount,String(c.abundantBalance))>=0?'super_abundant':'normal';
 return {stage,currency:c.currency,amount};
}
export function milkPresentation({is_available,balance_infos=[]}={}){
 const amounts=balance_infos.map(row=>/^[A-Z]{3,8}$/.test(String(row.currency))?compare(row.total_balance,'0'):null);
 const state=amounts.some(value=>value===1)?'funded':amounts.length&&amounts.every(value=>value!==null&&value<=0)?'empty':'unknown';
 return {perspective:'我的账户余额',state,feeling:state==='empty'?'额度已耗尽':state==='funded'?'额度可用':'先核实存量',
  responseGuidance:'按本次核实的账户余额、变化和可用状态说明当前额度情况；需要报数时带币种，不混算币种，不把失败或未知说成零余额，不编造充值明细。'+(state==='empty'?'已确认额度耗尽，需要补充调用额度后才能继续调用。':state==='funded'?'已确认存在可用余额。':'当前无法确认余额。')+(is_available===false?'当前账户不可用；不可用不等于余额为零。':'')+'不自动修改心情或现有限额，不索取充值、不拟人化为饥饿。'};
}
function relativeChange(before,after){
 const x=decimal(before),y=decimal(after);if(!x||!y)return {baseline:'unknown',percent:null};
 if(x.units<=0n)return {baseline:'zero_or_below',percent:null};
 const scale=Math.max(x.scale,y.scale),a=x.units*10n**BigInt(scale-x.scale),b=y.units*10n**BigInt(scale-y.scale),percent=(b-a)*10000n/a,abs=(percent<0n?-percent:percent).toString().padStart(3,'0');
 return {baseline:'positive',percent:(percent<0n?'-':'')+abs.slice(0,-2)+'.'+abs.slice(-2)};
}
export function stockChange(previous,current,config={}){
 const c=milkPolicy(config),stock=selectedStock(current,c),before=selectedStock(previous,c);
 if(stock.stage==='unknown')return null;
 if(previous&&before.currency!==stock.currency)return ['normal','super_abundant','unknown'].includes(stock.stage)?null:{kind:stock.stage,urgent:true,stock};
 const changed=stock.stage!==before.stage;
 const delta=previous&&before.amount!==undefined?difference(stock.amount,before.amount):null;
 const event=(kind,urgent=false)=>({kind,urgent,stock,before,delta,relativeChange:relativeChange(before.amount,stock.amount)});
 if(changed&&stock.stage==='unavailable')return event('unavailable',true);
 if(previous&&changed&&['empty','unavailable','critical','low'].includes(before.stage)&&['normal','super_abundant'].includes(stock.stage))return event('recovered',true);
 if(compare(delta,'0')===1)return event('replenished',changed);
 if(changed&&['empty','critical','low','unavailable','super_abundant'].includes(stock.stage))return event(stock.stage,true);
 if(previous&&before.amount!==undefined&&c.dropAlertAmount>0&&compare(difference(before.amount,stock.amount),String(c.dropAlertAmount))>=0)return event('drop');
 return null;
}
export function stockNotice(event){
 const amount=event.stock?.currency+' '+event.stock?.amount;
 // Factual no-LLM health receipt only. Persona wording is generated from prompts.
 const label={super_abundant:'超级富足',low:'偏少',critical:'见底',empty:'空了',unavailable:'账户不可用',recovered:'补充后恢复',replenished:'补充',drop:'明显减少',query_restored:'查询恢复'}[event.kind]||'已核实';
 return '账户余额'+label+'：'+amount+'。'+(event.delta!=null?'净变化 '+event.delta+'。':'')+(event.kind==='replenished'&&['critical','low'].includes(event.stock?.stage)?'补充后仍处于'+(event.stock.stage==='critical'?'见底':'低库存')+'区间。':'')+(event.kind==='unavailable'?'接口报告当前账户不可用；不等于存量为零。':'');
}
