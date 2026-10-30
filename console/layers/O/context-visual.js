import {compareRequests} from './context-request-diff.js';
import {knowledgePanel,visualGroups} from './context-knowledge.js';
import {attributeMessage,partLabel,unmatchedLabel} from './context-attribution.js';
import {inspectorHtml} from './context-inspector.js';
import {requestStageOptions,requestStageSummary} from './context-request-stages.js';
import {api,esc} from '../../shared/api.js';
import {registerPageLoader} from '../../shared/page-loaders.js';
let saved,draft,data,actual=true,dragged='',revision=0,loading=false,selectedRequestId='',inspectedRequest;
const inspectorState={view:'messages',selected:'',query:'',kind:'',region:''};
const $=id=>document.getElementById(id),copy=x=>JSON.parse(JSON.stringify(x));
const notice=text=>{$('contextNotice').textContent=text;};
const changed=()=>JSON.stringify(saved)!==JSON.stringify(draft);
const sceneNames={message:'用户来信',probability:'普通消息按概率触发唤醒',atMention:'有人 @ bot',nameMention:'有人叫 bot 的名字',bootstrap:'会话首次唤醒',timeBubble:'定时冒泡',careCheck:'主动关心',proactiveCheck:'静默后主动开口',idleRescue:'长时间静默后主动开口',reminder:'日程提醒',scheduledContact:'约定时间联系',newsShare:'每日视频推荐',replyCheck:'检查是否需要回复',budgetRecovery:'预算恢复后补发',selfReview:'自查',selfOptimize:'自我优化',slangLearn:'黑话学习',memoryWrite:'整理记忆',memoryUpdate:'更新记忆'};
const sceneName=value=>sceneNames[String(value||'').split(/[:@]/)[0]]||value||'未记录原因';
const reasonText=value=>({'O 层屏蔽':'已在本页关闭，本轮不发送','本轮未产出':'组件本轮没有提供内容','本场景无需演练':'本轮未触发演练，不发送这部分'}[value]||value);
const sourceText=value=>({'qq-context-current':'本轮整理后的背景信息','qq-context-dialogue':'聊天内容与本轮任务','runtime-context':'DSH 运行环境说明','system-prompt':'系统设定与角色要求'}[value]||value);
const metric=(label,value)=>'<div class="context-stat"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';
function framedText(text,modules,catalog,message={}){
 const fallback=unmatchedLabel(message);
 return attributeMessage({...message,text},modules,catalog).map(segment=>{
  if(!segment.text.trim())return '<pre class="context-text-gap" aria-hidden="true">'+esc(segment.text)+'</pre>';
  const owner=segment.owners[0],tone=owner?.number?((owner.number-1)%5):0;
  const labels=owner?segment.owners.map(o=>'<span class="context-pill">'+esc(o.number?'组件 C'+String(o.number).padStart(2,'0'):'附加规则')+'</span><strong>'+esc(o.name)+(o.part?' · '+esc(partLabel({name:o.part})):'')+'</strong>'+(o.evidence?'<span class="context-frame-evidence">'+esc(o.evidence)+'</span>':'')).join('<span> / </span>'):'<span class="context-pill">'+esc(fallback.tag)+'</span><strong>'+esc(fallback.title)+'</strong>';
  return '<div class="context-text-frame'+(owner?' context-tone-'+tone:' is-unattributed')+'"'+(owner?' data-context-owner="'+esc(owner.id)+'"':'')+'><div class="context-frame-label">'+labels+'</div>'+(!owner?'<p class="context-knowledge-note">'+esc(fallback.description)+'</p>':'')+'<pre>'+esc(segment.text)+'</pre></div>';
 }).join('');
}
function render(){
 if(!data)return;
 $('contextSave').disabled=!draft||!changed();$('contextReset').disabled=!draft||!changed();
 $('contextSave').hidden=actual;$('contextReset').hidden=actual;$('contextConsole').querySelector('.context-options').hidden=actual;$('contextConsole').querySelector('.context-help').hidden=actual;
 $('contextConsole').querySelector('.context-scope-badge').textContent=actual?'真实请求 · 只读查看':'全局设置 · 按会话预览';
 $('contextCompactHistory').checked=draft?.compactHistory!==false;
 $('contextDraftTab').setAttribute('aria-pressed',String(!actual));$('contextActualTab').setAttribute('aria-pressed',String(actual));
 const stages=data.requestStages||data.request?.requestStages||[{kind:'initial',label:'本轮初始请求',request:null},{kind:'previous',label:'上一次请求',request:null},{kind:'current',label:'当前请求（旧记录）',request:data.request}];
 const options=requestStageOptions(stages),selected=options.find(option=>option.aliases.includes(selectedRequestId))||options.find(option=>option.kind==='current')||options.at(-1);
 selectedRequestId=selected?.kind||'';
 const request=selected?.request,preview=data.preview;
 $('contextRequestPicker').hidden=!actual;$('contextRequestDiff').hidden=!actual;
 $('contextRequestSelect').replaceChildren(...(options.length?options.map(option=>new Option(option.label,option.kind)):[new Option('尚无模型调用记录','')]));$('contextRequestSelect').value=selectedRequestId;$('contextRequestSelect').disabled=!options.length;
 $('contextRequestSummary').textContent=requestStageSummary(request);
 const olderKind=selectedRequestId==='current'?'previous':'initial',older=selected?.aliases.includes(olderKind)?undefined:stages.find(stage=>stage.kind===olderKind)?.request;
 const delta=selected?.aliases.includes('initial')?null:compareRequests(older,request),join=items=>items.length?items.map(item=>esc(item.name||item)).join('、'):'无';
 $('contextRequestDiff').innerHTML=delta?'<strong>'+(selectedRequestId==='current'?'最新调用与上一次调用比较':'上一次调用与首次调用比较')+'</strong><p>工具新增：'+join(delta.toolsAdded)+'；移除：'+join(delta.toolsRemoved)+'；用途或参数说明变化：'+join(delta.toolsChanged)+'</p><p>模块变化：'+join(delta.modulesChanged)+'；消息字符变化 '+(delta.messageCharsDelta>=0?'+':'')+delta.messageCharsDelta+'；工具说明字符变化 '+(delta.toolCharsDelta>=0?'+':'')+delta.toolCharsDelta+'</p>':selected?.aliases.includes('initial')?'这是本次处理的首次模型调用，保留作比较基线；相同请求已合并展示。':'上一次调用尚未采集，无法比较；缺失记录不补造。';
 if(request&&Number.isSafeInteger(request.turn))$('contextRequestDiff').innerHTML+='<p class="meta">日志定位：DSH 内部回合 '+esc(request.turn)+(Number.isSafeInteger(request.step)?' / 步骤 '+esc(request.step):'')+'。这是内部处理编号，与消息条数、工具调用次数分别计数。</p>';
 $('contextRequestDiff').innerHTML='<summary>查看本次请求的变化</summary><div>'+$('contextRequestDiff').innerHTML+'</div>';
 if(actual&&data.capture?.nonce&&request?.nonce&&data.capture.nonce!==request.nonce)notice('这份请求使用的是另一批背景快照。下方按该次实际请求自己的组件记录展示。');
 if(actual){
  if(!request){$('contextMetrics').textContent='还没有记录到这个会话实际发给 AI 的内容。等下一次正常聊天或定时冒泡后再刷新；查看这里不会调用 AI。';$('contextModules').replaceChildren();return;}
  $('contextMetrics').innerHTML=metric('实际请求记录时间',new Date(request.at).toLocaleString())+metric('消息数据 · 含历史',request.messageChars+' 字符')+metric('工具清单',request.toolCount+' 个 / '+request.toolChars+' 字符');
  inspectedRequest=request;
  $('contextModules').innerHTML='<p class="context-section-note">下方是本次请求携带的完整消息记录（含历史）。消息角色按 system / user / assistant / tool 标注，彩色标签说明内容用途。</p><div id="contextInspector" class="context-inspector"></div>';
  renderInspector();return;
 }
 if(!preview){$('contextMetrics').textContent='这个会话还没有可预览的记录。下一次正常聊天或定时冒泡后会自动记录，再点“刷新已有记录”查看。';$('contextModules').replaceChildren();return;}
 $('contextMetrics').innerHTML=metric('采集场景',sceneName(data.capture.scene))+metric('全部组件原文',preview.beforeChars+' 字符')+metric('当前设置保留',preview.afterChars+' 字符 / 约 '+Math.ceil(preview.afterChars/2)+' token')+'<p class="context-metrics-note">采集于 '+esc(new Date(data.capture.at).toLocaleString())+' · 资料统计按当前策略，正文保留采集时内容。</p>';
 const groups=visualGroups(preview.modules,data.catalog||preview.modules);
 $('contextModules').innerHTML=section('modules','模块（'+groups.core.length+'个，空模块保留位置）',groups.core.map(m=>card(m,true)).join(''))+(groups.extra.length?section('rules','其他附加规则',groups.extra.map(m=>card({...m,index:undefined},true)).join('')):'');
}
function renderInspector({keepPosition=false,keepSearch=false}={}){
 const host=$('contextInspector');if(!host||!inspectedRequest)return;
 const scroll=keepPosition?host.querySelector('.context-sequence')?.scrollTop:undefined;
 const cursor=keepSearch?$('contextInspectorSearch')?.selectionStart:null;
 host.innerHTML=inspectorHtml(inspectedRequest,data.catalog||[],inspectorState,{renderText:framedText,renderComponent:row=>card({...row,index:undefined,protected:true},false)});
 const list=host.querySelector('.context-sequence'),active=list?.querySelector('[aria-pressed="true"]');
 if(scroll!==undefined)list.scrollTop=scroll;else if(active)list.scrollTop=Math.max(0,active.offsetTop-list.offsetTop-list.clientHeight/3);
 if(keepSearch){const input=$('contextInspectorSearch');input.focus();if(input.type!=='search'&&cursor!==null)input.setSelectionRange(cursor,cursor);}
}
function section(id,title,body,folded=false){return folded?'<details class="context-section" data-context-group="'+id+'"><summary>'+esc(title)+'</summary>'+body+'</details>':'<section class="context-section" data-context-group="'+id+'"><h3 class="context-section-title">'+esc(title)+'</h3>'+body+'</section>';}
function card(m,editable){
 const delivery=!editable?(m.notCaptured&&typeof m.inRequest!=='boolean'?'未采集，不能判定实发':m.included===false?'未注入：'+reasonText(m.reason):m.inRequest===true?'已在实际请求正文中确认':m.inRequest===false?'实际请求未完整包含此模块':'旧记录没有逐模块实发证据'):m.truncated?'内容超过组件上限，已截断':'';
 const locked=m.protected||!editable,title=(editable?data.knowledge?.[m.id]?.name:null)||m.name||m.id,tag=m.placement==='fixed'?'系统设定与角色要求':m.placement==='stable'?'稳定会话资料（user 前缀）':m.id==='wake-action'?'任务说明（随本轮任务提供）':m.id==='message-snapshot'?'收件处理进度与聊天原文':'动态资料（变化时更新）',placeholder=!m.text?.trim();
 const request=data.requestStages?.find(s=>s.kind===selectedRequestId)?.request||data.request;
 const annotated=!editable&&(String(m.id).startsWith('actual-')&&m.id!=='actual-tools'||m.requestIndex!==undefined);
 const content=annotated?'<div class="context-framed-content">'+framedText(m.text||'',request?.modules||[],data.catalog||[])+'</div>':'<pre>'+esc(m.text||'（这部分没有文字内容）')+'</pre>';
 const tone=Number.isInteger(m.index)?' context-tone-'+(m.index%5):'';
 return '<article class="context-module'+tone+(placeholder?' is-placeholder':m.included===false?' is-excluded':'')+'" data-context-id="'+esc(m.id)+'"><div class="context-module-head">'
 +(editable?'<button type="button" class="context-drag" draggable="true" data-context-move="drag" aria-label="拖动 '+esc(title)+'">⠿</button>':'')
 +'<h3>'+(Number.isInteger(m.index)?'<span class="context-number">'+esc(m.index+1)+'.</span> ':m.requestIndex?'<span class="context-number">#'+esc(m.requestIndex)+'</span> ':'')+esc(title)+'</h3>'
 +(editable?'<label title="'+(locked?'身份、权限和任务等必要内容不能在这里关闭':'勾选表示允许把这部分内容发给 AI；保存后适用于所有会话')+'"><input type="checkbox" data-context-toggle="'+esc(m.id)+'" '+(!draft.disabled.includes(m.id)||locked?'checked ':'')+(locked?'disabled ':'')+'>'+(locked?'必要内容，不能关闭':'允许发给 AI')+'</label><button type="button" data-context-move="up" aria-label="上移 '+esc(title)+'">↑</button><button type="button" data-context-move="down" aria-label="下移 '+esc(title)+'">↓</button>':'')
 +'</div><div class="context-source"><span class="context-pill">'+esc(sourceText(m.source)||m.layer||'系统')+'</span>'+(editable?'<span class="context-pill">'+esc(tag)+'</span>':'')+'<span>'+esc(m.chars??m.text?.length??0)+' 字符</span>'+(delivery?'<span class="context-delivery">'+esc(delivery)+'</span>':'')+(!placeholder&&m.reason?'<span>'+esc(reasonText(m.reason))+'</span>':'')+'</div>'
 +((m.toolCalls?.length||m.toolResults?.length)?'<p class="context-knowledge-note">'+(m.toolCalls||[]).map(c=>'具体调用：'+esc(c.name)+' · 调用ID '+esc(c.id)).join('；')+(m.toolResults||[]).map(c=>'返回对应调用ID：'+esc(c.toolCallId)).join('；')+'</p>':'')
 +(m.references?'<details class="context-references"><summary>查看组件来源清单'+(m.attributionVerified===false?' · 缺少同轮标记':'')+'</summary><ul>'+m.references.map(ref=>'<li>'+esc(ref)+'</li>').join('')+'</ul></details>':'')
 +knowledgePanel(m,data.knowledge?.[m.id],{actual:!editable,allowed:editable?!(draft?.enabled!==false&&draft.disabled.includes(m.id)):m.included!==false})
 +(m.id==='message-snapshot'&&m.parts?.length?'<p class="context-knowledge-note">两部分共用开关；新增来信按消息序号去重。</p>'+m.parts.map(part=>'<details><summary>'+esc(partLabel(part))+'</summary><pre>'+esc(part.text||'本轮无新增正文')+'</pre></details>').join(''):placeholder?'<p class="context-placeholder">本轮暂无内容，位置保留。</p>':'<details class="context-content"'+(annotated&&m.requestIndex===undefined?' open':'')+'><summary>'+(editable?'查看组件原文':annotated?'查看按组件标注的原文':'查看原文')+'</summary>'+content+'</details>')+'</article>';
}
async function refresh(keepDraft=false){
 const ticket=++revision;loading=true;
 try{const key=$('contextSession').value;const response=await api('/api/context/preview'+(key?'?key='+encodeURIComponent(key):''));if(response.ok===false)throw Error(response.error);
  if(ticket!==revision)return;data=response;if(!keepDraft||!draft){saved=copy(response.policy);draft=copy(saved);}
  const selected=key;$('contextSession').replaceChildren(new Option('选择要查看的私聊或群聊…',''),...(response.sessions||[]).map(s=>new Option(s.key,s.key)));$('contextSession').value=selected;
  if(!selected&&response.sessions?.length){$('contextSession').value=response.sessions[0].key;loading=false;await refresh(true);return;}
  notice(changed()?'有未保存的修改；保存后将用于所有私聊和群聊。':!response.capture?'还没有可查看的记录。':response.capture.active?'已采集上下文。实际请求只读查看，组件设置需单独保存。':'采集这条记录时，新版整理功能尚未启用，bot 当时仍按原方式发送。');
  if(keepDraft&&changed()){loading=false;await project();return;}render();
 }catch(error){notice('读取失败：'+error.message);}finally{if(ticket===revision)loading=false;}
}
async function project(){const ticket=++revision;try{const response=await api('/api/context/preview','POST',{key:$('contextSession').value,draft});if(response.ok===false)throw Error(response.error);if(ticket!==revision)return;data=response;notice(changed()?'预览已更新，但还没有保存；bot 暂时继续使用原设置。':'当前预览与上次保存的设置一致。');render();}catch(error){notice('无法更新预览：'+error.message);}}
function move(id,target){if(!data?.preview||actual)return;const rows=[...data.preview.modules],from=rows.findIndex(x=>x.id===id),to=rows.findIndex(x=>x.id===target);if(from<0||to<0||from===to)return;
 if(rows[from].placement!==rows[to].placement){notice('请在同一装填层内调序：系统规则、稳定资料、动态资料各有固定位置。');return;}
 const [item]=rows.splice(from,1);rows.splice(to,0,item);draft.order=rows.map(x=>x.id);void project();}
