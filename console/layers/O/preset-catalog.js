// Names explain existing DSH registrations; this module never creates or deletes presets.
const DEFINITIONS = {
  standard: {label:'通用编程助手',group:'常用',description:'DSH 的通用编程与本地工具配置。例：处理代码和文件任务。'},
  'qq-chat-dev': {label:'AI助手管理员助手',group:'常用',description:'保留AI助手角色并开放本地开发工具，仅供管理员私聊。例：让AI助手检查本机代码。'},
  ptc: {label:'程序化工具调用',group:'DSH 高级',description:'通过代码编排工具调用，适合熟悉 DSH 工具执行机制的使用者。'},
  minimal: {label:'精简编程助手',group:'DSH 高级',description:'精简的人格与工具配置。例：需要更少默认上下文时选用。'},
  cordis: {label:'DSH 插件与配置开发',group:'DSH 高级',description:'提供 Cordis 组合、插件开发相关工具与技能。例：开发 DSH 插件。'},
  'qq-chat': {label:'AI助手一代聊天',group:'按模式自动使用',description:'一代仿真聊天预设，由桥接按运行模式选择。'},
  'qq-chat-v2': {label:'AI助手二代仿真',group:'按模式自动使用',description:'二代仿真专用，自主读消息、用工具发言和等待；由桥接按模式选择。'},
  'qq-task-worker': {label:'独立任务执行',group:'后台专用',description:'AI助手处理委派任务时创建的独立工作会话，不是日常聊天入口。'},
  'qq-learning': {label:"后台学习（黑话／词条／绰号）",group:'后台专用',description:"黑话、词条和绰号学习共用 qq-learning 预设及同一个后台学习会话，串行执行各自任务；各组件的素材、审核规则与数据独立管理。仅允许后台抽取、分类和公开资料检索，不发送 QQ 或执行本机命令。"},
  'campus-summary': {label:'网页更新整理',group:'后台专用',description:'整理监控网页差异；无工具，不发送消息，不读取聊天历史。'}
};
export function presetInfo(preset) {
  const p=typeof preset==='string'?{id:preset}:preset;
  const fallback=DEFINITIONS[p.id]||{label:'自定义预设',group:'自定义',description:'用途由此自定义预设声明。'};
  return {...p,...fallback,label:p.name||fallback.label,description:p.description||fallback.description};
}
export function presetChoices(presets,showAll=false,selected='') {
  const unique=new Map(presets.map(p=>[p.id,presetInfo(p)]));
  if(selected&&!unique.has(selected))unique.set(selected,{id:selected,label:'当前配置（DSH 未列出）',group:'当前设置',description:'DSH 暂未列出这个预设，请先核对是否已安装。'});
  return [...unique.values()];
}
