import test,{after} from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { NodeApiClient } from '../src/dsh-client.js';
import { isAdminEnvironmentAuthorized } from '../src/tools/admin-policy.js';
const sources=['qq-chat','qq-chat-v2','qq-admin','qq-learning','qq-task-worker','campus-summary'];
const map=Object.fromEntries(sources.map(id=>[id,'public-bot:'+id]));
const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'instance-session-routing-'));
after(()=>{assert.equal(path.dirname(testRoot),os.tmpdir());fs.rmSync(testRoot,{recursive:true,force:true});});
const descriptor={version:1,instanceId:'public-bot',root:testRoot,entryId:'public-bot-mode',settingsNamespace:'public-bot-mode',presetIdMap:map};
const policyModule=()=>import('../src/instance-session-policy.mjs');

test('all six owned presets use the runtime map through the real Node client adapter',async()=>{
 const calls=[],recorded=[];
 const client=new NodeApiClient('http://127.0.0.1:1',1000,{}, {descriptor,env:{QQ_BRIDGE_PRESET_MAP:JSON.stringify(map)},recordCreatedSession:async row=>recorded.push(row)});
 client.callUnary=async(method,data)=>{calls.push({method,data});return {result:{ok:true,value:method==='workspace.create'?{workspace:{workspaceId:'ws',path:data.path}}:{sessionId:'s'+calls.length}}};};
 for(const id of sources)await client.sessions.create({agentPreset:id});
 assert.deepEqual(calls.filter(c=>c.method==='session.create').map(c=>c.data.agentPreset),Object.values(map));
 assert.equal(recorded.length,6);assert(recorded.every(row=>row.workspaceId==='ws'&&Object.keys(row).sort().join()==='sessionId,workspaceId'));
 assert(calls.filter(c=>c.method==='session.create').every(c=>c.data.workspaceId==='ws'&&!('cwd'in c.data)));
});

test('invalid maps fail closed, owned mapping is idempotent, foreign explicit IDs stay exact',async()=>{
 const {readInstanceSessionPolicy}=await policyModule();
 for(const raw of ['{','{}','null',JSON.stringify({...map,unknown:'x'}),JSON.stringify({...map,'qq-chat':'public-bot:qq-admin'})])assert.throws(()=>readInstanceSessionPolicy({descriptor,env:{QQ_BRIDGE_PRESET_MAP:raw}}),/PRESET_MAP/);
 const p=readInstanceSessionPolicy({descriptor,env:{QQ_BRIDGE_PRESET_MAP:JSON.stringify(map)}});
 for(const id of sources){assert.equal(p.resolvePreset(id),map[id]);assert.equal(p.resolvePreset(map[id]),map[id]);assert.equal(p.canonicalPreset(map[id]),id);}
 assert.equal(p.resolvePreset('external-admin'),'external-admin');assert.equal(p.ownsPreset('other:qq-admin'),false);
 assert.equal(p.settingsNamespace,'public-bot-mode');assert.match(p.workspace('learning'),/public-bot/);
 assert(p.equivalentPreset('qq-admin',map['qq-admin']));assert(!p.equivalentPreset('',map['qq-admin']));
});

test('mapped chat, learning and summary IDs never gain admin authority; exact session checks remain',()=>{
 for(const source of ['qq-chat','qq-chat-v2','qq-learning','campus-summary'])assert.equal(isAdminEnvironmentAuthorized({owner:true,enabled:true,selectedPreset:map[source],loadedPreset:map[source],hasSession:true,knownPresets:Object.values(map),presetMap:map}),false);
 const args={owner:true,enabled:true,selectedPreset:map['qq-admin'],loadedPreset:map['qq-admin'],hasSession:true,knownPresets:Object.values(map),presetMap:map};
 assert.equal(isAdminEnvironmentAuthorized(args),true);assert.equal(isAdminEnvironmentAuthorized({...args,loadedPreset:'qq-admin'}),false);assert.equal(isAdminEnvironmentAuthorized({...args,owner:false}),false);
});

test('record failure preserves successful response and existing-ID requests are never claimed',async()=>{
 const calls=[],errors=[];
 const client=new NodeApiClient('http://127.0.0.1:1',1000,{}, {descriptor,env:{},recordCreatedSession:async()=>{throw Error('receipt unavailable');},onOwnershipError:e=>errors.push(e)});
 client.callUnary=async(method,data)=>{calls.push({method,data});return {result:{ok:true,value:method==='workspace.create'?{workspace:{workspaceId:'ws',path:data.path}}:{sessionId:'retained'}}};};
 const result=await client.sessions.create({agentPreset:'qq-chat'});assert.equal(result.result.value.sessionId,'retained');assert.equal(result.ownership.status,'unrecorded');assert.equal(errors.length,1);
 await client.sessions.create({sessionId:'old',cwd:path.join(os.tmpdir(),'old-cwd'),agentPreset:'qq-chat'});
 assert.equal(errors.length,1);assert.equal(calls.filter(c=>c.method==='session.create').length,2);assert.equal(calls.at(-1).data.cwd,path.join(os.tmpdir(),'old-cwd'));assert.equal(calls.at(-1).data.agentPreset,'qq-chat');
});

