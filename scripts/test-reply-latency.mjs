import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {installDynamicChatTools} from '../plugins/qq-agent-presets/dynamic-tools.mjs';
import {compactHistoricalToolResults} from '../plugins/qq-components/obs-context-assembly/tool-history.mjs';
import {validateContextSend} from '../plugins/qq-components/ctx-chat-reply-shape/context-send-policy.mjs';
test('optional context omissions never block a complete response but required order and body checks remain',()=>{
 const base={agent:true,groupContext:[{seq:1,complete:false}],pending:[],requiredSeqs:[3,4]};
 assert.equal(validateContextSend({...base,selectedSeqs:[3]}).ok,true);
 assert.equal(validateContextSend({...base,selectedSeqs:[4]}).reason,'required_reply_order');
 assert.equal(validateContextSend({...base,selectedSeqs:[3],targetIncomplete:true}).reason,'message_context_pending');
 assert.equal(validateContextSend({...base,reason:'memoryWrite',selectedSeqs:[3]}).reason,'maintenance_send_forbidden');
});
test('action receipts and failed read results are never excerpted',()=>{
 const events=[{seq:1,type:'assistant/message',data:{content:[{type:'tool-call',id:'s',name:'mcp__snowluma__qq_send_message'},{type:'tool-call',id:'r',name:'mcp__snowluma__qq_get_recent_messages'}]}},{seq:2,type:'tool/result',data:{message:{toolCallId:'s',content:[{type:'text',text:'发送凭据'.repeat(4000)}]}}},{seq:3,type:'tool/result',data:{message:{toolCallId:'r',isError:true,content:[{type:'text',text:'错误详情'.repeat(4000)}]}}}];
 const session={surface:{nodes:[1,2,3]},eventAt:seq=>events.find(e=>e.seq===seq),append(){assert.fail('critical results cannot be replaced');}};
 assert.equal(compactHistoricalToolResults(session,{keepRecent:0}).count,0);
});
test('model selects a deferred tool; schemas remain scoped, refreshable and isolated across agents',async()=>{
 const hooks={},registry=[];const ctx={tools:{register:t=>registry.push(t)},on:(n,f)=>hooks[n]=f};installDynamicChatTools(ctx);
 const selector=registry[0],a={},b={},core={name:'mcp__snowluma__qq_send_message'},optional={name:'mcp__snowluma__qq_list_voices',description:'语音库'};
 const assemble=(agent,tools=[core,optional,{name:selector.name}])=>hooks['system-prompt/assemble']({},{agent},async()=>({tools,sections:[]}));
 let result=await assemble(a);assert(!result.tools.includes(optional));assert(result.sections[0].text.includes(optional.name.split('__').at(-1)));
 assert.deepEqual(await selector.execute({query:optional.name},{agent:a}),{loaded:[optional.name]});
 assert((await assemble(a)).tools.includes(optional));assert(!(await assemble(b)).tools.includes(optional));
 assert(!(await assemble(a,[core])).tools.includes(optional),'removed permission never returns through selection');
 assert.deepEqual(await selector.execute({query:'pwsh'},{agent:b}),{loaded:[]},'tool outside permission-filtered assembly cannot be selected');
 hooks['agent/status']({agent:a,status:'idle'});assert(!(await assemble(a)).tools.includes(optional));
});
test('historical results shrink with durable replacement while recent results and raw events survive',()=>{
 const original=[1,2,3,4,5,6].map(seq=>({seq,type:'tool/result',data:{turn:1,step:seq,message:{id:'r'+seq,role:'tool',toolCallId:'c'+seq,isError:false,content:[{type:'text',text:'status:'+seq+' '+ '原始资料'.repeat(3000)+' tail-id:'+seq}]}}}));
 const call={seq:0,type:'assistant/message',data:{content:original.map(e=>({type:'tool-call',id:e.data.message.toolCallId,name:'mcp__snowluma__qq_get_recent_messages'}))}};const events=[call,...original],nodes=events.map(e=>e.seq),before=JSON.stringify(original);
 const session={surface:{nodes},eventAt:seq=>events.find(e=>e.seq===seq),append(type,data,intent){const event={seq:events.length+1,type,data};events.push(event);nodes[nodes.indexOf(intent.surfaceOp.startSeq)]=event.seq;}};
 const r=compactHistoricalToolResults(session);assert.equal(r.count,2);assert(r.savedChars>15000);assert.equal(JSON.stringify(original),before);
 assert.deepEqual(nodes.slice(-4),[3,4,5,6]);const m=events[7].data.message;assert.equal(m.toolCallId,'c1');assert.equal(m.isError,false);assert.match(m.content[0].text,/status:1/);assert.match(m.content[0].text,/tail-id:1/);
 assert.equal(compactHistoricalToolResults(session).count,0,'bounded projection is idempotent');
});
test('chat pressure threshold leaves room above retained history and limits repeated summary attempts',()=>{
 for(const name of ['qq-chat','qq-chat-v2','qq-admin']){const text=fs.readFileSync(new URL('../plugins/qq-agent-presets/presets/'+name+'.patch.yml',import.meta.url),'utf8');assert.match(text,/thresholdRatio: 0\.65/);assert.match(text,new RegExp('retainTokens: '+(name==='qq-chat'?12000:6000)));assert.match(text,/compactionRetries: 0/);}
});
