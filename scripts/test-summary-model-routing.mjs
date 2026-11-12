import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {NodeApiClient} from '../src/dsh-client.js';
import {generateWebSummary} from '../plugins/qq-components/life-web-watch/summarizer.mjs';

test('independent summary selects the saved provider and omits default effort before any generation',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'summary-model-routing-'));
  t.after(()=>{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('summary-model-routing-'))throw Error('Unexpected cleanup');fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'state/plugins/config'),{recursive:true});
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({consolePort:1,consoleToken:'fixture-only-summary',dsh:{baseUrl:'http://127.0.0.1:1',provider:'wrong-legacy-provider'}}));
  t.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'http://127.0.0.1:1/api/tokens/budgets');return {ok:true,json:async()=>({ok:true,global:{limit:10,cost:0,reached:false}})};});
  const selections=[],prompts=[];
  t.mock.method(NodeApiClient.prototype,'callUnary',async(method,payload)=>{
    if(method==='session.selectModel'){selections.push(payload);throw Error('fixture-stop-before-generation');}
    if(method==='session.prompt')prompts.push(payload);
    const value=method==='agentPresets.list'?{presets:[{id:'campus-summary'}]}:method==='session.create'?{sessionId:'summary-fixture'}:{};
    return {result:{ok:true,value}};
  });
  for(const [provider,model,effort] of [['magpie-responses','codex/gpt-6.1-sol','xhigh'],['future-provider','future-model','']]){
    const other={provider:'different-default',model:'different-model',effort:'low'};
    fs.writeFileSync(path.join(root,'state/plugins/config/obs-cost-policy.json'),JSON.stringify({conversation:other,task:other,presets:{'campus-summary':{provider,model,effort}}}));
    await assert.rejects(generateWebSummary({},{root}),/fixture-stop-before-generation/);
    const actual=selections.at(-1);assert.equal(actual.provider,provider);assert.equal(actual.model,model);
    if(effort)assert.equal(actual.reasoningEffort,effort);else assert.equal(Object.hasOwn(actual,'reasoningEffort'),false);
  }
  assert.equal(prompts.length,0,'selection failure must not send a prompt');
});
