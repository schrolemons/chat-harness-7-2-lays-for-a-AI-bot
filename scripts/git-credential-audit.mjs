import {spawn,execFileSync} from 'node:child_process';import {sessionRows} from './private-history.mjs';
export function blobHasCredential(file,bytes,secrets){
 const contains=value=>[...secrets].some(secret=>secret.length>=8&&value.includes(secret));
 if(file.endsWith('.jsonl.zstd')){for(const row of sessionRows(bytes))if(contains(JSON.stringify(row)))return true;return false;}
 return [...secrets].some(secret=>secret.length>=8&&bytes.includes(Buffer.from(secret)));
}
// Stream batch output rather than retaining every Git blob in one 128MB buffer.
export async function auditGitCredentials({root,indexOnly=false,secrets=new Set()}){
 const files=execFileSync('git',indexOnly?['ls-files','-z']:['ls-tree','-r','--name-only','-z','HEAD'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(Boolean),leaked=[];
 if(files.some(f=>/[\r\n]/.test(f)))throw Error('Unsupported newline in Git path');
 const child=spawn('git',['cat-file','--batch'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let fileIndex=0,header='',size=-1,received=0,chunks=[],separator=false,errorText='',failure;
 child.stderr.on('data',c=>errorText+=c.toString());
 child.stdout.on('data',buffer=>{if(failure)return;try{let pos=0;while(pos<buffer.length){
  if(separator){if(buffer[pos++]!==10)throw Error('Invalid git batch separator');separator=false;fileIndex++;continue;}
  if(size<0){const end=buffer.indexOf(10,pos);if(end<0){header+=buffer.subarray(pos).toString();break;}header+=buffer.subarray(pos,end).toString();pos=end+1;const m=header.match(/^[a-f0-9]+ blob (\d+)$/);if(!m)throw Error('Cannot audit Git object');size=Number(m[1]);if(size>110*1024*1024)throw Error('Git object exceeds reviewed file size');header='';received=0;chunks=[];}
  const take=Math.min(size-received,buffer.length-pos);if(take){chunks.push(buffer.subarray(pos,pos+take));received+=take;pos+=take;}
  if(received===size){if(blobHasCredential(files[fileIndex],Buffer.concat(chunks,size),secrets))leaked.push(files[fileIndex]);chunks=[];size=-1;separator=true;}
 }}catch(e){failure=e;child.kill();}});
 child.stdin.end(files.map(f=>(indexOnly?':':'HEAD:')+f).join('\n')+'\n');
 await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>failure?reject(failure):code!==0?reject(Error('git cat-file failed: '+errorText)):fileIndex!==files.length?reject(Error('Incomplete Git credential audit')):resolve());});
 return {files:files.length,leaked};
}
