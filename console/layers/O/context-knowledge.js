import {esc} from '../../shared/api.js';
export const CONTEXT_LAYER_NAMES={system:'系统上下文',stable:'用户级稳定上下文',history:'聊天与工具历史',arrivals:'本次来信与待处理',dynamic:'当前补充资料（历史后注入）'};
export const CONTEXT_LAYER_SUMMARIES={system:'系统硬规则与角色原文。',stable:'稳定的身份、适用资料与组件规则。',history:'已处理的聊天与工具调用、返回。',arrivals:'桥接任务，以及未读或已读未回复的消息。',dynamic:'最新心情、日程、临时画像等变化资料。'};
const layerGuide=[
 ['system','主提示词／角色定义','系统硬规则与角色原文。当前实现把角色卡原文放在 system；不会因界面换名而迁移角色或提高资料权限。'],
 ['stable','世界书资料、用户身份与辅助规则的相近位置','稳定行为规则、会话身份和适用的长期资料。位于 user 资料前缀，内容变化时更新；世界书前后位置及示例对话不强行拆成不存在的发送分区。'],
 ['history','聊天历史','历史 QQ 原文、模型内部输出、工具调用与返回按时间顺序保留。工具配对不可打散；模型输出是否投递到 QQ 要另看发送回执。'],
 ['arrivals','本次输入／待处理窗口','包含未读及已读未回复的来信，也包括此前积压的消息。按双戳及成功回执归类；完成处理后归入历史窗口。'],
 ['dynamic','历史后注入／深度 0 注入的相近位置','每次请求重新整理一份最新心情、日程、临时画像等资料。旧状态只保存在运行日志；本项目采用程序条件触发，不等同于酒馆的关键词世界书。']
];
export function contextLayerGuide(){
 return '<details class="context-layer-guide"><summary>分层结构与酒馆对照 · 查看每层放什么、何时更新</summary><p>这是概念对照，以实际请求为准；分区位置不改变消息角色或指令权限。</p><ol>'+layerGuide.map(([id,tavern,description])=>'<li><strong>'+esc(CONTEXT_LAYER_NAMES[id])+'</strong><span>酒馆相近概念：'+esc(tavern)+'</span><p>'+esc(description)+'</p></li>').join('')+'</ol><p><strong>工具定义：</strong>独立 tools 字段；不夹在系统和聊天消息之间。DSH 可能追加工具清单变更等协议记录，按其实际位置展示。</p></details>';
}
const mechanismNotes={
 'ctx-context-dynamics':'当前心情、形态与风格在末尾资料更新；心情表达喜不喜欢聊天，并参与主动发送、条数及深度判断。聊天意愿另表示对方是否有空，不负责决定风格。',
 'ctx-chat-topic-drive':'请求前提供追问或换题建议；等待超时后的选择则见等待工具返回。冷却和次数限制由执行逻辑校验，实际发送成功后才消耗相应额度；建议文字不等于已经发送。',
 'ctx-memory-profile-store':'按 QQ 号保存长期稳定事实；不要把临时猜测当作已确认档案。这里展示所选请求采集的资料，不是打开页面时重新提取。',
 'ctx-memory-context':'把窗口内轻量记忆、会话事实、今日画像和活跃事务提供给模型。行为印象窗口限制依据范围，不能理解为整个 DSH 聊天历史的条数上限。',
 'life-schedule-reminder':'本次资料提供适用的日程状态；日程状态改变与真正到点触发提醒是两个环节。文字出现在请求里不表示提醒已发送。',
 'message-snapshot':'C36 是当前收件状态索引的唯一来源，每次请求只读刷新窗口内的真实 seq 与双戳。索引不包含正文，也不证明正文已经交给模型。聊天原文按批次接入原执行时间线；待处理包含未读及已读未回复，历史工具回执保留原位。窗口上限不删除原始 QQ 记录。',
 'wake-action':'桥接给 bot 的本次处理要求及触发原因，不是 QQ 人类发言。新的来信可以接入同一次持续处理，不表示每条任务记录都从空闲重新唤醒。',
 'personal-core':'按会话与话题条件提供目录导读；资料正文由工具按需读取，不整库注入。目录导读开关和读取工具权限是两个控制点。'
};
export function componentGuide(row){
 const description=row.description||'这是请求装配中的组件来源；是否实际携带，以所选请求的正文和来源证据为准。';
 return '<section class="context-component-guide"><h4>组件职责与机制</h4><p>'+esc(description)+'</p>'+(mechanismNotes[row.id]?'<p>'+esc(mechanismNotes[row.id])+'</p>':'')+'<small>职责说明来自当前组件定义；正文与回执仍按所选请求当时的记录展示。</small></section>';
}
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
 const numbers=new Map(catalog.map((row,index)=>[row.id,index]));
 return [['fixed',CONTEXT_LAYER_NAMES.system,'系统硬规则与角色原文，位于请求前部。'],['stable',CONTEXT_LAYER_NAMES.stable,'放在 user 资料前缀；内容变化时更新。'],['current',CONTEXT_LAYER_NAMES.dynamic,'每次请求在业务消息末尾提供一份最新资料；排序仅调整本组内部。']].map(([id,name,description])=>({id,name,description,rows:rows.filter(row=>row.id!=='obs-context-assembly'&&(row.placement||'current')===id).map(row=>({...row,index:numbers.get(row.id)}))}));
}
