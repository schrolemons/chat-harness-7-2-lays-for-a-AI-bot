import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {zstdCompressSync} from 'node:zlib';
import {enrichRequestProvenance,readMessageProvenance} from '../plugins/qq-components/obs-context-assembly/provenance.mjs';
import {attributeMessage,messageLabel,unmatchedLabel} from '../console/layers/O/context-attribution.js';
import {recordDetails} from '../console/layers/O/context-records.js';
import {inspectorHtml} from '../console/layers/O/context-inspector.js';

const sessionId='session-22222222-2222-2222-2222-222222222222';
function fixture(events,run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-context-sources-'));
 try{
  const home=path.join(root,'home'),dir=path.join(home,'sessions','test',sessionId);
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(root,'workspace.local.json'),JSON.stringify({dshHome:home}));
  const file=path.join(dir,'session.v4.jsonl.zstd');fs.writeFileSync(file,zstdCompressSync(Buffer.from(events.map(x=>JSON.stringify(x)).join('\n')+'\n')));
  return run(root,file);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
const system=(id,text)=>({id,role:'system',source:{kind:'system-prompt'},content:[{type:'text',text}]});

test('archive example is the last pair actually folded into that archive, never newer retained failures',()=>{
 const call=n=>({seq:n*10,type:'assistant/message',data:{message:{id:'call-'+n,role:'assistant',content:[{type:'tool-call',id:'c'+n,name:'qq_reply',arguments:JSON.stringify({message:'失败'+n,token:'SECRET_TOKEN',extra:JSON.stringify({api_key:'SECRET_NESTED'})})}]}}});
 const result=n=>({seq:n*10+1,type:'tool/result',data:{message:{id:'result-'+n,role:'tool',toolCallId:'c'+n,isError:true,content:[{type:'text',text:'Error: 失败'+n}]}}});
 const replace=(seq,target,id,kind='qq-context-retired')=>({seq,type:kind==='qq-context-tool-history'?'user/message':'developer/message',surfaceOp:{op:'replace',startSeq:target,endSeq:target},data:{message:{id,role:'user',source:{kind,reason:'repeated-tool-failure',...(kind==='qq-context-tool-history'?{toolName:'qq_reply',code:'TOOL_ERROR',count:3}:{})},content:[]}}});
 const events=[1,2,3,4,5].flatMap(n=>[call(n),result(n)]);
 events.push(replace(60,10,'archive-a','qq-context-tool-history'),replace(61,11,'result-1'),replace(62,20,'call-2'),replace(63,21,'result-2'),replace(64,30,'call-3'),replace(65,31,'result-3'),{seq:66,type:'request/header',data:{}},call(7),result(7),replace(80,40,'archive-b','qq-context-tool-history'),replace(81,41,'result-4'),{seq:82,type:'request/header',data:{}});
 fixture(events,root=>{
  const archive=id=>({id,role:'user',source:'qq-context-tool-history',text:'归档'}),request={sessionId,messages:[archive('archive-a'),archive('archive-b')]},before=JSON.stringify(request),enriched=enrichRequestProvenance(root,request);
  const first=enriched.messages[0].archivedFailure,last=enriched.messages[1].archivedFailure;
  assert(first,'restore a pair explicitly replaced by archive-a');assert.equal(first.callId,'c3');assert.equal(first.callEventSeq,30);assert.equal(first.resultEventSeq,31);assert.match(first.errorText,/失败3/);
  assert.equal(last.callId,'c4');assert.equal(first.archiveId,'archive-a');assert(!JSON.stringify(first).includes('失败5'));assert(!JSON.stringify(first).includes('失败7'));assert(!JSON.stringify(first).includes('SECRET_'));assert.equal(JSON.stringify(request),before);
 });
});

test('native confirmed sends recover dialogue identities and summary history without changing the request',()=>{
 const args={key:'group:12',message:'归档 bot 原话'},events=[{seq:1,type:'assistant/message',time:1000,data:{turn:1,step:1,message:{id:'call',role:'assistant',content:[{type:'tool-call',id:'send-648',name:'qq_reply',arguments:JSON.stringify(args)}]}}},
 {seq:2,type:'tool/result',time:2000,data:{turn:1,step:1,message:{id:'return',role:'tool',toolCallId:'send-648',content:[{type:'text',text:'{"ok":true,"key":"group:12","sent":1,"failed":0}'}]}}},
 {seq:3,type:'user/message',data:{id:'dialogue',role:'user',source:{kind:'qq-context-dialogue',key:'group:12'},content:[{type:'text',text:'【历史 QQ 消息数据】\n[{"dialogueSeq":648,"isSelf":true,"text":"归档 bot 原话","time":1999}]'}]}},
 {seq:4,type:'compaction/summary',data:{compactionId:'c',shadowedSeqs:[1,2,3]}},{seq:5,type:'user/message',data:{id:'summary-old',source:{kind:'compact-checkpoint',compactionId:'c'},content:[]}},
 {seq:6,type:'user/message',surfaceOp:{op:'replace',startSeq:5,endSeq:5},data:{id:'summary-old',source:{kind:'qq-context-stable',baseSource:{kind:'compact-checkpoint',compactionId:'c'}},content:[]}},
 {seq:7,type:'compaction/summary',data:{compactionId:'c2',shadowedSeqs:[6]}},{seq:8,type:'user/message',data:{id:'summary',source:{kind:'compact-checkpoint',compactionId:'c2'},content:[]}}];
 fixture(events,root=>{
  const request={sessionId,key:'group:12',messages:[{id:'summary',role:'user',source:'compact-checkpoint',text:'摘要'}]},before=JSON.stringify(request),enriched=enrichRequestProvenance(root,request);
  assert.equal(enriched.archivedDeliveries[0].dialogueSeq,648);assert.equal(enriched.archivedDeliveries[0].text,'归档 bot 原话');assert.equal(enriched.archivedDeliveries[0].summaryId,'summary');assert.equal(JSON.stringify(request),before);
  const live=enrichRequestProvenance(root,{sessionId,key:'group:12',messages:[{id:'return',role:'tool',toolResults:[{toolCallId:'send-648'}],text:'{"ok":true,"sent":1}'}]});assert.equal(live.messages[0].deliveryRecords[0].dialogueSeq,648);assert.equal(live.archivedDeliveries.length,0);
 });
});

test('generation provenance follows native turns and task sources, not later surface replacements',()=>{
 const input={id:'qq-in',role:'user',source:{kind:'qq-context-dialogue',reason:'message'},content:[{type:'text',text:'SECRET_QQ_BODY'}]};
 const task={id:'task',role:'user',source:{kind:'qq-context-task',reason:'message'},content:[{type:'text',text:'SECRET_TASK'}]};
 const assistant=id=>({id,role:'assistant',content:[]});
 fixture([{seq:1,type:'turn/start',data:{turn:98}},{seq:2,type:'step/start',data:{turn:98,step:1}},
  {seq:3,type:'user/message',surfaceOp:'append',data:input},{seq:4,type:'user/message',surfaceOp:'append',data:task},
  {seq:5,type:'assistant/message',data:{turn:98,step:1,message:assistant('a1')}},
  {seq:6,type:'tool/result',data:{turn:98,step:1,message:{id:'error',role:'tool',toolCallId:'failed',content:[{type:'text',text:'{"ok":false,"code":"message_context_pending","token":"SECRET_TOKEN"}'}]}}},
  {seq:7,type:'step/start',data:{turn:98,step:2}},
  {seq:8,type:'user/message',surfaceOp:{op:'replace',startSeq:3,endSeq:3},data:{id:'archive',role:'user',source:{kind:'qq-context-tool-history',reason:'repeated-tool-failure'},content:[]}},
  {seq:9,type:'assistant/message',data:{turn:98,step:2,message:assistant('a2')}},
  {seq:10,type:'turn/end',data:{turn:98}},{seq:11,type:'turn/start',data:{turn:99}},{seq:12,type:'step/start',data:{turn:99,step:1}},
  {seq:13,type:'user/message',data:{...task,id:'periodic',source:{kind:'qq-context-task',reason:'proactiveCheck'}}},
  {seq:14,type:'assistant/message',data:{turn:99,step:1,message:assistant('a3')}}],root=>{
   const map=readMessageProvenance(root,sessionId),a=map.get('a2').generation;
   assert.equal(a.turn,98);assert.equal(a.reason,'message');assert.deepEqual(a.inputs,[{id:'qq-in',eventSeq:3,kind:'qq-context-dialogue'}]);
   assert.equal(a.toolInputs[0].id,'error');assert.equal(a.toolInputs[0].code,'message_context_pending');
   assert.equal(map.get('a3').generation.reason,'proactiveCheck');assert.equal(map.get('a3').generation.inputs[0].id,'periodic');
   assert(!JSON.stringify([...map]).includes('SECRET_'));
  });
});

test('preset origin follows the recorded session selection, preserves text and refuses stale definitions',()=>{
 const events=[{type:'session',agentPreset:'old'}, {seq:1,type:'system/message',data:{message:system('s1','旧提示')}}, {seq:2,type:'agent-preset/selected',data:{agentPreset:'new'}}, {seq:3,type:'system/message',data:{message:system('s2','前部\n新提示\n后部')}}];
 fixture(events,(root,file)=>{
  for(const [id,prefix]of [['old','已修改的旧提示'],['new','新提示']]){const dir=path.join(root,'dsh/agent-presets',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'agent.cordis.yml'),JSON.stringify([{id:'persona',name:'@deepseek-ai/dsh-persona',config:{prefix}}]));}
  const request={sessionId,messages:[{id:'s1',role:'system',source:'system-prompt',text:'旧提示'},{id:'s2',role:'system',source:'system-prompt',text:'前部\n新提示\n后部'}]},before=JSON.stringify(request),log=fs.readFileSync(file);
  const enriched=enrichRequestProvenance(root,request);
  assert.equal(enriched.messages[0].provenance?.agentPreset,'old');
  assert.equal(enriched.messages[1].provenance?.agentPreset,'new');
  assert.equal(enriched.messages[0].sourceAttribution.ranges.length,0,'changed files cannot explain historical text');
  const ranges=enriched.messages[1].sourceAttribution.ranges;
  assert.equal(ranges.length,1);assert.equal(request.messages[1].text.slice(ranges[0].start,ranges[0].end),'新提示');
  assert.equal(ranges[0].source,'dsh/agent-presets/new/agent.cordis.yml');assert.equal(ranges[0].basis,'current-definition');
  assert(enriched.sourceModules.some(row=>row.id===ranges[0].id));
  assert.equal(JSON.stringify(request),before);assert.deepEqual(fs.readFileSync(file),log);
  const parts=attributeMessage(enriched.messages[1]);assert.equal(parts.map(x=>x.text).join(''),request.messages[1].text);assert.equal(parts.filter(x=>x.owners.length)[0].owners[0].source,ranges[0].source);
 });
});

