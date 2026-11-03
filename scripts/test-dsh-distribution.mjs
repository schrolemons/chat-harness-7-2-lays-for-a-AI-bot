import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';import yaml from 'js-yaml';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('bundled MCP wrapper mounts and disposes its child through the real Cordis lifecycle',async()=>{
 const {Context}=await import('@deepseek-ai/cordis');
 const wrapper=await import('../dsh-mcp-entry.mjs');
 const ctx=new Context();let mounted=0,disposed=0;
 const child={name:'fixture-mcp',apply(){mounted++;return ()=>{disposed++;};}};
 ctx.provide('loader',{import:async()=>({default:child}),unwrapExports:m=>m.default});
 const parent=ctx.plugin(wrapper,{root,serverName:'snowluma'});
 try{await parent;assert.equal(parent.state,2,'wrapper must remain active after mounting its child');assert.equal(mounted,1);}
 finally{await parent.dispose();await ctx.fiber.dispose();}
 assert.equal(disposed,1,'the child must be disposed with the wrapper');
});

test('Playwright MCP launches with dependencies hoisted beside the installed bundle',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-hoisted-mcp-'));
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('qq-hoisted-mcp-'));fs.rmSync(dir,{recursive:true,force:true});});
 const bundle=path.join(dir,'node_modules/qq-bridge');
 fs.mkdirSync(path.join(bundle,'scripts'),{recursive:true});
 fs.writeFileSync(path.join(bundle,'package.json'),'{"type":"module"}');
 fs.copyFileSync(path.join(root,'dsh-mcp-entry.mjs'),path.join(bundle,'dsh-mcp-entry.mjs'));
 fs.copyFileSync(path.join(root,'scripts/browser-mcp-config.mjs'),path.join(bundle,'scripts/browser-mcp-config.mjs'));
 fs.mkdirSync(path.join(bundle,'src'));fs.copyFileSync(path.join(root,'src/dsh-host-import.mjs'),path.join(bundle,'src/dsh-host-import.mjs'));
 fs.mkdirSync(path.join(dir,'node_modules/@playwright'),{recursive:true});
 fs.symlinkSync(fs.realpathSync(path.join(root,'node_modules/@playwright/mcp')),path.join(dir,'node_modules/@playwright/mcp'),process.platform==='win32'?'junction':'dir');
 const {apply}=await import(pathToFileURL(path.join(bundle,'dsh-mcp-entry.mjs')));
 let transport;
 await apply({root:{},loader:{import:async()=>({}),unwrapExports:m=>m},plugin:(_,config)=>{transport=config;}},{root:bundle,serverName:'playwright'});
 assert.equal(transport.cwd,bundle);assert.equal(transport.failOnStartupError,true);
 assert.ok(fs.existsSync(transport.args[0]),'hoisted dependency must resolve outside the bundle');
 const result=spawnSync(transport.command,[transport.args[0],'--version'],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/\d+\.\d+/);
});
test('root DSH bundle declares one controller and ships all instance preset definitions',async()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
 assert.ok(pkg.dsh?.bundle?.patch,'root must be a DSH installable bundle');
 const rows=[pkg.dsh.bundle.patch].flat().flatMap(file=>yaml.load(fs.readFileSync(path.join(root,file),'utf8')).flatMap(p=>p.insert||[]));
 assert.deepEqual(rows,[{id:pkg.qqBridge.instance.entryId,name:pkg.name,config:{}}]);
 const {INSTANCE_PRESETS,patchFileFor}=await import('./build-agent-preset-patches.mjs');
 const presets=INSTANCE_PRESETS.flatMap(id=>yaml.load(fs.readFileSync(patchFileFor(id),'utf8')).flatMap(p=>p.insert||[]));
 assert.deepEqual(presets.map(r=>r.config.id).sort(),['campus-summary','qq-admin','qq-chat','qq-chat-v2','qq-learning','qq-task-worker']);
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
 for(const preset of presets)for(const row of preset.config.plugins||[])if(row.name?.startsWith('qq-agent-presets/'))assert.ok(fs.existsSync(path.join(root,'plugins',row.name)),row.name);
 assert.ok(!rows.some(row=>row.id.startsWith('mcp-')||row.id.startsWith('preset-')));
});
test('the shipped bundle and browser entry are deterministic generated artifacts',async()=>{
 const {buildDshClient}=await import('./build-dsh-client.mjs');
 assert.equal((await buildDshClient({check:true})).changed,false,'bundled protocol client must match its build inputs');
 const {buildDshBundle}=await import('./build-dsh-bundle.mjs');
 assert.ok(buildDshBundle({check:true}).every(r=>!r.changed));
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),client=fs.readFileSync(path.join(root,pkg.exports['./client']),'utf8');
 assert.ok(client.includes('id: '+JSON.stringify(pkg.name)));
});
test('explicit install bootstrap creates safe local config once and preserves existing configuration',async()=>{
 const {bootstrapLocal}=await import('./bootstrap-local.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-bundle-bootstrap-'));
 try{fs.copyFileSync(path.join(root,'config.example.json'),path.join(dir,'config.example.json'));fs.mkdirSync(path.join(dir,'roles'));fs.writeFileSync(path.join(dir,'roles','Assistant.md'),'Assistant');
 const first=bootstrapLocal(dir);assert.equal(first.created,true);const file=path.join(dir,'config.json'),cfg=JSON.parse(fs.readFileSync(file));assert.equal(cfg.allowAllWhenEmpty,false);assert.equal(cfg.sessionCwd,dir);
 cfg.ownerQQ='10001';cfg.consoleToken='fixture-existing-local-secret';fs.writeFileSync(file,JSON.stringify(cfg));const before=fs.readFileSync(file);assert.equal(bootstrapLocal(dir).created,false);assert.deepEqual(fs.readFileSync(file),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('bundled MCP entries derive local entrypoints and mount through the DSH loader with scoped disposal',async()=>{
 const {apply}=await import('../dsh-mcp-entry.mjs');const calls=[],fakePlugin={apply(){}};
 const ctx={root:{},loader:{import:async(name,parent)=>{assert.equal(name,'@deepseek-ai/dsh-mcp-client');assert.equal(parent,undefined);return {default:fakePlugin};},unwrapExports:m=>m.default},plugin:(p,c)=>{calls.push({p,c});return 'scoped-child';}};
 const result=await apply(ctx,{root,serverName:'snowluma'});assert.equal(result,undefined);assert.equal(calls.length,1);assert.equal(calls[0].c.serverName,'snowluma');assert.ok(fs.existsSync(calls[0].c.args[0]));assert.ok(path.isAbsolute(calls[0].c.command));assert.equal(calls[0].c.cwd,root);assert.equal(calls[0].c.failOnStartupError,true);
 await assert.rejects(apply(ctx,{serverName:'snowluma'}),/explicit absolute instance root/);
 await assert.rejects(apply(ctx,{serverName:'arbitrary-script'}),/Unknown bundled MCP/);
});
