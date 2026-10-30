import {compareRequests} from './context-request-diff.js';
import {requestCards} from './context-request.js';
import {knowledgePanel,visualGroups} from './context-knowledge.js';
import {api,esc} from '../../shared/api.js';
import {registerPageLoader} from '../../shared/page-loaders.js';
let saved,draft,data,actual=false,dragged='',revision=0,loading=false,selectedRequestId='';
const $=id=>document.getElementById(id),copy=x=>JSON.parse(JSON.stringify(x));
const notice=text=>{$('contextNotice').textContent=text;};
const changed=()=>JSON.stringify(saved)!==JSON.stringify(draft);
const sceneNames={message:'用户来信',probability:'普通消息按概率触发唤醒',atMention:'有人 @ bot',nameMention:'有人叫 bot 的名字',bootstrap:'会话首次唤醒',timeBubble:'定时冒泡',careCheck:'主动关心',proactiveCheck:'静默后主动开口',idleRescue:'长时间静默后主动开口',reminder:'日程提醒',scheduledContact:'约定时间联系',newsShare:'每日视频推荐',replyCheck:'检查是否需要回复',budgetRecovery:'预算恢复后补发',selfReview:'自查',selfOptimize:'自我优化',slangLearn:'黑话学习',memoryWrite:'整理记忆',memoryUpdate:'更新记忆'};
const sceneName=value=>sceneNames[String(value||'').split(/[:@]/)[0]]||value||'未记录原因';
const reasonText=value=>({'O 层屏蔽':'已在本页关闭，本轮不发送','本轮未产出':'组件本轮没有提供内容','本场景无需演练':'本轮未触发演练，不发送这部分'}[value]||value);
const sourceText=value=>({'qq-context-current':'本轮整理后的背景信息','qq-context-dialogue':'聊天内容与本轮任务','runtime-context':'DSH 运行环境说明','system-prompt':'系统设定与角色要求'}[value]||value);
const actualName=row=>({system:'系统设定与角色要求',developer:'系统补充说明',user:'用户消息与附加资料',assistant:'AI 的历史消息',tool:'工具返回结果'}[row.role||row.name?.split(' ')[0]]||row.name||row.id);
function render(){
 if(!data)return;
 $('contextSave').disabled=!draft||!changed();$('contextReset').disabled=!draft||!changed();
 $('contextCompactHistory').checked=draft?.compactHistory!==false;
 $('contextDraftTab').setAttribute('aria-pressed',String(!actual));$('contextActualTab').setAttribute('aria-pressed',String(actual));
 const stages=data.requestStages||data.request?.requestStages||[{kind:'initial',label:'本轮初始请求',request:null},{kind:'previous',label:'上一次请求',request:null},{kind:'current',label:'当前请求（旧记录）',request:data.request}];
 if(!stages.some(stage=>stage.kind===selectedRequestId&&stage.request))selectedRequestId='current';
 const selected=stages.find(stage=>stage.kind===selectedRequestId)||stages.at(-1),request=selected?.request,preview=data.preview;
 $('contextRequestPicker').hidden=!actual;$('contextRequestDiff').hidden=!actual;
 $('contextRequestSelect').replaceChildren(...stages.map(stage=>{const row=stage.request,option=new Option(stage.label+(row?' · '+new Date(row.at).toLocaleString()+' · '+(row.turn!==undefined?'第'+row.turn+'回合':'回合'+String(row.nonce||'未知').slice(0,8))+' / 第'+(row.requestInRound||'?')+'次调用 · '+(row.toolCount||0)+'个工具':' · 尚未采集'),stage.kind);option.disabled=!row;return option;}));$('contextRequestSelect').value=selectedRequestId;
 const older=stages.find(stage=>stage.kind===(selectedRequestId==='current'?'previous':'initial'))?.request,delta=selectedRequestId==='initial'?null:compareRequests(older,request),join=items=>items.length?items.map(item=>esc(item.name||item)).join('、'):'无';
 $('contextRequestDiff').innerHTML=delta?'<strong>'+(selectedRequestId==='current'?'当前请求与上一次请求比较':'上一次请求与本轮初始请求比较')+'</strong><p>工具新增：'+join(delta.toolsAdded)+'；移除：'+join(delta.toolsRemoved)+'；用途或参数说明变化：'+join(delta.toolsChanged)+'</p><p>模块变化：'+join(delta.modulesChanged)+'；消息字符变化 '+(delta.messageCharsDelta>=0?'+':'')+delta.messageCharsDelta+'；工具说明字符变化 '+(delta.toolCharsDelta>=0?'+':'')+delta.toolCharsDelta+'</p>':selectedRequestId==='initial'?'这是本轮首次请求，保留作比较基线。':'尚无本轮上一次请求可比较；初始与当前可能是同一次调用，不会为填充记录调用AI。';
 if(actual&&data.capture?.nonce&&request?.nonce&&data.capture.nonce!==request.nonce)notice('这份实发记录与当前采集不是同一轮。下方按这份实际请求自己的模块记录展示，不与当前预览混算。');
 if(actual){
  if(!request){$('contextMetrics').textContent='还没有记录到这个会话实际发给 AI 的内容。等下一次正常聊天或定时冒泡后再刷新；查看这里不会调用 AI。';$('contextModules').replaceChildren();return;}
  $('contextMetrics').innerHTML='<span>发送记录时间 <strong>'+esc(new Date(request.at).toLocaleString())+'</strong></span><span>消息数据（含历史）<strong>'+esc(request.messageChars)+' 字符</strong></span><span>工具说明 <strong>'+esc(request.toolCount)+' 个 / '+esc(request.toolChars)+' 字符</strong></span>';
  const catalog=data.catalog||data.capture?.modules||[],view=requestCards(request,catalog),groups=visualGroups(request.modules||[],catalog);
  const toolRecord=m=>m.role==='tool'||m.toolCalls?.length||m.toolResults?.length;
  const renderRows=rows=>rows.map(m=>card({...m,name:actualName(m),index:undefined,protected:true,included:true},false)).join('');
  const toolsSection=section('tools','这次请求中，AI 可用的工具及说明（'+esc(request.toolCount)+'个）','<p class="meta"><strong>这就是所选请求的工具清单，与聊天消息并列。</strong>第一次实际调用AI时就会提供；后续调用仍按当时权限提供。它说明工具用途和参数，具体调用及返回数据见下方消息历史。</p>'+card({id:'actual-tools',name:'工具清单：用途与参数',source:'本次冻结请求的tools字段',text:JSON.stringify(request.tools,null,2),chars:request.toolChars,protected:true,included:true,inRequest:true},false),true);
  $('contextModules').innerHTML=toolsSection+section('delivery','所选请求实际发送的组合','<p class="meta"><strong>本轮背景是桥接最近送入的快照，并非每次请求前重新读取。</strong>例：心情快照为60，工具随后改为65，后续请求可同时保留快照60与工具结果65；桥接送入新一批上下文时才替换背景。系统设定通常沿用，对话和工具记录继续追加。</p>'+view.cards.map(m=>card(m,false)).join(''))
   +section('history-dialogue','对话消息与 AI 历史文字','<p class="meta">保留进入会话的历史消息。有些AI文字是内部处理记录，未必已发给QQ用户；本轮任务和新消息在上方单独展示。</p>'+renderRows(view.history.filter(m=>!toolRecord(m))),true)
   +section('history-tools','工具调用与返回记录','<p class="meta">这两者也属于消息历史，按请求中的先后顺序展示。AI的历史消息可包含具体调用；工具返回结果是数据或错误，调用ID用于配对。例：先调用日程查询，再返回今天14:00开会。</p>'+renderRows(view.history.filter(toolRecord)),true)
   +section('modules','来源模块（'+groups.core.length+'个；空模块保留编号）',groups.core.map(m=>card({...m,protected:true},false)).join(''),true)
   +(groups.extra.length?section('rules','其他附加规则',groups.extra.map(m=>card({...m,index:undefined,protected:true},false)).join(''),true):'')
;return;
 }
 if(!preview){$('contextMetrics').textContent='这个会话还没有可预览的记录。下一次正常聊天或定时冒泡后会自动记录，再点“刷新已有记录”查看。';$('contextModules').replaceChildren();return;}
 $('contextMetrics').innerHTML='<span>这份记录来自 <strong>'+esc(sceneName(data.capture.scene))+' · '+esc(new Date(data.capture.at).toLocaleString())+'</strong></span><span>全部模块原文 <strong>'+esc(preview.beforeChars)+' 字符</strong></span><span>按当前设置保留 <strong>'+esc(preview.afterChars)+' 字符 / 约 '+esc(Math.ceil(preview.afterChars/2))+' token</strong></span><span>资料统计是当前策略；正文为采集时内容</span>';
 const groups=visualGroups(preview.modules,data.catalog||preview.modules);
 $('contextModules').innerHTML=section('modules','模块（'+groups.core.length+'个，空模块保留位置）',groups.core.map(m=>card(m,true)).join(''))+(groups.extra.length?section('rules','其他附加规则',groups.extra.map(m=>card({...m,index:undefined},true)).join('')):'');
}
function section(id,title,body,folded=false){return folded?'<details class="context-section" data-context-group="'+id+'"><summary>'+esc(title)+'</summary>'+body+'</details>':'<section class="context-section" data-context-group="'+id+'"><h3 class="context-section-title">'+esc(title)+'</h3>'+body+'</section>';}
function card(m,editable){
 const delivery=!editable?(m.notCaptured&&typeof m.inRequest!=='boolean'?'未采集，不能判定实发':m.included===false?'未注入：'+reasonText(m.reason):m.inRequest===true?'已在实际请求正文中确认':m.inRequest===false?'实际请求未完整包含此模块':'旧记录没有逐模块实发证据'):m.truncated?'内容超过组件上限，已截断':'';
 const locked=m.protected||!editable,title=data.knowledge?.[m.id]?.name||m.name||m.id,tag=m.placement==='fixed'?'系统设定与角色要求':m.id==='wake-action'?'用户附加资料：本轮任务':m.id==='message-snapshot'?'用户附加资料：收件状态 + 新消息':'用户附加资料：本轮背景',placeholder=!m.text?.trim();
 return '<article class="context-module'+(placeholder?' is-placeholder':m.included===false?' is-excluded':'')+'" data-context-id="'+esc(m.id)+'"><div class="context-module-head">'
 +(editable?'<button type="button" class="context-drag" draggable="true" data-context-move="drag" aria-label="拖动 '+esc(title)+'">⠿</button>':'')
 +'<h3>'+(Number.isInteger(m.index)?esc(m.index+1)+'. ':'')+esc(title)+'</h3>'
 +(editable?'<label title="'+(locked?'身份、权限和任务等必要内容不能在这里关闭':'勾选表示允许把这部分内容发给 AI；保存后适用于所有会话')+'"><input type="checkbox" data-context-toggle="'+esc(m.id)+'" '+(!draft.disabled.includes(m.id)||locked?'checked ':'')+(locked?'disabled ':'')+'>'+(locked?'必要内容，不能关闭':'允许发给 AI')+'</label><button type="button" data-context-move="up" aria-label="上移 '+esc(title)+'">↑</button><button type="button" data-context-move="down" aria-label="下移 '+esc(title)+'">↓</button>':'')
 +'</div><p class="context-source">内容来自：'+esc(sourceText(m.source)||m.layer||'系统')+' · '+(editable?tag+' · ':'')+esc(m.chars??m.text?.length??0)+' 字符'+(delivery?' · '+esc(delivery):'')+(!placeholder&&m.reason?' · '+esc(reasonText(m.reason)):'')+'</p>'
 +((m.toolCalls?.length||m.toolResults?.length)?'<p class="context-knowledge-note">'+(m.toolCalls||[]).map(c=>'具体调用：'+esc(c.name)+' · 调用ID '+esc(c.id)).join('；')+(m.toolResults||[]).map(c=>'返回对应调用ID：'+esc(c.toolCallId)).join('；')+'</p>':'')
 +(m.references?'<p class="context-knowledge-note">来源：'+esc(m.references.join(' · '))+(m.attributionVerified===false?'；旧记录缺少同轮标记，分类尚不能完全核验':'')+'</p>':'')
 +knowledgePanel(m,data.knowledge?.[m.id],{actual:!editable,allowed:editable?!(draft?.enabled!==false&&draft.disabled.includes(m.id)):m.included!==false})
 +(m.id==='message-snapshot'&&m.parts?.length?'<p class="context-knowledge-note">两部分关联启停，共用本模块开关；实际新增消息会按已发送序号去重。</p>'+m.parts.map(part=>'<details><summary>'+esc(part.name)+' → '+(part.destination==='background'?'用户消息与附加资料：本轮背景':'用户消息与附加资料：本轮任务和新消息')+'</summary><pre>'+esc(part.text||'本轮无新增正文')+'</pre></details>').join(''):placeholder?'<p class="context-placeholder">本轮暂无内容，位置保留。</p>':'<details><summary>'+(editable?'查看这部分提供的文字':'查看这次请求发送的文字')+'</summary><pre>'+esc(m.text||'（这部分没有文字内容）')+'</pre></details>')+'</article>';
}
async function refresh(keepDraft=false){
 const ticket=++revision;loading=true;
 try{const key=$('contextSession').value;const response=await api('/api/context/preview'+(key?'?key='+encodeURIComponent(key):''));if(response.ok===false)throw Error(response.error);
  if(ticket!==revision)return;data=response;if(!keepDraft||!draft){saved=copy(response.policy);draft=copy(saved);}
  const selected=key;$('contextSession').replaceChildren(new Option('选择要查看的私聊或群聊…',''),...(response.sessions||[]).map(s=>new Option(s.key,s.key)));$('contextSession').value=selected;
  if(!selected&&response.sessions?.length){$('contextSession').value=response.sessions[0].key;loading=false;await refresh(true);return;}
  notice(changed()?'有未保存的修改；保存后将用于所有私聊和群聊。':!response.capture?'还没有可查看的记录。':response.capture.active?'这条记录使用了新版上下文整理流程；点“本轮请求对比”核对发出的内容。':'采集这条记录时，新版整理功能尚未启用，bot 当时仍按原方式发送。');
  if(keepDraft&&changed()){loading=false;await project();return;}render();
 }catch(error){notice('读取失败：'+error.message);}finally{if(ticket===revision)loading=false;}
}
async function project(){const ticket=++revision;try{const response=await api('/api/context/preview','POST',{key:$('contextSession').value,draft});if(response.ok===false)throw Error(response.error);if(ticket!==revision)return;data=response;notice(changed()?'预览已更新，但还没有保存；bot 暂时继续使用原设置。':'当前预览与上次保存的设置一致。');render();}catch(error){notice('无法更新预览：'+error.message);}}
function move(id,target){if(!data?.preview||actual)return;const rows=[...data.preview.modules],from=rows.findIndex(x=>x.id===id),to=rows.findIndex(x=>x.id===target);if(from<0||to<0||from===to)return;
 if(rows[from].placement!==rows[to].placement){notice('角色设定的系统位置固定；其余模块请在用户附加资料内调序，例如把心情移到黑话前面。');return;}
 const [item]=rows.splice(from,1);rows.splice(to,0,item);draft.order=rows.map(x=>x.id);void project();}
