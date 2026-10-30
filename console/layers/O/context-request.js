// UI grouping of observed frozen messages, never a reconstruction of model input.
export function requestCards(request,catalog=[]){
 const messages=request.messages||[],nonce=request.nonce;
 const current=kind=>{const candidates=messages.filter(m=>m.source===kind);const exact=candidates.filter(m=>m.contextNonce&&m.contextNonce===nonce);return {rows:exact.length?exact:candidates.slice(-1),verified:exact.length>0};};
 const background=current('qq-context-current'),task=current('qq-context-dialogue'),system=messages.filter(m=>['system','developer'].includes(m.role));
 const selected=new Set([...system,...background.rows,...task.rows]);
 const numbers=new Map(catalog.map((m,index)=>[m.id,index+1]));
 const references=(group)=>(request.modules||[]).filter(m=>m.included!==false&&(group==='system'?m.id==='role-card':group==='task'?['wake-action','message-snapshot'].includes(m.id):!['role-card','wake-action'].includes(m.id))).map(m=>(numbers.get(m.id)||'?')+(m.id==='message-snapshot'?group==='task'?'.2 新增聊天原文':'.1 收件状态':' '+(m.name||m.id)));
 const card=(id,name,rows,refs,verified=true)=>({id,name,source:'DSH 实际请求记录',text:rows.map(m=>m.text).filter(Boolean).join('\n\n'),chars:rows.reduce((n,m)=>n+(m.chars||m.text?.length||0),0),references:refs,attributionVerified:verified,protected:true,included:rows.length>0,inRequest:rows.length>0});
 return {cards:[card('actual-system','系统设定与角色要求',system,[...references('system'),'DSH 自身系统规则']),card('actual-background','本轮背景 · 组件资料与收件状态',background.rows,references('background'),background.verified),card('actual-task','本轮任务 · 唤醒原因与新增 QQ 来信',task.rows,references('task'),task.verified)],history:messages.flatMap((m,index)=>selected.has(m)?[]:[{...m,requestIndex:index+1}])};
}
