import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {zstdDecompressSync} from 'node:zlib';
// Reuse only the reviewed, bounded structural frame primitive; no recovery/scan API.
import {zstdFrameEnd} from '../scripts/recover-session-title-metadata.mjs';
import {fingerprintSessionHeader} from './instance-session-ownership.mjs';
import {readInstanceDescriptor} from './instance-descriptor.mjs';
import {state,rowHash,sha256,assertPlainDirectory,within,samePath,cleanupError} from './instance-cleanup-files.mjs';
const unsupported=message=>cleanupError('UNSUPPORTED_SESSION_DELETE',message);
const plain=async file=>{if((await state(file)).kind!=='file')throw unsupported('Missing ordinary evidence file');return JSON.parse(await fs.readFile(file,'utf8'));};
const fingerprints=header=>{const {type,...logical}=header;const values=[fingerprintSessionHeader(logical)];if(logical.delegationDepth===0){delete logical.delegationDepth;values.push(fingerprintSessionHeader(logical));}return values;};
const executing=new WeakMap();
const RAW_LIMIT=128*1024*1024,HEADER_LIMIT=64*1024,DECODED_LIMIT=512*1024*1024;

/** Validate the pinned layout and every exact frame/checksum without parsing history bodies.
 * The native backend requires its independently decodable first frame to be one header line.
 * Keep raw SHA/CAS authoritative; decoded bytes are never written or used as delete targets. */
function artifactHeader(bytes,filename){
 try{
  const format=/^session\.v([34])\.jsonl(\.zstd)?$/.exec(filename);if(!format||!bytes.length||bytes.length>RAW_LIMIT)throw Error('unsupported artifact');
  let first;
  if(format[2]){
   let frames=0,total=0;
   for(let offset=0;offset<bytes.length;){
    if(++frames>65536||bytes.length-offset<5||(bytes[offset+4]&0x18))throw Error('unsupported frame');
    const end=zstdFrameEnd(bytes,offset),decoded=zstdDecompressSync(bytes.subarray(offset,end),{maxOutputLength:offset===0?HEADER_LIMIT:RAW_LIMIT});
    total+=decoded.length;if(total>DECODED_LIMIT||!decoded.length||decoded.at(-1)!==10)throw Error('unsupported frame payload');
    if(offset===0){if(decoded.indexOf(10)!==decoded.length-1)throw Error('header frame contains more than one row');first=decoded;}
    offset=end;
   }
  }else{const end=bytes.indexOf(10);if(end<0||end>=HEADER_LIMIT)throw Error('unbounded header');first=bytes.subarray(0,end+1);}
  const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(first));
  if(header.version!==Number(format[1]))throw Error('generation/header mismatch');
  return header;
 }catch{throw unsupported('Unknown, malformed or over-limit session artifact encoding');}
}

/** Offline exact-path adapter. The injected owner is a trusted coordination capability,
 * not a serialized acknowledgement. It must create/control the entire home, freeze ALL
 * launches and observe ALL writer child closes. Current public CLI supplies no such owner.
 * Native methods are used only by owner.reconcile, never as exact-path inspection. */
