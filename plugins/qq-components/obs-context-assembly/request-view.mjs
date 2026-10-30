// Presentation of frozen request messages only; this never changes model input.
export function previewRequestMessage(message){return (message?.content||[]).map(block=>block.type==='text'?block.text:['tool-call','tool-result'].includes(block.type)?JSON.stringify(block):'【'+block.type+' · 非文本载荷】').join('\n');}
export function deliveryDestination(id){return id==='role-card'?'system':id==='wake-action'?'task':'background';}
