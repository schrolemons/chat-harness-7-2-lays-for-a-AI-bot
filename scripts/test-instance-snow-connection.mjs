import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';import {parse} from 'acorn';
const api=await import('../src/instance-snow-connection.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('owned bridge uses exact runtime account, token and endpoints; stale home and environment cannot redirect it',()=>{
 assert.equal(typeof api.bindInstanceSnowConfig,'function');
 const root=path.join(os.tmpdir(),'fixture-bot'),snow={home:path.join(root,'managed-dependencies','release'),botUin:'123456789',httpUrl:'http://127.0.0.1:42000',wsUrl:'ws://127.0.0.1:42001',accessToken:'owned-token',consolePort:42100};
 const cfg={snowluma:{homeDir:'external-home',launcherPath:'external-launcher',botUin:'123456789',accessToken:'owned-token',httpUrl:'http://external.invalid:3000',wsUrl:'ws://external.invalid:3001'}};
 const result=api.bindInstanceSnowConfig(cfg,{root,active:true,env:{QQ_BRIDGE_SNOW_CONFIG:JSON.stringify(snow),SNOWLUMA_TOKEN:'external-token',SNOWLUMA_HTTP_URL:'http://external.invalid'}});
 assert.equal(result.snowluma.homeDir,snow.home);assert.equal(result.snowluma.wsUrl,snow.wsUrl);assert.equal(result.snowluma.httpUrl,snow.httpUrl);assert.equal(result.snowluma.launcherPath,undefined);assert.equal(result.consolePort,42100);assert.equal(cfg.snowluma.homeDir,'external-home');
 assert.throws(()=>api.bindInstanceSnowConfig(cfg,{root,active:true,env:{}}),/OWNED_SNOW_CONFIG_REQUIRED/);
 assert.equal(api.bindInstanceSnowConfig(cfg,{root,active:false}),cfg);
});
test('actual owned bridge recovery refuses discovery and persisted healing when its gateway is unavailable',async()=>{
 const source=await fs.readFile(new URL('../src/bridge.js',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),main=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='main');
 const names=['healTokenIfStale','applyHealedTokens','syncTokenToFile'];
 const code=main.body.body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
 let discovered=0,written=0;const cfg={snowluma:{wsUrl:'ws://127.0.0.1:9',accessToken:'own'}},bot={url:cfg.snowluma.wsUrl,accessToken:'own'};
 const funcs=vm.runInNewContext(code+'\n({'+names.join(',')+'})',{instanceSessionPolicy:{active:true},tokenHealAt:0,cfg,bot,ROOT:'fixture',path,log(){},discoverSnowLumaConnection:async()=>{discovered++;return {ok:true,token:'external',wsToken:'external',wsUrl:'ws://external.invalid'};},persistToken:()=>written++,persistSnowLumaEndpoint:()=>written++});
 await funcs.healTokenIfStale('own endpoint unavailable');await funcs.applyHealedTokens({token:'external',wsToken:'external',wsUrl:'ws://external.invalid'});await funcs.syncTokenToFile();
 assert.equal(discovered,0);assert.equal(written,0);assert.equal(bot.url,'ws://127.0.0.1:9');assert.equal(bot.accessToken,'own');assert.equal(cfg.snowluma.accessToken,'own');
});

test('runtime settings namespace cannot contradict its descriptor',async()=>{const {readInstanceSessionPolicy}=await import('../src/instance-session-policy.mjs');assert.throws(()=>readInstanceSessionPolicy({descriptor:{version:1,instanceId:'fixture',root:os.tmpdir(),entryId:'fixture',settingsNamespace:'fixture',presetIdMap:{}},env:{QQ_BRIDGE_SETTINGS_NAMESPACE:'foreign'}}),/PRESET_MAP_INVALID/);});
