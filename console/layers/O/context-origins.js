// Producer identities are independent of the 40 configurable component slots.
const producers={
 'agent-instructions':{tag:'工作区指令',title:'工作区指令文件',source:'@deepseek-ai/dsh-agent-instructions',description:'读取适用的 AGENTS.md 等指令文件；首次提供基线，文件变化或工具访问新目录时补充更新。具体文件只采用原日志记录的路径。'},
 'skill-catalog':{tag:'技能目录',title:'DSH 可用技能目录',source:'@deepseek-ai/dsh-tool-skill',description:'从技能注册表汇集当时可用的技能名称与简介；目录不等于已读取或执行完整 SKILL.md。'},
 'skill-invocation':{tag:'技能内容',title:'DSH 技能加载内容',source:'@deepseek-ai/dsh-tool-skill',description:'调用技能时提供的技能内容；具体技能以原记录为准，不从当前安装列表补造。'},
 'qq-context-tool-history':{tag:'旧错误归档',title:'旧版重复工具错误归档',source:'plugins/qq-components/obs-context-assembly/failure-history.mjs',description:'这是旧版按工具名与错误码跨时段折叠的记录。默认时间线按原日志恢复调用；新版仅合并连续至少3次同类失败，在最后一对真实调用与结果上标尝试次数。'},
 'compact-checkpoint':{tag:'压缩摘要',title:'DSH 会话压缩摘要',source:'@deepseek-ai/dsh-compaction · compact-checkpoint',description:'DSH 在压缩较早对话时，用摘要替换一段模型可见历史，原事件保留在会话日志。此段是摘要生成结果，不能把其中引用的文字直接归给原组件。触发方式未记录时，不判断为自动压缩或手动压缩。'},
 'runtime-context':{tag:'运行环境',title:'DSH 运行环境更新',source:'@deepseek-ai/dsh-agent-loop · runtime-context',description:'各运行环境插件按需补充当前环境快照；Agent Loop 将快照和变化记录放入会话。具体贡献段落以日志中的 section 名称为准。'}
};
export function contextOrigin(message={}){
 const producer=Object.hasOwn(producers,message.source)?producers[message.source]:null;
 if(!producer)return null;
 const source=message.provenance?.source||{},compaction=message.provenance?.compaction;
 const out={...producer,id:'producer:'+message.source};
 if(message.source==='compact-checkpoint'){
  const mode=compaction?.mode||(source.sourceCommandId?'manual':null);
  if(mode==='automatic')Object.assign(out,{title:'DSH 自动压缩摘要',description:'DSH 在运行回合内自动压缩历史，生成摘要后替换模型可见的旧历史范围。该摘要的事务、模型及覆盖范围见原始日志证据；原事件未删除。'});
  else if(mode==='manual')Object.assign(out,{title:'DSH 手动压缩摘要',description:'由日志关联的压缩命令触发，摘要替换模型可见的旧历史范围，原事件未删除。'});
  else if(mode==='standalone')out.description='这是回合之外的一次独立压缩；日志没有关联命令，无法进一步确定提交方。摘要替换模型可见历史，原事件仍在日志中。';
 }
 return out;
}
