/** Narrow candidate preparation for explicitly allowlisted purpose-title records.
 * Default CLI action writes a protected candidate and metadata report only.
 * No discovery, profile reload, index update, or model/QQ request is performed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {zstdCompressSync,zstdDecompressSync,constants} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sessionTitle} from '../src/session-titles.js';

const TITLE_ERROR='session/title messageSeqs must be empty exactly for a user title';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function checkHash(value){if(!/^[a-f0-9]{64}$/i.test(value||''))throw Error('expected SHA256 is required');return value.toLowerCase();}
/** RFC 8878 §§3.1.1.1–3.1.1.2: walk structural lengths, never payload magic.
 * https://www.rfc-editor.org/rfc/rfc8878.html#section-3.1.1
 * Native zstd concatenation behavior varies by Node version; it is not framing.
 */
export function zstdFrameEnd(bytes,start=0){
  if(!Number.isSafeInteger(start)||start<0||start>bytes.length)throw Error('invalid Zstandard frame offset');
  let cursor=start;
  const take=count=>{if(cursor+count>bytes.length)throw Error('truncated Zstandard frame');const at=cursor;cursor+=count;return at;};
  if(bytes.readUInt32LE(take(4))!==0xfd2fb528)throw Error('unsupported Zstandard frame magic');
  const descriptor=bytes[take(1)],singleSegment=(descriptor&0x20)!==0;
  if(descriptor&0x08)throw Error('reserved Zstandard frame flag');
  let windowSize;
  if(!singleSegment){const window=bytes[take(1)],base=2**(10+(window>>>3));windowSize=base+(base/8)*(window&7);}
  const dictionarySize=[0,1,2,4][descriptor&3],dictionaryAt=take(dictionarySize);
  if(bytes.subarray(dictionaryAt,dictionaryAt+dictionarySize).some(value=>value!==0))throw Error('unsupported Zstandard dictionary');
  const sizeFlag=descriptor>>>6,sizeBytes=sizeFlag===0?(singleSegment?1:0):[0,2,4,8][sizeFlag];
  let contentSize;
  if(sizeBytes){const at=take(sizeBytes);contentSize=sizeBytes===8?bytes.readBigUInt64LE(at):BigInt(bytes.readUIntLE(at,sizeBytes)+(sizeBytes===2?256:0));}
  if(contentSize!==undefined&&contentSize>128n*1024n*1024n)throw Error('Zstandard frame content exceeds recovery limit');
  if(singleSegment)windowSize=Number(contentSize);
  if(windowSize>128*1024*1024)throw Error('Zstandard window exceeds recovery limit');
  const blockMaximum=Math.min(windowSize,128*1024);
  for(;;){
    const block=bytes.readUIntLE(take(3),3),type=(block>>>1)&3,size=block>>>3;
    if(type===3)throw Error('reserved Zstandard block type');
    if(size>blockMaximum)throw Error('invalid Zstandard block size');
    take(type===1?1:size);
    if(block&1)break;
  }
  if(descriptor&4)take(4);
  return cursor;
}

function decodeFrames(bytes){
  const frames=[];let total=0;
  for(let offset=0;offset<bytes.length;){
    const end=zstdFrameEnd(bytes,offset),compressed=bytes.subarray(offset,end);
    const plain=zstdDecompressSync(compressed,{maxOutputLength:128*1024*1024});
    total+=plain.length;if(total>512*1024*1024)throw Error('decoded log exceeds recovery limit');
    frames.push({compressed,plain,start:total-plain.length});offset=end;
  }
  if(!frames.length)throw Error('empty log');return frames;
}
function physicalLines(plain){
  if(plain.at(-1)!==10)throw Error('incomplete physical tail');
  const lines=[];let start=0;
  for(let i=0;i<plain.length;i++)if(plain[i]===10){const bytes=plain.subarray(start,i+1);let row;try{row=JSON.parse(bytes.toString('utf8'));}catch{throw Error('invalid JSON record');}lines.push({bytes,row,start,end:i+1});start=i+1;}
  return lines;
}

