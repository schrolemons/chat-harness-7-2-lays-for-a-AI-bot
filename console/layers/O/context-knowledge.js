import {esc} from '../../shared/api.js';
const label=entry=>entry.term||entry.alias||entry.content||entry.id;
const value=entry=>entry.summary||entry.meaning||(entry.qq?'QQ '+entry.qq:'');
export function knowledgePanel(row,current,{actual=false,allowed=true}={}){
 if(!current&&!row.knowledge)return '';
 const recorded=row.knowledge,report=actual?recorded:current;
 let evidence=actual?(row.inRequest===true?'已在实际请求正文中确认':row.inRequest===false?'实际请求未包含完整模块正文':'旧记录未提供逐模块发送证据'):(recorded?'本轮采集时入选 '+recorded.selectedCount+' 条':'历史记录未保存条数，不能按行数推算');
 if(actual&&row.included===false&&!(row.notCaptured&&typeof row.inRequest!=='boolean'))evidence='当时未注入：'+(row.reason||'未选用');
 if(!report?.available)return '<p class="context-knowledge-note">'+esc(evidence)+(actual?'':'；当前组件未启用或尚未提供统计接口')+'。</p>';
 const expected=allowed?report.selectedCount:0;
 const pairs=[['库总量',report.total],['已确认',report.confirmed],['本会话适用',report.eligible],['条数上限',report.limit],[actual?'当时入选':'当前预计',expected]];
 const reason=!allowed?'O 层已关闭，本轮不发送本模块。':report.limit===0?'默认注入上限为0，仅保留按需查询。':report.eligible===0?'没有适用于此会话的已确认资料，不从其他会话补数。':report.limited>0?'有'+report.limited+'条适用资料因上限未入选。':'';
 return '<div class="context-knowledge-stats">'+pairs.map(([title,count])=>'<span>'+esc(title)+' <strong>'+esc(count??'未知')+'</strong></span>').join('')+'</div><p class="context-knowledge-note">'+esc(evidence)+'。'+esc(reason)+'</p>'
 +'<p class="context-knowledge-note">筛除：未确认 '+esc(report.total-report.confirmed)+' 条 · 确认但内容不完整 '+esc(report.unusable)+' 条 · 不适用当前会话 '+esc(report.outOfScope)+' 条。<a href="#'+esc(report.page)+'">调整'+esc(report.name)+'来源与上限</a></p>'
 +(report.selected?.length?'<details class="context-knowledge-selection"><summary>查看'+(actual?'当时':'当前策略')+'入选的 '+report.selected.length+' 条资料</summary><ul>'+report.selected.map(entry=>'<li><strong>'+esc(label(entry))+'</strong><span>'+esc(value(entry))+'</span></li>').join('')+'</ul></details>':'');
}
export function visualGroups(rows,catalog=[]){
 const ids=new Set(catalog.map(row=>row.id)),byId=new Map(rows.map(row=>[row.id,row]));
 const core=rows.filter(row=>ids.has(row.id));
 for(const slot of catalog)if(!byId.has(slot.id))core.push({...slot,text:'',notCaptured:true,included:false,reason:'本轮未产出'});
 return {core:core.map((row,index)=>({...row,index})),extra:rows.filter(row=>!ids.has(row.id))};
}
