// Presentation of frozen request messages only; this never changes model input.
export function previewRequestToolResults(message){
 const blocks=(message?.content||[]).filter(block=>block.type==='tool-result').map(block=>({toolCallId:block.toolCallId,...(block.name?{name:block.name}:{})}));
 if(message?.role==='tool'&&typeof message.toolCallId==='string'&&!blocks.some(block=>block.toolCallId===message.toolCallId))blocks.push({toolCallId:message.toolCallId});
 return blocks;
}
export function previewRequestMessage(message){return (message?.content||[]).map(block=>block.type==='text'?block.text:['tool-call','tool-result'].includes(block.type)?JSON.stringify(block):block.type==='tool-addition'?'【工具定义新增】'+(block.toolName||'名称未采集'):block.type==='tool-removal'?'【工具定义移除】'+(block.toolName||'名称未采集'):'【'+block.type+' · 结构化内容，正文未展开】').join('\n');}
export function previewRequestBlocks(message){return (message?.content||[]).filter(block=>block.type!=='text').map(block=>({type:block.type,...(block.toolName?{toolName:block.toolName}:{}),...(block.type==='tool-call'?{name:block.name,id:block.id}:{}),...(block.type==='tool-result'?{toolCallId:block.toolCallId}:{}),...(block.mimeType?{mimeType:block.mimeType}:{})}));}
export function deliveryDestination(id){return id==='role-card'?'system':id==='wake-action'?'task':'background';}
