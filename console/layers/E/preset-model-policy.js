import {api,esc} from '../../shared/api.js';
import {presetInfo} from '../O/preset-catalog.js';
let editor;
export async function loadPresetModelPolicy(overview){
 if(!editor)editor=createEditor(document.getElementById('presetModelPolicy'),overview);
 else editor.updateOverview(overview);
 return editor.initial;
}
function createEditor(root,overview){
 let state=null,groups=[],ready=false,busy=false,rows=[],activeKey='',views=[];
 const status=root.querySelector('[data-model-status]'),grid=root.querySelector('[data-model-rows]');
 const defaults=root.querySelector('[data-model-defaults]');
 const tabs=root.querySelector('[data-preset-tabs]');
 const labels={'qq-admin':'管理员','qq-chat':'一代聊天','qq-chat-v2':'二代聊天','qq-learning':'后台学习','campus-summary':'网页整理','qq-task-worker':'独立任务'};
 function buildViews(){const get=key=>overview?.bindings?.find(b=>b.key===key)?.preset;
  const chat=get('v1'),admin=get('admin');return [
   ...[['chat','聊天模式',chat],['closed-agent','封闭 Agent',overview?.adminEnabled?admin:chat],['reserved','一代仿真',chat],['reserved2','二代仿真',get('v2')]].map(([key,label,id])=>({key,label,id,active:overview?.mode===key})),
   {key:'admin',label:'管理员环境',id:admin,active:overview?.adminEnabled===true},
   ...[['task','独立任务'],['learning','后台学习'],['summary','网页整理']].map(([key,label])=>({key,label,id:get(key)}))];}
 function selectRow(key){activeKey=key;const view=views.find(v=>v.key===key);for(const row of rows){row.el.hidden=row.scope!=='global'&&row.id!==view?.id;if(row.id&&!row.el.hidden)describe(row,view);}for(const button of tabs.children)button.setAttribute('aria-selected',String(button.dataset.presetSelect===key));defaults.hidden=false;grid.hidden=false;}
 function addTabs(){for(const view of views){const button=document.createElement('button');button.type='button';button.role='tab';button.textContent=view.label;button.dataset.presetSelect=view.key;button.addEventListener('click',()=>selectRow(view.key));tabs.append(button);}}
 function describe(row,view){
  if(!row.id)return;
  const bindings=(overview?.bindings||[]).filter(b=>b.preset===row.id),primary=bindings.find(b=>b.key==='admin')||bindings.find(b=>!['owner','default'].includes(b.key))||bindings[0];
  const title=primary?.label||row.label.replace(/^Chat Bridge\s*[·・]\s*/,'').replace(/^AI助手/,'');
  row.el.querySelector('h4').textContent=title+(row.range?' · 模型范围':'');
  row.el.dataset.presetBinding=primary?.key||row.id;
  const info=row.el.querySelector('[data-preset-info]');
  const code=row.el.querySelector('p.meta:has(code)');if(code)code.hidden=true;
  const active=view?view.active:primary?.active;
  const phase=row.available===false?'不可用':active===true?'当前使用':active===false?'未启用':'按需启用';
  const description=primary?.configuration?.description||row.description||'';
  info.innerHTML='<div class="preset-selected-heading"><strong>'+esc(row.label)+'</strong><code>'+esc(row.id)+'</code><span class="preset-state">'+phase+'</span></div>'+(description?'<p class="preset-selected-description">'+esc(description)+'</p>':'');
 }
 const refresh=root.querySelector('[data-model-refresh]'),read=root.querySelector('[data-model-read]');
 const purpose=id=>['qq-task-worker','qq-learning','campus-summary'].includes(id)?'task':'conversation';
 const inherited=row=>row.range?asRange(state.config.task):state.config[purpose(row.id)];
 const asRange=value=>value.allowed?value:{allowed:[{provider:value.provider,model:value.model,efforts:[value.effort]}]};
 const choice=row=>{
  if(!row.range)return Object.fromEntries(['provider','model','effort'].map(k=>[k,row.fields[k].value]));
  const allowed=[];for(const field of row.checks)if(field.checked){const {provider,model,effort}=field.dataset;let item=allowed.find(x=>x.provider===provider&&x.model===model);if(!item){item={provider,model,efforts:[]};allowed.push(item);}item.efforts.push(effort);}return {allowed};
 };
 const entry=row=>groups.find(g=>g.id===row.fields.provider.value)?.models.find(m=>m.id===row.fields.model.value);
 function options(el,list,value){
  el.replaceChildren();for(const item of list){const o=document.createElement('option');o.value=item.id;o.textContent=item.name||item.id;o.title=item.description||'';el.append(o);}
  if(!list.some(x=>x.id===value)){const o=document.createElement('option');o.value=value;o.textContent=value?value+'（当前不可用）':'请选择';el.append(o);}el.value=value;
 }
 function fill(row,value){
  if(row.range){
   const selected=asRange(value).allowed,models=groups.flatMap(g=>g.models.map(m=>({provider:g.id,model:m.id,name:(g.name||g.id)+' / '+(m.name||m.id),efforts:['',...(m.reasoning?.efforts||[]).map(e=>e.id)]})));
   for(const s of selected){let m=models.find(m=>m.provider===s.provider&&m.model===s.model);if(!m){m={...s,name:s.provider+' / '+s.model+'（当前不可用）',efforts:[]};models.push(m);}for(const e of s.efforts)if(!m.efforts.includes(e))m.efforts.push(e);}
   row.options.replaceChildren();row.checks=[];
   const picker=document.createElement('select');picker.setAttribute('aria-label','范围模型');picker.dataset.rangeModel='';const modelLabel=document.createElement('label');modelLabel.textContent='模型';modelLabel.append(picker);row.options.append(modelLabel);
   for(const m of models){const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='允许的思考强度';box.dataset.rangeKey=m.provider+'\n'+m.model;box.append(legend);const option=document.createElement('option');option.value=box.dataset.rangeKey;option.textContent=m.name+(selected.some(s=>s.provider===m.provider&&s.model===m.model)?' · 已选':'');picker.append(option);
    for(const effort of m.efforts){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.rangeEffort='';Object.assign(check.dataset,{provider:m.provider,model:m.model,effort});check.checked=selected.some(s=>s.provider===m.provider&&s.model===m.model&&s.efforts.includes(effort));label.append(check,document.createTextNode(effort||'模型默认'));box.append(label);row.checks.push(check);}
    row.options.append(box);
   }
   picker.value=models.some(m=>m.provider+'\n'+m.model===row.rangeVisible)?row.rangeVisible:(selected[0]?selected[0].provider+'\n'+selected[0].model:picker.options[0]?.value||'');
   const show=()=>{row.rangeVisible=picker.value;for(const box of row.options.querySelectorAll('fieldset'))box.hidden=box.dataset.rangeKey!==picker.value;};picker.addEventListener('change',event=>{event.stopPropagation();show();});show();return;
  }
  options(row.fields.provider,groups,value.provider);
  options(row.fields.model,groups.find(g=>g.id===value.provider)?.models||[],value.model);
  const model=entry(row),efforts=model?.reasoning?.efforts||[];
  options(row.fields.effort,[{id:'',name:efforts.length?'模型默认'+(model.reasoning.defaultEffort?'（'+model.reasoning.defaultEffort+'）':''):'无需思考档位'},...efforts],value.effort);
 }
 function paint(){
  refresh.disabled=read.disabled=busy;
  for(const row of rows){
   if(row.range){
    const own=row.override.checked,value=choice(row),valid=value.allowed.length&&value.allowed.every(s=>{const m=groups.find(g=>g.id===s.provider)?.models.find(m=>m.id===s.model);return m&&s.efforts.every(e=>!e||m.reasoning?.efforts?.some(x=>x.id===e));});
    row.override.disabled=busy;for(const check of row.checks)check.disabled=busy||!own||!row.available;
    row.save.disabled=busy||!ready||own&&(!valid||!row.available);
    row.note.textContent=!own?'继承默认设置':!ready?'目录不可用，草稿保留。':!valid?'请选择有效组合。':'已选 '+value.allowed.length+' 个模型 · 由发起模型决定';continue;
   }
   const own=!row.override||row.override.checked,model=entry(row),effort=row.fields.effort.value;
   const valid=!!model&&(!effort||model.reasoning?.efforts?.some(e=>e.id===effort));
   if(row.override)row.override.disabled=busy;
   row.fields.provider.disabled=row.fields.model.disabled=busy||!own||row.available===false;
   row.fields.effort.disabled=busy||!own||row.available===false||!!model&&!model.reasoning?.efforts?.length&&!effort;
   row.save.disabled=busy||!ready||own&&(!valid||row.available===false)||row.scope==='global'&&!state.supportsGlobalDefault;
   row.note.textContent=row.scope==='global'?(!state.supportsGlobalDefault?'当前服务尚不支持全局保存。':!ready?'目录不可用，保留当前选择。':!valid?'当前选择已失效':'未启用单独设置的环境继承此默认值；已启用的单独配置和任务范围保持不变。'):!own?'继承默认设置':!ready?'目录不可用，保留当前选择。':row.available===false?'DSH 未提供此预设':!valid?'当前选择已失效':'';
  }
 }
 function addRow(scope,id,label,available=true,description=''){
  if(id==='qq-task-worker'){addRangeRow(label,available,description);return;}
  const el=document.createElement('article');el.className='preset-overview-card';el.dataset.modelScope=scope;if(id)el.dataset.modelPreset=id;
  el.innerHTML='<h4>'+esc(label)+'</h4>'+(id?'<p class="meta"><code>'+esc(id)+'</code></p><label><input type="checkbox" data-model-override> 单独配置此预设</label>':'')+'<div class="preset-model-fields">'+[['provider','服务提供方'],['model','模型'],['effort','思考强度']].map(([k,label])=>'<label>'+label+'<select data-model-field="'+k+'" aria-label="'+esc(label)+'"></select></label>').join('')+'</div><p class="meta" data-model-note></p><button type="button" class="small primary" data-model-save>保存此项</button><p class="meta" data-model-message role="status"></p>';
  if(id)el.querySelector('h4').insertAdjacentHTML('afterend','<div data-preset-info></div>');
  (id?grid:defaults).append(el);
  const row={scope,id,available,el,fields:Object.fromEntries(['provider','model','effort'].map(k=>[k,el.querySelector('[data-model-field="'+k+'"]')])),override:el.querySelector('[data-model-override]'),save:el.querySelector('[data-model-save]'),note:el.querySelector('[data-model-note]'),message:el.querySelector('[data-model-message]'),dirty:false};
  if(scope==='global')row.save.textContent='保存全局默认';
  row.label=label;row.description=description;describe(row);
  if(row.override)row.override.checked=Object.hasOwn(state.config.presets,id);
  fill(row,id?state.config.presets[id]||inherited(row):state.config[scope==='global'?'conversation':scope]);
  const changed=()=>{row.dirty=true;row.message.textContent='尚未保存';paint();};
  row.fields.provider.addEventListener('change',()=>{const provider=row.fields.provider.value;fill(row,{provider,model:groups.find(g=>g.id===provider)?.models[0]?.id||'',effort:''});changed();});
  row.fields.model.addEventListener('change',()=>{fill(row,{...choice(row),effort:''});changed();});
  row.fields.effort.addEventListener('change',changed);
  row.override?.addEventListener('change',()=>{if(!row.override.checked)fill(row,inherited(row));changed();});
  row.save.addEventListener('click',()=>saveRow(row));rows.push(row);if(id)row.el.setAttribute('role','tabpanel');
 }
 async function saveRow(row){
   const {scope,id}=row;
   if(busy||!ready)return;busy=true;paint();row.message.textContent='保存并同步会话…';
   try{
    const result=await api('/api/presets/model-policy','POST',{scope,...(id?{presetId:id}:{}),selection:row.override&&!row.override.checked?null:choice(row),revision:state.revision});
    if(result.saved){
     state={...state,config:result.config,revision:result.revision};row.dirty=false;
     for(const other of rows){
      if(other.override&&!other.override.checked)fill(other,inherited(other));
     }
    }
    if(!result.ok)throw Error((result.error||'保存失败')+(result.sync?.failed?.length?'；'+result.sync.failed.map(x=>x.sessionId+': '+(x.error||x.status)).join('；'):''));
    row.message.textContent=scope==='global'?'全局默认已保存并同步，单独配置保持不变。':'已保存并同步，后续请求使用新设置。';
   }catch(error){row.message.textContent=error.message;}
   finally{busy=false;paint();}
 }
 function addRangeRow(label,available,description){
  const el=document.createElement('article');el.className='preset-overview-card preset-model-range';el.dataset.modelScope='preset';el.dataset.modelPreset='qq-task-worker';
  el.innerHTML='<h4>'+esc(label)+' · 可选范围</h4><p class="meta"><code>qq-task-worker</code></p><label><input type="checkbox" data-model-override> 单独配置任务范围</label><div data-range-options></div><p class="meta" data-model-note></p><button type="button" class="small primary" data-model-save>保存此项</button><p class="meta" data-model-message role="status"></p>';grid.append(el);
  const row={range:true,scope:'preset',id:'qq-task-worker',available,el,override:el.querySelector('[data-model-override]'),options:el.querySelector('[data-range-options]'),save:el.querySelector('[data-model-save]'),note:el.querySelector('[data-model-note]'),message:el.querySelector('[data-model-message]'),checks:[],dirty:false};
  el.querySelector('h4').insertAdjacentHTML('afterend','<div data-preset-info></div>');row.label=label;row.description=description;describe(row);
  row.override.checked=Object.hasOwn(state.config.presets,row.id);fill(row,state.config.presets[row.id]||inherited(row));
  el.addEventListener('change',event=>{if(event.target===row.override&&!row.override.checked)fill(row,inherited(row));row.dirty=true;row.message.textContent='尚未保存';paint();});
  row.save.addEventListener('click',()=>saveRow(row));rows.push(row);row.el.setAttribute('role','tabpanel');
 }
 async function readSettings(){
  if(busy)return;if(rows.some(r=>r.dirty)&&!confirm('重新读取会丢弃未保存的模型设置，继续吗？'))return;
  busy=true;paint();status.textContent='读取模型设置与 DSH 目录…';
  try{
   const [settings,directory]=await Promise.all([api('/api/presets/model-policy'),api('/api/dsh/models')]);
   if(!settings.ok||!directory.ok)throw Error(settings.error||directory.error||'读取失败');
   state=settings;groups=directory.groups;ready=true;rows=[];grid.replaceChildren();defaults.replaceChildren();tabs.replaceChildren();
   addRow('global',null,'全局默认模型');
   views=buildViews();const bound=new Set(views.map(v=>v.id));
   const ordered=[...settings.presets].filter(p=>bound.has(p.id)).sort((a,b)=>(a.id==='qq-task-worker')-(b.id==='qq-task-worker'));
   for(const preset of ordered)addRow('preset',preset.id,presetInfo(preset).label,preset.available,preset.description);
   addTabs();selectRow(views.some(v=>v.key===activeKey)?activeKey:overview?.mode||'reserved2');
   status.textContent='';
  }catch(error){ready=false;status.textContent='读取失败：'+error.message+'；当前草稿保留。';}
  finally{busy=false;paint();}
 }
 async function refreshCatalog(){
  if(!state)return readSettings();if(busy)return;busy=true;paint();status.textContent='刷新 DSH 模型目录…';
  try{const data=await api('/api/dsh/models');if(!data.ok)throw Error(data.error||'读取失败');groups=data.groups;ready=true;for(const row of rows)fill(row,choice(row));status.textContent='';}
  catch(error){ready=false;status.textContent='读取失败：'+error.message+'；当前草稿保留。';}
  finally{busy=false;paint();}
 }
 refresh.addEventListener('click',refreshCatalog);read.addEventListener('click',readSettings);
 return {initial:readSettings(),updateOverview(value){overview=value;views=buildViews();tabs.replaceChildren();addTabs();selectRow(activeKey||overview?.mode||'reserved2');}};
}
