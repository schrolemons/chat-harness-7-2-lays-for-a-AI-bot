import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {installProfile} from './install-profile.mjs';
export {installProfile};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),get=f=>{const i=args.indexOf(f);return i<0?undefined:args[i+1];};try{
  console.log(JSON.stringify(installProfile({profile:get('--profile')||'desktop'})));
  if(args.includes('--with-codex')){const profile=path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'profiles',get('--profile')||'desktop');const r=spawnSync(process.execPath,[path.join(root,'plugins/qq-components/tool-codex-chat/install.mjs'),'--profile',profile,...(get('--codex-path')?['--codex-path',get('--codex-path')]:[])],{cwd:root,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.stdout);console.log(r.stdout.trim());}
  console.log('Unified DSH bundle installed. Apply/reload this profile when ready; no service or conversation was restarted. Configure bot QQ and allowlists in the DSH launcher.');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
