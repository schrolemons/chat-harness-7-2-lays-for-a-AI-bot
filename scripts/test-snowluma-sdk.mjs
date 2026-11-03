import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('bridge loads the unpatched published SDK without install scripts or dependency writes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-sdk-install-'));
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('qq-sdk-install-'));fs.rmSync(dir,{recursive:true,force:true});});
 const sdk=path.join(dir,'node_modules/@snowluma/sdk');
 fs.cpSync(fs.realpathSync(path.join(root,'node_modules/@snowluma/sdk')),sdk,{recursive:true,dereference:true});
 assert.equal(fs.lstatSync(sdk).isSymbolicLink(),false,'fixture must never write through a dependency junction');
 const before=new Map();
 const walk=folder=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  const file=path.join(folder,entry.name);
  if(entry.isDirectory())walk(file);
  else if(file.endsWith('.js')){
   // Recreate the upstream extensionless ESM imports repaired by npm postinstall.
   const source=fs.readFileSync(file,'utf8').replace(/(from\s+'\.[^']+)\.js'/g,"$1'");
   fs.writeFileSync(file,source);before.set(file,source);
  }
 }};
 walk(path.join(sdk,'dist'));
 fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
 const plain=spawnSync(process.execPath,['--input-type=module','-e',"await import('@snowluma/sdk')"],{cwd:dir,encoding:'utf8',windowsHide:true});
 assert.notEqual(plain.status,0,'fixture must reproduce the published SDK failure');
 assert.match(plain.stderr,/ERR_MODULE_NOT_FOUND/);
 fs.copyFileSync(path.join(root,'src/snowluma-sdk.mjs'),path.join(dir,'sdk.mjs'));
 fs.writeFileSync(path.join(dir,'unrelated.js'),"export const value='no implicit extension';");
 const probe=`import {SnowLumaWebSocketClient,text} from './sdk.mjs';
  import assert from 'node:assert/strict';
  assert.equal(typeof SnowLumaWebSocketClient,'function');
  assert.deepEqual(text('fixture').toArray(),[{type:'text',data:{text:'fixture'}}]);
  await assert.rejects(import('./unrelated'),{code:'ERR_MODULE_NOT_FOUND'});
  console.log('SDK_READY');`;
 fs.writeFileSync(path.join(dir,'probe.mjs'),probe);
 const loaded=spawnSync(process.execPath,['probe.mjs'],{cwd:dir,encoding:'utf8',windowsHide:true});
 assert.equal(loaded.status,0,loaded.stderr);assert.match(loaded.stdout,/SDK_READY/);
 for(const [file,source] of before)assert.equal(fs.readFileSync(file,'utf8'),source,'loading must not mutate dependency files');
});
