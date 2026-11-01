import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import yaml from 'js-yaml';import {buildDshBundle} from './build-dsh-bundle.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function installProfile({profile='desktop',home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh')}={}){
 if(!/^[\w-]+$/.test(profile))throw Error('Invalid profile name');const dir=path.join(home,'profiles',profile),file=path.join(dir,'package.json');
 if(!fs.existsSync(file))throw Error('请先启动 DSH 并初始化目标 profile');
 const pkg=JSON.parse(fs.readFileSync(file,'utf8')),patchFile=path.join(dir,'cordis.patch.yml'),original=fs.existsSync(patchFile)?fs.readFileSync(patchFile,'utf8'):'[]\n';
 const link=path.join(dir,'node_modules','qq-bridge');fs.mkdirSync(path.dirname(link),{recursive:true});let stat;try{stat=fs.lstatSync(link);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(stat&&(!stat.isSymbolicLink()||fs.realpathSync(link)!==fs.realpathSync(root)))throw Error('qq-bridge already points elsewhere; inspect the selected profile before changing it');
 buildDshBundle();
 const owned=new Set(['qq-mode','qq-launcher','preset-qq-chat','preset-qq-chat-v2','preset-qq-admin','preset-qq-task-worker','preset-qq-learning','preset-campus-summary','whale-session-title-fallback','mcp-snowluma','mcp-snowluma-host','mcp-web-search-safe','mcp-playwright','mcp-games','mcp-bridge-health','mcp-personal-core','mcp-reference-data-private-phi']);
 const patches=(yaml.load(original.replace(/^\s*\[\]\s*$/gm,''))||[]).flatMap(p=>{if(!Array.isArray(p.insert))return [p];const insert=p.insert.filter(r=>!owned.has(r.id));return insert.length?[{...p,insert}]:Object.keys(p).length>1?[{...p,insert}]:[];});
 const nextPatch=yaml.dump(patches,{lineWidth:-1}),before=JSON.stringify(pkg);pkg.dependencies||={};pkg.dependencies['qq-bridge']='link:'+root.replaceAll('\\','/');pkg.dsh||={};pkg.dsh.profile||={};pkg.dsh.profile.bundles=[...new Set([...(pkg.dsh.profile.bundles||[]).filter(n=>!['qq-agent-presets','qq-mode-console'].includes(n)),'qq-bridge'])];
 const stamp=Date.now();if(JSON.stringify(pkg)!==before){fs.copyFileSync(file,file+'.bak-qq-bridge-'+stamp);fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');}
 if(nextPatch!==original){if(fs.existsSync(patchFile))fs.copyFileSync(patchFile,patchFile+'.bak-qq-bridge-'+stamp);fs.writeFileSync(patchFile,nextPatch);}
 if(!stat)fs.symlinkSync(root,link,process.platform==='win32'?'junction':'dir');
 return {installed:true,profile,bundle:'qq-bridge',presets:6,changed:JSON.stringify(pkg)!==before||nextPatch!==original||!stat};
}
