import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {zstdCompressSync} from 'node:zlib';import {auditGitCredentials} from './git-credential-audit.mjs';
test('credential audit inspects staged bytes and every concatenated compressed session frame',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'git-credential-'));
 try{execFileSync('git',['init','-q'],{cwd:root});fs.writeFileSync(path.join(root,'source.txt'),'safe');fs.writeFileSync(path.join(root,'history.jsonl.zstd'),Buffer.concat([{type:'session',id:'fixture'},{type:'tool/result',data:{token:'fixture-real-secret-123'}}].map(row=>zstdCompressSync(Buffer.from(JSON.stringify(row)+'\n')))));
 execFileSync('git',['add','.'],{cwd:root});fs.writeFileSync(path.join(root,'history.jsonl.zstd'),zstdCompressSync(Buffer.from('{"type":"session"}\n')));
 const result=await auditGitCredentials({root,indexOnly:true,secrets:new Set(['fixture-real-secret-123'])});assert.deepEqual(result.leaked,['history.jsonl.zstd']);assert.equal(result.files,2);
 execFileSync('git',['add','.'],{cwd:root});assert.deepEqual((await auditGitCredentials({root,indexOnly:true,secrets:new Set(['fixture-real-secret-123'])})).leaked,[]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
