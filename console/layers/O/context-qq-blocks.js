// Shared decoder for bridge-owned QQ containers in captured requests. Source
// checks stay with callers; headers inside JSON strings never become new blocks.
export function jsonContainerEnd(text,start){
 if(!['[','{'].includes(text[start]))return -1;
 const stack=[];let quoted=false,escaped=false;
 for(let i=start;i<text.length;i++){
  const c=text[i];
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;continue;}
  if(c==='['||c==='{')stack.push(c);
  else if(c===']'||c==='}'){
   if(stack.pop()!==(c===']'?'[':'{'))return -1;
   if(!stack.length)return i+1;
  }
 }
 return -1;
}
export function qqDialogueBlocks(text=''){
 const marker=/(^|\n)(【(?:(?:新增|历史|待处理|未处理) QQ 消息数据|历史 QQ 消息数据；当轮规则已由当前 context 取代)】)\s*/g,blocks=[];let match;
 while((match=marker.exec(text))){
  const start=match.index+match[1].length,jsonStart=marker.lastIndex,end=jsonContainerEnd(text,jsonStart);if(end<0)continue;
  let rows;try{rows=JSON.parse(text.slice(jsonStart,end));}catch{continue;}
  if(match[2].includes('当轮规则')&&rows&&Array.isArray(rows.messages))rows=[...(Array.isArray(rows.recent)?rows.recent:[]),...(Array.isArray(rows.receiptWindow)?rows.receiptWindow:[]),...rows.messages];
  if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))continue;
  blocks.push({start,end,heading:match[2],rows});marker.lastIndex=end;
 }
 return blocks;
}