test('durable source metadata exposes files and compaction range without returning log prose or secrets',()=>{
 const events=[{type:'session',agentPreset:'qq-chat-v2'},
  {seq:5,type:'user/message',data:{id:'instructions',source:{kind:'agent-instructions',changes:[{path:'project/AGENTS.md',action:'set',scope:'project',text:'SECRET_SOURCE_BODY'}]},content:[{type:'text',text:'SECRET_LOG_BODY'}]}},
  {seq:6,type:'compaction/start',data:{compactionId:'compact-a',turn:4}},
  {seq:7,type:'compaction/summary',data:{compactionId:'compact-a',provider:'test-provider',model:'test-model',shadowedRange:{start:1,end:4},shadowedSeqs:[1,2,4],summary:'SECRET_SUMMARY',rawOutput:'SECRET_RAW'}},
  {seq:8,type:'user/message',data:{id:'summary',source:{kind:'compact-checkpoint',compactionId:'compact-a'},content:[{type:'text',text:'压缩后的文字'}]}}
 ];
 fixture(events,root=>{
  const data=readMessageProvenance(root,sessionId);assert(!JSON.stringify([...data]).includes('SECRET_'));
  assert.equal(data.get('instructions')?.source.changes?.[0]?.path,'project/AGENTS.md');
  const request=enrichRequestProvenance(root,{sessionId,messages:[{id:'instructions',role:'user',source:'agent-instructions',text:'规则'},{id:'summary',role:'user',source:'compact-checkpoint',text:'压缩后的文字'}]});
  const summary=request.messages[1].provenance.compaction;assert.equal(summary.summarySeq,7);assert.equal(summary.model,'test-model');assert.deepEqual(summary.shadowedRange,{start:1,end:4});assert.equal(summary.mode,'automatic');
  assert.match(messageLabel(request.messages[1]),/自动压缩/);
  const html=recordDetails(request.messages[1]);for(const term of ['test-model','1–4','compact-a'])assert(html.includes(term),term);
  assert.match(recordDetails(request.messages[0]),/project\/AGENTS\.md/);
 });
});

