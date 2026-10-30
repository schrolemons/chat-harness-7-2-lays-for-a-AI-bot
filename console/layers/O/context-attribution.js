// Read-only annotation: exact captured text only, never reconstruct model input.
export function attributeText(text='',modules=[],catalog=[]){
 const numbers=new Map(catalog.map((row,index)=>[row.id,index+1])),names=new Map(catalog.map(row=>[row.id,row.name])),patterns=new Map();
 for(const row of modules){
  if(row.notCaptured)continue;
  for(const part of row.parts?.length?row.parts:[{text:row.text}]){
   const value=String(part.text||'').trim();if(!value)continue;
   const id=row.id==='role-card'&&part.id==='ctx-context-dynamics:expression'?'ctx-context-dynamics':row.id;
   const catalogName=names.get(id);
   const owner={id,name:catalogName&&catalogName!==id?catalogName:id!==row.id?'心情与表情策略':row.name||id,number:numbers.get(id),part:part.name,...(id!==row.id?{evidence:'来源为心情组件；此段放入系统提示'}:{})};
   if(!patterns.has(value))patterns.set(value,[]);
   patterns.get(value).push(owner);
  }
 }
 const candidates=[];
 for(const [value,owners] of patterns){let start=text.indexOf(value);while(start!==-1){candidates.push({start,end:start+value.length,owners});start=text.indexOf(value,start+value.length);}}
 // Prefer the longest complete source when a module nests another module's text.
 candidates.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
 const ranges=[];for(const row of candidates)if(!ranges.some(r=>row.start<r.end&&row.end>r.start))ranges.push(row);
 ranges.sort((a,b)=>a.start-b.start);
 const segments=[];let cursor=0;
 for(const row of ranges){if(row.start>cursor)segments.push({text:text.slice(cursor,row.start),owners:[]});segments.push({text:text.slice(row.start,row.end),owners:row.owners});cursor=row.end;}
 if(cursor<text.length)segments.push({text:text.slice(cursor),owners:[]});
 return segments;
}

export function messageLabel(row){
 if(row.role==='tool'||row.toolResults?.length)return '工具返回数据';
 if(row.toolCalls?.length)return 'bot 发起的工具调用';
 if(row.role==='assistant')return 'bot 生成的文字（QQ 投递未核验）';
 if(row.source==='compact-checkpoint')return '会话压缩摘要';
 if(row.source==='runtime-context')return '运行环境说明';
 if(row.source==='qq-context-dialogue')return '先前回合任务与 QQ 来信';
 if(row.source==='qq-context-current')return '先前回合背景快照';
 if(row.source==='qq-context-stable')return '稳定会话资料（user 前缀）';
 if(row.source==='qq-context-update')return '心情、日程与资料的状态更新';
 return {system:'系统设定与角色要求',developer:'系统补充说明',user:'会话输入记录'}[row.role]||row.name||row.id;
}

export function partLabel(part){
 if(part.id==='receipt-state'||part.name==='收件状态')return '收件处理进度（放入背景资料）';
 if(part.id==='new-messages'||part.name==='新增聊天原文')return '新增聊天原文（随本轮任务提供）';
 return (part.name||'组件内容')+(part.destination==='background'?'（放入背景资料）':part.destination==='task'?'（随本轮任务提供）':'');
}

export function unmatchedLabel(message={}){
 if(message.source==='qq-context-stable')return {tag:'稳定资料',title:'稳定会话资料与状态解释规则',description:'保存会话背景、会话协议及稳定规则；若此消息还包含早期聊天，聊天原文保留在资料之后。'};
 if(message.source==='qq-context-update')return {tag:'动态更新',title:'组件状态更新与撤回说明',description:'组件有变化时才追加；同组件最后一条更新生效，早先状态仍保留在历史中。'};
 if(message.role==='system')return {tag:'系统记录',title:'DSH 系统提示与框架规则',description:'提供运行身份、权限边界和系统约定；此段没有与组件采集原文完整匹配。'};
 if(message.role==='tool'||message.toolResults?.length)return {tag:'工具记录',title:'工具返回数据',description:'记录工具执行结果、查询数据或错误，供模型继续处理。'};
 if(message.toolCalls?.length)return {tag:'工具记录',title:'bot 的工具调用与附带文字',description:'记录模型选择的工具、参数及同次生成的说明；调用 ID 用于配对返回结果。'};
 if(message.role==='assistant')return {tag:'生成记录',title:'bot 生成文字',description:'保留模型的回复或内部处理文字；是否发送到 QQ 需要结合发送工具结果判断。'};
 if(message.source==='compact-checkpoint')return {tag:'会话记录',title:'DSH 会话压缩摘要',description:'在压缩较早对话时生成，保留后续处理所需的聊天经过和任务线索。'};
 if(message.source==='runtime-context')return {tag:'环境记录',title:'DSH 运行环境更新',description:'由运行时按需补充当前环境信息；具体状态以这条记录正文为准。'};
 if(message.source==='tool-registry')return {tag:'工具记录',title:'DSH 工具注册变更',description:'在可用工具发生变化时补充注册信息；非文本内容的完整载荷未被本次预览采集。'};
 if(message.source==='qq-context-dialogue')return {tag:'回合记录',title:'桥接回合说明与任务衔接',description:'说明本次唤醒原因、任务要求或回合衔接信息；能够验证的 QQ 来信会单独标为 C36。'};
 if(message.source==='qq-context-current')return {tag:'背景记录',title:'桥接补充背景资料',description:'由桥接随本轮背景提供；此段与保存的组件原文未完整匹配，保留供核对。'};
 if(message.role==='user'&&message.source==='user')return {tag:'会话记录',title:'会话输入记录（来源组件未记录）',description:'这是以 user 角色进入模型请求的文字；旧采集未说明它是聊天原文还是管理补充。'};
 return {tag:'上下文记录',title:'其他上下文记录（来源组件未记录）',description:'按实际请求原样保留；当前只知道消息角色与来源字段，无法确认具体触发机制。'};
}

