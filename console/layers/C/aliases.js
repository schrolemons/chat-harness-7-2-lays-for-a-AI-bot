
import { registerPageLoader } from '../../shared/page-loaders.js';
import { api, esc } from '../../shared/api.js';
import { learningCall, learningEvidence, learningLinks } from './learning-common.js';
// layers/C/aliases: explicit imports; initialize is called in the application startup order.




export function initialize() {
(() => {
  const message=document.getElementById('aliasMsg');let rows=[],active='candidate',selected=new Set();
  const statusLabel={candidate:'待判断',confirmed:'已确认',rejected:'已拒绝'};
  function search(){const suffix=active==='candidate'?'Cand':active[0].toUpperCase()+active.slice(1);return document.getElementById('aliasSearch'+suffix).value.trim().toLowerCase();}
  function openEditor(entry){
    document.getElementById('aliasEditId').value=entry.id;document.getElementById('aliasModalName').value=entry.alias||'';document.getElementById('aliasModalQq').value=entry.qq||'';document.getElementById('aliasModalNote').value=entry.note||entry.reason||'';
    document.getElementById('aliasModalTitle').textContent=entry.status==='candidate'?'审核绰号：'+entry.alias:'编辑绰号：'+entry.alias;
    document.getElementById('aliasModalContent').textContent=(entry.targetName?'被称呼者线索：'+entry.targetName+' · ':'')+(entry.sourceKey||'');
    document.getElementById('aliasModalEvidence').innerHTML=learningEvidence(entry.evidence);
    document.getElementById('aliasModalConfirm').textContent=entry.status==='candidate'?'确认映射':'保存修改';
    document.getElementById('aliasModalReject').style.display=entry.status==='candidate'?'':'none';document.getElementById('aliasModalOverlay').classList.add('open');
  }
  function render(){
    const suffix=active==='candidate'?'Cand':active[0].toUpperCase()+active.slice(1),target=document.getElementById('alias'+active[0].toUpperCase()+active.slice(1)+'List'),q=search(),limit=Number(document.getElementById('aliasLimit'+suffix).value)||100;
    const list=rows.filter(x=>x.status===active),filtered=list.filter(x=>!q||[x.alias,x.qq,x.note,x.reason,x.targetName,x.sourceKey,...(x.evidence||[]).map(y=>y.text)].join(' ').toLowerCase().includes(q)),shown=filtered.slice(0,limit);
    if(!shown.length){target.innerHTML='<div class="meta" style="padding:8px">'+(list.length?'没有符合条件的绰号':active==='candidate'?'暂无候选；可刷新近期群消息或手动添加':'暂无'+statusLabel[active]+'绰号')+'</div>';return;}
    let html='<div class="meta" style="padding:6px 8px">共 '+filtered.length+' 条，显示 '+shown.length+' 条</div><table><tr><th>选择</th><th>绰号</th><th>被称呼者</th><th>对应 QQ</th><th>来源 / 语境证据</th><th>备注</th><th>操作</th></tr>';
    for(const e of shown){const actions=active==='candidate'?'<button class="small" data-alias-edit="'+esc(e.id)+'">查看 / 编辑</button><button class="small primary" data-alias-confirm="'+esc(e.id)+'">确认</button><details class="compact-actions"><summary>更多</summary><div class="compact-actions-menu"><button class="small" data-alias-reject="'+esc(e.id)+'">拒绝</button></div></details>':active==='confirmed'?'<button class="small" data-alias-edit="'+esc(e.id)+'">编辑</button><button class="small danger" data-alias-delete="'+esc(e.id)+'">删除</button>':'<span class="meta">已记入拒绝记录</span>';
      html+='<tr data-alias-id="'+esc(e.id)+'"><td>'+(active!=='rejected'?'<input type="checkbox" data-alias-select="'+esc(e.id)+'" '+(selected.has(e.id)?'checked':'')+'>':'—')+'</td><td><b>'+esc(e.alias)+'</b><br><span class="'+(active==='candidate'?'pill b':active==='confirmed'?'pill g':'pill r')+'">'+statusLabel[active]+'</span></td><td>'+esc(e.targetName||'—')+'</td><td>'+esc(e.qq||'未绑定')+'</td><td>'+esc(e.sourceKey||'手动')+(e.evidence?.length?'<br>'+learningEvidence(e.evidence):'')+'</td><td>'+esc(e.note||e.reason||'—')+'</td><td class="row">'+actions+'</td></tr>';
    }target.innerHTML=html+'</table>';
    target.querySelectorAll('[data-alias-select]').forEach(cb=>cb.addEventListener('change',()=>{cb.checked?selected.add(cb.dataset.aliasSelect):selected.delete(cb.dataset.aliasSelect);}));
    target.querySelectorAll('[data-alias-edit],[data-alias-confirm]').forEach(button=>button.addEventListener('click',()=>openEditor(rows.find(x=>x.id===(button.dataset.aliasEdit||button.dataset.aliasConfirm)))));
    target.querySelectorAll('[data-alias-reject],[data-alias-delete]').forEach(button=>button.addEventListener('click',async()=>{try{await learningCall('alias_reject',{id:button.dataset.aliasReject||button.dataset.aliasDelete});message.textContent='已处理此条绰号';await loadAliases();}catch(e){message.textContent=e.message;}}));
  }
  const loadAliases =async()=>{
    if(!document.getElementById('aliasCandidateList'))return;
    try {
      const [data,detail]=await Promise.all([learningCall('alias_list'),api('/api/plugins/detail?id=ctx-member-alias')]);
      const config=(detail.plugin||detail).config||{};
      document.getElementById('aliasAutoExtract').checked=config.autoExtract!==false;
      document.getElementById('aliasAutoSemantic').checked=config.autoSemantic!==false;
      document.getElementById('aliasMinMessages').value=config.minMessages??15;
      document.getElementById('aliasCooldown').value=Number(config.cooldownMs??1800000)/60000;
      document.getElementById('aliasMaxCalls').value=config.maxCallsPerHour??4;
      rows=[...(data.entries||[]),...(data.rejected||[])];render();
    } catch(e){document.getElementById('aliasCandidateList').innerHTML='<span class="err">读取失败：'+esc(e.message)+'</span>';}
  };
  document.querySelectorAll('#aliasTabs [data-alias-tab]').forEach(button=>button.addEventListener('click',()=>{active=button.dataset.aliasTab;document.querySelectorAll('#aliasTabs [data-alias-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('#section-alias .alias-panel').forEach(panel=>panel.classList.toggle('active',panel.id==='aliasPanel'+active[0].toUpperCase()+active.slice(1)));render();}));
  for(const status of ['candidate','confirmed','rejected']){const suffix=status==='candidate'?'Cand':status[0].toUpperCase()+status.slice(1);document.getElementById('aliasSearch'+suffix).addEventListener('input',render);document.getElementById('aliasLimit'+suffix).addEventListener('change',render);}
  for(const status of ['candidate','confirmed'])document.getElementById('alias'+status[0].toUpperCase()+status.slice(1)+'SelectAll').addEventListener('change',event=>{for(const e of rows.filter(x=>x.status===status)){if(event.target.checked)selected.add(e.id);else selected.delete(e.id);}render();});
  document.getElementById('aliasRejectSelected').addEventListener('click',async()=>{for(const id of selected){const e=rows.find(x=>x.id===id);if(e?.status==='candidate')try{await learningCall('alias_reject',{id});}catch(error){message.textContent=error.message;}}selected.clear();await loadAliases();});
  document.getElementById('aliasConfirmSelected').addEventListener('click',async()=>{let confirmed=0,skipped=0;for(const id of selected){const e=rows.find(x=>x.id===id);if(e?.status!=='candidate')continue;if(!/^\d{5,12}$/.test(String(e.qq||''))){skipped++;continue;}try{await learningCall('alias_confirm',{id:e.id,alias:e.alias,qq:e.qq,note:e.note||''});confirmed++;}catch{skipped++;}}selected.clear();message.textContent='批量确认 '+confirmed+' 条；'+skipped+' 条缺少有效 QQ 或确认失败，请单独编辑。';await loadAliases();});
  document.getElementById('aliasDeleteSelected').addEventListener('click',async()=>{for(const id of selected){const e=rows.find(x=>x.id===id);if(e?.status==='confirmed')try{await learningCall('alias_reject',{id});}catch(error){message.textContent=error.message;}}selected.clear();await loadAliases();});
  document.getElementById('aliasAutoExtract').addEventListener('change',async event=>{
    const input=event.currentTarget,previous=!input.checked,msg=document.getElementById('aliasAutoExtractMsg');
    try{const out=await api('/api/plugins/detail?id=ctx-member-alias');await api('/api/plugins/config','POST',{id:'ctx-member-alias',config:{...(out.plugin||out).config,autoExtract:input.checked}});msg.textContent=input.checked?'已启用候选收集':'已停止自动收集；确认的绰号仍可查询';}catch(e){input.checked=previous;msg.textContent='保存失败：'+e.message;}
  });
  document.getElementById('aliasConfigSave').addEventListener('click',async event=>{
    const button=event.currentTarget,msg=document.getElementById('aliasConfigMsg');
    const minMessages=Number(document.getElementById('aliasMinMessages').value),cooldownMinutes=Number(document.getElementById('aliasCooldown').value),maxCallsPerHour=Number(document.getElementById('aliasMaxCalls').value);
    if(!Number.isSafeInteger(minMessages)||minMessages<1||!Number.isSafeInteger(cooldownMinutes)||cooldownMinutes<1||!Number.isSafeInteger(maxCallsPerHour)||maxCallsPerHour<1||maxCallsPerHour>12){msg.textContent='消息数、冷却分钟需为正整数；每小时次数需为 1–12。';msg.className='meta err';return;}
    button.disabled=true;msg.textContent='正在保存…';
    try{
      const latest=await api('/api/plugins/detail?id=ctx-member-alias');
      const config={...((latest.plugin||latest).config||{}),autoExtract:document.getElementById('aliasAutoExtract').checked,autoSemantic:document.getElementById('aliasAutoSemantic').checked,minMessages,cooldownMs:cooldownMinutes*60000,maxCallsPerHour};
      const result=await api('/api/plugins/config','POST',{id:'ctx-member-alias',config});if(result.ok!==true)throw Error(result.error||'保存失败');
      msg.textContent='已保存学习设置';msg.className='meta ok';
    }catch(error){msg.textContent='保存失败：'+error.message;msg.className='meta err';}finally{button.disabled=false;}
  });
  document.getElementById('aliasAdd').addEventListener('click',async()=>{
    try{const result=await learningCall('alias_add',{alias:document.getElementById('aliasName').value,qq:document.getElementById('aliasQq').value,note:document.getElementById('aliasNote').value});message.textContent=result.ok?'已添加；不会覆盖该用户其他绰号':'保存失败';await loadAliases();}catch(e){message.textContent=e.message;}
  });
  document.getElementById('aliasRefreshCandidates').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;message.textContent='正在补扫近期群消息并筛选一个高置信度绰号候选……';
    try{const r=await learningCall('alias_refresh');message.textContent='刷新完成：扫描 '+(r.scanned||0)+' 条消息，新增 '+(r.processed||0)+' 条候选证据；结果仍需管理员审核。';await loadAliases();}
    catch(e){message.textContent=e.message;}finally{button.disabled=false;}
  });
  document.getElementById('aliasModalConfirm').addEventListener('click',async()=>{const id=document.getElementById('aliasEditId').value,entry=rows.find(x=>x.id===id);if(!entry)return;try{await learningCall('alias_confirm',{id,alias:document.getElementById('aliasModalName').value,qq:document.getElementById('aliasModalQq').value,note:document.getElementById('aliasModalNote').value});message.textContent='已确认并保存；同一用户的其他绰号保留';document.getElementById('aliasModalOverlay').classList.remove('open');await loadAliases();}catch(e){document.getElementById('aliasModalContent').textContent=e.message;}});
  document.getElementById('aliasModalReject').addEventListener('click',async()=>{const id=document.getElementById('aliasEditId').value;try{await learningCall('alias_reject',{id});document.getElementById('aliasModalOverlay').classList.remove('open');message.textContent='已拒绝此条绰号';await loadAliases();}catch(e){document.getElementById('aliasModalContent').textContent=e.message;}});
  document.getElementById('aliasModalCancel').addEventListener('click',()=>document.getElementById('aliasModalOverlay').classList.remove('open'));
  document.getElementById('aliasModalOverlay').addEventListener('click',event=>{if(event.target.id==='aliasModalOverlay')event.currentTarget.classList.remove('open');});
  registerPageLoader('alias', loadAliases);
})();

}