test('summary producers own their entire text even if it quotes a component verbatim',()=>{
 const modules=[{id:'role-card',name:'角色',text:'引用的旧规则'}],message={role:'user',source:'compact-checkpoint',text:'摘要：引用的旧规则'};
 const parts=attributeMessage(message,modules,modules);
 assert.equal(parts.map(x=>x.text).join(''),message.text);assert(parts.every(x=>x.owners.every(o=>o.id!=='role-card')));
 assert.match(parts[0].owners[0].name,/压缩摘要/);
 assert.match(unmatchedLabel(message).description,/触发.*未记录/,'source marker alone cannot establish automatic versus manual compaction');
 for(const [source,title]of [['agent-instructions',/工作区指令/],['skill-catalog',/技能目录/],['qq-context-tool-history',/错误.*归档/]]){
  assert.match(messageLabel({role:'user',source}),title);assert(!unmatchedLabel({role:'user',source}).title.includes('未记录'));
 }
});

test('source inventory includes captured extra components and preset origins without assigning invented C numbers',()=>{
 const request={messages:[],modules:[{id:'extra-owner',name:'额外组件',source:'plugins/qq-components/extra-owner/index.js',text:'已采集',included:true,inRequest:true}],sourceModules:[{id:'preset:fixture:prefix',name:'预设 fixture',source:'dsh/agent-presets/fixture/agent.cordis.yml',text:'预设原文',included:true,inRequest:true}]};
 const html=inspectorHtml(request,[{id:'role-card',name:'角色'}],{view:'components',selected:'component:preset:fixture:prefix'},{renderText:text=>text,renderComponent:row=>row.text});
 assert(html.includes('component:extra-owner'));assert(html.includes('component:preset:fixture:prefix'));assert(html.includes('dsh/agent-presets/fixture/agent.cordis.yml'));
 assert(!html.includes('组件 C02'));assert(!html.includes('40 个组件来源'));
});

