import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib,{zstdCompressSync,zstdDecompressSync,constants} from 'node:zlib';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildCandidate,prepareRecovery,zstdFrameEnd} from './recover-session-title-metadata.mjs';

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

const magic=Buffer.from([0x28,0xb5,0x2f,0xfd]);
function blockHeader(size,type=0,last=true){const bytes=Buffer.alloc(3);bytes.writeUIntLE((size<<3)|(type<<1)|Number(last),0,3);return bytes;}
function rawFrame(payload){return Buffer.concat([magic,Buffer.from([0x20,payload.length]),blockHeader(payload.length),payload]);}

test('parses exact raw and RLE frame ends without mistaking payload magic for a boundary',()=>{
  const payload=Buffer.concat([Buffer.from('prefix'),magic,Buffer.from('suffix')]);
  const raw=rawFrame(payload),rle=Buffer.concat([magic,Buffer.from([0x20,7]),blockHeader(7,1),Buffer.from('R')]);
  const input=Buffer.concat([raw,rle]);
  assert.equal(zstdFrameEnd(input,0),raw.length);assert.equal(zstdFrameEnd(input,raw.length),input.length);
  assert.deepEqual(zstdDecompressSync(raw),payload);assert.equal(zstdDecompressSync(rle).toString(),'RRRRRRR');
  const multi=Buffer.concat([magic,Buffer.from([0x20,4]),blockHeader(2,0,false),Buffer.from('ab'),blockHeader(2,1),Buffer.from('c')]);
  assert.equal(zstdFrameEnd(multi),multi.length);assert.equal(zstdDecompressSync(multi).toString(),'abcc');
});

test('accounts for window descriptor, every dictionary/FCS width, and optional checksum bytes',()=>{
  // Literal hand-built headers: zero dictionary ID, and 4-byte content size 1.
  for(const [flag,width] of [[0,0],[1,1],[2,2],[3,4]]){
    const frame=Buffer.concat([magic,Buffer.from([0xa0|flag]),Buffer.alloc(width),Buffer.from([1,0,0,0]),blockHeader(1),Buffer.from('x')]);
    assert.equal(zstdFrameEnd(Buffer.concat([frame,rawFrame(Buffer.from('tail'))])),frame.length);
    assert.equal(zstdDecompressSync(frame).toString(),'x');
  }
  const unknownSize=Buffer.concat([magic,Buffer.from([0,0]),blockHeader(1),Buffer.from('u')]);
  assert.equal(zstdFrameEnd(unknownSize),unknownSize.length);assert.equal(zstdDecompressSync(unknownSize).toString(),'u');
  const fcs2=Buffer.concat([magic,Buffer.from([0x60,0,0]),blockHeader(256,1),Buffer.from('a')]);
  const fcs8=Buffer.concat([magic,Buffer.from([0xe0,1,0,0,0,0,0,0,0]),blockHeader(1),Buffer.from('b')]);
  assert.equal(zstdFrameEnd(fcs2),fcs2.length);assert.equal(zstdDecompressSync(fcs2).length,256);
  assert.equal(zstdFrameEnd(fcs8),fcs8.length);assert.equal(zstdDecompressSync(fcs8).toString(),'b');
  const checked=zstdCompressSync(Buffer.from('checksum fixture'),{params:{[constants.ZSTD_c_checksumFlag]:1}});
  assert.equal(zstdFrameEnd(Buffer.concat([checked,unknownSize])),checked.length);
  for(let removed=1;removed<=4;removed++)assert.throws(()=>zstdFrameEnd(checked.subarray(0,-removed)),/truncated/);
  const corrupt=Buffer.from(checked);corrupt[corrupt.length-1]^=1;
  assert.equal(zstdFrameEnd(corrupt),corrupt.length);assert.throws(()=>zstdDecompressSync(corrupt));
});

test('fails closed for truncated structure, reserved blocks/flags, skippable frames and unsupported dictionary',()=>{
  const raw=rawFrame(Buffer.from('abc'));
  for(let end=0;end<raw.length;end++)assert.throws(()=>zstdFrameEnd(raw.subarray(0,end)),/truncated/);
  const rle=Buffer.concat([magic,Buffer.from([0x20,5]),blockHeader(5,1)]);
  assert.throws(()=>zstdFrameEnd(rle),/truncated/);
  assert.throws(()=>zstdFrameEnd(Buffer.concat([magic,Buffer.from([0x28,0]),blockHeader(0)])),/reserved/);
  assert.throws(()=>zstdFrameEnd(Buffer.concat([magic,Buffer.from([0x20,0]),blockHeader(0,3)])),/reserved/);
  assert.throws(()=>zstdFrameEnd(Buffer.from([0x50,0x2a,0x4d,0x18,0,0,0,0])),/unsupported/);
  assert.throws(()=>zstdFrameEnd(Buffer.concat([magic,Buffer.from([0x21,1,0]),blockHeader(0)])),/dictionary/);
  assert.throws(()=>zstdFrameEnd(Buffer.concat([magic,Buffer.from([0x20,1]),blockHeader(2),Buffer.from('ab')])),/block size/);
});

test('only the target title source changes; all other row and frame bytes survive',()=>{
  const f=fixture(),result=buildCandidate(f.bytes,{sessionId:id,validate});
  assert.equal(result.report.changedRecords,1);assert.equal(result.report.nonTargetBytesEqual,true);
  assert.equal(result.report.headerBytesEqual,true);assert.equal(result.report.titleTextUnchanged,true);
  assert.deepEqual(result.frames[0],f.frames[0]);assert.deepEqual(result.frames[2],f.frames[2]);
  assert.deepEqual(zstdDecompressSync(result.frames[1]),Buffer.concat([Buffer.from(f.title.toString().replace('"kind":"fallback"','"kind":"user"')),f.later]));
  const again=buildCandidate(result.bytes,{sessionId:id,validate});
  assert.equal(again.report.changedRecords,0);assert.deepEqual(again.bytes,result.bytes);
});

test('preserves frame boundaries when native decompression consumes all concatenated frames',t=>{
  const f=fixture(),native=zlib.zstdDecompressSync,calls=[];
  t.mock.method(zlib,'zstdDecompressSync',(input,options)=>{
    calls.push(Buffer.from(input));
    if(input.equals(f.bytes)){
      const buffer=Buffer.concat([f.header,f.title,f.later,f.tail]);
      return options?.info?{buffer,engine:{bytesWritten:input.length}}:buffer;
    }
    return native(input,options);
  });
  syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const result=buildCandidate(f.bytes,{sessionId:id,validate});
  assert.deepEqual(result.frames[0],f.frames[0]);assert.deepEqual(result.frames[2],f.frames[2]);
  assert.equal(result.frames.length,3);assert.deepEqual(calls[0],f.frames[0]);
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
