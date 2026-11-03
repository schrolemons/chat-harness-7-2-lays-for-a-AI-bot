import yaml from 'js-yaml';
import {FIXED_PRESETS,adminPresetConfig,requestedPreset,simulationPreset} from '../preset-policy.js';
const schema=yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:()=> '[条件表达式]'})]);
export function summarizePreset(content) {
  const parsed=yaml.load(String(content||''),{schema});
  const rows=[];
  function walk(items){for(const row of items||[]){if(!row||typeof row!=='object')continue;rows.push(row);if(row.group===true&&Array.isArray(row.config))walk(row.config);}}
  walk(Array.isArray(parsed)?parsed:parsed?.plugins||[]);
  const names=rows.map(row=>String(row.name||'')),has=name=>names.some(value=>value.includes(name));
  const features=[];
  if(has('dsh-tool-web'))features.push('联网检索与网页读取');
  if(has('dsh-tool-fs'))features.push('本机文件读写与搜索');
  if(has('dsh-tool-pwsh')||has('dsh-tool-bash'))features.push('本机命令执行');
  if(has('dsh-tool-jobs'))features.push('后台任务工具');
  if(has('dsh-tool-skill'))features.push('技能工具');
  if(has('qq-tool-restrict'))features.push('普通聊天工具白名单；管理与本机执行工具受限');
  if(has('task-tool-restrict'))features.push('独立任务工具边界；不直接发送 QQ');
  if(has('learning-tool-restrict'))features.push('知识学习工具边界；不发送 QQ 或执行本机命令');
  if(has('summary-tool-restrict'))features.push('网页整理边界；无可调用工具');
  if(has('context-composer'))features.push('桥接上下文与角色卡编排');
  const compaction=rows.find(row=>row.name==='@deepseek-ai/dsh-compaction-basic')?.config;
  if(compaction){const bits=['上下文压缩'];if(Number.isFinite(compaction.retainTokens))bits.push('保留 '+compaction.retainTokens+' tokens');if(Number.isFinite(compaction.maxTokens))bits.push('摘要上限 '+compaction.maxTokens+' tokens');features.push(bits.join('；'));}
  return {features:features.length?features:['基础会话配置'],moduleCount:rows.length};
}
export function presetBindings({mode,admin={},defaultPreset='',ownerLoadedPreset='',ownerHasSession=false,sessionPolicy}) {
  const resolve=id=>sessionPolicy?.resolvePreset(id) ?? id;
  const fixed=Object.fromEntries(Object.entries(FIXED_PRESETS).map(([key,id])=>[key,resolve(id)]));
  const a=adminPresetConfig(admin),owner=requestedPreset({mode,owner:true,admin:a});
  a.preset=resolve(a.preset);owner.id=resolve(owner.id);
  const ownerExpected=owner.id||defaultPreset,sim=resolve(simulationPreset(mode));
  const editor=id=>sim===id?{page:'persona',target:'simPromptText',label:'编辑当前模式的仿真提示词'}:{page:'overview',target:'section-mode',label:'切换到对应运行模式后编辑提示词'};
  return [
    {key:'owner',label:'管理员当前私聊',preset:ownerExpected,active:true,description:a.enabled?'使用管理员环境的预设；包括此会话中的日常聊天。':'管理员环境未启用，日常聊天跟随当前运行模式。',loadedPreset:ownerLoadedPreset||null,hasSession:ownerHasSession,edit:{page:'environment-admin',target:'v2AdminDevPreset',label:'调整管理员环境'}},
    {key:'admin',label:'管理员专用环境',preset:a.preset||defaultPreset,active:a.enabled,description:(a.preset?'指定预设。':'跟随 DSH 默认。')+'所有运行模式都必须主动开启管理员环境；高权限仅在所选预设装配完成后生效，owner 身份不单独授权。',edit:{page:'environment-admin',target:'v2AdminDevPreset',label:'调整管理员环境'}},
    {key:'v1',label:'普通聊天／一代仿真',preset:fixed.chat,active:['chat','reserved'].includes(mode),description:'固定控制一代回复与静默协议。',edit:editor(fixed.chat)},
    {key:'v2',label:'二代仿真',preset:fixed.reserved2,active:mode==='reserved2',description:'固定控制读消息、工具发送、等待和潜水；普通用户及未启用管理员环境的 owner 使用此预设。',edit:editor(fixed.reserved2)},
    {key:'task',label:'独立任务会话',preset:fixed.task,description:'固定用于管理员委派的工作会话；不替代聊天会话。'},
    {key:'learning',label:"后台学习（黑话／词条／绰号）",preset:fixed.learning,description:"黑话、词条和绰号学习共用 qq-learning 预设及同一个后台学习会话，串行执行各自任务；各组件的素材、审核规则与数据独立管理。仅允许后台抽取、分类和公开资料检索，不发送 QQ 或执行本机命令。"},
    {key:'summary',label:'网页模型整理',preset:fixed.summary,description:'固定整理网页监控差异，不发送 QQ 或调用本机工具。'},
    {key:'default',label:'DSH 新会话默认',preset:defaultPreset,description:'由 DSH 自身的预设设置管理，与桥接一、二代运行模式独立。'}
  ];
}
