import {AsyncLocalStorage} from 'node:async_hooks';
import {z} from 'zod';
// The MCP input carries identity only. The bridge verifies it against admitted
// source content and owns every quota/permission decision.
export function createReplyContentCarrier(){
 const scope=new AsyncLocalStorage();
 return {
  decorate(name,rest){
   if(!/^(?:qq_(?:send_|reply$|schedule$|diary$|task_(?:spawn|list|result|input|cancel)$)|worklog_history$|diary_(?:history|read)$)/.test(name)||typeof rest[2]!=='function'||!rest[1]||typeof rest[1]!=='object')return rest;
   const [description,schema,handler,...tail]=rest;
   return [description,{...schema,contentId:z.string().max(200).regex(/^[A-Za-z0-9:_-]+$/).optional().describe('qq_reply_contents返回的完整用户内容ID；同一份内容跨工具/模型步骤保持不变，不因拆分重新领取。')},
    (input,...extra)=>scope.run({contentId:input?.contentId},()=>handler(input,...extra)),...tail];
  },
  headers(extra){const headers=new Headers(extra),id=scope.getStore()?.contentId;if(id)headers.set('x-reply-content-id',id);return headers;}
 };
}