test('partial historical preset matches do not absorb changed paragraphs or interpolated values',()=>{
 const same='这是一段保持一致的预设工具协议，要求核对真实回执，并且不会把模型内部文字视为已发送。';
 fixture([{type:'session',agentPreset:'fixture'},{seq:1,type:'system/message',data:{message:system('s','旧版规则\n\n'+same+'\n模型是 test-model')}}],root=>{
  const dir=path.join(root,'dsh/agent-presets/fixture');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'agent.cordis.yml'),JSON.stringify([{id:'persona',name:'@deepseek-ai/dsh-persona',config:{prefix:'新版规则\n\n'+same+'\n模型是 {{model}}'}}]));
  const request=enrichRequestProvenance(root,{sessionId,messages:[{id:'s',role:'system',source:'system-prompt',text:'旧版规则\n\n'+same+'\n模型是 test-model'}]});
  const parts=attributeMessage(request.messages[0]);assert(parts.some(x=>x.owners.length&&x.text.includes(same)));assert(parts.filter(x=>!x.owners.length).some(x=>x.text.includes('旧版规则')));assert(parts.filter(x=>!x.owners.length).some(x=>x.text.includes('test-model')));
 });
});

test('manual, standalone and unknown compression are never presented as automatic',()=>{
 assert.match(messageLabel({source:'compact-checkpoint',provenance:{source:{sourceCommandId:'command-x'}}}),/手动/);
 assert(!messageLabel({source:'compact-checkpoint',provenance:{compaction:{mode:'standalone'}}}).includes('自动'));
 assert(!messageLabel({source:'compact-checkpoint'}).includes('自动'));
});

test('unknown source names cannot inherit producer identities from Object.prototype',()=>{
 for(const source of ['constructor','__proto__','toString']){
  const message={role:'user',source,text:'未确认的来源'};
  assert.equal(messageLabel(message),'会话输入记录');assert.match(unmatchedLabel(message).title,/未记录/);
  assert.equal(attributeMessage(message).filter(row=>row.owners.length).length,0);
 }
});

test('native skill invocation retains the exact skill name as concise source identity',()=>{
 fixture([{seq:1,type:'user/message',data:{id:'skill',source:{kind:'skill-invocation',name:'fixture-skill',form:'instructions'},content:[{type:'text',text:'技能原文'}]}}],root=>{
  const request=enrichRequestProvenance(root,{sessionId,messages:[{id:'skill',role:'user',source:'skill-invocation',text:'技能原文'}]});
  assert.equal(request.messages[0].provenance?.source?.name,'fixture-skill');assert.match(recordDetails(request.messages[0]),/fixture-skill/);
 });
});

test('source details keep the source path and omit verbose attribution boilerplate',()=>{
 const message={role:'system',source:'system-prompt',text:'规则',sourceAttribution:{presetId:'fixture'}};
 const html=recordDetails(message);assert(html.includes('fixture'));assert(!html.includes('其余保留为未确认'));
 assert(!recordDetails({role:'user',source:'compact-checkpoint'}).includes('不能把其中引用的文字'));
});