/** Pure transform; every byte outside the one source-kind value is preserved. */
export function buildCandidate(bytes,{sessionId,validate,requirePurposeTitle=false}){
  if(typeof validate!=='function')throw Error('codec validation is required');
  const frames=decodeFrames(bytes),plain=Buffer.concat(frames.map(f=>f.plain)),lines=physicalLines(plain),rows=lines.map(l=>l.row),header=rows[0];
  if(header?.type!=='session'||header.version!==4||header.id!==sessionId||header.isSeeded!==false)throw Error('session identity or v4 header mismatch');
  const target=lines[1];if(target?.row?.type!=='session/title'||target.row.seq!==0)throw Error('target title must be seq 0');
  const data=target.row.data;
  if(!data||typeof data.title!=='string'||!Array.isArray(data.messageSeqs)||data.messageSeqs.length!==0||!['fallback','user'].includes(data.source?.kind))throw Error('target title metadata mismatch');
  if(Object.keys(data.source).length!==1)throw Error('target title source has unexpected fields');
  if(requirePurposeTitle&&data.title!==sessionTitle({sessionId,cwd:header.cwd}))throw Error('target title does not match the reviewed purpose-title writer');
  const beforeSha256=sha(bytes),base={sessionId,formatVersion:4,recordCount:lines.length-1,targetSeq:0,targetTime:target.row.time,beforeSha256,headerBytesEqual:true,titleTextUnchanged:true,seqTimeUnchanged:true,nonTargetBytesEqual:true};
  if(data.source.kind==='user'){
    validate(rows);return {bytes,frames:frames.map(f=>f.compressed),report:{...base,afterSha256:beforeSha256,changedRecords:0,status:'already-repaired',codecValidation:'accepted'}};
  }
  // Refuse unreviewed corruption: the original must fail for this exact contract.
  let rejection;try{validate(rows);}catch(error){rejection=error;}
  if(rejection?.message!==TITLE_ERROR){if(rejection)throw rejection;throw Error('original codec did not reject the target title');}
  const text=target.bytes.toString('utf8'),matches=[...text.matchAll(/"source"\s*:\s*\{\s*"kind"\s*:\s*"fallback"\s*\}/g)];
  if(matches.length!==1)throw Error('target source token is ambiguous');
  const match=matches[0],local=match.index+match[0].lastIndexOf('fallback');
  const changedLine=Buffer.from(text.slice(0,local)+'user'+text.slice(local+'fallback'.length));
  const expected={...target.row,data:{...data,source:{kind:'user'}}};assert.deepEqual(JSON.parse(changedLine.toString('utf8')),expected);
  const candidatePlain=Buffer.concat([plain.subarray(0,target.start),changedLine,plain.subarray(target.end)]);
  const candidateLines=physicalLines(candidatePlain),candidateRows=candidateLines.map(l=>l.row);
  for(let i=0;i<lines.length;i++)if(i!==1&&!lines[i].bytes.equals(candidateLines[i].bytes))throw Error('non-target record bytes changed');
  validate(candidateRows);
  // A target line spanning frames is deliberately unsupported; never rewrite neighbors.
  const frameIndex=frames.findIndex(f=>target.start>=f.start&&target.end<=f.start+f.plain.length);
  if(frameIndex<0)throw Error('target row spans compressed frames');
  const frame=frames[frameIndex],replacement=Buffer.concat([frame.plain.subarray(0,target.start-frame.start),changedLine,frame.plain.subarray(target.end-frame.start)]);
  const candidateFrames=frames.map((f,i)=>i===frameIndex?zstdCompressSync(replacement,{params:{[constants.ZSTD_c_checksumFlag]:1}}):f.compressed);
  const candidate=Buffer.concat(candidateFrames),roundTrip=Buffer.concat(decodeFrames(candidate).map(f=>f.plain));
  if(!roundTrip.equals(candidatePlain))throw Error('compressed candidate round trip differs');
  return {bytes:candidate,frames:candidateFrames,report:{...base,afterSha256:sha(candidate),changedRecords:1,status:'candidate-ready',codecValidation:'accepted',changedFrame:frameIndex,frameCount:frames.length,nonTargetFramesByteEqual:true}};
}