export function createOfflineSessionStoreAdapter(owner) {
 let manifest,evidence,descriptor,bound;
 const assertExclusive=async plan=>{
  if(!owner||typeof owner.assertExclusive!=='function'||!evidence)throw unsupported('No exclusive owner capability');
  await owner.assertExclusive(evidence.ownerToken);
  if(plan&&bound!==plan.integrity)throw cleanupError('OWNER_PLAN_MISMATCH');
 };
 async function inspect(id,{absent=[]}={}) {
  await assertExclusive();const row=evidence.sessions.find(r=>r.sessionId===id);if(!row)throw cleanupError('SESSION_NOT_OWNED');
  const allowMissing=new Set(absent);
  for(const file of row.artifacts){
   if(file.kind==='log'){try{if((await fs.lstat(file.path)).size>RAW_LIMIT)throw unsupported('Session artifact exceeds raw byte limit');}catch(e){if(e.code!=='ENOENT')throw e;}}
   const current=await state(file.path);
   if(current.kind==='missing'&&allowMissing.has(file.path))continue;
   if(current.kind!=='file'||current.sha256!==file.sha256)throw cleanupError('SESSION_ARTIFACT_CHANGED',file.path);
   if(file.kind==='log'){
    const bytes=await fs.readFile(file.path);if(sha256(bytes)!==file.sha256)throw cleanupError('SESSION_ARTIFACT_CHANGED');
    const header=artifactHeader(bytes,path.basename(file.path));
    if(header.type!=='session'||header.id!==id||!fingerprints({...header,version:4}).includes(row.headerFingerprint))throw cleanupError('SESSION_HEADER_MISMATCH');
   }else if(file.kind==='cache'){
    const cache=await plain(file.path),identity=cache.record?.identity;
    if(cache.version!==7||identity?.formatVersion!==4||identity.createdAt!==row.header.createdAt||identity.cwd!==row.header.cwd||identity.isSeeded!==row.header.isSeeded)throw unsupported('Unknown projection cache format/identity');
   }
  }
  const directory=path.dirname(row.path);let names=[];
  try{await assertPlainDirectory(directory);names=await fs.readdir(directory);}catch(e){if(e.code!=='ENOENT')throw e;if(!row.artifacts.filter(r=>r.kind==='log').every(r=>allowMissing.has(r.path)))throw cleanupError('SESSION_ARTIFACT_CHANGED');}
  const allowed=new Set(row.artifacts.filter(r=>r.kind==='log').map(r=>path.basename(r.path)));
  if(names.some(n=>!allowed.has(n)))throw unsupported('Unknown session directory artifact');
  // Only inspect the immediate known cache table to detect backups of this exact ID.
  const cacheDir=path.join(evidence.storageRoot,'session_projcache','sessions');await assertPlainDirectory(cacheDir);
  if((await fs.readdir(cacheDir)).some(n=>n.startsWith(id+'.json.')&&!row.artifacts.some(r=>r.path===path.join(cacheDir,n))))throw unsupported('Unrecorded projection backup');
  if((await state(path.join(evidence.storageRoot,'session_projcache.json'))).kind!=='missing')throw unsupported('Legacy whole-unit projection cache');
  return row;
 }
 return {
  async prepare(input){
   if(!owner?.snapshotForCleanup)throw unsupported('No verified home-wide admission/exit capability');
   manifest=input;descriptor=await readInstanceDescriptor(input.root);
   if(['instanceId','bundleName','profile','dshHome','root'].some(k=>descriptor[k]!==input[k]))throw cleanupError('DESCRIPTOR_MISMATCH');
   evidence=await owner.snapshotForCleanup(input);
   await assertExclusive();
   const host=createRequire(owner.hostPackage),base=createRequire(host.resolve('@deepseek-ai/dsh-base/package.json'));
   for(const name of ['dsh-session-persistence-jsonl','dsh-session-projection-cache','dsh-session-query-sqlite'])if(base(base.resolve('@deepseek-ai/'+name+'/package.json')).version!=='0.2.1-rc.2')throw unsupported('Unpinned backend');
   if(!samePath(evidence.home,input.dshHome)||!samePath(evidence.sessionsRoot,path.join(input.dshHome,'sessions'))||!samePath(evidence.storageRoot,path.join(input.dshHome,'storages'))||evidence.indexes?.length!==1||evidence.indexes.some(i=>!samePath(i.path,path.join(input.dshHome,'query.sqlite'))||i.enabled!==true))throw unsupported('Unknown home/storage/index boundary');
   const expected=new Set(input.sessions.map(r=>r.sessionId));
   for(const ws of evidence.snapshot.workspaces) {
    if(!Object.values(descriptor.workspaces).some(p=>samePath(p,ws.path))&&!input.sessions.some(r=>r.workspaceId===ws.id))continue;
    if(ws.sessionIds.some(id=>!expected.has(id)))throw cleanupError('UNRECORDED_WORKSPACE_SESSION');
    if(within(input.root,ws.path)&&ws.sessionIds.some(id=>input.sessions.find(r=>r.sessionId===id)?.cleanup!=='owned'))throw cleanupError('PRESERVED_SESSION_IN_DATA_NAMESPACE');
   }
   const rows=[];
   for(const receipt of input.sessions.filter(r=>r.cleanup==='owned')){
    if(!['created','verified-legacy'].includes(receipt.source)||rows.some(r=>r.sessionId===receipt.sessionId))throw cleanupError('SESSION_NOT_OWNED');
    const supplied=evidence.sessions.find(r=>r.sessionId===receipt.sessionId),ws=evidence.snapshot.workspaces.find(w=>w.id===receipt.workspaceId);
    if(!supplied||supplied.path!==receipt.path||!within(evidence.sessionsRoot,receipt.path)||!ws?.sessionIds.includes(receipt.sessionId)||!Object.values(descriptor.workspaces).some(p=>samePath(p,ws.path)))throw cleanupError('SESSION_NOT_OWNED');
    if(!supplied.header||supplied.header.id!==receipt.sessionId||!samePath(supplied.header.cwd,ws.path)||!Object.values(descriptor.presetIdMap).includes(supplied.header.agentPreset)||!fingerprints({type:'session',...supplied.header}).includes(receipt.headerFingerprint))throw cleanupError('SESSION_HEADER_MISMATCH');
    const cachePath=path.join(evidence.storageRoot,'session_projcache','sessions',receipt.sessionId+'.json');
    if(!/^[A-Za-z0-9._-]+$/.test(receipt.sessionId)||!supplied.artifacts.some(a=>a.path===receipt.path&&a.kind==='log')||!supplied.artifacts.some(a=>a.path===cachePath&&a.kind==='cache'))throw unsupported('Incomplete exact artifact inventory');
    for(const file of supplied.artifacts)if(file.kind==='log'?path.dirname(file.path)!==path.dirname(receipt.path):file.kind!=='cache'||file.path!==cachePath)throw unsupported('Unknown artifact scope');
    rows.push({...receipt,header:supplied.header,artifacts:supplied.artifacts});
   }
   evidence={...evidence,sessions:rows};for(const row of rows)await inspect(row.sessionId);
   // No unrecorded-session ownership is inferred from native list membership.
   return {home:evidence.home,sessions:rows,indexes:evidence.indexes,snapshot:evidence.snapshot,ownerToken:evidence.ownerToken};
  },
  bind(plan){bound=plan.integrity;},assertExclusive,inspect,
  async beginExecution(plan){await assertExclusive(plan);if(executing.has(owner))throw cleanupError('CLEANUP_BUSY');const token={};executing.set(owner,token);return token;},
  endExecution(token){if(executing.get(owner)===token)executing.delete(owner);},
  async deleteOwned(record,{absent=[],beforeArtifact,afterArtifact}={}){
   const row=await inspect(record.sessionId,{absent});if(rowHash(record)!==rowHash(row))throw cleanupError('SESSION_RECORD_CHANGED');
   for(const file of row.artifacts){
    await assertExclusive();const s=await state(file.path);if(s.kind==='missing'&&absent.includes(file.path))continue;
    if(s.sha256!==file.sha256)throw cleanupError('SESSION_ARTIFACT_CHANGED');
    await beforeArtifact(file.path);await assertExclusive();
    if((await state(file.path)).sha256!==file.sha256)throw cleanupError('SESSION_ARTIFACT_CHANGED');
    await fs.unlink(file.path);await afterArtifact(file.path);
   }
   const dir=path.dirname(row.path);try{await fs.rmdir(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
  },
  async verifyNative(plan){
   await assertExclusive(plan);const result=await owner.reconcile(evidence.sessions,evidence.snapshot);
   await assertExclusive(plan);
   const removed=new Set(evidence.sessions.map(r=>r.sessionId));
   if(result.listed.some(id=>removed.has(id))||result.searched.items.some(r=>removed.has(r.header.id))||result.catalogIds.some(id=>removed.has(id))||result.workspaceIds.some(id=>removed.has(id))||result.archived.some(id=>removed.has(id))||result.pinned.some(id=>removed.has(id)))throw cleanupError('NATIVE_VERIFY_FAILED');
   const others=evidence.snapshot.listed.filter(id=>!removed.has(id));
   if(others.some(id=>!result.listed.includes(id))||rowHash(others.slice().sort())!==rowHash(result.listed.slice().sort()))throw cleanupError('UNRELATED_SESSION_CHANGED');
   for(const id of others){
    const before=evidence.snapshot.events.find(r=>r.sessionId===id)?.result.items,after=result.events.find(r=>r.sessionId===id)?.result.items;
    if(!before||rowHash(before)!==rowHash(after))throw cleanupError('UNRELATED_SESSION_CHANGED');
   }
   if(rowHash(result.archived)!==rowHash(evidence.snapshot.archived.filter(id=>!removed.has(id)))||rowHash(result.pinned)!==rowHash(evidence.snapshot.pinned.filter(id=>!removed.has(id))))throw cleanupError('UNRELATED_WORKSPACE_CHANGED');
   const expectedWorkspaces=evidence.snapshot.workspaces.map(w=>({...w,sessionIds:w.sessionIds.filter(id=>!removed.has(id))}));
   if(rowHash(result.workspaces)!==rowHash(expectedWorkspaces))throw cleanupError('UNRELATED_WORKSPACE_CHANGED');
   for(const row of evidence.sessions)for(const a of row.artifacts)if((await state(a.path)).kind!=='missing')throw cleanupError('SESSION_RESURRECTED');
   return result;
  }
 };
}
