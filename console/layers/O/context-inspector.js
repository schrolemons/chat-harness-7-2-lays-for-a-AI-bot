import {esc} from '../../shared/api.js';
import {timelineEntries,timelinePreview,timelineFamily,messageActor,dialogueSequence,messageIsOutgoing} from './context-timeline.js';
import {messageLabel} from './context-attribution.js';
import {displayRole,DISPLAY_ROLES} from './context-display-role.js';
import {recordDetails,inputOrigin,dialogueParts,waitResultParts,messageReadParts} from './context-records.js';
import {CONTEXT_LAYER_NAMES,CONTEXT_LAYER_SUMMARIES,contextLayerGuide,componentGuide} from './context-knowledge.js';
import {processingEntries,processingRecordHtml,triggerMechanism,outputTrace,traceHtml,traceRelations} from './context-processing.js';
export const KIND_LABELS={system:'系统提示',context:'上下文记录',notice:'运行提醒',incoming:'QQ与任务',qq:'QQ 消息',quote:'用户消息（引用）',delivery:'bot 已发送',forwarded:'转发内消息',task:'桥接任务',registry:'工具清单变更',runtime:'运行环境',summary:'历史摘要',user:'外部输入',assistant:'bot 内部输出',call:'工具调用',result:'工具返回',definition:'工具定义',component:'组件来源'};
export const REGION_LABELS=CONTEXT_LAYER_NAMES;
export function requestEntries(request){
 const callNames=new Map((request.messages||[]).flatMap(row=>(row.toolCalls||[]).map(call=>[call.id,call.name])));
 const latest=new Map();for(const [index,row]of (request.messages||[]).entries())for(const update of row.contextUpdates||[])latest.set(update.id,index);
 return (request.messages||[]).map((row,index)=>{
  const kind=row.toolCalls?.length?'call':row.role==='tool'||row.toolResults?.length?'result':row.role==='system'?'system':row.role==='assistant'?'assistant':row.source==='tool-registry'?'registry':row.source==='runtime-context'?'runtime':row.source==='compact-checkpoint'?'summary':row.source==='repeat-tool-reminder'?'notice':row.source==='qq-context-task'?'task':row.source==='qq-context-dialogue'?'incoming':inputOrigin(row)?.title.startsWith('桥接收尾提醒')?'task':row.role==='developer'||!['user',undefined,'DSH 会话历史'].includes(row.source)?'context':'user';
  const current=!!request.nonce&&request.nonce===row.contextNonce;
  const toolNames=kind==='call'?(row.toolCalls||[]).map(c=>c.name):kind==='result'?(row.toolResults||[]).map(c=>c.name||callNames.get(c.toolCallId)||c.toolCallId):[];
  const name=toolNames.length?toolNames.filter(Boolean).join('、'):inputOrigin(row)?.title||(current&&row.source==='qq-context-current'?'本轮背景快照':messageLabel(row));
  const region=row.role==='system'?'system':row.source==='qq-context-task'?'arrivals':row.source==='qq-context-stable'?'stable':['qq-context-update','qq-context-latest'].includes(row.source)?'dynamic':row.currentInput&&row.role==='user'&&['user','qq-context-dialogue'].includes(row.source)?'arrivals':'history';
  const effectiveComponents=row.source==='qq-context-task'?['wake-action']:(row.contextUpdates||[]).filter(u=>latest.get(u.id)===index).map(u=>u.id);
  const withdrawnComponents=(row.contextUpdates||[]).filter(u=>latest.get(u.id)===index&&u.hash===null).map(u=>u.id);
  const hasUpdateEvidence=Array.isArray(row.contextUpdates)&&row.contextUpdates.length>0,superseded=region==='dynamic'&&hasUpdateEvidence&&!effectiveComponents.length;
  const stateLabel=region==='dynamic'?(!hasUpdateEvidence?'缺少逐组件更新标记，无法判断当前是否有效':effectiveComponents.length?'本条仍作为最新版本的组件 '+effectiveComponents.length+' 项'+(withdrawnComponents.length?' · 其中 '+withdrawnComponents.length+' 项本轮停用':''):'旧快照，已被后续更新取代'):'';
  return {...row,...(row.toolResults?{toolResults:row.toolResults.map(result=>({...result,name:result.name||callNames.get(result.toolCallId)}))}:{}),key:'message:'+index,position:index+1,kind,name:row.source==='qq-context-latest'?'当前补充资料（仅最新状态）':region==='dynamic'?'组件状态快照（'+(!hasUpdateEvidence?'有效性未采集':effectiveComponents.length?effectiveComponents.length<row.contextUpdates.length?'部分仍有效':'最新版本':'已被后续更新取代')+'）':name,region,effectiveComponents,withdrawnComponents,stateLabel,superseded};
 });
}
export function filterEntries(rows,{query='',kind='',region=''}={}){
 const needle=query.trim().toLocaleLowerCase();
 return rows.filter(row=>(!region||row.region===region)&&(!kind||(DISPLAY_ROLES.includes(kind)?displayRole(row)===kind:row.kind===kind))&&(!needle||[row.name,row.id,row.text,row.source,displayRole(row),row.componentNumber?'C'+String(row.componentNumber).padStart(2,'0'):'',JSON.stringify(row.toolCalls||[]),JSON.stringify(row.toolResults||[])].join(' ').toLocaleLowerCase().includes(needle))).map((row,index)=>({...row,listNumber:index+1}));
}
export function componentAvailability(row){
 if(row.relatedStyleText)return '当前心情、形态与风格已放入系统提示';
 if(row.notCaptured)return '本次未采集该组件';
 if(row.included===false||!row.text?.trim())return '本次未提供正文';
 if(row.inRequest===true)return '本次请求已携带';
 if(row.inRequest===false)return '正文未在请求中完整确认';
 return '有采集正文，实发证据未记录';
}
const dynamicSources=[['ctx-context-dynamics','05 · 心情'],['ctx-chat-topic-drive','10 · 话题建议'],['ctx-memory-context','12 · 记忆与临时画像'],['life-schedule-reminder','25 · 日程']];
const badge=kind=>'<span class="context-kind context-kind-'+kind+'">'+esc(KIND_LABELS[kind]||kind)+'</span>';
const messageBadge=row=>{const role=displayRole(row);return (role?'<span class="context-kind context-display-role context-role-'+role+'">'+role+'</span>':badge(row.kind))+(row.attemptCount?'<span class="context-window-badge">尝试次数：'+row.attemptCount+'</span>':'');};
function messageIdentityFields(row){
 const seq=['qq','quote','forwarded'].includes(row.kind)?row.record?.seq??(row.kind==='forwarded'?row.originalSeq:row.seq):undefined;
 const messageId=row.record?.messageId??row.record?.message_id??row.messageId;
 return (Number.isSafeInteger(seq)&&seq>0?'<div><dt>收件 seq</dt><dd>'+seq+'</dd></div>':'')+(messageId!=null&&String(messageId)!==''?'<div><dt>messageId</dt><dd>'+esc(messageId)+'</dd></div>':'');
}
const listName=row=>['call','result','definition'].includes(row.kind)?String(row.name||row.id).split('、').map(name=>name.startsWith('mcp__')?name.split('__').at(-1):name).join('、'):row.name||row.id;
function quotePreview(row){
 const flow=row.outputTrace?.badges?.length?'<span class="context-output-badges" aria-label="内部输出来源与去向">'+row.outputTrace.badges.map(label=>'<span>'+esc(label)+'</span>').join('')+'</span>':'';
 return flow+(row.quoted?'<span class="context-quote-preview"><span>引用 '+esc(messageActor({record:row.quoted}))+'</span>'+esc(row.quoted.text||'引用原文未采集')+'</span>':'');
}
function extractedMessageDetails(row){
 const quoted=row.quoted?'<blockquote><strong>引用 '+esc(messageActor({record:row.quoted}))+'</strong><p>'+esc(row.quoted.text||'引用原文未采集')+'</p></blockquote>':'';
 const route=row.sourceKey&&row.targetKey&&row.sourceKey!==row.targetKey?row.sourceKey+' → '+row.targetKey:row.targetKey||row.sourceKey||'';
 const note=row.archived?'摘要覆盖的原始发送消息。':row.kind==='delivery'?'发送成功由匹配回执确认；正文取自对应发送参数。':row.kind==='quote'?'工具回执中的引用原文；不据此推断已读或已回复。':row.forwardId?'合并转发内容；不计入当前会话的未处理队列。':'工具读取的消息原文；不据此推断已读或已回复。';
 const ids=[dialogueSequence(row)?'对话序号：'+dialogueSequence(row):'',row.archived?'原始发送事件：seq '+row.resultEventSeq:'',row.originalMessageSeq?'原转发 messageSeq：'+row.originalMessageSeq:'',row.forwardId?'转发 ID：'+row.forwardId:''].filter(Boolean).join(' · ');
 return '<section class="context-record-part"><h4>'+esc(messageActor(row))+'</h4>'+(route?'<p>会话：'+esc(route)+'</p>':'')+quoted+'<pre class="context-chat-body">'+esc(row.text)+'</pre><p>'+esc(note)+'</p>'+(ids?'<p>'+esc(ids)+'</p>':'<p>对话序号未记录。</p>')+(row.textTruncated?'<p class="context-excerpt-note">工具只返回了正文片段，不是完整消息。</p>':'')+'<button type="button" data-inspector-message="'+esc(row.sourceSummaryKey||'message:'+((row.sourceSummaryPosition||row.resultPosition||Math.floor(row.position))-1))+'">'+(row.archived?'查看对应摘要':'查看来源工具返回')+'</button></section>';
}
export function inspectorHtml(request,catalog,state,{renderText,renderComponent}){
 const nativeMessages=requestEntries(request),tools=(request.tools||[]).map((row,index)=>({...row,key:'tool:'+index,position:index+1,kind:'definition',name:row.name||'未命名工具',text:JSON.stringify(row,null,2)}));
 const business=processingEntries(request,nativeMessages),raw=state.layout==='raw',messages=raw?nativeMessages:business.messages;
 const ordered=(raw?messages:timelineEntries(business.entries)).map(row=>row.kind==='assistant'?{...row,outputTrace:outputTrace(row,messages,request)}:row);
 const modules=new Map([...(request.modules||[]),...(request.sourceModules||[])].filter(row=>row.id!=='obs-context-assembly').map(row=>[row.id,row]));
 const moodStyle=modules.get('role-card')?.parts?.find(part=>part.id==='ctx-context-dynamics:expression');
 const confirmedStyle=moodStyle?.text?.trim()&&(request.messages||[]).some(m=>m.text?.includes(moodStyle.text.trim()))?moodStyle.text:'';
 const inventory=[...catalog,...[...modules.values()].filter(row=>!catalog.some(slot=>slot.id===row.id)&&row.text?.trim())];
 const components=inventory.map((slot,index)=>({...slot,...modules.get(slot.id),...(slot.id==='ctx-context-dynamics'&&confirmedStyle?{relatedStyleText:confirmedStyle}:{}),notCaptured:!modules.has(slot.id)||modules.get(slot.id)?.notCaptured===true,key:'component:'+slot.id,position:index+1,componentNumber:index<catalog.length?index+1:undefined,kind:'component',name:slot.name&&slot.name!==slot.id?slot.name:modules.get(slot.id)?.name||slot.id}));
 const all=state.view==='tools'?tools:state.view==='components'?components:ordered;
 const rows=filterEntries(all,{query:state.query,kind:state.view==='messages'?state.kind:'',region:state.view==='messages'?state.region:''});
 const selected=rows.find(row=>row.key===state.selected)||rows.find(row=>row.source==='qq-context-current'&&row.contextNonce===request.nonce)||rows[0];
 const relations=traceRelations(request,messages,business),related=relations.byEntry.get(selected?.key)||new Set();
 const hint=row=>[...(relations.byEntry.get(row.key)||[])].filter(key=>key.startsWith('qq:')).slice(0,4).map(key=>business.records.find(record=>record.key===key)?.dialogueSeq).filter(Boolean).map(seq=>'对话 '+seq).join('、');
 const nav=[['messages',raw?'原始消息':'业务分区',ordered.length],['tools','工具列表',tools.length],['components','组件来源',components.length]];
 const navHtml='<div class="context-inspector-nav" role="group" aria-label="请求查看内容">'+nav.map(([id,name,count])=>'<button type="button" data-inspector-view="'+id+'" aria-pressed="'+(state.view===id)+'">'+name+' <span>'+count+'</span></button>').join('')+'</div>';
 const shortcuts='<div class="context-source-shortcuts"><span>动态资料定位</span>'+dynamicSources.filter(([id])=>catalog.some(row=>row.id===id)).map(([id,label])=>'<button type="button" data-inspector-component="'+id+'">'+label+'</button>').join('')+'</div>';
 const mapping=state.view==='components'?'<label class="context-component-lookup">按组件或来源名称定位<select id="contextComponentLookup"><option value="">选择来源…</option>'+components.map(row=>'<option value="'+esc(row.id)+'"'+(selected?.id===row.id?' selected':'')+'>'+(row.componentNumber?String(row.componentNumber).padStart(2,'0'):'附加来源')+' ｜ '+esc(row.name)+'</option>').join('')+'</select></label>':'';
 const controls='<div class="context-inspector-controls"><label class="context-search"><span>搜索'+(state.view==='messages'?'本次请求':state.view==='tools'?'工具':'组件')+'</span><input id="contextInspectorSearch" type="search" value="'+esc(state.query)+'" placeholder="名称、正文或调用 ID"></label>'+(state.view==='messages'?'<label><span>role</span><select id="contextInspectorKind"><option value="">全部 role</option>'+DISPLAY_ROLES.map(role=>'<option value="'+role+'"'+(state.kind===role?' selected':'')+'>'+role+'</option>').join('')+'</select></label>':'')+'</div>';
 const sequenceHtml=(items,caption)=>'<div class="context-sequence" role="group" aria-label="'+(state.view==='messages'?(raw?'按请求顺序排列的消息':'按对话序号排列的消息'):state.view==='tools'?'本次请求的工具定义':'组件与附加来源目录')+'"><div class="context-sequence-caption">'+caption+' <span>'+items.length+' 项</span></div>'+items.map(row=>'<button type="button" class="context-sequence-row context-family-'+timelineFamily(row)+(timelineFamily(row)==='message'&&messageIsOutgoing(row)?' is-message-outgoing':'')+(row.kind==='qq'?(row.record.isSelf?' is-qq-self':' is-qq-human'):['call','result'].includes(row.kind)?' is-tool-step':'')+(related.has(row.key)?' is-related':'')+'" data-inspector-select="'+esc(row.key)+'" data-entry-kind="'+row.kind+'" data-display-role="'+(displayRole(row)||'')+'" data-request-position="'+row.position+'" aria-pressed="'+(row.key===selected?.key)+'"><span class="context-sequence-number" title="'+esc(state.view==='messages'?(dialogueSequence(row)?'对话序号 '+dialogueSequence(row):timelineFamily(row)==='message'?'对话序号未记录':'协议记录'):'目录编号')+'"'+(dialogueSequence(row)?' data-dialogue-seq="'+dialogueSequence(row)+'"':'')+'>'+(state.view==='messages'?(dialogueSequence(row)??(timelineFamily(row)==='message'?'未记录':'·')):String(row.listNumber).padStart(3,'0'))+'</span><span class="context-sequence-main">'+messageBadge(row)+(row.kind==='qq'?'<span class="context-window-badge">'+esc(row.stateLabel)+'</span>':row.componentNumber?'<span class="context-component-code">组件 '+String(row.componentNumber).padStart(2,'0')+'</span>':'')+(hint(row)?'<span class="context-link-hint">关联 '+esc(hint(row))+'</span>':'')+'<strong class="'+(row.superseded?'context-superseded-title':'')+'" title="'+esc(row.name||row.id)+'">'+esc(listName(row))+'</strong>'+(timelineFamily(row)==='message'?'<span class="context-chat-sender">'+esc(messageActor(row))+((row.record?.at||row.at)?' · '+esc(row.record?.at||row.at):'')+(row.targetKey?' · '+esc(row.crossSession?(row.sourceKey||'来源会话')+' → '+row.targetKey:row.targetKey):'')+'</span>':'')+quotePreview(row)+'<span class="context-sequence-preview">'+esc(raw?String(row.text||'结构化记录').replace(/\s+/g,' ').slice(0,100):timelinePreview(row))+'</span></span><span class="context-sequence-size">'+(row.text?.length||0).toLocaleString()+'</span></button>').join('')+(items.length?'':'<p class="context-empty">没有匹配项。</p>')+'</div>';
 const caption=state.view==='messages'?(raw?'原始请求顺序 · QQ 消息使用对话序号':'聊天与工具时间线 · QQ 消息使用对话序号'):state.view==='tools'?'实际 tools 字段':'组件与附加来源目录';
 const legend=state.view==='messages'?'<div class="context-card-legend" aria-label="role 分类">'+DISPLAY_ROLES.map(role=>'<span class="context-kind context-display-role context-role-'+role+'">'+role+'</span>').join('')+'</div>':'';
 const list=sequenceHtml(rows,caption);
 const isTimeline=state.view==='messages'&&!raw;
 const historyHumans=business.records.filter(row=>!row.record.isSelf&&row.region==='history').length;
 const historyBots=business.entries.filter(row=>row.region==='history'&&messageIsOutgoing(row)).length;
 const pendingHumans=business.records.filter(row=>!row.record.isSelf&&row.region==='arrivals').length;
 const optionalHumans=business.records.filter(row=>!row.record.isSelf&&row.region==='arrivals'&&row.optionalInput).length;
 const incomingSummary=(optionalHumans?'本次收信原文 ':'待处理用户原文 ')+pendingHumans+' 条'+(optionalHumans?'，其中 '+optionalHumans+' 条可自由回应':'');
 const missingPending=business.receiptIndexes.filter(row=>['seen','unseen','pending'].includes(row.receiptState)).length;
 const windowNote=state.view==='messages'&&!raw&&['history','arrivals'].includes(state.region)?'<div class="context-window-summary">'+(state.region==='history'?'用户原文 '+historyHumans+' 条 · bot 消息 '+historyBots+' 条'+(!historyHumans?'。这份请求未携带已处理的用户消息正文；不从实时聊天记录补入。':''):incomingSummary+(missingPending?'；另有 '+missingPending+' 条只有收件状态，正文未包含在这份请求中。':!pendingHumans?'。这份请求未携带待处理消息正文，不表示桥接队列已清空。':''))+'</div>':'';
 let detail='<p class="context-empty">没有可查看的记录。</p>';
 if(state.view==='messages'&&state.region==='arrivals'&&!rows.length)detail='<section class="context-record-part"><h3>本请求中未找到待处理来信</h3><p>仅依据所选快照；状态不完整的消息在“状态待核实”，不推断实时队列已经清空。</p></section>';
 if(selected){
  const roleField=(displayRole(selected)?'<div class="context-role-pair"><dt>role</dt><dd>'+displayRole(selected)+'</dd></div>':'')+messageIdentityFields(selected);
  const calls=[...(selected.toolCalls||[]).map(c=>'<div><dt>调用工具</dt><dd>'+esc(c.name)+' · '+esc(c.id)+'</dd></div>'),...(selected.toolResults||[]).map(c=>'<div><dt>对应调用</dt><dd>'+esc(c.name||'')+' · '+esc(c.toolCallId)+'</dd></div>')].join('');
  detail='<header class="context-detail-heading">'+messageBadge(selected)+'<h3 class="'+(selected.superseded?'context-superseded-title':'')+'">'+esc(selected.name||selected.id)+'</h3><p>'+ (selected.restoredFromArchive?'原始日志事件 seq '+selected.restoredEventSeq+' · 旧归档恢复':selected.archived?'摘要历史':selected.kind==='qq'?esc(selected.windowLabel):selected.kind==='component'?(selected.componentNumber?'组件 C'+String(selected.componentNumber).padStart(2,'0'):'附加规则'):selected.kind==='definition'?'本次请求的工具定义':(['delivery','quote','forwarded'].includes(selected.kind)?'从工具返回提取 · 原始位置 '+(selected.resultPosition||Math.floor(selected.position)):'原始请求位置 '+selected.position+' / '+nativeMessages.length))+' · '+(selected.text?.length||0).toLocaleString()+' 个文本字符</p></header>';
  if(selected.attemptCount)detail+='<p class="context-detail-note">连续同类失败，尝试次数：'+selected.attemptCount+'。展示最后一次尝试的实际参数与错误。</p>';
  if(!['component','definition','qq','quote','delivery','forwarded'].includes(selected.kind))detail+=recordDetails({...selected,qqBySeq:business.bySeq,triggerInfo:triggerMechanism(selected,request)});
  detail+=traceHtml(outputTrace(selected,messages,request));
  if(related.size){const targets=[...related].map(key=>business.entries.find(row=>row.key===key)).filter(Boolean);detail+='<section class="context-related-links"><strong>关联轨迹</strong>'+targets.map(row=>'<button type="button" data-inspector-related="'+esc(row.key)+'">'+esc(relations.labels.get(selected.key+'|'+row.key)||'关联')+' · '+esc(row.kind==='qq'?row.numberLabel:'原始位置 '+(row.resultPosition||Math.floor(row.position)))+'</button>').join('')+'</section>';}
  if(selected.kind==='component'){
   if(!selected.provenanceOnly)detail+=componentGuide(selected);
   if(selected.source)detail+='<p class="context-detail-note">来源：<code>'+esc(selected.source)+'</code></p>';
   const locations=messages.filter(message=>message.effectiveComponents.includes(selected.id));
   if(locations.length)detail+='<p class="context-detail-note">当前状态位置：'+locations.map(message=>'<button type="button" data-inspector-message="'+esc(message.key)+'">消息 '+message.position+(message.withdrawnComponents.includes(selected.id)?' · 已撤回':' · 当前有效')+'</button>').join(' ')+'</p>';
   const related=selected.id==='ctx-context-dynamics'?modules.get('role-card')?.parts?.find(p=>p.id==='ctx-context-dynamics:expression'):null;
   detail+='<p class="context-detail-note">'+esc(componentAvailability(selected))+'。'+(!selected.relatedStyleText&&selected.included===false&&selected.reason?'记录原因：'+esc(selected.reason)+'。':'')+'这是所选请求当时的快照。</p>';
   if(related?.text&&selected.relatedStyleText)detail+='<div class="context-text-frame context-tone-4"><div class="context-frame-label"><strong>05 · 系统提示中的当前心情、形态与风格</strong></div><pre>'+esc(selected.relatedStyleText)+'</pre></div><p class="context-detail-note"><button type="button" data-inspector-component="role-card">定位到 01 · 系统提示中的放置位置</button></p>';
   if(!selected.text?.trim()&&['memoryWrite','selfReview','selfOptimize','userFeedbackReview','slangLearn'].includes(request.scene)&&['ctx-context-dynamics','life-schedule-reminder'].includes(selected.id))detail+='<p class="context-detail-note">这次是后台整理任务，心情和日程组件按场景跳过。</p>';
   if(!selected.relatedStyleText||selected.text?.trim())detail+=renderComponent(selected);
  }else if(selected.kind==='qq')detail+='<dl class="context-detail-fields context-role-field">'+roleField+'</dl>'+processingRecordHtml(selected);
  else if(['delivery','forwarded','quote'].includes(selected.kind))detail+='<dl class="context-detail-fields context-role-field">'+roleField+'</dl>'+extractedMessageDetails(selected);
  else{
   const structured=dialogueParts(selected)||waitResultParts(selected).length||messageReadParts(selected).length||selected.source==='tool-registry'&&(selected.contentBlocks||selected.provenance?.toolChanges||[]).some(block=>['tool-addition','tool-removal'].includes(block.type))||business.entries.some(row=>['quote','delivery','forwarded'].includes(row.kind)&&row.resultPosition===selected.position);
   const body=selected.kind==='definition'?'<pre class="context-tool-schema">'+esc(selected.text)+'</pre>':'<div class="context-detail-text">'+renderText(selected.text||'',request.modules||[],catalog,selected)+'</div>';
   detail+=(selected.projectedSummary?'<p class="context-detail-note">此摘要与稳定资料来自同一条请求记录，已分开展示。以下是摘要正文。</p>':'')+((roleField||calls)?'<dl class="context-detail-fields context-role-field">'+roleField+calls+'</dl>':'')+(structured?'<details class="context-raw-record"><summary>完整请求原文（保留原始字段与顺序）</summary>'+body+'</details>':body);
  }
  if(selected.source==='qq-context-current')detail+='<p class="context-detail-note">这是旧版按桥接批次提供的背景快照；不会按新版规则改写这份历史证据。</p>';
  if(selected.region==='stable')detail+='<p class="context-detail-note">稳定资料以 user 角色提供，独立于系统硬规则；首次放入消息前部，内容变化时才更新。</p>';
  if(selected.region==='dynamic')detail+='<p class="context-detail-note">'+(selected.source==='qq-context-latest'?'这是所选请求的完整当前资料；旧状态仅保存在运行日志，不在新版请求中反复携带。未列出的组件本次没有有效补充，不表示底层数据已删除。':esc(selected.stateLabel)+'。'+(selected.effectiveComponents.length?'本条仍有效的组件：'+selected.effectiveComponents.map(esc).join('、')+'。':'')+'这是旧版追加式记录；同组件以最后一次更新为准，旧状态保留在历史原位置。')+'</p>';
  if(selected.id==='ctx-chat-topic-drive'&&selected.kind==='component')detail+='<p class="context-detail-note">C10 展示请求前提供的会话推进建议。等待超时后的追问或换题建议位于 qq_wait_for_messages 工具返回中，请在“聊天与工具历史”查看对应返回；它们不会重复标为 C10 正文。</p>';
  if(selected.kind==='assistant')detail+='<p class="context-detail-note">内部输出与 QQ 消息分别核验；保存和投递以对应回执为准。</p>';
 }
 const toolsNote=state.view==='tools'?'<p class="context-tools-note">工具定义来自所选请求独立的 tools 字段，与系统提示、messages 消息列表并列。这里的分区位置不表示模型内部的编码顺序。</p>':'';
 const regions='<div class="context-layer-controls" role="group" aria-label="其他查看范围"><button type="button" data-inspector-region="" aria-pressed="'+(!state.region&&state.view==='messages')+'">全部内容 · '+ordered.length+' 项</button><button type="button" data-inspector-region="tools" aria-pressed="'+(state.view==='tools')+'">工具定义 · '+tools.length+' 个（独立 tools 字段）</button>'+(business.counts.unknown?'<button type="button" data-inspector-region="unknown" aria-pressed="'+(state.region==='unknown'&&state.view==='messages')+'">处理状态待核实 · '+business.counts.unknown+' 条</button>':'')+'</div><div class="context-layout-map" role="group" aria-label="五层上下文结构">'+Object.entries(REGION_LABELS).map(([id,label])=>'<button type="button" data-inspector-region="'+id+'" aria-pressed="'+(state.region===id&&state.view==='messages')+'"><strong>'+label+'</strong><span class="context-layer-summary">'+esc(CONTEXT_LAYER_SUMMARIES[id])+'</span><span class="context-layer-count">'+(raw?messages:business.entries).filter(row=>row.region===id).length+' 项</span></button>').join('')+'</div>';
 const layout='<div class="context-layout-switch" role="group" aria-label="查看方式"><button type="button" data-inspector-layout="business" aria-pressed="'+!raw+'">按对话序号</button><button type="button" data-inspector-layout="raw" aria-pressed="'+raw+'">原始请求顺序</button><span>'+(raw?'保留实际装填顺序，对话序号可能因分批补入而回跳。':'历史窗口 '+business.counts.completed+' 条 · '+(optionalHumans?'收信窗口 ':'未处理窗口 ')+business.counts.pending+' 条'+(business.counts.unknown?' · 待核实 '+business.counts.unknown+' 条':'')+'。工具记录保留配对。')+'</span></div>';
 const refresh=request.layoutVersion>=2?'<p class="context-refresh-note">'+esc(request.contextRefresh?.status==='fresh'?'支持逐请求更新的组件已刷新':request.contextRefresh?.status==='stale'?'资料刷新失败':'未采集刷新结果')+' · '+(request.layoutVersion>=3?'当前资料集中在末尾；原始记录与工具配对保留。':'旧版追加式记录。')+'</p>':'<p class="context-refresh-note">旧版采集；按原始证据展示。</p>';
 const missingToolsNote=!raw&&business.missingToolArchives?'<p class="context-detail-note">有 '+business.missingToolArchives+' 份旧错误归档缺少可核验的原始调用记录，无法恢复对应尝试；可在原始请求顺序中核对旧记录。</p>':'';
 return contextLayerGuide()+layout+regions+refresh+missingToolsNote+navHtml+shortcuts+mapping+toolsNote+controls+windowNote+legend+'<div class="context-inspector-split'+(isTimeline?' has-timeline':'')+'">'+list+'<section class="context-detail context-family-'+timelineFamily(selected||{})+'" aria-label="选中项详情" data-inspector-detail="'+esc(selected?.key||'')+'">'+detail+'</section></div>';
}