function inspectNewScratch(file,dir){
  const absolute=path.resolve(dir),parent=path.dirname(absolute);
  // Resolve every existing ancestor; a junction must not redirect a new leaf
  // into history. A single new leaf avoids mutating permissions on old data.
  for(let ancestor=parent;;ancestor=path.dirname(ancestor)){
    let entry;try{entry=fs.lstatSync(ancestor);}catch{throw Error('scratch parent must already exist');}
    if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('scratch ancestor must not be a link');
    fs.realpathSync(ancestor);
    if(path.dirname(ancestor)===ancestor)break;
  }
  const physical=path.join(fs.realpathSync(parent),path.basename(absolute));
  const sourceDirectory=path.dirname(fs.realpathSync(file));
  const comparable=value=>process.platform==='win32'?value.toLowerCase():value;
  const contains=(a,b)=>{const relative=path.relative(comparable(a),comparable(b));return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
  if(contains(sourceDirectory,physical)||contains(physical,sourceDirectory))throw Error('scratch overlaps the source history directory');
  try{fs.lstatSync(absolute);throw Error('scratch must be an exclusively new directory');}catch(error){if(error.code!=='ENOENT')throw error;}
  return absolute;
}
function protectScratch(file,dir){
  dir=inspectNewScratch(file,dir);
  fs.mkdirSync(dir,{mode:0o700});
  if(process.platform==='win32'){
    const identity=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8'}),sid=identity.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if(!sid)throw Error('cannot determine scratch ACL owner');
    execFileSync('icacls.exe',[dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'pipe'});
  }else fs.chmodSync(dir,0o700);
}
function writeSameOrExclusive(file,bytes){
  try{const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  catch(error){if(error.code!=='EEXIST')throw error;if(!fs.readFileSync(file).equals(bytes))throw Error('existing review artifact differs');}
}
export function prepareRecovery({file,scratch,sessionId,expectedSha256,validate,requirePurposeTitle=false,codecEvidence}){
  const expected=checkHash(expectedSha256),bytes=fs.readFileSync(file);if(sha(bytes)!==expected)throw Error('source hash changed');
  scratch=inspectNewScratch(file,scratch);
  const result=buildCandidate(bytes,{sessionId,validate,requirePurposeTitle});protectScratch(file,scratch);
  const stem=`${sessionId}-${result.report.beforeSha256}-${result.report.afterSha256}`;
  const candidatePath=path.join(scratch,stem+'.candidate.zstd'),reportPath=path.join(scratch,stem+'.json'),backupPath=path.join(scratch,`${sessionId}-${expected}.original.zstd`);
  const report={...result.report,mode:'dry-run',sourceFile:path.resolve(file),sourceBytes:bytes.length,candidateBytes:result.bytes.length,...codecEvidence?{codecEvidence}: {}};
  writeSameOrExclusive(candidatePath,result.bytes);writeSameOrExclusive(reportPath,Buffer.from(JSON.stringify(report,null,2)+'\n'));
  if(sha(fs.readFileSync(file))!==expected)throw Error('source hash changed during dry run');
  return {candidatePath,reportPath,backupPath,report};
}

async function main(){
  const args={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--apply')throw Error('apply is unavailable; publication requires a separately approved offline DSH procedure');else if(/^--[a-z0-9-]+$/.test(key)&&i+1<process.argv.length)args[key.slice(2)]=process.argv[++i];else throw Error('invalid CLI argument');}
  const allowed=new Set(['session-id','file','expected-sha256','scratch','codec-module','codec-sha256','allowlist-manifest','allowlist-sha256']);
  if(Object.keys(args).some(k=>!allowed.has(k)))throw Error('unknown CLI argument');
  const id=args['session-id'],allowlistBytes=fs.readFileSync(args['allowlist-manifest']||'');
  if(sha(allowlistBytes)!==checkHash(args['allowlist-sha256']))throw Error('allowlist manifest hash mismatch');
  const allowlist=JSON.parse(allowlistBytes),target=allowlist.targets?.find(t=>t.sessionId===id);
  if(!target||target.expectedSha256!==checkHash(args['expected-sha256']))throw Error('session or expected hash is outside the incident allowlist');
  const expectedFile=path.resolve(target.file);
  if(!args.file||path.resolve(args.file).toLowerCase()!==expectedFile.toLowerCase()||fs.realpathSync(args.file).toLowerCase()!==expectedFile.toLowerCase())throw Error('file is outside the exact physical-path allowlist');
  const codecFile=path.resolve(args['codec-module']||''),codecHash=checkHash(args['codec-sha256']);
  if(allowlist.codec?.sha256!==codecHash||path.resolve(allowlist.codec.module).toLowerCase()!==codecFile.toLowerCase())throw Error('codec is outside the incident allowlist');
  if(sha(fs.readFileSync(codecFile))!==codecHash)throw Error('codec module hash mismatch');
  if(/[\\/]AppData[\\/]|[\\/]app\.asar[\\/]/i.test(codecFile))throw Error('installed or bundled code execution is forbidden');
  const {sessionFormatCatalog}=await import(pathToFileURL(codecFile).href);if(!sessionFormatCatalog?.createRestore)throw Error('codec module must export sessionFormatCatalog');
  const validate=rows=>{const restore=sessionFormatCatalog.createRestore(rows[0],{recovery:'strict',validation:'current'});for(const row of rows.slice(1))restore.decodeRow(row);restore.finish();};
  const scratch=path.resolve(args.scratch||path.join(os.homedir(),'.codex','scratch','session-title-recovery'));
  const options={file:args.file,scratch,sessionId:id,expectedSha256:args['expected-sha256'],validate,requirePurposeTitle:true,codecEvidence:{module:codecFile,sha256:codecHash}};
  const prepared=prepareRecovery(options);console.log(JSON.stringify(prepared,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({status:'refused',reason:error instanceof SyntaxError?'invalid input JSON':error.message==='apply is unavailable; publication requires a separately approved offline DSH procedure'?error.message:error.message===TITLE_ERROR?TITLE_ERROR:(error?.code?String(error.code):error.constructor.name)}));process.exitCode=1;});
