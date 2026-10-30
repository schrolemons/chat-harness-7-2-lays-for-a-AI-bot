// Names explain existing DSH registrations; this module never creates or deletes presets.
const DEFINITIONS = {
  standard: {label:'通用编程助手',group:'常用',description:'DSH 的通用编程与本地工具配置。例：处理代码和文件任务。'},
  'qq-chat-dev': {label:'小鲸鱼管理员助手',group:'常用',description:'保留小鲸鱼角色并开放本地开发工具，仅供管理员私聊。例：让小鲸鱼检查本机代码。'},
  ptc: {label:'程序化工具调用',group:'DSH 高级',description:'通过代码编排工具调用，适合熟悉 DSH 工具执行机制的使用者。'},
  minimal: {label:'精简编程助手',group:'DSH 高级',description:'精简的人格与工具配置。例：需要更少默认上下文时选用。'},
  cordis: {label:'DSH 插件与配置开发',group:'DSH 高级',description:'提供 Cordis 组合、插件开发相关工具与技能。例：开发 DSH 插件。'},
  'qq-chat': {label:'小鲸鱼一代聊天',group:'按模式自动使用',description:'一代仿真聊天预设，由桥接按运行模式选择。'},
  'qq-chat-v2': {label:'小鲸鱼二代仿真',group:'按模式自动使用',description:'二代仿真专用，自主读消息、用工具发言和等待；由桥接按模式选择。'},
  'qq-task-worker': {label:'独立任务执行',group:'后台专用',description:'小鲸鱼处理委派任务时创建的独立工作会话，不是日常聊天入口。'},
  'qq-learning': {label:'知识学习与核实',group:'后台专用',description:'后台学习、核实公开知识；不接入聊天人格、QQ 发送或本机执行。'},
  'campus-summary': {label:'网页更新整理',group:'后台专用',description:'整理监控网页差异；无工具，不发送消息，不读取聊天历史。'}
};
export function presetInfo(preset) {
  const p=typeof preset==='string'?{id:preset}:preset;
  return {...p,...(DEFINITIONS[p.id]||{label:p.name||'自定义预设',group:'自定义',description:p.description||'用途由此自定义预设声明；请核对其工具与权限。'})};
}
export function presetChoices(presets,showAll=false,selected='') {
  const unique=new Map(presets.map(p=>[p.id,presetInfo(p)]));
  if(selected&&!unique.has(selected))unique.set(selected,{id:selected,label:'当前配置（DSH 未列出）',group:'当前设置',description:'DSH 暂未列出这个预设，请先核对是否已安装。'});
  return [...unique.values()].filter(p=>showAll||p.group==='常用'||p.group==='自定义'||p.id===selected);
}
