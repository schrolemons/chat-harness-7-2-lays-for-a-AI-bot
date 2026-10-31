// Presentation-only partitions. Labels refer to receipt facts captured then, not the live unread queue.
import {esc} from '../../shared/api.js';
import {messageBodyParts,quoteBodyHtml} from './context-message-body.js';
import {qqDialogueBlocks} from './context-qq-blocks.js';
const waitTools=new Set(['qq_wait_for_messages','qq_wait_for_quiet']);
const messageReaders=new Set(['qq_get_recent_messages','qq_get_unread_messages','qq_get_my_recent_messages']);
const json=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
export function classifyReceipt(row){
 if(row.isSelf===true)return 'self';
 const state=row.receiptState||row.receiptStatus||row.replyStatus||row.state||row.status;
 const positive=value=>Number.isFinite(Number(value))&&Number(value)>0;
 const seen=positive(row.seenAt)||positive(row.readAt),replied=positive(row.repliedAt);
 if(state==='anomaly'||replied&&!seen)return 'anomaly';
 if(['complete','replied'].includes(state)||seen&&replied)return 'complete';
 if(state==='resolved'||seen&&positive(row.resolvedAt)&&row.resolutionReason)return 'resolved';
 if(state==='seen'||row.awaitingReply===true||seen||row.read===true)return 'seen';
 if(state==='unseen'||row.read===false)return 'unseen';
 if(state==='pending')return 'pending';
 return 'unknown';
}
export function capturedToolResults(message){
 if(message.role!=='tool'&&!message.toolResults?.length)return [];
 const whole=json(String(message.text||'')),blocks=whole?[whole]:String(message.text||'').split('\n').map(json).filter(Boolean);
 return (message.toolResults||[]).map(result=>{
  const block=blocks.find(row=>row?.type==='tool-result'&&row.toolCallId===result.toolCallId);
  let body=block?.content??(message.toolResults.length===1&&whole?.type!=='tool-result'?whole:null);
  const textContent=value=>Array.isArray(value)&&value.length>0&&value.every(row=>row&&['text','image','resource','resource_link'].includes(row.type))?value.filter(row=>row.type==='text').map(row=>row.text).join('\n'):value;
  body=json(textContent(body));
  const envelopeError=body?.isError===true;
  if(body?.content&&Array.isArray(body.content))body=json(textContent(body.content));
  if(Array.isArray(body)&&messageReaders.has(String(result.name||'').split('__').at(-1)))body={messages:body};
  return {...result,data:body&&typeof body==='object'&&!Array.isArray(body)?body:null,isError:message.isError===true||block?.isError===true||envelopeError||/^Error\s*[:：]/.test(message.text||'')};
 });
}
export function toolMessageRows(name,data={}){return (String(name||'').split('__').at(-1)==='qq_get_message_detail'?[data.info||data.message].filter(Boolean):[...(Array.isArray(data.messages)?data.messages:[]),...(Array.isArray(data.newMessages)?data.newMessages:[])]).filter(row=>row&&typeof row==='object'&&!Array.isArray(row));}
export function messageReadParts(message){return capturedToolResults(message).filter(result=>(messageReaders.has(String(result.name||'').split('__').at(-1))||String(result.name||'').split('__').at(-1)==='qq_get_message_detail')&&result.data&&!result.isError&&result.data.ok!==false&&!result.data.error).map(result=>({...result,data:{...result.data,messages:toolMessageRows(result.name,result.data)}}));}
export function waitResultParts(message){
 return capturedToolResults(message).filter(result=>waitTools.has(String(result.name||'').split('__').at(-1))&&!result.isError&&result.data?.ok!==false&&result.data&&!result.data.error&&['arrived','endRound','quiet','waitedMs','newMessages'].some(key=>Object.hasOwn(result.data,key)));
}
function qqMessagesHtml(rows,{businessBySeq}={}){
 return '<div class="context-qq-messages">'+rows.map(row=>{
  const state=classifyReceipt(row);
  const resolved=businessBySeq?.get(row.seq);
  const label=resolved?resolved.windowLabel+' · '+resolved.stateLabel:state==='self'?'QQ 历史消息 · bot':state==='complete'?'QQ 历史消息 · 处理完成':state==='resolved'?'QQ 历史消息 · 管理归档':['seen','unseen'].includes(state)?'QQ 未处理消息 · '+(state==='seen'?'已读待处理':'未读'):'QQ 消息（状态未知）';
  const {text,quoted}=messageBodyParts(row);
  return '<article class="context-qq-message'+(row.isSelf?' is-self':'')+'"><header><strong>'+(row.isSelf?'bot · ':'')+esc(row.sender||row.nickname||row.userId||(row.isSelf?'bot':'发送者未记录'))+'</strong><span>'+esc(row.at||'')+(row.at?' · ':'')+esc(label)+(Number.isSafeInteger(row.seq)?' · QQ seq '+row.seq:'')+'</span></header>'+quoteBodyHtml(quoted)+(typeof text==='string'?'<pre class="context-chat-body">'+esc(text)+'</pre>':'<p>未采集正文。</p>')+(row.truncated?'<p class="context-excerpt-note">本条为节选。</p>':'')+'<details><summary>原始字段</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details></article>';
 }).join('')+'</div>';
}
function waitDetails(message){
 return waitResultParts(message).map(({name,toolCallId,data})=>{
  const fields=[];
  const field=(label,value)=>fields.push('<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>');
  if(typeof data.endRound==='boolean')field('本轮判定',data.endRound?'结束本轮':'继续本轮');
  if(typeof data.arrived==='boolean')field('是否有新来信',data.arrived?'有':'无');
  if(typeof data.quiet==='boolean')field('返回的静默判定',data.quiet?'达到静默条件':'未达到静默条件');
  if(typeof data.timeout==='boolean')field('是否超时',data.timeout?'是':'否');
  for(const [key,label,unit]of [['waitedMs','本次已等待',' 毫秒'],['emptyWaits','连续无人回复判定',' 次'],['probabilityPercent','本次结束概率','%']])if(typeof data[key]==='number'&&Number.isFinite(data[key]))field(label,data[key]+unit);
  const actions={followup:'继续旧话题追问',newTopic:'开启新话题',wait:'继续等待'};
  const action=data.endRound===true?'结束本轮':data.arrived===true?'处理收到的来信':actions[data.action]||(data.purpose==='reply'?(data.quiet?'回应现有消息':'判断是否继续等对方说完'):'返回建议（分支未记录）');
  const advice=[...new Set([data.guidance,data.hint].filter(value=>typeof value==='string'&&value.trim()))];
  const rows=Array.isArray(data.newMessages)?data.newMessages.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)):[];
  return '<section class="context-record-part context-wait-decision"><h4>等待判定</h4><p><code>'+esc(name)+'</code> · 对应调用 '+esc(toolCallId||'未记录')+'</p><dl class="context-detail-fields">'+fields.join('')+'</dl></section><section class="context-record-part context-action-advice"><h4>下一步行动建议 · '+esc(action)+'</h4><p>工具建议，不是已发送的 QQ 消息。</p>'+advice.map(value=>'<pre>'+esc(value)+'</pre>').join('')+(data.reason?'<p>原因：<code>'+esc(data.reason)+'</code></p>':'')+'</section><section class="context-record-part"><h4>工具返回的 QQ 消息 · '+rows.length+' 条</h4>'+(data.partial===true?'<p>结果有截断。</p>':'')+qqMessagesHtml(rows,{businessBySeq:message.qqBySeq})+'</section>';
 }).join('');
}
export function dialogueParts(message){
 if(message.role!=='user'||!(message.source==='qq-context-dialogue'||message.source==='qq-context-stable'&&message.wrappedSource==='qq-context-dialogue'))return null;
 const text=String(message.text||''),blocks=qqDialogueBlocks(text);if(!blocks.length)return null;
 const records=blocks.flatMap(block=>block.rows),at=blocks[0].start;
 const groups={history:[],unread:[],pending:[],unknown:[]};
 for(const row of records){
  const state=classifyReceipt(row);
  if(['self','complete'].includes(state))groups.history.push(row);
  else if(state==='seen'||state==='pending')groups.pending.push(row);
  else if(state==='unseen')groups.unread.push(row);
  else groups.unknown.push(row);
 }
 const prefix=text.slice(0,at).trim(),start=message.source==='qq-context-stable'?prefix.lastIndexOf('【QQ 回合 '):0;
 const remainder=blocks.map((block,index)=>text.slice(block.end,blocks[index+1]?.start??text.length).trim()).filter(Boolean).join('\n');
 const task=[message.source==='qq-context-stable'?(start>=0?prefix.slice(start):''):prefix,remainder].filter(Boolean).join('\n');
 return {task,stablePrefix:message.source==='qq-context-stable'?(start>=0?prefix.slice(0,start).trim():prefix):'',records,...groups};
}
export function inputOrigin(message){
 if(message.source==='qq-context-task')return {title:'本次处理要求',description:'仅保留本次触发原因和当前任务。',evidence:'桥接任务槽位'};
 if(message.source==='qq-context-dialogue')return {title:'桥接任务与 QQ 消息',description:'任务由桥接生成，QQ 原文按处理窗口展示。',evidence:'桥接来源标记'};
 if(message.source==='tool-registry')return {title:'工具定义变化',description:'DSH 对比前后工具清单后记录新增或移除项，不是模型调用工具，也不执行工具。',evidence:'DSH 工具注册来源标记'};
 if(message.role==='user'&&message.source==='user'&&/^【当前时间】/.test(message.text||'')&&/【提醒】你还没有完成回合收尾/.test(message.text||'')&&/【会话令牌】/.test(message.text||''))return {title:'桥接收尾提醒（历史记录）',description:'桥接在模型尚未完成处理收尾时追加的提醒，附带当时的身份、时间、黑话与发送额度；不是 QQ 用户发言。历史文字不代表当前仍启用同样的等待规则。',evidence:'按桥接收尾提醒格式识别；原记录没有独立的组件来源标记'};
 if(message.role==='user'&&message.source==='user')return {title:'会话外部输入（未记录具体提交方）',description:'原日志只标记为 user 输入。不能据此认定是 QQ 来信，也不能认定由某个插件生成。请核对正文与原始事件位置。',evidence:'来源信息不完整'};
 return null;
}
export function recordDetails(message){
 const origin=inputOrigin(message),evidence=message.provenance,parts=dialogueParts(message),changes=(message.contentBlocks||evidence?.toolChanges||[]).filter(block=>['tool-addition','tool-removal'].includes(block.type));
 let html=waitDetails(message)+(origin?'<div class="context-record-origin"><strong>'+esc(origin.title)+'</strong><p>'+esc(origin.description)+'</p><small>识别依据：'+esc(origin.evidence)+'</small></div>':'');
 for(const result of messageReadParts(message)){const rows=result.data.messages.filter(row=>row&&typeof row==='object'&&!Array.isArray(row));html+='<section class="context-record-part"><h4>聊天记录 · '+rows.length+' 条</h4>'+qqMessagesHtml(rows,{businessBySeq:message.qqBySeq})+'</section>';}
 if(message.triggerInfo){const trigger=message.triggerInfo;html+='<section class="context-record-part context-trigger"><h4>触发机制 · '+esc(trigger.title)+'</h4><p>'+esc(trigger.description)+'</p><small>'+esc(trigger.note)+'</small></section>';}
 else if(message.source==='qq-context-dialogue'){
  const reason=String(message.text||'').match(/【QQ 回合\s+([^】]+)】|(?:^|\n)原因：([^\n]+)/)?.slice(1).find(Boolean);
  const reasons={probability:'群聊普通消息通过概率判定',memoryWrite:'后台整理会话记忆',atMention:'有人 @ bot',message:'收到来信',timeBubble:'定时冒泡',proactiveCheck:'静默后的主动检查',replyCheck:'检查来信是否需要回复',reminder:'日程提醒'};
  html+='<p class="context-detail-note">处理触发原因：'+esc(reasons[reason]||reason||'原记录未提供')+'。这里的触发不一定表示从空闲开始；bot 已在处理时，新来信可接入同一次持续处理。历史任务被本次请求携带，不代表刚刚再次触发。</p>';
 }
 if(evidence)html+='<dl class="context-detail-fields"><div><dt>原始事件</dt><dd>'+esc(evidence.eventType)+' · seq '+esc(evidence.eventSeq)+'</dd></div>'+(evidence.recordedAt?'<div><dt>原始产生时间</dt><dd>'+esc(new Date(evidence.recordedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+'</dd></div>':'')+(evidence.headerSeq!==undefined?'<div><dt>工具定义出处</dt><dd>request/header · seq '+esc(evidence.headerSeq)+'</dd></div>':'')+'</dl>';
 if(changes.length)html+='<section class="context-record-part"><h4>工具定义变化 · '+changes.length+' 项</h4><p>只记录可用工具变化，不执行工具；历史移除不代表本次仍不可用，当前以所选请求的工具列表为准。</p><ul>'+changes.map(block=>'<li><strong>'+esc(block.type==='tool-addition'?'新增':'移除')+'</strong> <code>'+esc(block.toolName||'名称未采集')+'</code></li>').join('')+'</ul></section>';
 else if(message.source==='tool-registry')html+='<p class="context-detail-note">本条旧采集没有保存工具名称，且当前未能从原始日志恢复；不能据占位符推断是哪几个工具。</p>';
 if(/非文本载荷|结构化内容，正文未展开/.test(message.text||''))html+='<p class="context-detail-note">“非文本载荷／结构化内容”是预览生成的占位说明，不是发给模型的字面文字。上方只展示本次采集或原始日志能恢复的字段。</p>';
 if(parts){
  if(parts.task)html+='<section class="context-record-part"><h4>桥接处理任务 · C39</h4><pre>'+esc(parts.task)+'</pre></section>';
  const groups={history:[],arrivals:[],unknown:[]};
  for(const row of [...parts.history,...parts.unread,...parts.pending,...parts.unknown]){const resolved=message.qqBySeq?.get(row.seq),state=classifyReceipt(row),region=resolved?.region||(['self','complete','resolved'].includes(state)?'history':['seen','unseen'].includes(state)?'arrivals':'unknown');groups[region].push(row);}
  for(const [key,label]of [['history','QQ 历史消息'],['arrivals','QQ 未处理消息'],['unknown','QQ 消息（状态未知）']])if(groups[key].length)html+='<section class="context-record-part"><h4>'+label+' · '+groups[key].length+' 条</h4>'+qqMessagesHtml(groups[key].sort((a,b)=>a.seq-b.seq),{businessBySeq:message.qqBySeq})+'</section>';
 }
 return html;
}
