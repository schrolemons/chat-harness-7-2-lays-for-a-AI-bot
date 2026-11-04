import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {digest,sessionRows,writeSession,projectKey,encodeSegment} from './private-history.mjs';
const MARKER='<LOCAL_CREDENTIAL>';
function inside(root,relative){if(typeof relative!=='string'||!relative||relative.includes('\\')||path.posix.isAbsolute(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..')||/^[A-Za-z]:/.test(relative))throw Error('Unsafe snapshot path');const result=path.resolve(root,relative);if(!result.startsWith(path.resolve(root)+path.sep))throw Error('Snapshot path escapes destination');let cursor=root;for(const part of relative.split('/')){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw Error('Snapshot path crosses a symlink');}return result;}
function canonicalRows(rows){const h=crypto.createHash('sha256');for(const r of rows)h.update(JSON.stringify(r)+'\n');return h.digest('hex');}
export function restorePrivateData(root,{dshHome=process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),apply=false,overwrite=false}={}){
 root=path.resolve(root);dshHome=path.resolve(dshHome);const snapshot=path.join(root,'private-data'),manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json'),'utf8'));
 if(![1,2].includes(manifest.version)||!Array.isArray(manifest.files))throw Error('Unsupported snapshot manifest');
 const relocate=text=>{for(const [from,to]of [[manifest.sourceRoot,root],[manifest.sourceDshHome,dshHome]])if(from){text=text.split(from).join(to);text=text.split(JSON.stringify(from).slice(1,-1)).join(JSON.stringify(to).slice(1,-1));}return text;};
 const hydrate=(value,current)=>{if(value===MARKER)return current;if(typeof value==='string')return relocate(value);if(Array.isArray(value))return value.map((v,i)=>hydrate(v,current?.[i]));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,hydrate(v,current?.[k])]).filter(([,v])=>v!==undefined));return value;};
 const plans=[],seenTargets=new Set();
 for(const item of manifest.files){
  const source=inside(snapshot,item.path),bytes=fs.readFileSync(source);if(digest(bytes)!==item.snapshotSha256)throw Error('Snapshot checksum mismatch: '+item.path);
  let destination,output,kind=item.kind||'data',rows;
  if(kind==='dsh-session'){
   const header=sessionRows(bytes).next().value;if(header?.type!=='session'||header.version!==4||header.id!==item.sessionId)throw Error('Invalid native session header');
   const cwd=relocate(header.cwd),relative=path.relative(root,cwd);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Restored session cwd is outside the workspace');
   destination=inside(dshHome,'sessions/'+projectKey(cwd)+'/'+encodeSegment(header.id)+'/session.v4.jsonl.zstd');
   rows=()=>{const input=sessionRows(bytes);return (function*(){for(const row of input)yield hydrate(row);})();};
  }else if(kind==='dsh-attachment'){
   if(!/^dsh\/attachments\/v1\/objects\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(item.path))throw Error('Unsafe attachment path');destination=inside(dshHome,item.path.slice(4));output=bytes;
  }else{
   if(!/^(?:config\.json|browser-sites\.json|state\/)/.test(item.path))throw Error('Unknown business data path');destination=inside(root,item.path);
   let current;if(fs.existsSync(destination)&&item.path.endsWith('.json'))current=JSON.parse(fs.readFileSync(destination,'utf8'));
   if(item.path.endsWith('.json'))output=Buffer.from(JSON.stringify(hydrate(JSON.parse(bytes),current),null,2)+'\n');
   else if(item.path.endsWith('.jsonl'))output=Buffer.from(bytes.toString('utf8').split('\n').filter(l=>l.trim()).map(l=>JSON.stringify(hydrate(JSON.parse(l)))).join('\n')+'\n');
   else output=Buffer.from(relocate(bytes.toString('utf8')));
  }
  if(seenTargets.has(destination))throw Error('Duplicate snapshot destination');seenTargets.add(destination);
  const exists=fs.existsSync(destination),same=exists&&(rows?canonicalRows(sessionRows(fs.readFileSync(destination)))===canonicalRows(rows()):fs.readFileSync(destination).equals(output));
  if(exists&&!same&&(kind==='dsh-session'||!overwrite))throw Error('Existing destination differs; review before restoring: '+item.path);
  plans.push({source:item.path,destination,kind,output,rows,same,exists});
 }
 if(!apply)return {applied:false,files:plans.length,changed:plans.filter(p=>!p.same).length,historySessions:plans.filter(p=>p.kind==='dsh-session').length};
 // All checksums and conflicts are checked before the first destination write.
 const backup=path.join(root,'state/audits/private-restore',Date.now()+'-'+process.pid);
 for(const p of plans)if(!p.same){fs.mkdirSync(path.dirname(p.destination),{recursive:true});if(p.exists){const file=path.join(backup,p.source);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(p.destination,file);}
  if(p.rows){writeSession(p.destination,p.rows());const header=sessionRows(fs.readFileSync(p.destination)).next().value;fs.mkdirSync(header.cwd,{recursive:true});}
  else{const temporary=p.destination+'.restore-'+crypto.randomUUID();fs.writeFileSync(temporary,p.output,{flag:'wx',mode:0o600});fs.renameSync(temporary,p.destination);}
 }
 return {applied:true,files:plans.length,changed:plans.filter(p=>!p.same).length,historySessions:plans.filter(p=>p.kind==='dsh-session').length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),get=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};try{console.log(JSON.stringify(restorePrivateData(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),{apply:args.includes('--apply'),overwrite:args.includes('--overwrite'),...(get('--dsh-home')?{dshHome:get('--dsh-home')}:{})})));}catch(e){console.error(e.message);process.exitCode=1;}
}