test('bridge keeps canonical legacy mappings while resolving new owned presets and namespaces',async()=>{
 const {bridgeHarness}=await import('./audit-bridge-harness.mjs');const {readInstanceSessionPolicy}=await policyModule();
 const policy=readInstanceSessionPolicy({descriptor,env:{}});
 const h=await bridgeHarness({config:{socialV2:{adminDev:{enabled:true,preset:'qq-admin'}}},savedState:{sessions:{'private:123':'original-private'},sessionPresets:{'private:123':'qq-admin'}},globals:{loadInstanceSessionPolicy:()=>policy}});
 try{h.setPresets([...Object.values(map),'standard']);h.setMode('reserved2');h.syncAdminDevPreset();assert.equal(h.state.sessions['private:123'],'original-private');assert.equal(await h.ensureSession('group:456'),'fixture-1');assert.equal(h.calls.created[0].agentPreset,map['qq-chat-v2']);assert.equal(h.calls.archived.length,0);}
 finally{await h.close();}
});

test('bridge preserves unknown old preset metadata rather than retiring a session',async()=>{
 const {bridgeHarness}=await import('./audit-bridge-harness.mjs');
 const h=await bridgeHarness({config:{socialV2:{adminDev:{enabled:true,preset:'qq-admin'}}},savedState:{sessions:{'private:123':'unknown-original'}}});
 try{h.setPresets(['qq-admin','standard']);h.syncAdminDevPreset();assert.equal(h.state.sessions['private:123'],'unknown-original');assert.equal(h.calls.archived.length,0);}
 finally{await h.close();}
});

test('overview and source attribution reverse only explicit owned mapped IDs',async()=>{
 const {presetBindings}=await import('../src/console/preset-overview.js');const {readInstanceSessionPolicy}=await policyModule();const policy=readInstanceSessionPolicy({descriptor});
 const rows=presetBindings({mode:'reserved2',admin:{enabled:true,preset:'qq-admin'},sessionPolicy:policy});
 assert.equal(rows.find(r=>r.key==='owner').preset,map['qq-admin']);assert.equal(rows.find(r=>r.key==='summary').preset,map['campus-summary']);
 const {annotateRequestSources}=await import('../plugins/qq-components/obs-context-assembly/source-attribution.mjs');
 const fs=await import('node:fs');const yaml=await import('js-yaml');const root=process.cwd();
 const definitions=yaml.load(fs.readFileSync(path.join(root,'dsh/agent-presets/qq-learning/agent.cordis.yml'),'utf8'));
 const find=rows=>rows.flatMap(row=>row.id==='persona'?[row]:row.group?find(row.config):[]);const text=find(definitions)[0].config.prefix;
 const request={messages:[{role:'system',text,provenance:{agentPreset:map['qq-learning']}}]};
 assert(annotateRequestSources(root,request,{sessionPolicy:policy}).messages[0].sourceAttribution.ranges.length>0);
 assert.equal(annotateRequestSources(root,{messages:[{...request.messages[0],provenance:{agentPreset:'foreign:qq-learning'}}]},{sessionPolicy:policy}).messages[0].sourceAttribution.ranges.length,0);
});

test('new workspace titles identify the bot and ordinary clients do not inherit bot policy',async()=>{
 const calls=[];const client=new NodeApiClient('http://127.0.0.1:1',1000,{}, {descriptor:{...descriptor,label:'Synthetic Public Bot'},env:{},recordCreatedSession:async()=>{}});
 client.callUnary=async(method,data)=>{calls.push({method,data});return {result:{ok:true,value:method==='workspace.create'?{created:true,workspace:{workspaceId:'ws',path:data.path}}:{sessionId:'new-title'}}};};
 await client.sessions.create({agentPreset:'qq-learning'});assert.match(calls.find(row=>row.method==='workspace.rename')?.data.title||'',/Synthetic Public Bot/);
 const old=process.env.QQ_BRIDGE_PRESET_MAP;process.env.QQ_BRIDGE_PRESET_MAP='invalid';try{const ordinary=new NodeApiClient('http://127.0.0.1:1',1000,{});assert.equal(ordinary.sessionPolicy.active,false);}finally{if(old===undefined)delete process.env.QQ_BRIDGE_PRESET_MAP;else process.env.QQ_BRIDGE_PRESET_MAP=old;}
});

test('descriptor maps reject unknown sources and ambiguous canonical aliases before create',async()=>{
 const {readInstanceSessionPolicy}=await policyModule();
 assert.throws(()=>readInstanceSessionPolicy({descriptor:{...descriptor,presetIdMap:{...map,unknown:'public-bot:unknown'}}}),/PRESET_MAP/);
 assert.throws(()=>readInstanceSessionPolicy({descriptor:{...descriptor,presetIdMap:{...map,'qq-chat':'qq-admin'}}}),/PRESET_MAP/);
});

