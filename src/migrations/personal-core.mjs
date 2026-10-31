// One-time migration only. The active component and MCP expose no legacy aliases.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import yaml from 'js-yaml';
import {patchProfile,createMcpEntry} from '../../plugins/qq-components/personal-core/install.mjs';
import {DEFAULT_CONFIG,validateSettings} from '../../plugins/qq-components/personal-core/config.mjs';
import {loadLibrary} from '../../plugins/qq-components/personal-core/library.mjs';
const OLD='schnie-core',NEW='personal-core',sha=b=>createHash('sha256').update(b).digest('hex');
function removeUnmanagedLegacyServer(text){
 // Old installers sometimes inserted one unmarked YAML row. Remove that exact
 // row only; unrelated profile bytes must survive the migration unchanged.
 if(text.includes('# === SCHNIE PRIVATE PHI BEGIN ==='))return text;
 const lines=text.match(/[^\n]*\n|[^\n]+$/g)||[];
 for(let i=0;i<lines.length;i++){
  if(!/^- insert:\s*(?:\r?\n)?$/.test(lines[i]))continue;
  let end=i+1;while(end<lines.length&&!/^(?:- |# ===)/.test(lines[end]))end++;
  const block=lines.slice(i,end).join('');if(!block.includes('mcp-schnie-private-phi'))continue;
  const rows=yaml.load(block);if(rows?.length!==1||rows[0]?.insert?.length!==1||rows[0].insert[0]?.id!=='mcp-schnie-private-phi')throw Error('旧MCP与其他profile条目混合，请先审查具体条目');
  lines.splice(i,end-i);return lines.join('');
 }
 return text;
}
function roles(root){const dir=path.join(root,'roles');return fs.existsSync(dir)?Object.fromEntries(fs.readdirSync(dir).filter(f=>f.endsWith('.md')).map(f=>[f,sha(fs.readFileSync(path.join(dir,f)))])):{};}
export function planPersonalCoreMigration({root,profileText,legacyConfig,registry={}}){
 if(!legacyConfig||!Array.isArray(legacyConfig.coreSessionKeys)||!Array.isArray(legacyConfig.worldviewPatterns)||!Array.isArray(legacyConfig.coreCarePatterns))throw Error('缺少完整的旧配置快照，拒绝猜测机主设置');
 const config={...DEFAULT_CONFIG,libraryDir:'private-libraries/schnie',referenceSessionKeys:[],careSessionKeys:[...legacyConfig.coreSessionKeys]};const valid=validateSettings(config);if(!valid.ok)throw Error(valid.errors.join('；'));
 const clean=values=>[...new Set((values||[]).map(id=>id===OLD?NEW:id))];const nextRegistry={...registry,disabled:clean(registry.disabled),enabled:clean(registry.enabled),order:clean(registry.order)};
 let text=removeUnmanagedLegacyServer(profileText).replaceAll('mcp__schnie-private-phi__schnie_','mcp__personal-core__core_').replaceAll('mcp-schnie-private-phi','mcp-personal-core').replaceAll('schnie-private-phi','personal-core').replaceAll('SCHNIE PRIVATE PHI','PERSONAL CORE').replaceAll('schnie-core/mcp.mjs','personal-core/mcp.mjs').replaceAll('schnie-core\\mcp.mjs','personal-core\\mcp.mjs').replaceAll('qq-tool-restrict-phi.mjs','qq-tool-restrict.mjs');
 text=patchProfile(text,createMcpEntry(root));
 if(/mcp-schnie-private-phi|schnie-core[\\/]mcp\.mjs|schnie-private-phi/.test(text))throw Error('旧MCP条目未清理完整');
 const discussion=[...new Set(['(?:进入|开启|使用|切换到)?\\s*phi\\s*模式',...legacyConfig.worldviewPatterns])],behavior={discussion_commands:['/phi'],discussion_patterns:discussion,care_patterns:[...legacyConfig.coreCarePatterns],exit_patterns:['退出\\s*phi','关闭\\s*phi','别讲哲学']};for(const expression of [...discussion,...behavior.care_patterns])new RegExp(expression,'i');
 return{version:1,root,config,registry:nextRegistry,profileText:text,behavior,roleHashes:roles(root)};
}
export function preparePersonalCoreMigration({root,profile}){
 root=fs.realpathSync(root);const read=(relative,fallback)=>{const file=path.join(root,relative);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):fallback;};
 const legacy=read('plugins/qq-components/'+OLD+'/plugin.json',null);if(!legacy)throw Error('准备迁移需要仍在运行的旧组件配置，请在覆盖源码前生成计划');
 const profileFile=path.join(profile,'cordis.patch.yml'),profileText=fs.readFileSync(profileFile,'utf8'),configFile=path.join(root,'state/plugins/config/'+OLD+'.json'),registryFile=path.join(root,'state/plugins/registry.json'),plan=planPersonalCoreMigration({root,profileText,legacyConfig:{...legacy.config,...read('state/plugins/config/'+OLD+'.json',{})},registry:read('state/plugins/registry.json',{})});
 return{...plan,profileFile,profileBeforeHash:sha(profileText),oldConfigHash:fs.existsSync(configFile)?sha(fs.readFileSync(configFile)):null,registryBeforeHash:fs.existsSync(registryFile)?sha(fs.readFileSync(registryFile)):null,createdAt:Date.now()};
}
export function applyPersonalCoreMigration(plan){
 const root=fs.realpathSync(plan.root),marker=path.join(root,'state/migrations/personal-core-v1.json');if(fs.existsSync(marker))return{ok:true,alreadyApplied:true};
 const profile=plan.profileFile;if(!profile||sha(fs.readFileSync(profile))!==plan.profileBeforeHash)throw Error('DSH profile在计划生成后发生变化，请重新核对再迁移');
 if(JSON.stringify(roles(root))!==JSON.stringify(plan.roleHashes))throw Error('人设卡在计划生成后变化；本迁移不改人设卡，请重新核对');
 if(!fs.existsSync(path.join(root,'plugins/qq-components/'+NEW+'/mcp.mjs')))throw Error('新组件源码尚未就绪');
 if(fs.existsSync(path.join(root,'plugins/qq-components/'+OLD+'/plugin.json')))throw Error('旧组件源码尚未退出运行目录，拒绝同时启用新旧接口');
 const oldConfig=path.join(root,'state/plugins/config/'+OLD+'.json'),registry=path.join(root,'state/plugins/registry.json');for(const [file,expected]of [[oldConfig,plan.oldConfigHash],[registry,plan.registryBeforeHash]])if((fs.existsSync(file)?sha(fs.readFileSync(file)):null)!==expected)throw Error('S层配置或插件注册表已变化，请重新核对迁移计划');
 const packageManifest=path.join(root,plan.config.libraryDir,'manifest.json'),manifest=JSON.parse(fs.readFileSync(packageManifest));manifest.behavior=plan.behavior;
 const writes=new Map([[path.join(root,'state/plugins/config/'+NEW+'.json'),Buffer.from(JSON.stringify(plan.config,null,2)+'\n')],[registry,Buffer.from(JSON.stringify(plan.registry,null,2)+'\n')],[packageManifest,Buffer.from(JSON.stringify(manifest,null,2)+'\n')],[profile,Buffer.from(plan.profileText)],[marker,Buffer.from(JSON.stringify({version:1,completedAt:Date.now(),component:NEW},null,2)+'\n')]]);
 const removals=[oldConfig,path.join(root,'state/plugins/'+OLD+'.json')],backup=path.join(root,'state/audits/personal-core-cutover',Date.now()+'-'+process.pid);if(!backup.startsWith(root+path.sep))throw Error('Unexpected backup path');fs.mkdirSync(backup,{recursive:true});const before=new Map();let index=0;
 for(const file of [...writes.keys(),...removals]){if(!path.resolve(file).startsWith(root+path.sep)&&file!==profile)throw Error('Unexpected migration path');const bytes=fs.existsSync(file)?fs.readFileSync(file):null;before.set(file,bytes);if(bytes)fs.writeFileSync(path.join(backup,(index++)+'-'+path.basename(file)),bytes);}
 try{for(const [file,bytes]of writes){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}loadLibrary(path.dirname(packageManifest));for(const file of removals)if(fs.existsSync(file))fs.unlinkSync(file);if(JSON.stringify(roles(root))!==JSON.stringify(plan.roleHashes))throw Error('人设卡变化，迁移回滚');}
 catch(error){for(const [file,bytes]of before){if(bytes)fs.writeFileSync(file,bytes);else if(fs.existsSync(file))fs.unlinkSync(file);}throw error;}
 return{ok:true,alreadyApplied:false,backup,component:NEW,toolCount:3,careSessionCount:plan.config.careSessionKeys.length};
}
