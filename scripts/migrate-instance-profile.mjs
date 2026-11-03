import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathState, sameState, rowHash, verifyLegacyRow, installError, assertPlainDirectory } from './plan-instance-install.mjs';
import { initializeManifest, appendInstallationEvidence } from '../src/instance-manifest.mjs';

async function atomic(file,content) {
  await assertPlainDirectory(path.dirname(file));
  const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  let handle;
  try {handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;await fs.rename(temporary,file);}
  finally {await handle?.close();await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function ensureDirectory(directory) {
  try{await assertPlainDirectory(directory);}catch(e){if(e.code!=='ENOENT')throw e;await ensureDirectory(path.dirname(directory));await fs.mkdir(directory,{mode:0o700});await assertPlainDirectory(directory);}
}
const pendingFile=plan=>path.join(plan.profilePath,'.qq-bridge-install-pending.json');
function validatePlan(plan) {
  if(plan?.version!==1 || !plan.transactionId || !path.isAbsolute(plan.journalPath||'')
    || plan.journalPath!==path.join(plan.descriptor.root,'.instance-install','transactions',plan.transactionId+'.json'))throw installError('PLAN_INVALID');
  const files=new Set([path.join(plan.profilePath,'package.json'),path.join(plan.profilePath,'cordis.patch.yml'),path.join(plan.descriptor.root,'.qq-bridge-instance.json')]);
  for(const op of plan.operations) {
    if(op.kind==='write' ? !files.has(op.path) : !['link','unlink'].includes(op.kind)||path.dirname(op.path)!==path.join(plan.profilePath,'node_modules'))throw installError('PLAN_INVALID');
  }
}
async function withProfileLock(plan,fn,{recoverLock=false}={}) {
  validatePlan(plan);await assertPlainDirectory(plan.profilePath);await assertPlainDirectory(plan.descriptor.root);
  const lock=path.join(plan.profilePath,'.qq-bridge-install.lock');
  const ownerFile=path.join(lock,'owner.json'),owner={transactionId:plan.transactionId,planHash:rowHash(plan)};
  try{await fs.mkdir(lock,{mode:0o700});}catch(e){
    if(e.code!=='EEXIST')throw e;
    if(!recoverLock)throw installError('INSTALL_BUSY');
    await assertPlainDirectory(lock);await checkPending(plan);
    if(JSON.stringify(await fs.readdir(lock))!==JSON.stringify(['owner.json'])||(await pathState(ownerFile)).kind!=='file'||rowHash(JSON.parse(await fs.readFile(ownerFile,'utf8')))!==rowHash(owner)||!await readJournal(plan))throw installError('LOCK_RECOVERY_CONFLICT');
    for(const op of plan.operations){const state=await pathState(op.path);if(!sameState(state,op.before)&&!sameState(state,op.after))throw installError('ROLLBACK_CONFLICT');}
    await fs.unlink(ownerFile);await fs.rmdir(lock);await fs.mkdir(lock,{mode:0o700});
  }
  await fs.writeFile(ownerFile,JSON.stringify(owner),{flag:'wx',mode:0o600});
  try{return await fn();}finally{
    if(rowHash(JSON.parse(await fs.readFile(ownerFile,'utf8')))!==rowHash(owner))throw installError('LOCK_OWNER_CHANGED');
    await fs.unlink(ownerFile);await fs.rmdir(lock);
  }
}
async function readJournal(plan) {
  const state=await pathState(plan.journalPath);if(state.kind==='missing')return null;
  if(state.kind!=='file')throw installError('JOURNAL_INVALID');
  const journal=JSON.parse(await fs.readFile(plan.journalPath,'utf8'));
  if(journal.planHash!==rowHash(plan))throw installError('JOURNAL_PLAN_CONFLICT');return journal;
}
async function saveJournal(plan,journal) {await atomic(plan.journalPath,JSON.stringify(journal,null,2)+'\n');}
async function checkPending(plan,{create=false}={}) {
  const file=pendingFile(plan),state=await pathState(file);
  if(state.kind==='missing') {
    if(!create)throw installError('JOURNAL_PENDING_MISSING');
    await fs.writeFile(file,JSON.stringify({transactionId:plan.transactionId,journalPath:plan.journalPath}),{flag:'wx',mode:0o600});return;
  }
  if(state.kind!=='file'||JSON.parse(await fs.readFile(file,'utf8')).transactionId!==plan.transactionId)throw installError('INSTALL_PENDING');
}
async function setOperation(op,reverse=false) {
  await ensureDirectory(path.dirname(op.path));
  const from=reverse?op.after:op.before,to=reverse?op.before:op.after;
  if(!sameState(await pathState(op.path),from))throw installError(reverse?'ROLLBACK_CONFLICT':'BASELINE_CHANGED');
  if(to.kind==='file')await atomic(op.path,reverse?op.previous:op.content);
  else if(to.kind==='link')await fs.symlink(to.target,op.path,process.platform==='win32'?'junction':'dir');
  else await fs.unlink(op.path); // exact CAS-checked file or junction only, never recurse
  if(!sameState(await pathState(op.path),to))throw installError('INSTALL_WRITE_VERIFY_FAILED');
}
/** No process control. Caller must close the actual profile writers explicitly.
 * A fresh journal precedes every mutation and uncertain states remain pending. */
export async function applyInstanceInstall(plan,{expectedHashes,writersStopped=false,onStep}={}) {
  if(!writersStopped)throw installError('WRITERS_NOT_STOPPED');
  if(!expectedHashes||rowHash(expectedHashes)!==rowHash(plan.beforeHashes))throw installError('EXPECTED_HASHES_REQUIRED');
  if(plan.conflicts.length)throw installError('INSTALL_CONFLICT');
  return withProfileLock(plan,async()=>{
    let journal=await readJournal(plan);
    if(journal?.status==='committed') {
      for(const op of plan.operations)if(!sameState(await pathState(op.path),op.after))throw installError('BASELINE_CHANGED');
      return journal.receipt;
    }
    if(journal)throw installError('INSTALL_PENDING');
    for(const [file,before] of Object.entries(expectedHashes))if(!sameState(await pathState(file),before))throw installError('BASELINE_CHANGED');
    for(const evidence of plan.ownedEvidence)if(evidence.kind==='legacy-row'&&!await verifyLegacyRow(evidence.row,evidence.proof,plan.descriptor,plan.profilePath))throw installError('PROVENANCE_CHANGED');
    await ensureDirectory(path.dirname(plan.journalPath));
    journal={version:1,transactionId:plan.transactionId,planHash:rowHash(plan),status:'prepared',completed:[],plan};
    await saveJournal(plan,journal);await checkPending(plan,{create:true});
    try {
      for(let index=0;index<plan.operations.length;index++) {
        journal.next=index;await saveJournal(plan,journal);
        await setOperation(plan.operations[index]);
        journal.completed.push(index);await saveJournal(plan,journal);await onStep?.({index,operation:plan.operations[index]});
      }
      // Identity declaration is durable, separate from profile rollback. If this
      // fails or is interrupted, preserve its pending exclusion for manual review.
      await initializeManifest(plan.descriptor.root,plan.descriptor);
      await appendInstallationEvidence(plan.descriptor.root,plan.evidence);
      const receipt={version:1,transactionId:plan.transactionId,status:'committed',root:plan.descriptor.root,profilePath:plan.profilePath,codeDisposition:plan.codeDisposition,journalPath:plan.journalPath};
      journal.status='committed';journal.receipt=receipt;await saveJournal(plan,journal);
      await fs.unlink(pendingFile(plan));return receipt;
    } catch(error) {journal.status='interrupted';journal.error=error.code||'INTERRUPTED';await saveJournal(plan,journal);throw error;}
  });
}
/** Explicit CAS rollback of profile edits, never a snapshot restore over newer
 * bytes. Preserves source, data, sessions, initialization evidence and backups. */
export async function recoverInstanceInstall(plan,{writersStopped=false,action,recoverLock=false}={}) {
  if(!writersStopped)throw installError('WRITERS_NOT_STOPPED');
  if(action!=='rollback')throw installError('RECOVERY_ACTION_REQUIRED');
  return withProfileLock(plan,async()=>{
    const journal=await readJournal(plan);
    if(journal?.status==='rolled-back')return journal;
    if(!journal||journal.status==='committed')throw installError('RECOVERY_NOT_AVAILABLE');
    await checkPending(plan);
    // Preflight every path, including the gap between write and journal fsync.
    for(const op of plan.operations){const current=await pathState(op.path).catch(()=>{throw installError('ROLLBACK_CONFLICT');});if(!sameState(current,op.before)&&!sameState(current,op.after))throw installError('ROLLBACK_CONFLICT');}
    for(const op of [...plan.operations].reverse())if(sameState(await pathState(op.path),op.after))await setOperation(op,true);
    journal.status='rolled-back';journal.preserved='Source, session data, receipts/inventory and backup journal retained';await saveJournal(plan,journal);await fs.unlink(pendingFile(plan));return journal;
  },{recoverLock});
}
