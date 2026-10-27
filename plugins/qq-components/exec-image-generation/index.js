import crypto from 'node:crypto';
export async function createPlugin(ctx){
 const {createImageEngine}=await import('./engine.mjs?generation='+crypto.randomUUID());
 const engine=createImageEngine({root:ctx.root,config:ctx.config,signal:ctx.signal,readReferences:(request)=>ctx.capabilities.readImageReferences?.(request)||[]});
 ctx.registerTool('image_generation_secret',{description:'仅管理员配置生图密钥；状态不返回密钥',handler:input=>engine.secret(input)});
 ctx.registerTool('image_generation_status',{description:'查询生图服务设置与当天使用量',handler:input=>engine.status(input)});
 return {services:{imageGeneration:{create:input=>engine.create(input),get:input=>engine.get(input),asset:input=>engine.asset(input),status:input=>engine.status(input),claimSend:input=>engine.claimSend(input),finishSend:input=>engine.finishSend(input)}},hooks:{beforePrompt(payload){if(!engine.status().configured)return '';const incoming=String(payload?.incomingText||'');if(!/(梗图|表情包|画一张|生成图片|改图)/.test(incoming)&&!ctx.config.allowAutomatic)return '';return '【小鲸鱼生图】你可以按需使用 qq_make_meme 提交提示词和当前会话参考消息 ID，再用 qq_get_meme_job 查询；完成后用 qq_send_image 将生成图片发到同一会话。只有发送工具返回成功才能说已经发出。普通聊天仅在启用主动生图且确实适合时调用，注意每日额度。';}}};
}
