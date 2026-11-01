import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {zstdCompressSync} from 'node:zlib';
import {snapshotPrivateData} from './snapshot-private-data.mjs';import {sessionRows,projectKey} from './private-history.mjs';
test('private clone restores configuration, original native history and relocated paths without credentials',async()=>{
 const {restorePrivateData}=await import('./restore-private-data.mjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'private-restore-'));
 try{const source=path.join(dir,'source'),target=path.join(dir,'target'),home=path.join(dir,'old-dsh'),nextHome=path.join(dir,'new-dsh'),cwd=path.join(source,'state/agents');fs.mkdirSync(cwd,{recursive:true});
 fs.writeFileSync(path.join(source,'config.json'),JSON.stringify({ownerQQ:10001,sessionCwd:cwd,consoleToken:'fixture-secret-12345'}));fs.writeFileSync(path.join(source,'state/sessions.json'),JSON.stringify({sessions:{'private:10001':'session-example'}}));
 const log=path.join(home,'sessions',projectKey(cwd),'session-example','session.v4.jsonl.zstd');fs.mkdirSync(path.dirname(log),{recursive:true});const rows=[{type:'session',version:4,id:'session-example',cwd},{type:'tool/result',seq:1,time:1,data:{token:'fixture-old-history-secret',text:'copy fixture-old-history-secret'}},{type:'user/message',seq:2,time:2,data:{text:'original conversation',cwd}},{type:'request/header',seq:3,time:3,data:{tools:[{inputSchema:{type:'object',properties:{token:{type:'string',description:'a session credential'}}}}]}}];
 fs.writeFileSync(log,Buffer.concat(rows.map(r=>zstdCompressSync(Buffer.from(JSON.stringify(r)+'\n')))));
 const attachment=Buffer.from('original referenced attachment'),hash=crypto.createHash('sha256').update(attachment).digest('hex'),object=path.join(home,'attachments/v1/objects',hash.slice(0,2),hash);fs.mkdirSync(path.dirname(object),{recursive:true});fs.writeFileSync(object,attachment);
 fs.appendFileSync(log,zstdCompressSync(Buffer.from(JSON.stringify({type:'user/message',seq:4,data:{attachmentHash:hash}})+'\n')));
 const manifest=snapshotPrivateData(source,{dshHome:home});assert.equal(manifest.historySessions,1);assert.match(manifest.files.find(f=>f.kind==='dsh-session').path,/^dsh\/sessions\/[a-f0-9]{20}\.jsonl\.zstd$/);fs.mkdirSync(target);fs.cpSync(path.join(source,'private-data'),path.join(target,'private-data'),{recursive:true});
 const preview=restorePrivateData(target,{dshHome:nextHome});assert.equal(preview.applied,false);assert.equal(fs.existsSync(path.join(target,'config.json')),false);
 const result=restorePrivateData(target,{dshHome:nextHome,apply:true});assert.equal(result.applied,true);
 const cfg=JSON.parse(fs.readFileSync(path.join(target,'config.json')));assert.equal(cfg.ownerQQ,10001);assert.ok(!cfg.consoleToken);assert.equal(cfg.sessionCwd,path.join(target,'state/agents'));
 const restored=path.join(nextHome,'sessions',projectKey(path.join(target,'state/agents')),'session-example','session.v4.jsonl.zstd'),actual=[...sessionRows(fs.readFileSync(restored))];
 assert.equal(actual[0].id,'session-example');assert.equal(actual[0].cwd,path.join(target,'state/agents'));assert.equal(actual[2].data.text,'original conversation');assert.ok(!JSON.stringify(actual).includes('fixture-old-history-secret'));
 assert.deepEqual(actual[3],rows[3],'redacting credentials must preserve tool definitions and native event structure');
 assert.deepEqual(fs.readFileSync(path.join(nextHome,'attachments/v1/objects',hash.slice(0,2),hash)),attachment);
 assert.equal(restorePrivateData(target,{dshHome:nextHome,apply:true}).changed,0,'reruns must be idempotent and preserve local credentials');
 const before=fs.readFileSync(restored);fs.appendFileSync(restored,zstdCompressSync(Buffer.from(JSON.stringify({type:'user/message',seq:5,data:{text:'new target-only message'}})+'\n')));const changed=fs.readFileSync(restored);assert.ok(!changed.equals(before));
 assert.throws(()=>restorePrivateData(target,{dshHome:nextHome,apply:true,overwrite:true}),/Existing destination differs/);assert.deepEqual(fs.readFileSync(restored),changed,'even explicit business overwrite must not erase new native history');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('tampered snapshots, traversal and existing native sessions fail before overwriting data',async()=>{
 const {restorePrivateData}=await import('./restore-private-data.mjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'private-restore-invalid-'));
 try{fs.writeFileSync(path.join(dir,'config.json'),'{}');snapshotPrivateData(dir);const file=path.join(dir,'private-data/config.json');fs.appendFileSync(file,'tampered');assert.throws(()=>restorePrivateData(dir,{apply:true}),/checksum/i);assert.equal(fs.readFileSync(path.join(dir,'config.json'),'utf8'),'{}');
 const manifestFile=path.join(dir,'private-data/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile));manifest.files[0].path='../escape.json';fs.writeFileSync(manifestFile,JSON.stringify(manifest));assert.throws(()=>restorePrivateData(dir,{apply:true}),/path/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
