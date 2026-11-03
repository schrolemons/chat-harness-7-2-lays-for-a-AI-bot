import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readLauncherSettings,saveLauncherSettings} from './launcher-settings.mjs';
import {bootstrapLocal} from './bootstrap-local.mjs';
const api=await import('../src/instance-dsh-target.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('managed target follows exact native origin and preserves explicit port remote and non-root targets',()=>{
 assert.equal(typeof api.selectInstanceDshTarget,'function');
 const cfg={dsh:{baseUrl:'http://127.0.0.1:3080'}},origin='http://127.0.0.1:54321';
 assert.deepEqual(api.selectInstanceDshTarget(cfg,()=>origin),{mode:'native',baseUrl:origin});
 assert.equal(api.selectInstanceDshTarget(cfg,()=>origin.replace('54321','54322')).baseUrl,'http://127.0.0.1:54322');
 for(const baseUrl of ['https://example.invalid/api','http://127.0.0.1:45678/api','https://localhost:45678/'])assert.equal(api.selectInstanceDshTarget({dsh:{baseUrl}},()=>origin).baseUrl,baseUrl);
 assert.equal(api.selectInstanceDshTarget({...cfg,launcher:{ports:{dsh:45678}}},()=>origin).baseUrl,'http://127.0.0.1:45678');
 assert.throws(()=>api.selectInstanceDshTarget(cfg,()=>{throw Error('not bound');}),/not bound/);
});
test('managed unrelated settings saves keep follow-current blank; explicit port and reset are persisted',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'instance-target-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'config.json'),cfg={dsh:{baseUrl:'http://127.0.0.1:3080'},snowluma:{botUin:'123456789'}};
 fs.writeFileSync(file,JSON.stringify(cfg));const options={managed:true};
 const first=readLauncherSettings(root,undefined,options);assert.equal(first.ports.dsh,'');
 const saved=saveLauncherSettings(root,{revision:first.revision,ports:{...first.ports,launcher:4299}},options);
 assert.equal(saved.ports.dsh,'');assert.equal(JSON.parse(fs.readFileSync(file)).launcher.ports.dsh,'');
 assert.equal(JSON.parse(fs.readFileSync(file)).dsh.baseUrl,cfg.dsh.baseUrl);
 const explicit=saveLauncherSettings(root,{ports:{dsh:45678}},options);assert.equal(explicit.ports.dsh,45678);
 const reset=saveLauncherSettings(root,{ports:{dsh:''}},options);assert.equal(reset.ports.dsh,'');
 assert.equal(readLauncherSettings(root).ports.dsh,45678,'standalone interpretation retains ordinary stored URL');
});
test('owned DSH snapshot binding is explicit and ordinary consumers ignore ambient instance values',()=>{
 assert.equal(typeof api.bindInstanceDshConfig,'function');const cfg={dsh:{baseUrl:'http://127.0.0.1:3080',provider:'fixture'}};
 const env={QQ_BRIDGE_DSH_TARGET:JSON.stringify({baseUrl:'http://127.0.0.1:54321'})};
 assert.equal(api.bindInstanceDshConfig(cfg,{active:false,env}),cfg);
 assert.equal(api.bindInstanceDshConfig(cfg,{active:true,env}).dsh.baseUrl,'http://127.0.0.1:54321');
 assert.throws(()=>api.bindInstanceDshConfig(cfg,{active:true,env:{}}),/OWNED_DSH_TARGET/);
});
test('blank follow-current applies only to DSH, other empty listener settings still refuse',()=>{
 assert.throws(()=>readLauncherSettings(undefined,{launcher:{ports:{console:''}}}),/端口/);
});
test('same explicit local port preserves URL authority for native cookies',()=>{
 const baseUrl='http://localhost:45678/';assert.equal(api.selectInstanceDshTarget({dsh:{baseUrl},launcher:{ports:{dsh:45678}}},()=>{throw Error('manual target must not read host');}).baseUrl,baseUrl);
});
test('fresh bootstrap preserves an explicitly supplied manual DSH port',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'manual-target-install-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'config.example.json'),JSON.stringify({dsh:{baseUrl:'http://127.0.0.1:3080'},snowluma:{}}));fs.mkdirSync(path.join(root,'roles'));fs.writeFileSync(path.join(root,'roles','fixture.md'),'synthetic');
 const descriptor={version:1,instanceId:'fixture',root,entryId:'fixture',settingsNamespace:'fixture',presetIdMap:{}};
 bootstrapLocal(root,{descriptor,snowHome:path.join(root,'managed-dependencies','snow'),ports:{dsh:45678,console:3100,snowHttp:3000,snowWs:3001,launcher:3199,snowWebui:5099}});
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json')));assert.equal(cfg.launcher.ports.dsh,45678);assert.equal(cfg.dsh.baseUrl,'http://127.0.0.1:45678');
});

test('managed auto target does not reserve the stale configured DSH port',()=>{
 const cfg={dsh:{baseUrl:'http://127.0.0.1:3080'},launcher:{ports:{dsh:'',console:3080}}};
 assert.equal(readLauncherSettings(undefined,cfg,{managed:true}).ports.console,3080);
 assert.throws(()=>readLauncherSettings(undefined,cfg),/端口重复/);
});
