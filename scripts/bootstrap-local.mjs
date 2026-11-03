import fs from 'node:fs';import path from 'node:path';
import {readInstanceSessionPolicy} from '../src/instance-session-policy.mjs';
// First-install filesystem initialization only; never start/restart QQ or DSH.
export function bootstrapLocal(root,{descriptor,snowHome,ports}={}){
 const file=path.join(root,'config.json');if(fs.existsSync(file))return {created:false};
 if(fs.existsSync(path.join(root,'private-data/manifest.json')))throw Error('PRIVATE_RESTORE_SEPARATE: snapshot restore is a separate reviewed action');
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.example.json'),'utf8'));
 cfg.sessionCwd=root;cfg.allowAllWhenEmpty=false;cfg.allow={private:[],groups:[]};cfg.ownerQQ=null;cfg.consoleToken='';
 if(descriptor){
  const policy=readInstanceSessionPolicy({descriptor});cfg.sessionCwd=policy.workspace('chat');cfg.agentPreset=policy.resolvePreset('qq-chat');
  cfg.snowluma={...cfg.snowluma,homeDir:snowHome,launcherPath:'',botUin:'',accessToken:'',followDiscoveredEndpoint:false,httpUrl:`http://127.0.0.1:${ports.snowHttp}`,wsUrl:`ws://127.0.0.1:${ports.snowWs}`};
  cfg.launcher={...cfg.launcher,ports};cfg.consolePort=ports.console;
  if(ports.dsh!=='')cfg.dsh.baseUrl=`http://127.0.0.1:${ports.dsh}`;
 }
 fs.writeFileSync(file,JSON.stringify(cfg,null,2)+'\n',{flag:'wx',mode:0o600});
 fs.mkdirSync(path.join(root,'state'),{recursive:true,mode:0o700});
 for(const [name,value]of Object.entries({'mode.json':{mode:'reserved2',closedAgentPreset:''},'current-role.json':{role:fs.readdirSync(path.join(root,'roles')).find(f=>f.endsWith('.md')&&f!=='README.md')?.slice(0,-3)||'',mode:'active'}})){
  const target=path.join(root,'state',name);if(!fs.existsSync(target))fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 return {created:true};
}
