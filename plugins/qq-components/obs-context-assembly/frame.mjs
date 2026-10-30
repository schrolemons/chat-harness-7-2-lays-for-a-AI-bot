import {COMMON_CHAT_PROTOCOL} from '../life-wake-reasons/chat-entry-guidance.mjs';
// Source attribution at the transport seam; business prompts remain with their owners.
export function frameModules({modules=[],extras=[],roleText='',backgroundText='',prompt='',snapshot,slangText=''}){
 const out=[];let rest=prompt;
 const remove=text=>{if(text)rest=rest.replace(text,'');};
 if(roleText){out.push({id:'role-card',name:'当前角色设定',source:'C · 人格与角色',text:roleText,protected:true});remove(roleText);}
 if(backgroundText)out.push({id:'session-background',name:'当前会话的固定背景',source:'C · 会话背景',text:backgroundText});
 for(const row of [...extras,...modules]){remove(row.text);let text=row.text;if(row.id==='ctx-context-session'&&backgroundText)text=text.replace(backgroundText,'').trim();out.push({...row,text});}
 if(snapshot){const text=JSON.stringify(snapshot);remove('【本次消息快照】\n'+text);out.push({id:'message-snapshot',name:'本轮 QQ 消息与收件状态',source:'桥接 · 真实消息窗口',text,protected:false});}
 const delivery=rest.indexOf('【逐条看完，别只回最后一条】');
 if(delivery>=0){out.push({id:'delivery-rules',name:'回复与收件确认规则',source:'L · 回合投递协议',text:rest.slice(delivery),protected:true});rest=rest.slice(0,delivery);}
 if(slangText.trim())out.push({id:'slang-context',name:'当前会话黑话',source:'C · 黑话词库',text:slangText});
 // These are generated protocol paragraphs, never taken from a QQ message body.
 const protocol=[];
 if(snapshot&&[...(snapshot.messages||[]),...(snapshot.recent||[])].some(message=>Number.isSafeInteger(message.dialogueSeq)))protocol.push('【消息编号】dialogueSeq 是双方共用的对话序号；seq 是入站消息的收件序号。回执和读取水位参数仍使用 seq，不可填 dialogueSeq；引用仍使用 messageId。');
 if(rest.includes(COMMON_CHAT_PROTOCOL)){protocol.push(COMMON_CHAT_PROTOCOL);remove(COMMON_CHAT_PROTOCOL);}
 if(snapshot&&[...(snapshot.messages||[]),...(snapshot.recent||[]),...(snapshot.receiptWindow||[])].some(message=>message.truncated))protocol.push('【消息节选说明】truncated=true 表示本次自动附带的文字已节选；缺失部分不能用于推断事实，需要时按messageId/seq查询原文。节选不等于完整原文，也不改变双戳和真实发送凭据。');
 rest=rest.split(/\n\s*\n/).filter(block=>{if(/^【双戳窗口回查｜按消息条数】/.test(block.trim())){protocol.push(block.trim());return false;}return true;}).join('\n\n');
 if(protocol.length){const existing=out.find(row=>row.id==='session-protocol');if(existing)existing.text=[existing.text,...protocol].filter(Boolean).join('\n\n');else out.push({id:'session-protocol',name:'会话处理规则',source:'桥接 · 回执处理约定',text:protocol.join('\n\n'),protected:true});}
 out.push({id:'wake-action',name:'本次处理任务',source:'L · 处理触发原因',text:rest.trim(),protected:true});
 return out;
}
