import {AsyncLocalStorage} from 'node:async_hooks';
import {z} from 'zod';
// The MCP input carries identity only. The bridge verifies it against admitted
// source content and owns every quota/permission decision.
export function createReplyContentCarrier({declareContents}={}){
 const scope=new AsyncLocalStorage();
 return {
  decorate(name,rest){
   if(!/^qq_(?:send_|relay_image$|reply$|schedule$|task_(?:spawn|input|cancel)$)/.test(name)||typeof rest[2]!=='function'||!rest[1]||typeof rest[1]!=='object')return rest;
   const [description,schema,handler,...tail]=rest;
   const compound=name==='qq_send_message'||name==='qq_reply'||name==='qq_relay_image';
   const hint = name==='qq_schedule'
    ? '查询 list 不需要。新增、修改、确认完成或取消时沿用已准入任务组的 contentId。'
    : /^(?:qq_relay_image|qq_send_(?:private_message|group_message|poke))$/.test(name)
      ? '跨会话发送须用发起私聊的原指令声明 task，并带上该组已准入的 contentId；目标须与原指令一致。'
      : '多条来信时，即使只发一条，也先用本回合完整已读seq调用qq_reply_contents；同义碎片合为一组，发送显式携带返回的contentId。只有服务端已绑定单条来信时可省略；引用也不能跳过分组，同一份跨步骤保持ID。';
   return [description,{...schema,
    ...(compound?{sourceSeqs:z.array(z.number().int().positive()).min(1).max(100).optional().describe(name==='qq_relay_image'
      ?'发起私聊中本次完整传图指令的准确seq；程序按准确seq校验并接手该task，再尝试发图，contentId由服务端确定。不能填写图片的旧seq或目标会话seq。'
      :'本轮一份完整聊天意思的准确来源seq。同义碎片可同组；程序按seq校验分组并确定contentId，无需手抄长ID或单独调用qq_reply_contents。不同意思分别分组。')}:{})
    ,contentId:z.string().max(200).regex(/^[A-Za-z0-9:_-]+$/).optional().describe(hint+(compound?' 也可用sourceSeqs让程序先完成同一份声明再发送，二选一。':''))},
    async(input,...extra)=>{
     let contentId=input?.contentId,bound;
     if(compound&&input?.sourceSeqs){
      if(typeof declareContents!=='function')throw Error('本次未发送：内容声明能力未加载');
      const kind=name==='qq_relay_image'?'task':'auto',seqs=[...new Set(input.sourceSeqs)].sort((a,b)=>a-b);
      const key=name==='qq_reply'?'group:'+String(input.groupId):input.key;
      const result=await declareContents({key,token:input.token,groups:[{seqs,kind}]});
      const content=result?.contents?.[0];
      if(result?.ok!==true||!Array.isArray(result.contents)||result.contents.length!==1||content?.key!==key||!(kind==='auto'?['chat','task'].includes(content.kind):content.kind===kind)||content.taskPending===true||!Array.isArray(content.seqs)
        ||JSON.stringify([...content.seqs].sort((a,b)=>a-b))!==JSON.stringify(seqs)||!/^content:[A-Za-z0-9_-]+$/.test(content.id)
        ||content.kind==='task'&&content.taskExempt!==true)throw Error('本次未发送：内容声明或任务接手尚未通过');
      contentId=content.id;bound={contentId,seqs,kind:content.kind};
     }
     const value=await scope.run({contentId},()=>handler({...input,...(contentId?{contentId}:{})},...extra));
     if(!bound||!Array.isArray(value?.content))return value;
     return {...value,content:value.content.map(block=>{
      if(block.type!=='text')return block;
      try{const data=JSON.parse(block.text);if(data&&typeof data==='object'&&!Array.isArray(data))return {...block,text:JSON.stringify({...data,replyContent:bound})};}catch{}
      return block;
     })};
    },...tail];
  },
  headers(extra){const headers=new Headers(extra),id=scope.getStore()?.contentId;if(id)headers.set('x-reply-content-id',id);return headers;}
 };
}
