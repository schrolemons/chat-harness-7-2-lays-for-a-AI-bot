import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {checkPrivacy,forbiddenReleasePath} from './privacy-check.mjs';
import {buildDshBundle} from './build-dsh-bundle.mjs';
import {sha256,assertPlainDirectory,installError} from './plan-instance-install.mjs';

export const RELEASE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const freshCreations=new WeakSet();
export const isFreshReleaseCreation=(creation,root)=>freshCreations.has(creation)&&creation.root===root;
export async function stagePublicRelease({sourceRoot=RELEASE_ROOT,target,bundleName='qq-bridge-public',entryId='public-bot-mode'}={}) {
  if(!path.isAbsolute(target||'')||!path.isAbsolute(sourceRoot)||!/^[a-z0-9][a-z0-9._-]*$/.test(bundleName)||!/^[a-z0-9][a-z0-9._-]*$/.test(entryId))throw installError('RELEASE_INPUT_INVALID');
  await assertPlainDirectory(path.dirname(target));
  try{await fs.lstat(target);throw installError('TARGET_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  const files=JSON.parse(await fs.readFile(path.join(sourceRoot,'release-files.json'),'utf8'));
  const actualSource=async file=>{
    if(file==='package-lock.json')try{await fs.lstat(path.join(sourceRoot,file));}catch(e){if(e.code==='ENOENT')return 'npm-shrinkwrap.json';throw e;}
    return file;
  };
  if(!Array.isArray(files)||new Set(files).size!==files.length||!files.includes('release-files.json'))throw installError('RELEASE_ALLOWLIST_INVALID');
  for(const file of files) {
    if(typeof file!=='string'||file.includes('\\')||file.split('/').some(p=>!p||p==='..'||p==='.')||path.isAbsolute(file)||forbiddenReleasePath.test(file))throw installError('RELEASE_PATH_DENIED');
    const actual=await actualSource(file);await assertPlainDirectory(path.dirname(path.join(sourceRoot,actual)));
    const stat=await fs.lstat(path.join(sourceRoot,actual));if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw installError('RELEASE_PATH_DENIED');
  }
  const privacy=checkPrivacy(sourceRoot,{files:await Promise.all(files.map(actualSource))});if(!privacy.ok)throw Object.assign(installError('RELEASE_PRIVACY_FAILED'),{problems:privacy.problems});
  await fs.mkdir(target,{mode:0o700}); // exclusive creation; failures retain staging for inspection
  for(const file of files){const destination=path.join(target,file);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(sourceRoot,await actualSource(file)),destination,1);}
  const pkg=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8'));
  pkg.name=bundleName;pkg.qqBridge.instance={bundleName,entryId,settingsNamespace:entryId};
  pkg.files=files.filter(file=>file!=='package.json'&&file!=='package-lock.json');
  // npm normally excludes package-lock; the canonical distribution needs its
  // exact resolution graph for fresh npm ci. npm-shrinkwrap is the same lock.
  pkg.files.push('npm-shrinkwrap.json');
  await fs.writeFile(path.join(target,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const lock=JSON.parse(await fs.readFile(path.join(target,'package-lock.json'),'utf8'));lock.name=bundleName;if(lock.packages?.[''])lock.packages[''].name=bundleName;
  const lockText=JSON.stringify(lock,null,2)+'\n';await fs.writeFile(path.join(target,'package-lock.json'),lockText);await fs.writeFile(path.join(target,'npm-shrinkwrap.json'),lockText);
  buildDshBundle({root:target,descriptor:{bundleName,entryId,settingsNamespace:entryId}});
  const result=checkPrivacy(target,{files:[...files,'npm-shrinkwrap.json']});if(!result.ok)throw installError('RELEASE_PRIVACY_FAILED');
  const creation={transactionId:randomUUID(),root:await fs.realpath(target),source:'created',files:[]};
  for(const file of [...files,'npm-shrinkwrap.json'])creation.files.push({path:file,sha256:sha256(await fs.readFile(path.join(target,file)))});
  freshCreations.add(creation);
  return {target,bundleName,files:files.length,privacy:result,creation};
}
export function runNpm(root,args) {
  const npm=process.env.npm_execpath || path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  const result=spawnSync(process.execPath,[npm,...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8*1024*1024,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',ELECTRON_RUN_AS_NODE:''}});
  if(result.status!==0)throw Object.assign(installError('NPM_FAILED'),{detail:result.stderr||result.stdout||result.error?.message});
  return result.stdout;
}
export async function packPublicRelease(options) {
  const stage=await stagePublicRelease(options),output=options.packDirectory;
  await assertPlainDirectory(output);
  const packed=JSON.parse(runNpm(stage.target,['pack','--ignore-scripts','--json','--pack-destination',output]))[0];
  const file=path.join(output,packed.filename),bytes=await fs.readFile(file);
  return {...stage,artifact:file,bytes:bytes.length,sha256:sha256(bytes),unpackedBytes:packed.unpackedSize};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),get=flag=>args[args.indexOf(flag)+1];
  try {console.log(JSON.stringify(await packPublicRelease({target:get('--stage'),packDirectory:get('--output')}),null,2));}
  catch(e){console.error(e.code||e.message);if(e.problems)console.error(JSON.stringify(e.problems));process.exitCode=1;}
}
