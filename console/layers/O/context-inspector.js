import {esc} from '../../shared/api.js';
import {messageLabel} from './context-attribution.js';
export const KIND_LABELS={system:'系统提示',context:'补充资料',user:'用户输入',assistant:'bot 文字',call:'工具调用',result:'工具返回',definition:'工具定义',component:'组件来源'};
export const REGION_LABELS={system:'系统规则',stable:'稳定资料',history:'聊天与工具记录',dynamic:'动态资料更新'};
export function requestEntries(request){
 const callNames=new Map((request.messages||[]).flatMap(row=>(row.toolCalls||[]).map(call=>[call.id,call.name])));
 const latest=new Map();for(const [index,row]of (request.messages||[]).entries())for(const update of row.contextUpdates||[])latest.set(update.id,index);
 return (request.messages||[]).map((row,index)=>{
  const kind=row.toolCalls?.length?'call':row.role==='tool'||row.toolResults?.length?'result':row.role==='system'?'system':row.role==='assistant'?'assistant':row.role==='developer'||!['user',undefined,'DSH 会话历史'].includes(row.source)?'context':'user';
  const current=!!request.nonce&&request.nonce===row.contextNonce;
  const toolNames=kind==='call'?(row.toolCalls||[]).map(c=>c.name):kind==='result'?(row.toolResults||[]).map(c=>c.name||callNames.get(c.toolCallId)||c.toolCallId):[];
  const name=toolNames.length?toolNames.filter(Boolean).join('、'):current&&row.source==='qq-context-current'?'本轮背景快照':current&&row.source==='qq-context-dialogue'?'本轮任务与新增 QQ 来信':messageLabel(row);
  const region=row.role==='system'?'system':row.source==='qq-context-stable'?'stable':row.source==='qq-context-update'?'dynamic':'history';
  const effectiveComponents=(row.contextUpdates||[]).filter(u=>latest.get(u.id)===index).map(u=>u.id);
  const withdrawnComponents=(row.contextUpdates||[]).filter(u=>latest.get(u.id)===index&&u.hash===null).map(u=>u.id);
  const stateLabel=region==='dynamic'?(effectiveComponents.length?'当前有效 '+effectiveComponents.length+' 项'+(withdrawnComponents.length?' · 含撤回':''):'历史状态，已有后续更新'):'';
  return {...row,key:'message:'+index,position:index+1,kind,name:region==='dynamic'?'动态资料更新（'+(effectiveComponents.length?'当前有效':'历史')+'）':name,region,effectiveComponents,withdrawnComponents,stateLabel};
 });
}
export function filterEntries(rows,{query='',kind='',region=''}={}){
 const needle=query.trim().toLocaleLowerCase();
 return rows.filter(row=>(!region||row.region===region)&&(!kind||row.kind===kind)&&(!needle||[row.name,row.id,row.text,row.source,row.componentNumber?'C'+String(row.componentNumber).padStart(2,'0'):'',JSON.stringify(row.toolCalls||[]),JSON.stringify(row.toolResults||[])].join(' ').toLocaleLowerCase().includes(needle))).map((row,index)=>({...row,listNumber:index+1}));
}
export function componentAvailability(row){
 if(row.relatedStyleText)return '当前心情、形态与风格已放入系统提示';
 if(row.notCaptured)return '本次未采集该组件';
 if(row.included===false||!row.text?.trim())return '本次未提供正文';
 if(row.inRequest===true)return '本次请求已携带';
 if(row.inRequest===false)return '正文未在请求中完整确认';
 return '有采集正文，实发证据未记录';
}
const dynamicSources=[['ctx-context-dynamics','05 · 心情'],['ctx-memory-context','12 · 记忆与临时画像'],['life-schedule-reminder','25 · 日程']];
const badge=kind=>'<span class="context-kind context-kind-'+kind+'">'+esc(KIND_LABELS[kind]||kind)+'</span>';
const listName=row=>['call','result','definition'].includes(row.kind)?String(row.name||row.id).split('、').map(name=>name.startsWith('mcp__')?name.split('__').at(-1):name).join('、'):row.name||row.id;
export function inspectorHtml(request,catalog,state,{renderText,renderComponent}){
 const messages=requestEntries(request),tools=(request.tools||[]).map((row,index)=>({...row,key:'tool:'+index,position:index+1,kind:'definition',name:row.name||'未命名工具',text:JSON.stringify(row,null,2)}));
 const modules=new Map((request.modules||[]).map(row=>[row.id,row]));
 const moodStyle=modules.get('role-card')?.parts?.find(part=>part.id==='ctx-context-dynamics:expression');
 const confirmedStyle=moodStyle?.text?.trim()&&(request.messages||[]).some(m=>m.text?.includes(moodStyle.text.trim()))?moodStyle.text:'';
 const components=catalog.map((slot,index)=>({...slot,...modules.get(slot.id),...(slot.id==='ctx-context-dynamics'&&confirmedStyle?{relatedStyleText:confirmedStyle}:{}),notCaptured:!modules.has(slot.id)||modules.get(slot.id)?.notCaptured===true,key:'component:'+slot.id,position:index+1,componentNumber:index+1,kind:'component',name:slot.name&&slot.name!==slot.id?slot.name:modules.get(slot.id)?.name||slot.id}));
 const extras=(request.modules||[]).filter(row=>!catalog.some(slot=>slot.id===row.id)).map((row,index)=>({...row,key:'extra:'+row.id,position:catalog.length+index+1,kind:'component'}));
 const all=state.view==='tools'?tools:state.view==='components'?[...components,...extras]:messages;
 const rows=filterEntries(all,{query:state.query,kind:state.view==='messages'?state.kind:'',region:state.view==='messages'?state.region:''});
 const selected=rows.find(row=>row.key===state.selected)||rows.find(row=>row.source==='qq-context-current'&&row.contextNonce===request.nonce)||rows[0];
 const nav=[['messages','消息序列',messages.length],['tools','工具列表',tools.length],['components','组件来源',components.length+(extras.length?' + '+extras.length:'')]];
 const navHtml='<div class="context-inspector-nav" role="group" aria-label="请求查看内容">'+nav.map(([id,name,count])=>'<button type="button" data-inspector-view="'+id+'" aria-pressed="'+(state.view===id)+'">'+name+' <span>'+count+'</span></button>').join('')+'</div>';
 const shortcuts='<div class="context-source-shortcuts"><span>动态资料定位</span>'+dynamicSources.filter(([id])=>catalog.some(row=>row.id===id)).map(([id,label])=>'<button type="button" data-inspector-component="'+id+'">'+label+'</button>').join('')+'</div>';
 const mapping=state.view==='components'?'<label class="context-component-lookup">按组件名称定位到固定编号<select id="contextComponentLookup"><option value="">选择组件…</option>'+components.map(row=>'<option value="'+esc(row.id)+'"'+(selected?.id===row.id?' selected':'')+'>'+String(row.componentNumber).padStart(2,'0')+' ｜ '+esc(row.name)+'</option>').join('')+'</select></label>':'';
 const controls='<div class="context-inspector-controls"><label class="context-search"><span>搜索'+(state.view==='messages'?'本次请求':state.view==='tools'?'工具':'组件')+'</span><input id="contextInspectorSearch" type="search" value="'+esc(state.query)+'" placeholder="名称、正文或调用 ID"></label>'+(state.view==='messages'?'<label><span>类型</span><select id="contextInspectorKind"><option value="">全部类型</option>'+Object.entries(KIND_LABELS).filter(([kind])=>!['definition','component'].includes(kind)).map(([kind,label])=>'<option value="'+kind+'"'+(state.kind===kind?' selected':'')+'>'+label+'</option>').join('')+'</select></label>':'')+'</div>';
 const list='<div class="context-sequence" role="group" aria-label="'+(state.view==='messages'?'按请求顺序排列的消息':state.view==='tools'?'本次请求的工具定义':'39 个组件及附加规则')+'"><div class="context-sequence-caption">'+(state.view==='messages'?'按模型收到的顺序':state.view==='tools'?'实际 tools 字段':'固定组件目录')+' <span>'+rows.length+' 项</span></div>'+rows.map(row=>'<button type="button" class="context-sequence-row" data-inspector-select="'+esc(row.key)+'" data-request-position="'+row.position+'" aria-pressed="'+(row.key===selected?.key)+'"><span class="context-sequence-number">'+String(row.listNumber).padStart(3,'0')+'</span><span class="context-sequence-main">'+badge(row.kind)+(row.componentNumber?'<span class="context-component-code">组件 '+String(row.componentNumber).padStart(2,'0')+'</span>':row.role?'<span class="context-protocol-role">'+esc(row.role)+'</span>':'')+'<strong title="'+esc(row.name||row.id)+'">'+esc(listName(row))+'</strong><span class="context-sequence-preview">'+esc((row.text||'本轮无采集正文').replace(/\s+/g,' ').slice(0,100))+'</span></span><span class="context-sequence-size">'+(row.text?.length||0).toLocaleString()+'</span></button>').join('')+(rows.length?'':'<p class="context-empty">没有匹配项，试试其他关键词或类型。</p>')+'</div>';
 let detail='<p class="context-empty">没有可查看的记录。</p>';
 if(selected){
  const calls=[...(selected.toolCalls||[]).map(c=>'<div><dt>调用工具</dt><dd>'+esc(c.name)+' · '+esc(c.id)+'</dd></div>'),...(selected.toolResults||[]).map(c=>'<div><dt>对应调用</dt><dd>'+esc(c.name||'')+' · '+esc(c.toolCallId)+'</dd></div>')].join('');
  detail='<header class="context-detail-heading">'+badge(selected.kind)+'<h3>'+esc(selected.name||selected.id)+'</h3><p>'+ (selected.kind==='component'?(selected.componentNumber?'组件 C'+String(selected.componentNumber).padStart(2,'0'):'附加规则'):selected.kind==='definition'?'本次请求的工具定义':'请求位置 '+selected.position+' / '+messages.length)+' · '+(selected.text?.length||0).toLocaleString()+' 个文本字符</p></header>';
  if(selected.kind==='component'){
   const locations=messages.filter(message=>message.effectiveComponents.includes(selected.id));
   if(locations.length)detail+='<p class="context-detail-note">当前状态位置：'+locations.map(message=>'<button type="button" data-inspector-message="'+esc(message.key)+'">消息 '+message.position+(message.withdrawnComponents.includes(selected.id)?' · 已撤回':' · 当前有效')+'</button>').join(' ')+'</p>';
   const related=selected.id==='ctx-context-dynamics'?modules.get('role-card')?.parts?.find(p=>p.id==='ctx-context-dynamics:expression'):null;
   detail+='<p class="context-detail-note">'+esc(componentAvailability(selected))+'。'+(!selected.relatedStyleText&&selected.included===false&&selected.reason?'记录原因：'+esc(selected.reason)+'。':'')+'这是所选请求当时的快照。</p>';
   if(related?.text&&selected.relatedStyleText)detail+='<div class="context-text-frame context-tone-4"><div class="context-frame-label"><strong>05 · 系统提示中的当前心情、形态与风格</strong></div><pre>'+esc(selected.relatedStyleText)+'</pre></div><p class="context-detail-note"><button type="button" data-inspector-component="role-card">定位到 01 · 系统提示中的放置位置</button></p>';
   if(!selected.text?.trim()&&['memoryWrite','selfReview','selfOptimize','userFeedbackReview','slangLearn'].includes(request.scene)&&['ctx-context-dynamics','life-schedule-reminder'].includes(selected.id))detail+='<p class="context-detail-note">这次是后台整理任务，心情和日程组件按场景跳过。</p>';
   if(!selected.relatedStyleText||selected.text?.trim())detail+=renderComponent(selected);
  }else detail+='<dl class="context-detail-fields"><div><dt>消息角色</dt><dd>'+esc(selected.role||'未记录')+'</dd></div><div><dt>来源</dt><dd>'+esc(selected.source|| (selected.kind==='definition'?'tools 字段':'未记录'))+'</dd></div>'+calls+'</dl>'+(selected.kind==='definition'?'<pre class="context-tool-schema">'+esc(selected.text)+'</pre>':'<div class="context-detail-text">'+renderText(selected.text||'',request.modules||[],catalog,selected)+'</div>');
  if(selected.source==='qq-context-current')detail+='<p class="context-detail-note">这是旧版按桥接批次提供的背景快照；不会按新版规则改写这份历史证据。</p>';
  if(selected.region==='stable')detail+='<p class="context-detail-note">稳定资料以 user 角色提供，独立于系统硬规则；首次放入消息前部，内容变化时才更新。</p>';
  if(selected.region==='dynamic')detail+='<p class="context-detail-note">'+esc(selected.stateLabel)+'。'+(selected.effectiveComponents.length?'本条仍有效的组件：'+selected.effectiveComponents.map(esc).join('、')+'。':'')+'同组件以最后一次更新为准；旧状态保留在历史原位置，不代表现在仍是这个值。</p>';
  if(selected.kind==='assistant')detail+='<p class="context-detail-note">这是模型生成记录，不能据此认定已发送到 QQ。</p>';
  if(selected.kind!=='component'&&selected.kind!=='definition')detail+='<p class="context-detail-note">C 编号对应 39 个组件。其他内容在原位置说明记录类型与用途；历史来信仅在桥接来源和数据结构均可核对时标为 C36。</p>';
 }
 const toolsNote=state.view==='tools'?'<p class="context-tools-note">工具定义来自所选请求独立的 tools 字段，与系统提示、messages 消息列表并列。这里的分区位置不表示模型内部的编码顺序。</p>':'';
 const regions='<div class="context-layout-map" role="group" aria-label="请求结构筛选"><button type="button" data-inspector-region="" aria-pressed="'+(!state.region&&state.view==='messages')+'"><strong>完整顺序</strong><span>'+messages.length+' 条消息</span></button>'+Object.entries(REGION_LABELS).map(([id,label])=>'<button type="button" data-inspector-region="'+id+'" aria-pressed="'+(state.region===id&&state.view==='messages')+'"><strong>'+label+'</strong><span>'+messages.filter(row=>row.region===id).length+' 条</span></button>').join('')+'<button type="button" data-inspector-region="tools"><strong>工具定义</strong><span>'+tools.length+' 个 · 独立字段</span></button></div>';
 const refresh=request.layoutVersion===2?'<p class="context-refresh-note">逐请求刷新：'+esc(request.contextRefresh?.status==='fresh'?'已读取最新组件资料':request.contextRefresh?.status==='stale'?'刷新未成功，沿用上次可靠资料':'尚无刷新证据')+'。状态改变才追加更新，原始记录与工具配对保留。</p>':'<p class="context-refresh-note">旧版请求记录：按当时实际内容展示，不能据此判断新版装填已生效。</p>';
 return regions+refresh+navHtml+shortcuts+mapping+toolsNote+controls+'<div class="context-inspector-split">'+list+'<section class="context-detail" aria-label="选中项详情" data-inspector-detail="'+esc(selected?.key||'')+'">'+detail+'</section></div>';
}
