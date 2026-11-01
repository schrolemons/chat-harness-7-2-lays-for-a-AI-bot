import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {StringDecoder} from 'node:string_decoder';import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';
export const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function stableRead(file){for(let i=0;i<3;i++){const a=fs.statSync(file),bytes=fs.readFileSync(file),b=fs.statSync(file);if(a.size===b.size&&a.mtimeMs===b.mtimeMs)return bytes;}throw Error('File is still changing: '+path.basename(file));}
export function* sessionRows(bytes,compressed=true){
 const decoder=new StringDecoder('utf8');let offset=0,pending='';
 do{let chunk;if(compressed){const result=zstdDecompressSync(bytes.subarray(offset),{info:true});if(!(result.engine.bytesWritten>0))throw Error('Incomplete zstd frame');offset+=result.engine.bytesWritten;chunk=result.buffer;}else{chunk=bytes;offset=bytes.length;}
  pending+=decoder.write(chunk);let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(line.trim())yield JSON.parse(line);}
 }while(offset<bytes.length);
 pending+=decoder.end();if(pending.trim())yield JSON.parse(pending);
}
export function bridgeHistory(root,home){
 if(!home||!fs.existsSync(path.join(home,'sessions')))return [];
 const selected=[];
 for(const project of fs.readdirSync(path.join(home,'sessions'),{withFileTypes:true})){if(!project.isDirectory())continue;const parent=path.join(home,'sessions',project.name);
  for(const session of fs.readdirSync(parent,{withFileTypes:true})){if(!session.isDirectory())continue;const dir=path.join(parent,session.name),file=['session.v4.jsonl.zstd','session.v4.jsonl'].map(n=>path.join(dir,n)).find(f=>fs.existsSync(f));if(!file)continue;
   const bytes=stableRead(file),header=sessionRows(bytes,file.endsWith('.zstd')).next().value;if(header?.type!=='session'||header.version!==4||!header.cwd)continue;
   const relative=path.relative(root,header.cwd);if(relative.startsWith('..')||path.isAbsolute(relative))continue;
   selected.push({file,bytes,relative:path.relative(home,file).replaceAll('\\','/'),id:header.id,cwd:header.cwd,sourceSha256:digest(bytes)});
  }
 }
 return selected.sort((a,b)=>a.relative.localeCompare(b.relative));
}
export function writeSession(file,rows,{clean=x=>x,observe=()=>{}}={}){
 fs.mkdirSync(path.dirname(file),{recursive:true});let chunk='',size=0,count=0;const hash=crypto.createHash('sha256');
 const flush=()=>{if(!chunk)return;const compressed=zstdCompressSync(Buffer.from(chunk));fs.appendFileSync(file,compressed);hash.update(compressed);size+=compressed.length;chunk='';if(size>=95*1024*1024)throw Error('History artifact exceeds the Git file size budget');};
 fs.writeFileSync(file,'',{flag:'wx',mode:0o600});
 for(const row of rows){observe(row);chunk+=JSON.stringify(clean(row))+'\n';count++;if(Buffer.byteLength(chunk)>=4*1024*1024)flush();}flush();
 return {snapshotSha256:hash.digest('hex'),snapshotBytes:size,rows:count};
}
// Matches DSH session-persistence-jsonl's documented v4 path encoding.
export function projectKey(cwd){let out='',separator=false;for(let i=0;i<cwd.length;i++){const c=cwd[i],code=cwd.charCodeAt(i);if(c==='/'||c==='\\'||c===':'){if(!separator)out+='-';separator=true;}else{out+=c!=='~'&&/^[A-Za-z0-9._-]$/.test(c)?c:'~'+code.toString(16).toUpperCase().padStart(4,'0');separator=false;}}return '--'+(out.replace(/^-+/,'')||'root').slice(0,251)+'--';}
export function encodeSegment(value){if(!value)throw Error('Empty session id');if(value==='.'||value==='..')return value.split('').map(()=>'~002E').join('');let out='';for(let i=0;i<value.length;i++){const c=value[i];out+=c!=='~'&&/^[A-Za-z0-9._-]$/.test(c)?c:'~'+value.charCodeAt(i).toString(16).toUpperCase().padStart(4,'0');}return out;}
