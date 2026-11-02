import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {renderPatch,buildPatches} from './build-agent-preset-patches.mjs';
import {adminToolPermission} from '../plugins/qq-agent-presets/admin-environment-guard.mjs';

test('admin preset shares the v2 interaction protocol, compaction and context assembly; differences add capabilities',()=>{
 const rows=id=>yaml.load(renderPatch(id))[0].insert[0].config.plugins;
 const ordinary=rows('qq-chat-v2'),admin=rows('qq-admin'),marker='【二代仿真模式 —— 工具协议';
 const prefix=list=>list.find(x=>x.id==='persona').config.prefix;
 assert.equal(prefix(admin).slice(prefix(admin).indexOf(marker)),prefix(ordinary).slice(prefix(ordinary).indexOf(marker)));
 for(const id of ['compaction','qq-context-composer','tool-ask-user','tool-todo'])assert.deepEqual(admin.find(x=>x.id===id),ordinary.find(x=>x.id===id));
 assert(!admin.some(x=>x.id==='qq-tool-restrict'));
 const names=JSON.stringify(admin);
 for(const name of ['dsh-tool-pwsh','dsh-tool-fs','dsh-tool-jobs','dsh-tool-schedule','dsh-tool-goal','dsh-tool-subagent','dsh-tool-workflow','dsh-tool-cordis','dsh-plugin-manager/tools','dsh-plugin-market/tools','dsh-tool-present','dsh-tool-skill'])assert(names.includes(name),name);
 assert(admin.some(x=>x.id==='admin-environment-guard'));
});

test('future v2 prompt, compaction, common-tool and new mechanism edits propagate without editing the admin extension',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-derived-preset-'));
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('qq-derived-preset-'));fs.rmSync(root,{recursive:true,force:true});});
 fs.cpSync(new URL('../dsh/agent-presets',import.meta.url),path.join(root,'dsh/agent-presets'),{recursive:true});
 buildPatches({root});
 const file=path.join(root,'dsh/agent-presets/qq-chat-v2/agent.cordis.yml');
 const base=yaml.load(fs.readFileSync(file,'utf8'));
 base.find(row=>row.id==='persona').config.prefix+='\n【未来的共同聊天规则】fixture synchronization';
 base.find(row=>row.id==='tool-todo').config.allowParallelInProgress=false;
 base.find(row=>row.id==='compaction').config[0].config.retainTokens=12345;
 base.push({id:'future-common-mechanism',name:'fixture/common-mechanism',config:{version:2}});
 fs.writeFileSync(file,yaml.dump(base,{lineWidth:-1}));
 assert.equal(buildPatches({root,check:true}).find(row=>row.file.endsWith('qq-admin.patch.yml')).changed,true);
 buildPatches({root});
 const admin=yaml.load(renderPatch('qq-admin',{root}))[0].insert[0].config.plugins;
 for(const id of ['tool-todo','compaction','future-common-mechanism'])assert.deepEqual(admin.find(row=>row.id===id),base.find(row=>row.id===id));
 assert(admin.find(row=>row.id==='persona').config.prefix.includes('fixture synchronization'));
 assert(buildPatches({root,check:true}).every(row=>!row.changed));
 const artifact=path.join(root,'plugins/qq-agent-presets/presets/qq-chat-v2.patch.yml'),before=fs.readFileSync(artifact,'utf8');
 base.find(row=>row.id==='persona').config.prefix='invalid shared protocol';fs.writeFileSync(file,yaml.dump(base));
 assert.throws(()=>buildPatches({root}),/共享工具协议/);assert.equal(fs.readFileSync(artifact,'utf8'),before);
});

test('native DSH execution rechecks the switch, selected and loaded preset, task origin and session mapping',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-admin-guard-'));
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('qq-admin-guard-'));fs.rmSync(root,{recursive:true,force:true});});
 fs.mkdirSync(path.join(root,'state'));const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
 const config={ownerQQ:123,socialV2:{adminDev:{enabled:true,preset:'qq-admin'}}};
 const state={sessions:{'private:123':'owner-session'},sessionPresets:{'private:123':'qq-admin'}};
 save('config.json',config);save('state/sessions.json',state);save('state/tasks.json',{tasks:{worker:{sessionId:'worker-session',originKey:'private:123',status:'running'}}});
 assert.equal(adminToolPermission(root,'owner-session'),undefined);assert.equal(adminToolPermission(root,'worker-session'),undefined);
 assert(adminToolPermission(root,'other-session'));
 config.socialV2.adminDev.enabled=false;save('config.json',config);
 assert(adminToolPermission(root,'owner-session'));assert(adminToolPermission(root,'worker-session'));
 config.socialV2.adminDev.enabled=true;config.socialV2.adminDev.preset='qq-chat-v2';save('config.json',config);
 assert(adminToolPermission(root,'owner-session'));
 config.socialV2.adminDev.preset='qq-admin';save('config.json',config);state.sessions['private:123']='new-session';save('state/sessions.json',state);
 assert(adminToolPermission(root,'owner-session'));assert.equal(adminToolPermission(root,'new-session'),undefined);
 save('state/tasks.json',{tasks:{worker:{sessionId:'worker-session',originKey:'private:789',status:'running'}}});assert(adminToolPermission(root,'worker-session'));
});

test('native child tools follow only trusted live DSH ancestry and revoke with the root authorization',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-native-admin-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'state'));
 const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
 const cfg={ownerQQ:123,socialV2:{adminDev:{enabled:true,preset:'qq-admin'}}};
 const state={sessions:{'private:123':'owner'},sessionPresets:{'private:123':'qq-admin'}};
 save('config.json',cfg);save('state/sessions.json',state);save('state/tasks.json',{tasks:{}});
 const make=(id,parentSession,origin='subagent')=>({session:{id,header:{id,parentSession,origin}}});
 const owner=make('owner',undefined,'chat'),child=make('child','owner'),grandchild=make('grandchild','child');
 const agents=new Map([['owner',owner],['child',child],['grandchild',grandchild]]);
 assert.equal(adminToolPermission(root,'grandchild',{agent:grandchild,agents}),undefined);
 fs.unlinkSync(path.join(root,'state/tasks.json'));
 assert.equal(adminToolPermission(root,'owner'),undefined);
 assert.equal(adminToolPermission(root,'grandchild',{agent:grandchild,agents}),undefined,'native delegation does not require a bridge task file');
 assert(adminToolPermission(root,'grandchild',{agent:make('grandchild','owner'),agents}),'a supplied lookalike is not trusted runtime ancestry');
 agents.delete('child');assert(adminToolPermission(root,'grandchild',{agent:grandchild,agents}));agents.set('child',child);
 child.session.header.origin='chat';assert(adminToolPermission(root,'grandchild',{agent:grandchild,agents}));child.session.header.origin='subagent';
 child.session.header.parentSession='grandchild';assert(adminToolPermission(root,'grandchild',{agent:grandchild,agents}));child.session.header.parentSession='owner';
 cfg.socialV2.adminDev.enabled=false;save('config.json',cfg);assert(adminToolPermission(root,'grandchild',{agent:grandchild,agents}));
 cfg.socialV2.adminDev.enabled=true;save('config.json',cfg);state.sessions['private:123']='replacement';save('state/sessions.json',state);
 assert(adminToolPermission(root,'grandchild',{agent:grandchild,agents}));
});
