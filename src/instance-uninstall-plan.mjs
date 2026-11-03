import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readManifest} from './instance-manifest.mjs';
import {prepareFileCleanup,rowHash,assertPlainDirectory,state,within,cleanupError} from './instance-cleanup-files.mjs';
const text=v=>typeof v==='string'&&v.length>0;
const identity=['installationId','instanceId','profile','bundleName'];
const signature=plan=>rowHash(Object.fromEntries(Object.entries(plan).filter(([k])=>k!=='integrity')));
async function ordinaryDirectory(directory){try{await assertPlainDirectory(directory);}catch(e){if(e.code!=='ENOENT')throw e;await ordinaryDirectory(path.dirname(directory));await fs.mkdir(directory,{mode:0o700});await assertPlainDirectory(directory);}}
async function atomic(file,value){await assertPlainDirectory(path.dirname(file));const tmp=file+'.'+randomUUID()+'.tmp';let h;try{h=await fs.open(tmp,'wx',0o600);await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();await h.close();h=null;await fs.rename(tmp,file);}finally{await h?.close();await fs.unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}

/** Read-only plan. Additional evidence can only come from a verified offline owner adapter.
 * Native membership is a completeness check, never a source of new deletion targets. */
export async function planInstanceCleanup(manifest,{sessionStoreAdapter}={}) {
 const plan={version:1,planId:randomUUID(),manifestHash:rowHash(manifest??null),manifest:structuredClone(manifest??null),sessions:[],paths:[],preserve:[],conflicts:[]};
 try {
  if(!manifest||manifest.version!==1||identity.some(k=>!text(manifest[k]))||!path.isAbsolute(manifest.root||'')||!path.isAbsolute(manifest.dshHome||'')||['sessions','paths','profileEntries','links'].some(k=>!Array.isArray(manifest[k])))throw cleanupError('MANIFEST_INVALID');
  if(manifest.profile!==path.basename(manifest.profile)||manifest.installationId!==path.basename(manifest.installationId)||within(manifest.root,manifest.dshHome)||manifest.root===manifest.dshHome)throw cleanupError('EXTERNAL_ROOT');
  await assertPlainDirectory(manifest.root);await assertPlainDirectory(manifest.dshHome);
  if(rowHash(await readManifest(manifest.root))!==plan.manifestHash)throw cleanupError('MANIFEST_CHANGED');
  if(!sessionStoreAdapter?.prepare)throw cleanupError('UNSUPPORTED_SESSION_DELETE');
  plan.native=await sessionStoreAdapter.prepare(manifest);
  plan.sessions=plan.native.sessions;
  const files=await prepareFileCleanup(manifest);plan.paths=files.operations;plan.preserve=files.preserve;
  plan.preserve.push(...manifest.sessions.filter(r=>r.cleanup!=='owned'),{reason:'Shared attachments, independent forks, workspace registrations, unknown backups and search database physical pages are preserved; no secure erasure claim'});
  plan.journalPath=path.join(manifest.dshHome,'bot-instances','cleanup',manifest.installationId,plan.planId+'.json');
  if(within(manifest.root,plan.journalPath))throw cleanupError('JOURNAL_INSIDE_TARGET');
  if(rowHash(await readManifest(manifest.root))!==plan.manifestHash)throw cleanupError('MANIFEST_CHANGED');
 }catch(error){plan.conflicts.push({code:error.code||'CLEANUP_PLAN_FAILED',message:error.message});}
 plan.integrity=signature(plan);sessionStoreAdapter?.bind?.(plan);return plan;
}

/** Explicit execution only; disable, dispose and upgrade have no import/call path here.
 * No process discovery or stop operation is provided. The owner must prove full home exclusion. */
export async function executeInstanceCleanup(plan,{expectedManifestHash,sessionStoreAdapter,onStep}={}) {
 const result={version:1,planId:plan?.planId,status:'conflict',completed:[],preserve:plan?.preserve||[],conflicts:[]};
 let journal,guard,execution,journalSaved=false,homeGuards=[];
 const conflict=e=>({code:e.code||'CLEANUP_FAILED',message:e.message});
 try {
  if(!plan||plan.integrity!==signature(plan))throw cleanupError('PLAN_CHANGED');
  if(expectedManifestHash!==plan.manifestHash)throw cleanupError('MANIFEST_CHANGED');
  if(plan.conflicts.length){result.conflicts=plan.conflicts;return result;}
  if(!sessionStoreAdapter?.assertExclusive)throw cleanupError('UNSUPPORTED_SESSION_DELETE');
  await sessionStoreAdapter.assertExclusive(plan);
  execution=await sessionStoreAdapter.beginExecution(plan);
  // Share the installer's exact management mutexes, without stale-lock recovery.
  for(const lock of [path.join(plan.manifest.dshHome,'bot-instances','installation-roots.json.lock'),path.join(plan.manifest.dshHome,'profiles',plan.manifest.profile,'.qq-bridge-install.lock')]){
   await assertPlainDirectory(path.dirname(lock));try{await fs.mkdir(lock);homeGuards.push(lock);}catch(e){if(e.code==='EEXIST')throw cleanupError('CLEANUP_BUSY');throw e;}
  }
  await ordinaryDirectory(path.dirname(plan.journalPath));guard=plan.journalPath+'.lock';
  try{await fs.mkdir(guard);}catch(e){guard=null;throw cleanupError('CLEANUP_BUSY');}
  if((await state(plan.journalPath)).kind==='file'){
   journal=JSON.parse(await fs.readFile(plan.journalPath,'utf8'));
   if(journal.planHash!==plan.integrity)throw cleanupError('JOURNAL_PLAN_CHANGED');
   journalSaved=true;
  }else {journal={version:1,planHash:plan.integrity,plan,status:'prepared',completed:[],sessionFiles:[],intentFiles:[],nativeComplete:false};}
  const save=async()=>{await atomic(plan.journalPath,journal);journalSaved=true;};
  const codeStarted=journal.completed.some(i=>plan.paths[i].phase==='code')||(journal.intent!==undefined&&plan.paths[journal.intent]?.phase==='code');
  if(!codeStarted&&rowHash(await readManifest(plan.manifest.root))!==plan.manifestHash)throw cleanupError('MANIFEST_CHANGED');
  // Preflight all exact remaining/previous operations before the first mutation.
  for(let i=0;i<plan.paths.length;i++){
   const op=plan.paths[i],current=await state(op.path,{link:op.before.kind==='link'}),after=op.after||{kind:'missing'};
   if(journal.completed.includes(i)){if(rowHash(current)!==rowHash(after))throw cleanupError('COMPLETED_PATH_CHANGED',op.path);}
   else if(rowHash(current)!==rowHash(op.before)&&!(journal.intent===i&&rowHash(current)===rowHash(after)))throw cleanupError('PATH_CHANGED',op.path);
  }
  const targets=new Set(plan.paths.filter(op=>op.kind!=='write').map(op=>op.path));
  for(const op of plan.paths.filter(op=>op.kind==='rmdir')){
   if((await state(op.path)).kind==='missing')continue;
   await assertPlainDirectory(op.path);
   if((await fs.readdir(op.path)).some(name=>!targets.has(path.join(op.path,name))))throw cleanupError('UNKNOWN_DESCENDANT',op.path);
  }
  for(const record of plan.sessions)await sessionStoreAdapter.inspect(record.sessionId,{absent:journal.intentFiles});
  await save();await onStep?.({phase:'prepared'});
  for(const record of plan.sessions){
   await sessionStoreAdapter.deleteOwned(record,{absent:journal.intentFiles,
    beforeArtifact:async file=>{if(!journal.intentFiles.includes(file))journal.intentFiles.push(file);await save();await onStep?.({phase:'session-intent',path:file});},
    afterArtifact:async file=>{if(!journal.sessionFiles.includes(file))journal.sessionFiles.push(file);await save();await onStep?.({phase:'session-file',path:file});}});
  }
  // Native reconciliation is mandatory even on retries/completed plans.
  result.native=await sessionStoreAdapter.verifyNative(plan);
  journal.nativeComplete=true;await save();await onStep?.({phase:'native-verified'});
  await sessionStoreAdapter.assertExclusive(plan);
  for(let i=0;i<plan.paths.length;i++){
   const op=plan.paths[i];if(journal.completed.includes(i))continue;
   const current=await state(op.path,{link:op.before.kind==='link'}),after=op.after||{kind:'missing'};
   if(journal.intent!==i||rowHash(current)!==rowHash(after)) {
    if(rowHash(current)!==rowHash(op.before))throw cleanupError('PATH_CHANGED',op.path);
    journal.intent=i;await save();await onStep?.({phase:'path-intent',operation:op});
    await sessionStoreAdapter.assertExclusive(plan);
    if(rowHash(await state(op.path,{link:op.before.kind==='link'}))!==rowHash(op.before))throw cleanupError('PATH_CHANGED',op.path);
    if(op.kind==='write')await atomicText(op.path,op.content);
    else if(op.kind==='rmdir')await fs.rmdir(op.path);
    else await fs.unlink(op.path);
   }
   if(rowHash(await state(op.path,{link:op.before.kind==='link'}))!==rowHash(after))throw cleanupError('PATH_VERIFY_FAILED');
   journal.completed.push(i);delete journal.intent;await save();await onStep?.({phase:op.phase,operation:op});
  }
  journal.status='complete';journal.native=result.native;await save();result.status='complete';result.completed=journal.completed;result.journalPath=plan.journalPath;
 }catch(error){result.status=journalSaved?'interrupted':'conflict';result.conflicts.push(conflict(error));if(journalSaved){journal.status='interrupted';journal.error=conflict(error);await atomic(plan.journalPath,journal);result.completed=journal.completed;result.journalPath=plan.journalPath;}}
 finally{if(guard)await fs.rmdir(guard);for(const lock of homeGuards.reverse())await fs.rmdir(lock);if(execution)sessionStoreAdapter.endExecution(execution);}
 return result;
}
async function atomicText(file,content){const temp=file+'.'+randomUUID()+'.tmp';await assertPlainDirectory(path.dirname(file));let h;try{h=await fs.open(temp,'wx',0o600);await h.writeFile(content);await h.sync();await h.close();h=null;await fs.rename(temp,file);}finally{await h?.close();await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
