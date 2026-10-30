import {readSourceKeys,sourceKeysText,sourceKeysMarkup,requireLearningScopes} from './source-keys.js';

import { registerPageLoader } from '../../shared/page-loaders.js';
import { api, esc } from '../../shared/api.js';
import { learningCall, learningEvidence, learningLinks } from './learning-common.js';
export function initialize(){
(() => {
  let entries=[],config={},active='candidate',selected=new Set();const msg=document.getElementById('termsMsg');
  const statuses={candidate:'待审核',confirmed:'已确认',rejected:'已拒绝'},researchLabels={pending:'待研究',running:'研究中',researched:'已取得公开来源',failed:'研究失败',manual:'手动编辑',rejected:'已拒绝'};
  function search(){return document.getElementById('termsSearch'+(active==='candidate'?'Cand':active[0].toUpperCase()+active.slice(1))).value.trim().toLowerCase();}
  function render(){
    const suffix=active==='candidate'?'Candidate':active[0].toUpperCase()+active.slice(1),box=document.getElementById('terms'+suffix+'List'),q=search(),limit=Number(document.getElementById('termsLimit'+(active==='candidate'?'Cand':active[0].toUpperCase()+active.slice(1))).value)||100;
    const list=entries.filter(e=>e.status===active),filtered=list.filter(e=>!q||[e.term,e.topic,e.category,e.summary,(e.sourceKeys||[]).join(' '),...(e.aliases||[]),...(e.sources||[]),...(e.evidence||[]).map(x=>x.text)].join(' ').toLowerCase().includes(q)),shown=filtered.slice(0,limit);
    if(!shown.length){box.innerHTML='<div class="meta" style="padding:8px">'+(list.length?'没有符合条件的词条':active==='candidate'?'暂无候选；可刷新群消息或手动添加':'暂无'+statuses[active]+'词条')+'</div>';return;}
    let html='<div class="meta" style="padding:6px 8px">共 '+filtered.length+' 条，显示 '+shown.length+' 条（可滚动查找）</div><table><tr><th>选择</th><th>词条</th><th>次数</th><th>适用会话</th><th>摘要 / 主题</th><th>参考来源</th><th>语境证据</th><th>操作</th></tr>';
    for(const e of shown){const actions=active==='candidate'?'<button class="small" data-term-edit="'+esc(e.id)+'">查看 / 编辑</button><button class="small primary" data-term-confirm="'+esc(e.id)+'" '+(!e.summary?'disabled title="确认前需要摘要"':'')+'>确认</button><details class="compact-actions"><summary>更多</summary><div class="compact-actions-menu"><button class="small" data-term-research="'+esc(e.id)+'" '+(e.research?.status==='running'?'disabled':'')+'>研究来源</button><button class="small" data-term-reject="'+esc(e.id)+'">拒绝</button></div></details>':active==='confirmed'?'<button class="small" data-term-edit="'+esc(e.id)+'">编辑</button><button class="small danger" data-term-reject="'+esc(e.id)+'">撤销确认</button>':'<button class="small" data-term-restore="'+esc(e.id)+'">恢复候选</button>';
      const unverified=active==='candidate'&&!e.sources?.length,sourceStatus=e.research?.status==='failed'?'研究失败：'+(e.research.error||'未取得摘要'):e.research?.status==='running'?'正在研究':e.research?.status==='pending'?'待研究':'未附参考来源';
      html+='<tr data-term-id="'+esc(e.id)+'"><td>'+(active!=='rejected'?'<input type="checkbox" data-term-select="'+esc(e.id)+'" '+(selected.has(e.id)?'checked':'')+'>':'—')+'</td><td><b>'+esc(e.term)+'</b><br><span class="'+(active==='candidate'?'pill b':active==='confirmed'?'pill g':'pill r')+'">'+statuses[active]+'</span></td><td>'+esc(e.count||1)+'</td><td>'+sourceKeysMarkup(e)+'</td><td>'+(unverified&&e.summary?'<span class="meta">待核实摘要：</span>':'')+esc(e.summary||'待补充摘要')+'<br><span class="meta">'+esc(e.topic||'未分类')+' · '+esc(e.category||'兴趣知识')+' · '+esc(researchLabels[e.research?.status]||'未研究')+'</span></td><td>'+(e.sources?.length?learningLinks(e.sources):'<span class="meta">'+esc(sourceStatus)+'</span>')+'</td><td>'+learningEvidence(e.evidence)+'</td><td class="row">'+actions+'</td></tr>';
    }box.innerHTML=html+'</table>';
    box.querySelectorAll('[data-term-select]').forEach(cb=>cb.addEventListener('change',()=>{cb.checked?selected.add(cb.dataset.termSelect):selected.delete(cb.dataset.termSelect);}));
    box.querySelectorAll('[data-term-edit]').forEach(b=>b.addEventListener('click',()=>edit(entries.find(e=>e.id===b.dataset.termEdit))));
    for(const [attr,tool,label] of [['research','term_research','研究完成，结果仍待管理员审核'],['confirm','term_confirm','词条已确认'],['reject','term_reject','词条已拒绝']])box.querySelectorAll('[data-term-'+attr+']').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;msg.textContent=attr==='research'?'正在核实公开资料；不会自动确认……':'正在保存……';try{await learningCall(tool,{id:b.dataset['term'+attr[0].toUpperCase()+attr.slice(1)]});msg.textContent=label;await loadTerms(false);}catch(e){msg.textContent=e.message;}finally{b.disabled=false;}}));
    box.querySelectorAll('[data-term-restore]').forEach(b=>b.addEventListener('click',async()=>{const e=entries.find(x=>x.id===b.dataset.termRestore);try{await learningCall('term_save',{...e,status:'candidate'});msg.textContent='已恢复为候选';await loadTerms(false);}catch(error){msg.textContent=error.message;}}));
  }
  function edit(entry={}) {
    document.getElementById('termEditId').value=entry.id||'';
    document.getElementById('termName').value=entry.term||'';
    document.getElementById('termTopic').value=entry.topic||'';
    document.getElementById('termCategory').value=entry.category||'兴趣知识';
    document.getElementById('termSourceKeys').value=sourceKeysText(entry);
    document.getElementById('termAliases').value=(entry.aliases||[]).join('，');
    document.getElementById('termSummary').value=entry.summary||'';
    document.getElementById('termSources').value=(entry.sources||[]).join('\n');
    document.getElementById('termEditMsg').textContent='';
    document.getElementById('termEditorTitle').textContent=entry.id?'编辑词条：'+(entry.term||''):'新增词条';
    document.getElementById('termEditorOverlay').classList.add('open');
  }
  const loadTerms =async(withConfig=true)=>{
    try{
      const data=await learningCall('term_list');entries=data.entries||[];config=data.config||config;
      const categoryOptions=document.getElementById('termCategoryOptions'),existing=new Set([...categoryOptions.options].map(x=>x.value));
      for(const entry of entries)if(entry.category&&!existing.has(entry.category)){const option=document.createElement('option');option.value=entry.category;categoryOptions.append(option);existing.add(entry.category);}
      if(withConfig){
        document.getElementById('termsAutoExtract').checked=config.autoExtract!==false;
        document.getElementById('termsAutoResearch').checked=config.autoResearch!==false;
        document.getElementById('termsMinMessages').value=config.minMessages??12;
        document.getElementById('termsCooldown').value=Math.max(1,Number(config.cooldownMs||1800000)/60000);
        document.getElementById('termsMaxCalls').value=config.maxCallsPerHour??4;
        document.getElementById('termsInjectMax').value=config.injectMax??3;
      }
      const counts={candidate:entries.filter(e=>e.status==='candidate').length,confirmed:entries.filter(e=>e.status==='confirmed').length,rejected:entries.filter(e=>e.status==='rejected').length};
      document.getElementById('termsStats').textContent='待审核 '+counts.candidate+' · 已确认 '+counts.confirmed+' · 已拒绝 '+counts.rejected+' · 待提取群消息 '+Object.values(data.windows||{}).reduce((a,b)=>a+Number(b||0),0);render();
    }catch(e){document.getElementById('termsCandidateList').innerHTML='<p class="err">词条读取失败：'+esc(e.message)+'</p>';}
  };
  document.querySelectorAll('#termsTabs [data-term-tab]').forEach(button=>button.addEventListener('click',()=>{active=button.dataset.termTab;document.querySelectorAll('#termsTabs [data-term-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('#section-terms .terms-panel').forEach(panel=>panel.classList.toggle('active',panel.id==='termsPanel'+active[0].toUpperCase()+active.slice(1)));render();}));
  for(const status of ['candidate','confirmed','rejected']){const suffix=status==='candidate'?'Cand':status[0].toUpperCase()+status.slice(1);document.getElementById('termsSearch'+suffix).addEventListener('input',render);document.getElementById('termsLimit'+suffix).addEventListener('change',render);}
  for(const status of ['candidate','confirmed'])document.getElementById('terms'+status[0].toUpperCase()+status.slice(1)+'SelectAll').addEventListener('change',event=>{const q=status==='candidate'?search():'';for(const e of entries.filter(x=>x.status===status&&(!q||[x.term,x.topic,x.category,x.summary,...(x.sourceKeys||[]),...(x.aliases||[]),...(x.sources||[]),...(x.evidence||[]).map(y=>y.text)].join(' ').toLowerCase().includes(q)))){if(event.target.checked)selected.add(e.id);else selected.delete(e.id);}render();});
  document.getElementById('termsResearchSelected').addEventListener('click',async event=>{
    const button=event.currentTarget,targets=[...selected].map(id=>entries.find(e=>e.id===id)).filter(e=>e?.status==='candidate'&&e.research?.status!=='running');
    if(!targets.length){msg.textContent='请先勾选待审核词条';return;}
    button.disabled=true;
    try{
      let success=0,failed=0;const errors=[];
      for(let i=0;i<targets.length;i++){
        const entry=targets[i];msg.textContent='正在研究来源（'+(i+1)+'/'+targets.length+'）：'+entry.term+'；结果仍待审核';
        try{await learningCall('term_research',{id:entry.id});success++;selected.delete(entry.id);}
        catch(error){failed++;errors.push(entry.term+'：'+error.message);selected.delete(entry.id);}
      }
      msg.textContent='批量研究完成：成功 '+success+' 条，失败 '+failed+' 条；研究结果仍需管理员确认。'+(errors.length?' '+errors.join('；'):'');
      await loadTerms(false);
    }catch(error){msg.textContent='批量研究未开始：'+error.message;}
    finally{button.disabled=false;}
  });
  async function rejectSelected(status){for(const id of selected){if(entries.some(x=>x.id===id&&x.status===status))try{await learningCall('term_reject',{id});}catch(error){msg.textContent=error.message;}}selected.clear();await loadTerms(false);}
  document.getElementById('termsConfirmSelected').addEventListener('click',async()=>{let confirmed=0,skipped=0;for(const id of selected){const e=entries.find(x=>x.id===id);if(e?.status!=='candidate')continue;if(!e.summary){skipped++;continue;}try{await learningCall('term_confirm',{id});confirmed++;}catch{skipped++;}}selected.clear();msg.textContent='批量确认 '+confirmed+' 条；'+skipped+' 条缺少摘要或确认失败，请单独编辑。';await loadTerms(false);});
  document.getElementById('termsRejectSelected').addEventListener('click',()=>rejectSelected('candidate'));
  document.getElementById('termsRejectConfirmedSelected').addEventListener('click',()=>rejectSelected('confirmed'));
  document.getElementById('termsRefresh').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;msg.textContent='正在补扫近期群消息并提取一个候选……';
    try{const result=await learningCall('term_refresh');msg.textContent=result.processed?'刷新完成：扫描 '+(result.scanned||0)+' 条消息，新增 1 个待审核词条。':'刷新完成：扫描 '+(result.scanned||0)+' 条消息，暂未发现足够明确的兴趣词条。';await loadTerms(false);}
    catch(e){msg.textContent=e.message;}finally{button.disabled=false;}
  });
  document.getElementById('termsNew').addEventListener('click',()=>edit());
  async function quickAdd(status){const ids=['termManualName','termManualTopic','termManualSummary','termManualSource','termManualCategory'],values=Object.fromEntries(ids.map(id=>[id,document.getElementById(id).value.trim()]));try{await requireLearningScopes();const input={term:values.termManualName,topic:values.termManualTopic,category:values.termManualCategory,summary:values.termManualSummary,sources:values.termManualSource?[values.termManualSource]:[],sourceKeys:readSourceKeys('termManualSourceKeys'),status};await learningCall('term_save',input);msg.textContent=status==='confirmed'?'自定义词条已确认入库':'自定义词条已加入候选';for(const id of ids.slice(0,4))document.getElementById(id).value='';await loadTerms(false);}catch(error){msg.textContent=error.message;}}
  document.getElementById('termManualDraft').addEventListener('click',()=>quickAdd('candidate'));
  document.getElementById('termManualConfirm').addEventListener('click',()=>quickAdd('confirmed'));
  async function save(status) {
    const editMsg=document.getElementById('termEditMsg');let scope;try{scope=readSourceKeys('termSourceKeys');}catch(error){editMsg.textContent=error.message;return;}
    const input={id:document.getElementById('termEditId').value||undefined,term:document.getElementById('termName').value,topic:document.getElementById('termTopic').value,category:document.getElementById('termCategory').value,sourceKeys:scope,aliases:document.getElementById('termAliases').value.split(/[,，、]/).map(x=>x.trim()).filter(Boolean),summary:document.getElementById('termSummary').value,sources:document.getElementById('termSources').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),status};
    try{await requireLearningScopes();const r=await learningCall('term_save',input);document.getElementById('termEditId').value=r.entry.id;editMsg.textContent=status==='confirmed'?'已保存并确认':'草稿已保存';await loadTerms(false);document.getElementById('termEditorOverlay').classList.remove('open');}catch(e){editMsg.textContent=e.message;}
  }
  document.getElementById('termSaveDraft').addEventListener('click',()=>save('candidate'));
  document.getElementById('termSaveConfirmed').addEventListener('click',()=>save('confirmed'));
  document.getElementById('termsConfigSave').addEventListener('click',async()=>{
    const configMsg=document.getElementById('termsConfigMsg');
    const patch={autoExtract:document.getElementById('termsAutoExtract').checked,autoResearch:document.getElementById('termsAutoResearch').checked,minMessages:Number(document.getElementById('termsMinMessages').value),cooldownMs:Number(document.getElementById('termsCooldown').value)*60000,maxCallsPerHour:Number(document.getElementById('termsMaxCalls').value),injectMax:Number(document.getElementById('termsInjectMax').value)};
    try{await requireLearningScopes();const out=await api('/api/plugins/config','POST',{id:'ctx-interest-terms',config:patch});if(out.ok===false)throw Error(out.error);configMsg.textContent='学习设置已保存';await loadTerms(false);}catch(e){configMsg.textContent=e.message;}
  });
  document.getElementById('termEditorCancel').addEventListener('click',()=>document.getElementById('termEditorOverlay').classList.remove('open'));
  document.getElementById('termEditorOverlay').addEventListener('click',event=>{if(event.target.id==='termEditorOverlay')event.currentTarget.classList.remove('open');});
  registerPageLoader('terms', loadTerms);
})();
}
