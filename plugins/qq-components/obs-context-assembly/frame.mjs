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
 out.push({id:'wake-action',name:'本轮唤醒任务',source:'L · 唤醒原因',text:rest.trim(),protected:true});
 return out;
}
