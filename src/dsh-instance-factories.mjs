import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInstanceRuntime, verifyManagedSnow } from './instance-runtime.mjs';
import { createLauncher } from '../plugins/qq-launcher/lib/index.js';

const required = () => Object.assign(Error('NODE_RUNTIME_REQUIRED: configure verified Node >=24 (Windows >=24.20.0) or owned managed Snow'),{code:'NODE_RUNTIME_REQUIRED'});
export function isSupportedInstanceNode(version,platform=process.platform) {
  const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(version||'');if(!match)return false;
  const major=Number(match[1]),minor=Number(match[2]);
  return major>24 || major===24&&(platform!=='win32'||minor>=20);
}

/** No PATH fallback and no probing Electron with --eval (which can open another app). */
export async function resolveInstanceNode({ descriptor, config = {}, host = process }) {
  let selected=config.nodePath;
  if (!selected && config.snowHome) selected=(await verifyManagedSnow(descriptor.root,config.snowHome,descriptor.instanceId)).runtime;
  if (!selected && !host.versions.electron) selected=host.execPath;
  if (!path.isAbsolute(selected||'') || !/^node(?:\.exe)?$/i.test(path.basename(selected))) throw required();
  const physical=await fs.promises.realpath(selected);
  if (host.versions.electron && physical.toLowerCase()===(await fs.promises.realpath(host.execPath).catch(()=>host.execPath)).toLowerCase()) throw required();
  if (!(await fs.promises.stat(physical)).isFile()) throw required();
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.ELECTRON_RUN_AS_NODE;
  try {
    const {stdout}=await promisify(execFile)(physical,['--eval','process.stdout.write(JSON.stringify({name:process.release.name,electron:!!process.versions.electron,version:process.versions.node}))'],{env,windowsHide:true,timeout:5000,maxBuffer:4096});
    const result=JSON.parse(stdout);
    if(result.name!=='node'||result.electron||!isSupportedInstanceNode(result.version))throw required();
  } catch {throw required();}
  return physical;
}

/** Keep gateway startup/credential diagnostics locally, including before health is ready. */
function loggedSpawn(root) {
  return (file,args,options) => {
    const kind=args.some(value=>String(value).endsWith('index.mjs'))?'snow':args.some(value=>String(value).endsWith('campus-watch.mjs'))?'campus-watch':args.some(value=>String(value).endsWith('login-window.mjs'))?'login-window':'bridge';
    let directory=root;
    for(const segment of ['state','runtime-logs']) {
      directory=path.join(directory,segment);fs.mkdirSync(directory,{recursive:true,mode:0o700});
      const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Owned log directory must be an unlinked directory');
    }
    const target=path.join(directory,kind+'.log');
    if(fs.existsSync(target)){const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Owned log must be an unlinked regular file');}
    const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|(fs.constants.O_NOFOLLOW||0),0o600);
    try {return spawn(file,args,{...options,stdio:['ignore',fd,fd,'ipc']});}
    finally {fs.closeSync(fd);}
  };
}

export function createProductionFactories({ nodePath }) {
  return {
    createRuntime:({ctx,descriptor,config,presetMap,recordCreatedSession})=>createInstanceRuntime({descriptor,snowHome:config.snowHome||undefined,nodePath,presetMap,getDshOrigin:()=>ctx.root.get('webServer').getOrigin(),
      recordCreatedSession,spawnProcess:loggedSpawn(descriptor.root)}),
    mountLauncher:({ctx,descriptor,controller,runtime})=>createLauncher(ctx,{descriptor,getDshOrigin:()=>ctx.root.get('webServer').getOrigin(),runtime:{start:()=>controller.start(),stop:()=>controller.stop(),status:()=>runtime.status()}}),
  };
}
