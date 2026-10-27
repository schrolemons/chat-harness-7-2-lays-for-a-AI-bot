import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),profile=args.includes('--profile')?args[args.indexOf('--profile')+1]:'desktop';
const checks=[];const check=(name,ok,help)=>checks.push({name,ok:!!ok,...(!ok?{help}:{})});
check('Node.js 24+',Number(process.versions.node.split('.')[0])>=24,'Install a current Node.js LTS runtime');
for(const file of ['scripts/setup-dsh.mjs','scripts/campus-watch.mjs','src/mcp-snowluma-safe.js','src/mcp-host-server.js','src/mcp-web-search-safe.js','src/mcp-bridge-health.mjs','plugins/qq-components/tool-codex-chat/src/mcp-server.mjs','plugins/qq-components/schnie-core/mcp.mjs','plugins/qq-launcher/lib/client.js'])check('file:'+file,fs.existsSync(path.join(root,file)),'Download the complete repository');
const configured=fs.existsSync(path.join(root,'config.json'));check('local configuration',configured,'Run npm run configure');
if(configured){try{const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json')));check('owner and safe allowlist',cfg.ownerQQ&&cfg.allow?.private?.includes(String(cfg.ownerQQ))&&cfg.allowAllWhenEmpty===false,'Configure owner and explicit QQ allowlists');check('SnowLuma release',fs.existsSync(path.join(cfg.snowluma.homeDir,'index.mjs')),'Set the directory of your own SnowLuma release');}catch{check('config valid JSON',false,'Repair local config.json');}}
const dir=path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'profiles',profile);
for(const name of ['qq-mode-console','qq-agent-presets','qq-launcher']){try{const link=path.join(dir,'node_modules',name);check('profile link:'+name,fs.existsSync(link)&&fs.realpathSync(link).startsWith(root),'Run npm run setup -- --profile '+profile);}catch{check('profile link:'+name,false,'Run installer');}}
check('Codex Peer optional local settings',fs.existsSync(path.join(root,'state','codex-chat','settings.json')),'Optional: npm run setup -- --with-codex, after signing into Codex on this computer');
console.log(JSON.stringify({ok:checks.filter(c=>!c.name.startsWith('Codex Peer optional')).every(c=>c.ok),checks},null,2));
if(checks.filter(c=>!c.name.startsWith('Codex Peer optional')).some(c=>!c.ok))process.exitCode=1;
