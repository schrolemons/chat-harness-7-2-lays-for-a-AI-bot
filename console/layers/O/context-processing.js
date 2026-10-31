// Read-only business projection over the selected request. Never consult live-now state.
import {esc} from '../../shared/api.js';
import {dialogueParts,capturedToolResults,classifyReceipt,toolMessageRows} from './context-records.js';
import {extractToolDeliveries,extractForwardMessages,TEXT_SEND_TOOLS,deliveryTarget} from './context-deliveries.js';
import {messageActor} from './context-timeline.js';
import {messageBodyParts,quoteBodyHtml} from './context-message-body.js';
import {storedToolEffect} from './context-output-effects.js';
export {classifyReceipt} from './context-records.js';
const short=name=>String(name||'').split('__').at(-1);
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
const readers=new Set(['qq_get_recent_messages','qq_get_unread_messages','qq_get_my_recent_messages','qq_get_message_detail','qq_wait_for_messages','qq_wait_for_quiet']);
const senders=TEXT_SEND_TOOLS;
const labels={self:'bot QQ 消息',complete:'已完成处理',resolved:'管理归档（保留原记录）',seen:'已读待处理',unseen:'未读',pending:'待处理（读戳未采集）',anomaly:'双戳异常',unknown:''};
function receiptSnapshot(message){
 const chunks=(message.contextSegments||[]).filter(part=>part.id==='message-snapshot').map(part=>part.text);
 if(message.source==='qq-context-current')chunks.push(message.text||'');
 return chunks.flatMap(text=>{
  const marker=['【QQ 收件状态】','【本次消息快照】'].find(value=>text.includes(value));if(!marker)return [];
  const value=parse(text.slice(text.indexOf(marker)+marker.length).trim().split('\n')[0]);
  if(!value||typeof value!=='object')return [];
  return ['receipts','recent','messages','receiptWindow'].flatMap(key=>Array.isArray(value[key])?value[key]:[]);
 });
}
export function processingEntries(request,messages){
 const records=new Map(),tasks=[],quotes=new Map(),stablePrefixes=new Map(),consumed=new Set();let unsequenced=0,bodyOrder=0;
 const record=(row,message,label,{receiptOnly=false,authoritative=false}={})=>{
  if(!row||typeof row!=='object')return;
  const validSeq=Number.isSafeInteger(row.seq)&&row.seq>0;
  if(!validSeq&&typeof(row.text??row.plain??row.tail)!=='string')return;
  const recordId=validSeq?row.seq:Number.isSafeInteger(row.dialogueSeq)?'dialogue:'+row.dialogueSeq:row.messageId?'id:'+row.messageId:'unsequenced:'+message.position+':'+unsequenced++;
  const old=records.get(recordId),next=classifyReceipt(row),ranks={unknown:0,pending:1,unseen:2,seen:3,complete:4,resolved:4,self:4,anomaly:5};
  const position=message.position,proof={position,label};
  const selected=!old||next!=='unknown'&&(authoritative||ranks[next]>=ranks[old.receiptState]);
  const {text:capturedText,quoted}=messageBodyParts(row);
  const saved=old||{recordId,seq:validSeq?row.seq:undefined,text:'',record:{},sourcePositions:[],evidence:[],receiptState:'unknown'};
  if(!receiptOnly&&(capturedText.trim()||quoted)&&capturedText.length>=saved.text.length){if(!saved.bodyCaptured)saved.bodyOrder=bodyOrder++;saved.text=capturedText;saved.quoted=quoted;saved.bodyCaptured=true;saved.record={...saved.record,...row};}
  else saved.record={...row,...saved.record};
  if(!saved.sourcePositions.includes(position))saved.sourcePositions.push(position);
  saved.evidence.push(proof);
  if(selected){saved.receiptState=next;saved.receiptEvidence=proof;}
  records.set(recordId,saved);
 };
 // Receipt snapshots are admission-time baselines even when physically placed at the tail.
 for(const message of messages)for(const row of receiptSnapshot(message))record(row,message,'来信批次收件快照');
 for(const message of messages){
  const parts=dialogueParts(message);
  if(parts){
   if(parts.stablePrefix)stablePrefixes.set(message.key,{...message,text:parts.stablePrefix});else consumed.add(message.key);for(const row of parts.records)record(row,message,'桥接 QQ 输入');
   if(parts.task)tasks.push({...message,key:'task:'+message.position,kind:'task',name:'桥接处理任务与触发机制',text:parts.task,region:message.currentInput?'arrivals':'history',originalKey:message.key});
  }
  for(const result of capturedToolResults(message)){
   const data=result.data,name=short(result.name);
   if(!data||result.isError||data.ok===false||data.error||(data.key&&request.key&&data.key!==request.key))continue;
   if(readers.has(name)){
    const rows=toolMessageRows(name,data);
    for(const row of rows){if(!row||typeof row!=='object')continue;const pendingEvidence=name==='qq_get_unread_messages'||['qq_wait_for_messages','qq_wait_for_quiet'].includes(name)&&data.arrived===true;
     record(name==='qq_get_my_recent_messages'?{...row,isSelf:true}:pendingEvidence&&classifyReceipt(row)==='unknown'?{...row,receiptState:'pending'}:row,message,'工具读取 '+name);
    }
   }
   if(name==='qq_report_message_receipts'&&data.ok===true)for(const row of Array.isArray(data.receipts)?data.receipts:[])record(row,message,'成功工具回执',{receiptOnly:true,authoritative:true});
   if(senders.has(name)&&data.quoted&&typeof data.quoted.text==='string'&&data.quoted.text.trim()){
    const origin=messages.find(row=>(row.toolCalls||[]).some(call=>call.id===result.toolCallId)),args=origin?callArguments(origin,result.toolCallId):{},id=args.messageId||args.message_id;
    const quoteId=args.replyToMessageId||id||data.quoted.messageId;
    const key=quoteId?'quote:'+(data.key||request.key)+':'+quoteId:'quote:'+message.position;
    if(!quotes.has(key))quotes.set(key,{key,kind:'quote',region:'history',position:message.position,name:'用户消息（被引用）',text:data.quoted.text,record:data.quoted,messageId:quoteId,sourceKey:data.key||request.key,resultPosition:message.position,callId:result.toolCallId,source:'工具引用回执',effectiveComponents:[],withdrawnComponents:[]});
   }
  }
 }
 const receiptIndexes=[...records.values()].filter(row=>!row.bodyCaptured);
 const batches=new Map();
 for(const row of records.values())if(row.bodyCaptured){const position=Math.min(...row.sourcePositions);if(!batches.has(position))batches.set(position,[]);batches.get(position).push(row);}
 // QQ receipt seq does not number bot messages. Never sort unnumbered replies after all humans.
 const orderedRecords=[...batches].sort(([a],[b])=>a-b).flatMap(([,rows])=>rows.every(row=>Number.isSafeInteger(row.record.dialogueSeq))?rows.sort((a,b)=>a.record.dialogueSeq-b.record.dialogueSeq):rows.every(row=>Number.isSafeInteger(row.seq))?rows.sort((a,b)=>a.seq-b.seq):rows.sort((a,b)=>a.bodyOrder-b.bodyOrder));
 const qq=orderedRecords.map((row,index)=>{
  const region=['complete','resolved','self'].includes(row.receiptState)?'history':['seen','unseen','pending'].includes(row.receiptState)?'arrivals':'unknown';
  const dialogueSeq=Number.isSafeInteger(row.record.dialogueSeq)?row.record.dialogueSeq:null,numberLabel=row.seq?'收件 seq '+row.seq:(row.record.isSelf?'bot QQ 消息':'QQ 消息（无收件 seq）')+(row.record.at?' · '+row.record.at:'');
  return {...row,dialogueSeq,displaySeq:index+1,numberLabel,key:'qq:'+row.recordId,kind:'qq',region,position:Math.min(...row.sourcePositions),source:'QQ 收件证据',name:numberLabel+(row.record.isSelf?' · bot':''),text:row.text,windowLabel:region==='history'?'QQ 历史消息':region==='arrivals'?'QQ 未处理消息':'QQ 消息（状态未知）',stateLabel:labels[row.receiptState],effectiveComponents:[],withdrawnComponents:[]};
 });
 const hasCurrentTask=messages.some(row=>row.source==='qq-context-task');
 if(!hasCurrentTask&&tasks.length){const latest=tasks.at(-1);latest.region='arrivals';latest.name='最近桥接处理任务（旧快照）';}
 const quoted=[...quotes.values()].filter(row=>!row.messageId||!qq.some(q=>String(q.record.messageId||q.record.message_id)===String(row.messageId)));
 const deliveries=extractToolDeliveries(request,messages).filter(delivery=>!delivery.messageId||!qq.some(row=>row.record.isSelf&&String(row.record.messageId)===String(delivery.messageId)));
 const forwarded=extractForwardMessages(request,messages);
 const entries=[...messages.filter(message=>!consumed.has(message.key)).map(message=>stablePrefixes.get(message.key)||message),...tasks,...qq,...quoted,...deliveries,...forwarded].sort((a,b)=>a.position-b.position||(a.seq||0)-(b.seq||0));
 return {entries,records:qq,receiptIndexes,bySeq:new Map(qq.filter(row=>row.seq).map(row=>[row.seq,row])),counts:{pending:qq.filter(row=>row.region==='arrivals').length,completed:qq.filter(row=>row.region==='history').length,unknown:qq.filter(row=>row.region==='unknown').length}};
}
const triggers={
 probability:['群聊普通来信通过概率判定','群聊普通消息达到来信唤醒偏好的概率条件，获准送入本次处理；不是静默后的主动开口概率。'],
 message:['收到来信','桥接收到允许会话的新来信并交给模型处理。'],
 private:['私聊来信','收到私聊来信后开始或继续处理。'],
 atMention:['群内有人 @ bot','群消息明确 @ 到 bot，通过对应的来信触发路径。'],
 nameMention:['群内叫到 bot 名字','群消息匹配配置的 bot 名称，通过名字触发路径。'],
 proactiveCheck:['静默后的主动检查','统一静默调度到达检查点，按主动概率及约束提供主动会话机会。'],
 replyCheck:['回复后的来信检查','发送后的检查任务检查是否有新来信；不是无条件再次发送。'],
 timeBubble:['定时冒泡','定时冒泡任务达到计划时间并通过执行条件。'],
 reminder:['日程提醒','日程任务到期，进入对应提醒处理。'],
 memoryWrite:['后台记忆整理','后台任务整理会话记忆，不是用户的新聊天。'],
 bootstrap:['首次开始处理','桥接为会话建立初始处理。'],
 newsShare:['视频分享任务','视频分享计划到达执行时机。'],
 scheduledContact:['约定时间联系','此前登记的联系约定到期。']
};
export function triggerMechanism(message,request={}){
 if(!['qq-context-dialogue','qq-context-current','qq-context-task'].includes(message.source)&&message.kind!=='task')return null;
 const task=dialogueParts(message)?.task||message.text||'';
 const explicit=task.match(/(?:^|\n)原因[：:]\s*([^\n]+)/)?.[1]?.trim();
 const heading=task.match(/【QQ 回合\s+([^】]+)】/)?.[1]?.trim();
 const code=String(explicit||message.triggerReason||message.provenance?.source?.reason||(heading&&!['private','group'].includes(heading)?heading:'')||(message.currentInput?request.scene:'')||'').split(/[:@]/)[0];
 const known=triggers[code];
 return {code,title:known?.[0]||(code?'触发代码：'+code:'触发原因未采集'),description:known?.[1]||(code?'原记录提供此原因代码，但未采集进一步判定细节，不推断概率值或触发阈值。':'private／group 是会话类型，不能当作唤醒原因；这条旧记录未提供足够证据。'),note:'这是该输入批次的触发机制，不一定表示从空闲重新唤醒；历史任务被再次携带也不是刚刚再次触发。'};
}
function callArguments(message,id){
 for(const line of String(message.text||'').split('\n')){const block=parse(line);if(block?.type==='tool-call'&&block.id===id)return parse(block.arguments)||{};}
 return {};
}
export function outputTrace(message,messages,request={}){
 const preceding=messages.filter(row=>row.position<message.position),previous=preceding.filter(row=>row.toolResults?.length||row.role==='tool'||['user','developer'].includes(row.role)).at(-1);
 const isContinuation=!!(previous?.toolResults?.length||previous?.role==='tool');
 const inputName=previous?(previous.toolResults||[]).map(row=>short(row.name)).filter(Boolean).join('、')||previous.name||previous.source:'';
 const task=preceding.filter(row=>['qq-context-dialogue','qq-context-task'].includes(row.source)).at(-1);
 const taskTrigger=task?triggerMechanism({...task,currentInput:false},{}):null;
 const origin={kind:isContinuation?'tool-continuation':'input-continuation',title:(isContinuation?'工具返回后继续生成':previous?'输入记录后继续生成':'生成前的输入未在此快照中定位')+(inputName?' · '+inputName:''),positions:previous?[previous.position]:[],limit:'按请求顺序定位前置输入，不证明模型的具体思考原因。',task:taskTrigger?.code?taskTrigger.title:'',taskPosition:task?.position};
 const ownCalls=message.toolCalls||[],resultIds=new Set((message.toolResults||[]).map(result=>result.toolCallId));
 const origins=ownCalls.length?[{message,calls:ownCalls}]:resultIds.size?messages.map(row=>({message:row,calls:(row.toolCalls||[]).filter(call=>resultIds.has(call.id))})).filter(row=>row.calls.length):[];
 if(!origins.length){
  if(message.role!=='assistant')return null;
  const destinations=[{kind:'session',title:'模型输出事件（assistant）',badge:'生成原文',storage:'sessions/<提供方>/<会话>/session.v4.jsonl.zstd',target:request.sessionId||'',outcome:'这段生成原文随 assistant 事件保存，供后续模型请求衔接；未关联到印象、画像或 MD 的写入回执，也未见本条对应的 QQ 发送回执。提供方目录未采集，以上显示日志路径格式。'}];
  // Only the historical task authorizes this route; the newest request.scene cannot classify older outputs.
  if(taskTrigger?.code==='memoryWrite'&&/<MEMORY>\s*\S[\s\S]*?<\/MEMORY>/i.test(message.text||''))destinations.push({kind:'memory',title:'会话记忆 MD · 写入待核验',badge:'记忆MD·待核验',status:'unverified',storage:/^(private|group):\d+$/.test(request.key||'')?'state/memory/'+request.key.replace(/[^a-zA-Z0-9]/g,'_')+'.md':'state/memory/<会话key>.md',outcome:'前置任务要求整理记忆，输出含 MEMORY 正文；桥接须在记忆任务仍有效时捕获。本快照没有与这条输出配对的落盘回执，尚不能确认已保存。'});
  const priorEffects=isContinuation?(previous.toolResults||[]).flatMap(result=>{
   const caller=messages.find(row=>(row.toolCalls||[]).some(call=>call.id===result.toolCallId)),call=caller?.toolCalls.find(call=>call.id===result.toolCallId);
   if(!call)return [];
   const effect=storedToolEffect(short(call.name),callArguments(caller,call.id),capturedToolResults(previous).find(row=>row.toolCallId===call.id),request);
   return effect?[{...effect,name:call.name,callId:call.id,callPosition:caller.position,resultPosition:previous.position}]:[];
  }):[];
  const results=isContinuation?capturedToolResults(previous):[];
  const wait=results.find(result=>['qq_wait_for_messages','qq_wait_for_quiet'].includes(short(result.name))&&!result.isError&&result.data?.ok!==false)?.data;
  const waitingCause=wait?(wait.arrived===true?'等到新来信':wait.endRound===true?'等待结束收尾':wait.action==='followup'?'旧话题追问建议':wait.action==='newTopic'?'新话题建议':wait.timeout===true?'等待超时':'静默判定后'):'';
  const badges=[isContinuation?'工具续接':taskTrigger?.code?taskTrigger.title:'输入续接',...(waitingCause?[waitingCause]:[]),...priorEffects.filter(effect=>effect.status==='confirmed').map(effect=>effect.badge+'回执后'),...destinations.map(row=>row.badge)];
  return {origin,priorEffects,destinations,badges:[...new Set(badges)],qqVerified:false};
 }
 const destinations=origins.flatMap(origin=>origin.calls.map(call=>{
  const resultMessage=messages.find(row=>(row.toolResults||[]).some(result=>result.toolCallId===call.id));
  const payload=resultMessage?capturedToolResults(resultMessage).find(result=>result.toolCallId===call.id):null,data=payload?.data,name=short(call.name),args=callArguments(origin.message,call.id);
  const isSend=senders.has(name),target=isSend?deliveryTarget(request,args,data||{},name):data?.key||args.key||args.conversationId||'';
  const failed=payload?.isError||data?.ok===false||data?.error||/^Error\s*[:：]/.test(resultMessage?.text||'');
  const positive=isSend&&!failed&&data?.queued!==true&&(data?.sent!==undefined?Number(data.sent)>0:data?.success===true||data?.status==='ok'&&data?.retcode===0);
  const effect=!isSend?storedToolEffect(name,args,payload,request):null;
  const outcome=!resultMessage?'请求内尚无对应工具返回':failed?'工具返回失败'+(isSend?'，未确认 QQ 投递':''):positive?(Number(data?.failed)>0?'部分投递成功，仍有失败项':'QQ 投递成功（工具返回确认）'):isSend&&data?.sent===0?'未发送（sent=0）':isSend?'缺少足以确认 QQ 投递的返回字段':'结果返回给模型继续处理；未据此推定写入印象、画像或文件';
  return {kind:isSend?'qq':'tool',title:isSend?'QQ 投递':'工具返回 → 模型',name:call.name,callId:call.id,target,outcome,verified:!!positive,...effect,callPosition:origin.message.position,resultPosition:resultMessage?.position};
 }));
 return {origin:message.role==='tool'?{kind:'call-return',title:'对应工具调用的执行结果',positions:origins.map(row=>row.message.position),limit:'通过 toolCallId 配对。'}:origin,destinations,qqVerified:destinations.some(row=>row.kind==='qq'&&row.verified),mode:request.mode};
}
export function traceRelations(request,messages,view){
 const byEntry=new Map(),labels=new Map(),ids=new Map();
 for(const row of view.records)for(const id of [row.record.messageId,row.record.message_id,row.record.id])if(id!==undefined)ids.set(String(id),row.key);
 const connect=(a,b,label)=>{if(!a||!b||a===b)return;for(const[x,y]of [[a,b],[b,a]]){if(!byEntry.has(x))byEntry.set(x,new Set());byEntry.get(x).add(y);labels.set(x+'|'+y,label);}};
 const qqKey=seq=>view.bySeq.get(Number(seq))?.key;
 for(const row of view.entries.filter(row=>['quote','delivery','forwarded'].includes(row.kind))){
  const origin=messages.find(message=>(message.toolCalls||[]).some(call=>call.id===row.callId));
  const result=messages.find(message=>message.position===row.resultPosition);
  if(origin)connect(row.key,origin.key,row.kind==='delivery'?'发送调用':'消息来源');
  if(result)connect(row.key,result.key,row.kind==='delivery'?'发送回执':'消息原文');
 }
 for(const origin of messages)for(const call of origin.toolCalls||[]){
  const resultMessage=messages.find(row=>(row.toolResults||[]).some(result=>result.toolCallId===call.id));
  const captured=resultMessage?capturedToolResults(resultMessage).find(row=>row.toolCallId===call.id):null;
  const resultFailed=!!(resultMessage?.isError||captured?.isError||captured?.data?.ok===false||captured?.data?.error||/^Error\s*[:：]/.test(resultMessage?.text||''));
  if(resultMessage){connect(origin.key,resultMessage.key,resultFailed?'工具返回失败':'调用／返回');}
  const name=short(call.name),args=callArguments(origin,call.id),payload=resultMessage?capturedToolResults(resultMessage).find(row=>row.toolCallId===call.id):null,data=payload?.data;
  const known=readers.has(name)||senders.has(name)||name==='qq_report_message_receipts';
  if(!known)continue;
  const target=args.key||args.conversationId||data?.key;if(target&&request.key&&target!==request.key)continue;
  const referenced=new Map();
  if(name==='qq_report_message_receipts')for(const row of Array.isArray(args.receipts)?args.receipts:[])if(row&&Number.isSafeInteger(row.seq))referenced.set(qqKey(row.seq),'回执参数');
  for(const id of [args.messageId,args.message_id,args.quotedMessageId])if(id!==undefined&&ids.has(String(id)))referenced.set(ids.get(String(id)),'引用回复');
  if(data&&!payload.isError&&data.ok!==false&&!data.error){
   if(readers.has(name))for(const row of toolMessageRows(name,data)){const key=qqKey(row.seq)||ids.get(String(row.messageId||row.message_id));if(key)referenced.set(key,'读取消息');}
   if(name==='qq_report_message_receipts')for(const row of Array.isArray(data.receipts)?data.receipts:[])if(qqKey(row.seq))referenced.set(qqKey(row.seq),'收件回执');
  }
  for(const[key,label]of referenced)if(key){connect(key,origin.key,label);if(resultMessage)connect(key,resultMessage.key,resultFailed?'工具返回失败':label);}
 }
 return {byEntry,labels};
}
export function processingRecordHtml(row){
 return '<section class="context-record-part context-processing-record" data-qq-window="'+esc(row.region)+'"><h4>'+esc(row.windowLabel)+(row.stateLabel?' · '+esc(row.stateLabel):'')+'</h4><p>'+esc(row.numberLabel)+' · '+esc(messageActor(row))+(row.record.at?' · '+esc(row.record.at):'')+'</p>'+quoteBodyHtml(row.quoted)+'<pre class="context-chat-body">'+esc(row.text)+'</pre><details><summary>来源与原始字段</summary><p>'+(!row.seq?'原记录未采集 QQ 收件 seq；不补造编号。':'')+(row.dialogueSeq?' 内部对话排序字段（非 QQ 收件 seq）：'+row.dialogueSeq+'。':'')+(row.seq?' 双戳工具定位：收件 seq '+row.seq+'。':'')+'</p><p>状态依据：'+esc(row.receiptEvidence?.label||'未采集')+'</p><div class="context-detail-note">'+row.sourcePositions.map(position=>'<button type="button" data-inspector-message="message:'+(position-1)+'" data-inspector-record="'+esc(row.key)+'">原始位置 '+position+'</button>').join(' ')+'</div><pre>'+esc(JSON.stringify(row.record,null,2))+'</pre></details></section>';
}
export function traceHtml(trace){
 if(!trace)return '';
 const destination=row=>'<article'+(row.status?' data-write-status="'+esc(row.status)+'"':'')+'><strong>'+esc(row.title||'工具执行')+'</strong>'+(row.name?'<p><code>'+esc(row.name)+'</code></p>':'')+'<p>'+esc(row.outcome)+'</p>'+(row.storage?'<p>位置：<code>'+esc(row.storage)+'</code></p>':'')+(row.field?'<p>条目：'+esc(row.field)+'</p>':'')+(row.target?'<p>目标：'+esc(row.target)+'</p>':'')+(row.callPosition?'<div class="context-flow-links"><button type="button" data-inspector-message="message:'+(row.callPosition-1)+'">查看调用</button>'+(row.resultPosition?'<button type="button" data-inspector-message="message:'+(row.resultPosition-1)+'">查看返回</button>':'')+'</div>':'')+'</article>';
 return '<section class="context-record-part context-output-trace"><h4>生成来源</h4><p>'+esc(trace.origin?.title||'对应调用')+'</p>'+(trace.origin?.positions||[]).map(position=>'<button type="button" data-inspector-message="message:'+(position-1)+'">查看前置记录</button>').join(' ')+(trace.origin?.task?'<p>前置桥接任务：'+esc(trace.origin.task)+'</p>':'')+'<small>'+esc(trace.origin?.limit||'')+'</small>'+(trace.priorEffects?.length?'<h4>前一步工具处理</h4><p>以下是前置工具的结果，不是这段内部文字的保存位置。</p>'+trace.priorEffects.map(destination).join(''):'')+'<h4>本条数据去向</h4>'+trace.destinations.map(destination).join('')+'</section>';
}
export function receiptIndexHtml(text){
 const marker=['【QQ 收件状态】','【本次消息快照】'].find(value=>String(text).includes(value)),body=marker?String(text).slice(String(text).indexOf(marker)+marker.length).trim():String(text).trim();
 const data=parse(body)||parse(body.split('\n')[0]);if(!data||Array.isArray(data)||typeof data!=='object')return '';
 const rows=new Map();for(const row of [...(Array.isArray(data.receipts)?data.receipts:[]),...(Array.isArray(data.receiptWindow)?data.receiptWindow:[])])if(Number.isSafeInteger(row?.seq))rows.set(row.seq,row);
 if(!rows.size)return '';
 return '<details class="context-receipts"><summary>收件状态明细 · '+rows.size+' 条</summary><p>仅表示这份请求携带的处理状态；有状态不代表本次携带了消息正文。</p><div class="context-receipt-table"><table><thead><tr><th>原始收件 seq</th><th>处理状态</th></tr></thead><tbody>'+[...rows].sort(([a],[b])=>a-b).map(([seq,row])=>'<tr><td>'+seq+'</td><td>'+esc(labels[classifyReceipt(row)]||'状态未知')+'</td></tr>').join('')+'</tbody></table></div><details><summary>原始收件字段</summary><pre>'+esc(body)+'</pre></details></details>';
}
