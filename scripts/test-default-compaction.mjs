import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {defaultCompactionClass,readGlobalModel} from '../plugins/qq-agent-presets/default-compaction.mjs';
import {createRequire} from 'node:module';
const nativeRoot=JSON.parse(fs.readFileSync(new URL('../workspace.local.json',import.meta.url))).dshSourceRepository;
const {BasicCompactionEngine}=await import(pathToFileURL(path.join(nativeRoot,'packages/compaction/compaction-basic/lib/index.js')).href);
const {resolveConfig}=await import(pathToFileURL(path.join(nativeRoot,'packages/compaction/compaction-basic/lib/types/config.js')).href);

async function exerciseInheritance(BasicCompactionEngine,resolveConfig){
 let selection={provider:'ustc',model:'global-fast',effort:'off'};const calls=[];
 const Routed=defaultCompactionClass(BasicCompactionEngine,()=>({...selection}));
 const receiver={config:resolveConfig({auto:false,headroomTokens:8192,maxTokens:2048,summarizationProvider:'old-paid',summarizationModel:'old-fixed'}),ctx:{llm:{async *stream(options){calls.push(options);yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'<compacted-summary>当前话题：乌龙茶；已发送一条；等待新来信。</compacted-summary>'}};yield {type:'finish',reason:{kind:'stop'}};}}}};
 const before=JSON.stringify(receiver.config),agent={options:{provider:'old-paid',model:'old-fixed'},session:{id:'native-summary-test',requestHeader:()=>({config:{provider:'old-paid',model:'old-fixed'}}),toolHistory:()=>[]}};
 const input={messages:[{role:'user',content:[{type:'text',text:'乌龙茶'}]}]};
 const first=await Routed.prototype.summarize.call(receiver,input,agent);
 assert.equal(first.provider,'ustc');assert.equal(first.model,'global-fast');assert.equal(calls[0].reasoningEffort,'off');assert.equal(calls[0].purpose,'compaction');
 selection={provider:'other-default',model:'next-model',effort:'low'};
 const second=await Routed.prototype.summarize.call(receiver,input,agent);
 assert.equal(second.provider,'other-default');assert.equal(second.model,'next-model');assert.equal(calls[1].reasoningEffort,'low');assert.equal(JSON.stringify(receiver.config),before);
 assert.equal(calls.length,2);assert.equal(calls[1].maxTokens,2048);
}
test('native compaction follows changed global model and effort on the same engine, recording actual call identity',()=>exerciseInheritance(BasicCompactionEngine,resolveConfig));
test('the installed desktop native backend also supports the default-model adapter',async()=>{
 const workspace=JSON.parse(fs.readFileSync(new URL('../workspace.local.json',import.meta.url)));
 const module=createRequire(path.join(workspace.dshHome,'profiles',workspace.dshProfile,'package.json')).resolve('@deepseek-ai/dsh-compaction-basic');
 const installed=await import(pathToFileURL(module).href);
 await exerciseInheritance(installed.BasicCompactionEngine,resolveConfig);
 const requireHost=createRequire(module),{Context}=await import(pathToFileURL(requireHost.resolve('@deepseek-ai/cordis')).href);
 const ctx=new Context();ctx.provide('llm',{});ctx.provide('tokenMeter',{});ctx.provide('sessions',{});
 const Routed=defaultCompactionClass(installed.BasicCompactionEngine,()=>({provider:'selected',model:'global',effort:'off'}));
 try{const fiber=ctx.plugin(Routed,{auto:false,maxTokens:2048,headroomTokens:8192});await fiber;assert(ctx.compaction instanceof installed.BasicCompactionEngine);assert.equal(ctx.compaction.config.maxTokens,2048);await fiber.dispose();}
 finally{await ctx.fiber.dispose();}
});
test('missing global policy fails before a model call and never invents a paid fallback',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'default-compaction-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.throws(()=>readGlobalModel(root),/ENOENT/);
 fs.mkdirSync(path.join(root,'state/plugins/config'),{recursive:true});
 const file=path.join(root,'state/plugins/config/obs-cost-policy.json');
 fs.writeFileSync(file,JSON.stringify({conversation:{provider:'chosen',model:'selected',effort:''},task:{provider:'worker',model:'separate',effort:''},presets:{}}));
 assert.deepEqual(readGlobalModel(root),{provider:'chosen',model:'selected',effort:''});
 fs.writeFileSync(file,'broken JSON');assert.throws(()=>readGlobalModel(root));
 fs.writeFileSync(file,'{}');assert.throws(()=>readGlobalModel(root),/尚未配置/);
});

test('chat pressure budget caps only its own measurement and scales below smaller models',async()=>{
 const info={context:{contextWindow:1000000},defaultMaxTokens:8192};const ctx={llm:{resolveModelInfo:async()=>info},get(){assert.equal(this,ctx);return 'owned-pruner';}};
 class Base{async summarize(){}async compactIfNeeded(){assert.equal(this.ctx.get('toolResultPruner'),'owned-pruner');return this.ctx.llm.resolveModelInfo('selected','global');}}
 const Chat=defaultCompactionClass(Base,()=>({}),{maxContextTokens:65536}),Task=defaultCompactionClass(Base,()=>({}));
 const chat=await Chat.prototype.compactIfNeeded.call({ctx},{},'pressure');assert.equal(chat.context.contextWindow,65536);assert.equal(info.context.contextWindow,1000000);
 const task=await Task.prototype.compactIfNeeded.call({ctx},{},'pressure');assert.equal(task.context.contextWindow,1000000);
 info.context.contextWindow=32768;assert.equal((await Chat.prototype.compactIfNeeded.call({ctx},{},'pressure')).context.contextWindow,32768);
});
