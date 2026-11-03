import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildCandidate,prepareRecovery} from './recover-session-title-metadata.mjs';

const id='session-synthetic-recovery-fixture';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
  const header=Buffer.from(JSON.stringify({type:'session',version:4,id,createdAt:1,isSeeded:false,delegationDepth:0})+'\n');
  const title=Buffer.from('{"type":"session/title", "seq":0,"time":2,"data":{"title":"合成标题", "messageSeqs":[],"source":{"kind":"fallback"}}}\n');
  const later=Buffer.from('{"type":"session/title","seq":1,"time":3,"data":{"title":"later synthetic title","messageSeqs":[],"source":{"kind":"user"}}}\n');
  const tail=Buffer.from('{"type":"extension/event","seq":2,"time":4,"data":{"text":"synthetic 非标题正文"}}\n');
  const frames=[zstdCompressSync(header),zstdCompressSync(Buffer.concat([title,later])),zstdCompressSync(tail)];
  return {bytes:Buffer.concat(frames),header,title,later,tail,frames};
}
function validate(rows){
  assert.equal(rows[0].id,id);
  if(rows[1].data.source.kind==='fallback')throw Error('session/title messageSeqs must be empty exactly for a user title');
  assert.equal(rows[1].data.source.kind,'user');
}

test('only the target title source changes; all other row and frame bytes survive',()=>{
  const f=fixture(),result=buildCandidate(f.bytes,{sessionId:id,validate});
  assert.equal(result.report.changedRecords,1);assert.equal(result.report.nonTargetBytesEqual,true);
  assert.equal(result.report.headerBytesEqual,true);assert.equal(result.report.titleTextUnchanged,true);
  assert.deepEqual(result.frames[0],f.frames[0]);assert.deepEqual(result.frames[2],f.frames[2]);
  assert.deepEqual(zstdDecompressSync(result.frames[1]),Buffer.concat([Buffer.from(f.title.toString().replace('"kind":"fallback"','"kind":"user"')),f.later]));
  const again=buildCandidate(result.bytes,{sessionId:id,validate});
  assert.equal(again.report.changedRecords,0);assert.deepEqual(again.bytes,result.bytes);
});

test('rejects wrong session, nonzero fallback, malformed and unvalidated candidates',()=>{
  const f=fixture();
  assert.throws(()=>buildCandidate(f.bytes,{sessionId:'wrong',validate}),/identity/);
  const bad=zstdCompressSync(Buffer.concat([f.header,Buffer.from(f.title.toString().replace('"seq":0','"seq":9')),f.later]));
  assert.throws(()=>buildCandidate(bad,{sessionId:id,validate}),/seq/);
  assert.throws(()=>buildCandidate(Buffer.from('broken'),{sessionId:id,validate}));
  assert.throws(()=>buildCandidate(f.bytes,{sessionId:id,validate:()=>{throw Error('unexpected validator error');}}),/unexpected validator error/);
});

test('dry run never changes source and stale hashes cannot prepare a candidate',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'title-recovery-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const history=path.join(dir,'history');fs.mkdirSync(history);
  const file=path.join(history,'session.v4.jsonl.zstd'),scratch=path.join(dir,'private');const f=fixture();fs.writeFileSync(file,f.bytes);
  const prepared=prepareRecovery({file,scratch,sessionId:id,expectedSha256:sha(f.bytes),validate});
  assert.deepEqual(fs.readFileSync(file),f.bytes);assert.equal(prepared.report.mode,'dry-run');
  assert.equal(fs.existsSync(prepared.candidatePath),true);assert.equal(fs.existsSync(prepared.reportPath),true);
  assert.equal(fs.existsSync(prepared.backupPath),false);
  assert.equal(sha(fs.readFileSync(prepared.candidatePath)),prepared.report.afterSha256);
  fs.writeFileSync(file,Buffer.concat([f.bytes,Buffer.from('concurrent-change')]));
  assert.throws(()=>prepareRecovery({file,scratch,sessionId:id,expectedSha256:sha(f.bytes),validate}),/source hash/);
  assert.equal(fs.readFileSync(file).subarray(-17).toString(),'concurrent-change');
});

test('rejects overlapping, existing, and junction scratch paths before file or permission mutations',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'title-recovery-boundary-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const history=path.join(dir,'history'),existing=path.join(dir,'existing');fs.mkdirSync(history);fs.mkdirSync(existing);
  const file=path.join(history,'session.v4.jsonl.zstd'),f=fixture();fs.writeFileSync(file,f.bytes);
  const snapshot=folder=>({entries:fs.readdirSync(folder).sort(),mode:fs.statSync(folder).mode,acl:process.platform==='win32'?spawnSync('icacls.exe',[folder],{encoding:'utf8'}).stdout:''});
  const rejected=[history,path.join(history,'new-child'),dir,existing];
  if(process.platform==='win32'){
    const alias=path.join(dir,'history-alias');fs.symlinkSync(history,alias,'junction');rejected.push(path.join(alias,'new-child'));
  }
  for(const scratch of rejected){
    const before=[snapshot(dir),snapshot(history),snapshot(existing)];
    assert.throws(()=>prepareRecovery({file,scratch,sessionId:id,expectedSha256:sha(f.bytes),validate}),/scratch/);
    assert.deepEqual([snapshot(dir),snapshot(history),snapshot(existing)],before);
    assert.deepEqual(fs.readFileSync(file),f.bytes);assert.equal(fs.existsSync(path.join(history,'new-child')),false);
  }
});

test('CLI refuses apply before reading or publishing any file',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./recover-session-title-metadata.mjs',import.meta.url)),'--apply'],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/apply is unavailable/);
});
