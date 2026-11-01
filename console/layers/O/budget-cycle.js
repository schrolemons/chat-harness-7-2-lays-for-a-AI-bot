import {api} from '../../shared/api.js';
const valid=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export function mountBudgetCycle({onSaved}){
 const input=document.getElementById('usageBudgetResetTime'),button=document.getElementById('usageBudgetResetSave');
 const message=document.getElementById('usageBudgetResetMsg'),summary=document.getElementById('usageBudgetCycleSummary');
 let loaded=false,dirty=false,saving=false,request=null,revision=0;
 const render=value=>{summary.textContent=`每天 ${value}（北京时间）开始新额度周期。`;};
 input.addEventListener('input',()=>{dirty=true;});
 async function refresh(){
  if(saving)return;
  if(request)return request;
  const ticket=++revision;
  request=(async()=>{
   try{
    const result=await api('/api/plugins/detail?id=life-token-budget');
    if(ticket!==revision)return;
    if(!result.ok||!result.plugin?.config)throw Error(result.error||'未取得额度配置');
    const value=result.plugin.config.dailyResetTime??'22:00';
    if(!valid(value))throw Error('额度重置时间格式无效');
    loaded=true;render(value);if(!dirty)input.value=value;
    input.disabled=false;button.disabled=false;
   }catch(error){if(ticket===revision){message.textContent='读取失败：'+error.message;message.className='meta err';input.disabled=!loaded;button.disabled=!loaded;}}
  })().finally(()=>{request=null;});
  return request;
 }
 button.addEventListener('click',async()=>{
  if(!loaded||saving)return;
  const value=input.value;
  if(!valid(value)){message.textContent='请选择00:00–23:59之间的时间';message.className='meta err';return;}
  saving=true;revision++;input.disabled=true;button.disabled=true;
  try{
   const result=await api('/api/plugins/config','POST',{id:'life-token-budget',config:{dailyResetTime:value}});
   if(!result.ok)throw Error(result.error||'配置校验失败');
   dirty=false;render(value);message.textContent='每日额度重置时间已保存，本周期已按新时间重算';message.className='meta ok';
   await onSaved();
  }catch(error){message.textContent='保存失败：'+error.message;message.className='meta err';}
  finally{saving=false;input.disabled=false;button.disabled=false;}
 });
 return {refresh};
}
