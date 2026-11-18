import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const root=JSON.parse(fs.readFileSync('workspace.local.json')).runtimeRoot,dir=path.join(root,'state/audits/global-model-inheritance-20261113');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'candidate.json'))),hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const roleHashes=()=>fs.readdirSync(path.join(root,'roles')).filter(f=>fs.statSync(path.join(root,'roles',f)).isFile()).map(file=>({file,hash:hash(path.join(root,'roles',file))}));
const roles=roleHashes();
for(const row of manifest.rows){
 assert.equal(hash(path.join(dir,'candidate',row.file)),row.after,'Candidate changed: '+row.file);
 assert.equal(hash(row.file),row.after,'Source changed: '+row.file);
 const file=path.join(root,row.file);if(row.before)assert.equal(hash(file),row.before,'Concurrent runtime edit: '+row.file);else assert(!fs.existsSync(file),'Unexpected runtime file: '+row.file);
}
// Prepare files only. No runtime/preset reload, process control or window action.
const ordered=[...manifest.rows].sort((a,b)=>(a.file==='src/bridge.js')-(b.file==='src/bridge.js'));
for(const row of ordered){const target=path.join(root,row.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(dir,'candidate',row.file),target);assert.equal(hash(target),row.after);}
assert.deepEqual(roleHashes(),roles);
const report={at:Date.now(),files:ordered.length,rolesUnchanged:true,filesInstalled:true,reloaded:false,restarted:false,coreBuild:createHash('sha256').update(fs.readFileSync(path.join(root,'src/bridge.js'))).update(fs.readFileSync(path.join(root,'src/plugin-host.js'))).digest('hex').slice(0,16)};
fs.writeFileSync(path.join(dir,'installed.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
