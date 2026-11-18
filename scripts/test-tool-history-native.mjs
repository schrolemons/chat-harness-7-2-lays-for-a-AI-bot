import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {compactHistoricalToolResults} from '../plugins/qq-components/obs-context-assembly/tool-history.mjs';
const nativeRoot=process.env.DSH_NATIVE_TEST_ROOT||JSON.parse(fs.readFileSync(new URL('../workspace.local.json',import.meta.url))).dshSourceRepository;
const {Session,SessionId}=await import(pathToFileURL(path.join(nativeRoot,'packages/core/session/lib/index.js')).href);
const {createMessage,createToolResultMessage,ToolCallId}=await import(pathToFileURL(path.join(nativeRoot,'packages/llm/llm/lib/index.js')).href);
test('native session accepts excerpt without changing result identity and replays it losslessly',()=>{
 const session=Session.create(SessionId('latency-native-excerpt'));
 session.append('turn/start',{turn:1});
 session.append('step/start',{turn:1,step:1});
 const callId=ToolCallId('read-history');
 session.append('assistant/message',{turn:1,step:1,stream:[],message:createMessage({role:'assistant',content:[{type:'tool-call',id:callId,name:'mcp__snowluma__qq_get_recent_messages',arguments:'{}'}],source:{kind:'model',provider:'test',model:'test'}})},{surfaceOp:'append'});
 const original=session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:[{type:'text',text:'完整聊天记录'.repeat(3000)}],isError:false})},{surfaceOp:'append'});
 const before=JSON.stringify(original),stats=compactHistoricalToolResults(session,{keepRecent:0});
 assert.equal(stats.count,1);assert(stats.savedChars>10000);assert.equal(JSON.stringify(original),before);
 const replacement=session.eventAt(session.surface.nodes.at(-1));
 assert.deepEqual({...replacement.data,message:{...replacement.data.message,content:null}},{...original.data,message:{...original.data.message,content:null}});
 assert.equal(compactHistoricalToolResults(session,{keepRecent:0}).count,0);
 const replay=Session.create(SessionId('latency-native-replay'),structuredClone(session.snapshotEvents()));
 assert.deepEqual(replay.deriveMessages(),session.deriveMessages());
});

test('completed-turn affair reads are excerpted but action receipts and current reads stay complete',()=>{
 const session=Session.create(SessionId('affairs-read-excerpt')),results=[];
 for(const [turn,action]of [[1,'list'],[2,'upsert'],[3,'list']]){
  session.append('turn/start',{turn});session.append('step/start',{turn,step:1});const callId=ToolCallId('affair-'+turn);
  session.append('assistant/message',{turn,step:1,stream:[],message:createMessage({role:'assistant',content:[{type:'tool-call',id:callId,name:'mcp__snowluma__qq_task_note',arguments:JSON.stringify({action})}],source:{kind:'model',provider:'test',model:'test'}})},{surfaceOp:'append'});
  results.push(session.append('tool/result',{turn,step:1,message:createToolResultMessage({callId,content:[{type:'text',text:'完整事务资料'.repeat(1000)}],isError:false})},{surfaceOp:'append'}));
 }
 assert.equal(compactHistoricalToolResults(session,{keepRecent:0,currentTurn:3}).count,1);
 const messages=session.deriveMessages().filter(m=>m.role==='tool');assert.match(messages[0].content[0].text,/历史工具结果节选/);assert.equal(messages[1].content[0].text,results[1].data.message.content[0].text);assert.equal(messages[2].content[0].text,results[2].data.message.content[0].text);
 assert.deepEqual(Session.create(session.id,structuredClone(session.snapshotEvents())).deriveMessages(),session.deriveMessages());
});

test('a long waiting turn prunes older read snapshots, keeping recent steps, errors and sends intact',()=>{
 const session=Session.create(SessionId('current-turn-history'));session.append('turn/start',{turn:1});const originals=[];
 for(const [step,name,error]of [[1,'qq_wait_for_messages',false],[2,'qq_get_prompt',false],[3,'qq_send_message',false],[4,'qq_wait_for_quiet',true],[7,'qq_get_recent_messages',false],[8,'qq_wait_for_messages',false]]){
  session.append('step/start',{turn:1,step});const callId=ToolCallId('read-'+step);
  session.append('assistant/message',{turn:1,step,stream:[],message:createMessage({role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'tool-call',id:callId,name:'mcp__snowluma__'+name,arguments:'{}'}]})},{surfaceOp:'append'});
  originals.push(session.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:[{type:'text',text:'完整旧读取快照'.repeat(3000)}],isError:error})},{surfaceOp:'append'}));
 }
 const raw=JSON.stringify(originals),stats=compactHistoricalToolResults(session,{currentTurn:1,currentStep:9,keepCurrentSteps:2,keepRecent:0,maxChars:800});
 assert.equal(stats.count,2);assert(stats.savedChars>30000);assert.equal(JSON.stringify(originals),raw);
 const messages=session.deriveMessages().filter(m=>m.role==='tool');assert.match(messages[0].content[0].text,/过去步骤的读取快照/);assert(messages[0].content[0].text.length<1000);
 for(const index of[2,3,4,5])assert.equal(messages[index].content[0].text,originals[index].data.message.content[0].text);
 assert.deepEqual(Session.create(session.id,structuredClone(session.snapshotEvents())).deriveMessages(),session.deriveMessages());
});