export function initialize(){
 $('contextRefresh').addEventListener('click',()=>refresh(true));$('contextSession').addEventListener('change',()=>refresh(true));
 $('contextDraftTab').addEventListener('click',()=>{actual=false;render();});$('contextActualTab').addEventListener('click',()=>{actual=true;render();});
 $('contextRequestSelect').addEventListener('change',event=>{selectedRequestId=event.target.value;render();});
 $('contextReset').addEventListener('click',()=>{draft=copy(saved);void project();});
 $('contextCompactHistory').addEventListener('change',event=>{draft.compactHistory=event.target.checked;void project();});
 $('contextModules').addEventListener('change',event=>{const id=event.target.dataset.contextToggle;if(!id||!draft)return;draft.disabled=draft.disabled.filter(x=>x!==id);if(!event.target.checked)draft.disabled.push(id);void project();});
 $('contextModules').addEventListener('click',event=>{const btn=event.target.closest('[data-context-move]'),row=btn?.closest('[data-context-id]');if(!row||!['up','down'].includes(btn.dataset.contextMove))return;const rows=data.preview.modules,i=rows.findIndex(x=>x.id===row.dataset.contextId),target=rows[i+(btn.dataset.contextMove==='up'?-1:1)];if(target)move(row.dataset.contextId,target.id);});
 $('contextModules').addEventListener('dragstart',event=>{const handle=event.target.closest('[draggable]');if(!handle)return;dragged=handle.closest('[data-context-id]').dataset.contextId;event.dataTransfer.setData('text/plain',dragged);});
 $('contextModules').addEventListener('dragover',event=>{if(dragged)event.preventDefault();});
 $('contextModules').addEventListener('drop',event=>{event.preventDefault();const row=event.target.closest('[data-context-id]');if(row&&dragged)move(dragged,row.dataset.contextId);dragged='';});
 $('contextModules').addEventListener('dragend',()=>{dragged='';});
 $('contextSave').addEventListener('click',async()=>{if(!draft||loading)return;const submitted=copy(draft);$('contextSave').disabled=true;try{const response=await api('/api/context/policy','POST',{policy:submitted});if(response.ok===false)throw Error(response.error);saved=submitted;render();notice(changed()?'已保存全局设置；你在保存期间继续修改的部分还没有保存。':'已保存全局设置：适用于所有私聊和群聊，从各会话的下一次唤醒开始使用。组件功能与工具权限保持原样。');}catch(error){notice('保存失败：'+error.message);render();}});
 registerPageLoader('context-visual',()=>refresh(true));
}
