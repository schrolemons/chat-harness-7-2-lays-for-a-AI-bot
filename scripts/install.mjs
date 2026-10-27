import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),get=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const profileName=get('--profile')||'desktop';
if(!/^[\w-]+$/.test(profileName))throw Error('Invalid profile name');
const home=process.env.DSH_HOME||path.join(os.homedir(),'.dsh');
const profile=path.join(home,'profiles',profileName);
if(!fs.existsSync(path.join(profile,'package.json')))throw Error('请先启动 DSH 并完成初始化；找不到所选 profile 的 package.json');
fs.copyFileSync(path.join(profile,'package.json'),path.join(profile,'package.json.bak-chat-harness-'+Date.now()));
function run(file,more=[]){const out=spawnSync(process.execPath,[path.join(root,file),...more],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,QQ_BRIDGE_SKIP_DSH_INSTALL:'1'}});if(out.status!==0)throw Error(out.stderr||out.stdout||'Installer subprocess failed');if(out.stdout)process.stdout.write(out.stdout);}
run('scripts/setup-dsh.mjs',[profileName]);
run('scripts/setup-web-summary.mjs',[profileName]);
const packageFile=path.join(profile,'package.json'),pkg=JSON.parse(fs.readFileSync(packageFile));
const launcher=path.join(root,'plugins','qq-launcher'),link=path.join(profile,'node_modules','qq-launcher');
fs.mkdirSync(path.dirname(link),{recursive:true});
let stat;try{stat=fs.lstatSync(link);}catch(e){if(e.code!=='ENOENT')throw e;}
if(stat){if(!stat.isSymbolicLink()||fs.realpathSync(link).toLowerCase()!==fs.realpathSync(launcher).toLowerCase())throw Error('Existing qq-launcher path points elsewhere; inspect it before changing');}
else fs.symlinkSync(launcher,link,process.platform==='win32'?'junction':'dir');
pkg.dependencies ||= {};pkg.dependencies['qq-launcher']='link:'+launcher.replace(/\\/g,'/');
fs.writeFileSync(packageFile,JSON.stringify(pkg,null,2)+'\n');
const file=path.join(profile,'cordis.patch.yml'),original=fs.readFileSync(file,'utf8');
const entries=[{id:'qq-launcher',name:'qq-launcher',config:{bridgeDir:root,nodePath:process.execPath,qqExe:get('--qq-exe')||'',servicePort:3199}},
 {id:'mcp-bridge-health',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'bridge-health',transport:'stdio',command:process.execPath,args:[path.join(root,'src','mcp-bridge-health.mjs')]}},
 {id:'mcp-schnie-private-phi',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'schnie-private-phi',transport:'stdio',command:process.execPath,args:[path.join(root,'plugins','qq-components','schnie-core','mcp.mjs')]}}];
const begin='# === CHAT HARNESS INTEGRATIONS BEGIN ===',end='# === CHAT HARNESS INTEGRATIONS END ===';
let base=original;
if(base.includes(begin)){const start=base.indexOf(begin),finish=base.indexOf(end,start);if(finish<0)throw Error('Incomplete managed integration block');base=base.slice(0,start)+base.slice(finish+end.length);}
const ownedIds=new Set(entries.map(e=>e.id));
const kept=(yaml.load(base)||[]).flatMap(operation=>{
 if(!Array.isArray(operation.insert))return [operation];
 const insert=operation.insert.filter(entry=>!ownedIds.has(entry.id));
 return insert.length?[{...operation,insert}]:Object.keys(operation).length>1?[{...operation,insert}]:[];
});
const next=yaml.dump([...kept,{insert:entries}],{lineWidth:-1});yaml.load(next);
if(next!==original){fs.copyFileSync(file,file+'.bak-chat-harness-'+Date.now());fs.writeFileSync(file,next);}
if(args.includes('--with-codex'))run('plugins/qq-components/tool-codex-chat/install.mjs',['--profile',profile,...(get('--codex-path')?['--codex-path',get('--codex-path')]:[])]);
console.log('DSH profile installed. Reopen/refresh its UI if needed; existing conversations were preserved. Run npm run doctor, then npm start.');