// Read one JSON container without swallowing any following task or text block.
function jsonEnd(text,start){
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
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
// compactModelMessage writes HH:MM on the same day and MM-DD HH:MM across days.
const qqTime=value=>Number.isFinite(value)||typeof value==='string'&&/^(?:(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]) )?(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const qqRows=value=>Array.isArray(value)&&value.every(row=>record(row)&&(Number.isSafeInteger(row.seq)||((row.messageId!==undefined||row.id!==undefined)&&(row.userId!==undefined||row.senderId!==undefined))||(typeof row.sender==='string'&&typeof row.text==='string'&&qqTime(row.at))));
export function attributeMessage(message={},modules=[],catalog=[]){
 const text=String(message.text||'');
 if(message.role==='user'&&message.source==='qq-context-update'&&message.contextSegments?.length){
  const out=[];let cursor=0;
  for(const segment of message.contextSegments){
   if(!message.contextUpdates?.some(update=>update.id===segment.id)||!segment.text)continue;
   const start=text.indexOf(segment.text,cursor);if(start<0)continue;
   out.push(...attributeText(text.slice(cursor,start),modules,catalog));
   const index=catalog.findIndex(slot=>slot.id===segment.id);
   const slotName=catalog[index]?.name,ownerName=slotName&&slotName!==segment.id?slotName:modules.find(row=>row.id===segment.id)?.name||segment.id;
   out.push({text:segment.text,owners:[{id:segment.id,number:index<0?undefined:index+1,name:ownerName,evidence:message.effectiveComponents?.includes(segment.id)?'本次请求的当前状态':'历史状态更新'}]});
   cursor=start+segment.text.length;
  }
  out.push(...attributeText(text.slice(cursor),modules,catalog));return out;
 }
 if(message.source==='qq-context-stable'&&message.wrappedSource==='qq-context-dialogue')message={...message,source:'qq-context-dialogue'};
 if(message.role!=='user'||!['qq-context-dialogue','qq-context-current'].includes(message.source))return attributeText(text,modules,catalog);
 const header=/(^|\n)(【(?:新增 QQ 消息数据|历史 QQ 消息数据|历史 QQ 消息数据；当轮规则已由当前 context 取代|QQ 收件状态)】)[ \t]*\r?\n/g;
 const ranges=[];let match;
 while((match=header.exec(text))){
  const receipt=match[2]==='【QQ 收件状态】';
  if(receipt!==(message.source==='qq-context-current'))continue;
  let start=header.lastIndex;while(/\s/.test(text[start]||'')&&start<text.length)start++;
  const end=jsonEnd(text,start);if(end<0)continue;
  let value;try{value=JSON.parse(text.slice(start,end));}catch{continue;}
  const legacy=match[2].includes('当轮规则');
  if(receipt?!(record(value)&&Array.isArray(value.receipts)&&Number.isFinite(value.unreadCount)):legacy?!(record(value)&&qqRows(value.messages)):!qqRows(value))continue;
  const index=catalog.findIndex(row=>row.id==='message-snapshot'),slot=catalog[index];
  const part=receipt?'收件状态':legacy?'历史来信与收件处理进度':match[2]==='【历史 QQ 消息数据】'?'历史聊天原文（保留对话经过）':'聊天原文（随该回合任务提供）';
  ranges.push({start:match.index+match[1].length,end,owner:{id:'message-snapshot',number:index<0?36:index+1,name:slot?.name||'本轮 QQ 消息与收件状态',part,evidence:'桥接来源标记与 JSON 结构已核对'}});
  header.lastIndex=end;
 }
 const out=[];let cursor=0;
 for(const range of ranges){out.push(...attributeText(text.slice(cursor,range.start),modules,catalog));out.push({text:text.slice(range.start,range.end),owners:[range.owner]});cursor=range.end;}
 out.push(...attributeText(text.slice(cursor),modules,catalog));
 return out;
}
