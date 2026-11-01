import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import yaml from 'js-yaml';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('installing the root DSH bundle registers every bridge-owned preset without the manual installer',async()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
 assert.ok(pkg.dsh?.bundle?.patch,'root must be a DSH installable bundle');
 const rows=[pkg.dsh.bundle.patch].flat().flatMap(file=>yaml.load(fs.readFileSync(path.join(root,file),'utf8')).flatMap(p=>p.insert||[]));
 const presets=rows.filter(r=>r.name==='@deepseek-ai/dsh-agent-preset');
 assert.deepEqual(presets.map(r=>r.config.id).sort(),['campus-summary','qq-admin','qq-chat','qq-chat-v2','qq-learning','qq-task-worker']);
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
 const require=createRequire(path.join(root,'package.json'));
 for(const preset of presets)for(const row of preset.config.plugins||[])if(row.name?.startsWith('qq-'))assert.ok(fs.existsSync(require.resolve(row.name)),row.name);
 for(const id of ['qq-mode','qq-launcher','mcp-snowluma','mcp-snowluma-host','mcp-web-search-safe','mcp-playwright','mcp-games','mcp-bridge-health','mcp-personal-core'])assert.ok(rows.some(r=>r.id===id),id);
});
test('the shipped bundle and browser entry are deterministic generated artifacts',async()=>{
 const {buildDshBundle}=await import('./build-dsh-bundle.mjs');
 assert.ok(buildDshBundle({check:true}).every(r=>!r.changed));
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),client=fs.readFileSync(path.join(root,pkg.exports['./client']),'utf8');
 assert.ok(client.includes("id: 'qq-bridge'"));
});
test('first DSH load creates safe local config once and keeps existing private configuration intact',async()=>{
 const {bootstrapLocal}=await import('./bootstrap-local.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-bundle-bootstrap-'));
 try{fs.copyFileSync(path.join(root,'config.example.json'),path.join(dir,'config.example.json'));fs.mkdirSync(path.join(dir,'roles'));fs.writeFileSync(path.join(dir,'roles','Assistant.md'),'Assistant');
 const first=bootstrapLocal(dir);assert.equal(first.created,true);const file=path.join(dir,'config.json'),cfg=JSON.parse(fs.readFileSync(file));assert.equal(cfg.allowAllWhenEmpty,false);assert.equal(cfg.sessionCwd,dir);
 cfg.ownerQQ='10001';cfg.consoleToken='fixture-existing-local-secret';fs.writeFileSync(file,JSON.stringify(cfg));const before=fs.readFileSync(file);assert.equal(bootstrapLocal(dir).created,false);assert.deepEqual(fs.readFileSync(file),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('bundled MCP entries derive local entrypoints and mount through the DSH loader with scoped disposal',async()=>{
 const {apply}=await import('../dsh-mcp-entry.mjs');const calls=[],fakePlugin={apply(){}};
 const ctx={loader:{import:async(name,parent)=>{assert.equal(name,'@deepseek-ai/dsh-mcp-client');assert.ok(parent.startsWith('file:'));return {default:fakePlugin};},unwrapExports:m=>m.default},plugin:(p,c)=>{calls.push({p,c});return 'scoped-child';}};
 const result=await apply(ctx,{serverName:'snowluma'});assert.equal(result,'scoped-child');assert.equal(calls.length,1);assert.equal(calls[0].c.serverName,'snowluma');assert.ok(fs.existsSync(calls[0].c.args[0]));assert.ok(path.isAbsolute(calls[0].c.command));
 await assert.rejects(apply(ctx,{serverName:'arbitrary-script'}),/Unknown bundled MCP/);
});