test('bridge reads and writes only its own settings namespace',async()=>{
 const {bridgeHarness}=await import('./audit-bridge-harness.mjs');const {readInstanceSessionPolicy}=await policyModule();const policy=readInstanceSessionPolicy({descriptor});
 const h=await bridgeHarness({globals:{loadInstanceSessionPolicy:()=>policy}});let server;
 try{h.api.settings.describe=async()=>({result:{ok:true,value:{namespaces:[{ns:'qq-mode',value:{mode:'chat'}},{ns:policy.settingsNamespace,value:{mode:'reserved2'}}]}}});await h.refreshMode();assert.equal(h.getMode(),'reserved2');
 const writes=[];h.api.settings.update=async payload=>{writes.push(payload);return {result:{ok:true,value:{}}};};server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/mode',{method:'POST',headers:{'x-console-token':'fixture-console-token','content-type':'application/json'},body:JSON.stringify({mode:'chat'})});assert.equal(response.status,200);assert.equal(writes[0].ns,policy.settingsNamespace);
 }finally{if(server)await new Promise(r=>server.close(r));await h.close();}
});

test('native admin guard classifies owned mapped chat conservatively and keeps exact task origin',async t=>{
 const fs=await import('node:fs'),{adminToolPermission}=await import('../plugins/qq-agent-presets/admin-environment-guard.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mapped-admin-guard-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true});});fs.mkdirSync(path.join(root,'state'));
 fs.writeFileSync(path.join(root,'.qq-bridge-instance.json'),JSON.stringify({...descriptor,root}));
 const save=id=>{fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({ownerQQ:'123',socialV2:{adminDev:{enabled:true,preset:id}}}));fs.writeFileSync(path.join(root,'state/sessions.json'),JSON.stringify({sessions:{'private:123':'owner'},sessionPresets:{'private:123':id}}));};
 for(const source of ['qq-chat','qq-chat-v2','qq-learning','campus-summary']){save(map[source]);assert(adminToolPermission(root,'owner'));}
 save(map['qq-admin']);assert.equal(adminToolPermission(root,'owner'),undefined);
 fs.writeFileSync(path.join(root,'state/tasks.json'),JSON.stringify({tasks:{one:{sessionId:'task',originKey:'private:123',status:'running'},other:{sessionId:'foreign-task',originKey:'private:456',status:'running'}}}));assert.equal(adminToolPermission(root,'task'),undefined);assert(adminToolPermission(root,'foreign-task'));
});

test('existing canonical policy metadata stays reusable under mapped identity without rewriting mapping',async()=>{
 const {bridgeHarness}=await import('./audit-bridge-harness.mjs'),{readInstanceSessionPolicy}=await policyModule();
 const h=await bridgeHarness({savedState:{sessions:{'group:456':'legacy-group'},sessionPresets:{'group:456':'qq-chat-v2'},sessionPolicies:{'group:456':JSON.stringify(['reserved2','qq-chat-v2',null])}},globals:{loadInstanceSessionPolicy:()=>readInstanceSessionPolicy({descriptor})}});
 try{h.setMode('reserved2');h.setPresets(Object.values(map));assert.equal(await h.ensureSession('group:456'),'legacy-group');assert.equal(h.calls.created.length,0);assert.equal(h.state.sessionPresets['group:456'],'qq-chat-v2');assert.equal(h.calls.archived.length,0);}finally{await h.close();}
});

test('missing old policy metadata refuses reuse but never retires or recreates its ID',async()=>{
 const {bridgeHarness}=await import('./audit-bridge-harness.mjs');const h=await bridgeHarness({savedState:{sessions:{'group:456':'legacy-unknown'}}});
 try{h.setMode('reserved2');h.setPresets(['qq-chat-v2']);await assert.rejects(h.ensureSession('group:456'),/信息不完整/);assert.equal(h.state.sessions['group:456'],'legacy-unknown');assert.equal(h.calls.created.length,0);assert.equal(h.calls.archived.length,0);}finally{await h.close();}
});

test('map classification can only restrict canonical chat authorization, never promote it',()=>{
 assert.equal(isAdminEnvironmentAuthorized({owner:true,enabled:true,selectedPreset:'qq-chat-v2',loadedPreset:'qq-chat-v2',hasSession:true,knownPresets:['qq-chat-v2'],presetMap:{'qq-admin':'qq-chat-v2'}}),false);
});

test('announced metadata with an unknown schema version cannot create sessions',async()=>{
 const {readInstanceSessionPolicy}=await policyModule();assert.throws(()=>readInstanceSessionPolicy({descriptor:{...descriptor,version:99}}),/PRESET_MAP/);
});

test('present but null or primitive instance metadata cannot downgrade to legacy',async()=>{
 const {loadInstanceSessionPolicy}=await policyModule();const root=fs.mkdtempSync(path.join(testRoot,'invalid-descriptor-'));
 for(const value of [null,false,0,'']){fs.writeFileSync(path.join(root,'.qq-bridge-instance.json'),JSON.stringify(value));assert.throws(()=>loadInstanceSessionPolicy({root,env:{}}),/PRESET_MAP/);}
});
