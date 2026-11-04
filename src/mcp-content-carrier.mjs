import {AsyncLocalStorage} from 'node:async_hooks';
import {z} from 'zod';
// The MCP input carries identity only. The bridge verifies it against admitted
// source content and owns every quota/permission decision.
export function createReplyContentCarrier(){
 const scope=new AsyncLocalStorage();
 return {
  decorate(name,rest){
   if(!/^qq_(?:send_|reply$|schedule$|task_(?:spawn|input|cancel)$)/.test(name)||typeof rest[2]!=='function'||!rest[1]||typeof rest[1]!=='object')return rest;
   const [description,schema,handler,...tail]=rest;
   const hint = name==='qq_schedule'
    ? '查询 list 不需要。新增、修改、确认完成或取消时沿用已准入任务组的 contentId。'
    : '多条来信时，即使只发一条，也先用本回合完整已读seq调用qq_reply_contents；同义碎片合为一组，发送显式携带返回的contentId。只有服务端已绑定单条来信时可省略；引用也不能跳过分组，同一份跨步骤保持ID。';
   return [description,{...schema,contentId:z.string().max(200).regex(/^[A-Za-z0-9:_-]+$/).optional().describe(hint)},
    (input,...extra)=>scope.run({contentId:input?.contentId},()=>handler(input,...extra)),...tail];
  },
  headers(extra){const headers=new Headers(extra),id=scope.getStore()?.contentId;if(id)headers.set('x-reply-content-id',id);return headers;}
 };
}