export function initialize(){
 $('contextRefresh').addEventListener('click',()=>refresh(true));$('contextSession').addEventListener('change',()=>refresh(true));
 $('contextDraftTab').addEventListener('click',()=>{actual=false;render();});$('contextActualTab').addEventListener('click',()=>{actual=true;render();});
 $('contextRequestSelect').addEventListener('change',event=>{selectedRequestId=event.target.value;inspectorState.selected='';render();});
 $('contextReset').addEventListener('click',()=>{draft=copy(saved);void project();});
 $('contextCompactHistory').addEventListener('change',event=>{draft.compactHistory=event.target.checked;void project();});
 $('contextModules').addEventListener('change',event=>{const id=event.target.dataset.contextToggle;if(!id||!draft)return;draft.disabled=draft.disabled.filter(x=>x!==id);if(!event.target.checked)draft.disabled.push(id);void project();});
 $('contextModules').addEventListener('input',event=>{if(event.target.id!=='contextInspectorSearch')return;inspectorState.query=event.target.value;renderInspector({keepSearch:true});});
 $('contextModules').addEventListener('change',event=>{if(event.target.id!=='contextInspectorKind')return;inspectorState.kind=event.target.value;renderInspector();});
 const locateComponent=id=>{inspectorState.view='components';inspectorState.selected='component:'+id;inspectorState.query='';renderInspector();};
 $('contextModules').addEventListener('change',event=>{if(event.target.id==='contextComponentLookup'&&event.target.value)locateComponent(event.target.value);});
 $('contextModules').addEventListener('click',event=>{const button=event.target.closest('[data-inspector-component]');if(button)locateComponent(button.dataset.inspectorComponent);});
 $('contextModules').addEventListener('click',event=>{const button=event.target.closest('[data-inspector-message]');if(button){inspectorState.view='messages';inspectorState.region='';inspectorState.query='';inspectorState.kind='';inspectorState.selected=button.dataset.inspectorMessage;renderInspector();}});
 $('contextModules').addEventListener('click',event=>{const region=event.target.closest('[data-inspector-region]'),view=event.target.closest('[data-inspector-view]'),row=event.target.closest('[data-inspector-select]');if(region){inspectorState.view=region.dataset.inspectorRegion==='tools'?'tools':'messages';inspectorState.region=region.dataset.inspectorRegion==='tools'?'':region.dataset.inspectorRegion;inspectorState.kind='';inspectorState.query='';inspectorState.selected='';renderInspector();}else if(view){inspectorState.view=view.dataset.inspectorView;inspectorState.region='';inspectorState.query='';inspectorState.selected='';renderInspector();}else if(row){inspectorState.selected=row.dataset.inspectorSelect;renderInspector({keepPosition:true});}});
 $('contextModules').addEventListener('click',event=>{const btn=event.target.closest('[data-context-move]'),row=btn?.closest('[data-context-id]');if(!row||!['up','down'].includes(btn.dataset.contextMove))return;const rows=data.preview.modules,i=rows.findIndex(x=>x.id===row.dataset.contextId),direction=btn.dataset.contextMove==='up'?-1:1;let j=i+direction;while(rows[j]&&rows[j].placement!==rows[i].placement)j+=direction;if(rows[j])move(row.dataset.contextId,rows[j].id);});
 $('contextModules').addEventListener('dragstart',event=>{const handle=event.target.closest('[draggable]');if(!handle)return;dragged=handle.closest('[data-context-id]').dataset.contextId;event.dataTransfer.setData('text/plain',dragged);});
 $('contextModules').addEventListener('dragover',event=>{if(dragged)event.preventDefault();});
 $('contextModules').addEventListener('drop',event=>{event.preventDefault();const row=event.target.closest('[data-context-id]');if(row&&dragged)move(dragged,row.dataset.contextId);dragged='';});
 $('contextModules').addEventListener('dragend',()=>{dragged='';});
 $('contextSave').addEventListener('click',async()=>{if(!draft||loading)return;const submitted=copy(draft);$('contextSave').disabled=true;try{const response=await api('/api/context/policy','POST',{policy:submitted});if(response.ok===false)throw Error(response.error);saved=submitted;render();notice(changed()?'已保存全局设置；你在保存期间继续修改的部分还没有保存。':'已保存全局设置：适用于所有私聊和群聊，从各会话的下一次唤醒开始使用。组件功能与工具权限保持原样。');}catch(error){notice('保存失败：'+error.message);render();}});
 registerPageLoader('context-visual',()=>refresh(true));
}
