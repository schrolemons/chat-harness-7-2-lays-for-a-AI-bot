import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { patchText, install } from '../install.mjs';
test('安装幂等、保留原有配置及注释，卸载仅移除本区块',()=>{
 const original='# existing\n- id: existing\n  name: example\n  config:\n    keep: true\n';
 const entry={id:'mcp-codex-peer',name:'@deepseek-ai/dsh-mcp-client',config:{command:'C:\\Program Files\\node.exe',args:['C:\\space path\\中 文\\server.mjs']}};
 const once=patchText(original,entry);assert.ok(once.startsWith(original));assert.equal(patchText(once,entry),once);
 const parsed=yaml.load(once);assert.deepEqual(parsed[1].insert[0],entry);assert.equal(parsed[0].config.keep,true);
 const formatted=once.replace('C:\\space path\\中 文\\server.mjs','C:\\space path\\中\n            文\\server.mjs');
 assert.equal(patchText(formatted,entry),formatted);
 assert.equal(patchText(once,entry,true).trimEnd(),original.trimEnd());
});
test('损坏、重复标记或非列表配置均拒绝，避免覆盖误配置',()=>{
 for(const text of ['x: true','# === codex-peer MCP BEGIN ===\n[]','# === codex-peer MCP END ===\n[]','# === codex-peer MCP BEGIN ===\n# === codex-peer MCP END ===\n# === codex-peer MCP BEGIN ==='])assert.throws(()=>patchText(text,{}));
});
test('重复安装后已有状态和查看信息保持可读、内容不变',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-peer-install-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const profile=path.join(dir,'profile');const stateDir=path.join(dir,'state');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'cordis.patch.yml'),'- id: original\n  name: example\n');
 const options={profile,stateDir,codexPath:process.execPath};install(options);
 for(const file of ['state.json','viewer-info.json'])fs.writeFileSync(path.join(stateDir,file),'test-preserved');
 const second=install(options);assert.equal(second.changed,false);
 for(const file of ['state.json','viewer-info.json'])assert.equal(fs.readFileSync(path.join(stateDir,file),'utf8'),'test-preserved');
});
