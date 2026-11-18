import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {compactMessageReadResult,compactGroundedMessageResults} from '../plugins/qq-components/obs-context-assembly/grounded-tool-history.mjs';
const nativeRoot=JSON.parse(fs.readFileSync(new URL('../workspace.local.json',import.meta.url))).dshSourceRepository;
const {Session,SessionId}=await import(pathToFileURL(path.join(nativeRoot,'packages/core/session/lib/index.js')).href);
const {createMessage,createToolResultMessage,ToolCallId,createUserMessage}=await import(pathToFileURL(path.join(nativeRoot,'packages/llm/llm/lib/index.js')).href);
const key='group:456',row={seq:1287,messageId:'-288770930',userId:'789',sender:'群友',text:'[引用 上文原话]怎么疼爱你呀'.repeat(80),bodyComplete:true,seenAt:100};

test('duplicate body removal preserves read cursor, obligations, quote data and unknown metadata',()=>{
 const input={ok:true,key,readThroughSeq:1287,pendingSeqs:[1287],messages:[{...row,replyRequirement:'required',extra:'不能删的新元数据'}]};const before=JSON.stringify(input);
 const result=compactMessageReadResult(input,[row]);assert.equal(result.messages[0].text,undefined);assert.equal(result.messages[0].messageId,row.messageId);assert.equal(result.messages[0].replyRequirement,'required');assert.equal(result.messages[0].extra,'不能删的新元数据');assert.equal(result.readThroughSeq,1287);assert.deepEqual(result.pendingSeqs,[1287]);assert.equal(JSON.stringify(input),before);
});

test('different sender, body, identity, partial quote or absent canonical body never disappear',()=>{
 for(const other of [{...row,text:'别的原话'},{...row,messageId:'different'},{...row,userId:'999'},{...row,truncated:true},{...row,bodyComplete:false},{...row,unresolvedReplyIds:['missing']}])assert.equal(compactMessageReadResult({key,messages:[row]},[other]),null);
 assert.equal(compactMessageReadResult({key,messages:[{...row,truncated:true}]},[row]),null);
});

test('native current-turn read results may deduplicate only after exact authenticated dialogue exists and replay remains valid',()=>{
 const session=Session.create(SessionId('grounded-current-turn'));session.append('turn/start',{turn:1});session.append('step/start',{turn:1,step:1});const callId=ToolCallId('wait-result');
 session.append('assistant/message',{turn:1,step:1,stream:[],message:createMessage({role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'tool-call',id:callId,name:'mcp__snowluma__qq_wait_for_messages',arguments:'{}'}]})},{surfaceOp:'append'});
 const raw=session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:[{type:'text',text:JSON.stringify({ok:true,key,newMessages:[row],readThroughSeq:1287,arrived:true})}],isError:false})},{surfaceOp:'append'}),original=JSON.stringify(raw);
 const dialogue=createUserMessage({content:[{type:'text',text:'【新增 QQ 消息数据】\n'+JSON.stringify([row])}],source:{kind:'qq-context-dialogue',key}});
 assert.equal(compactGroundedMessageResults(session,{key,messages:[]}).count,0);
 const stats=compactGroundedMessageResults(session,{key,messages:[dialogue]});assert.equal(stats.count,1);assert(stats.savedChars>1000);assert.equal(JSON.stringify(raw),original);
 const projected=session.eventAt(session.surface.nodes.at(-1));assert.deepEqual({...projected.data,message:{...projected.data.message,content:null}},{...raw.data,message:{...raw.data.message,content:null}});
 assert.equal(compactGroundedMessageResults(session,{key,messages:[dialogue]}).count,0);
 assert.deepEqual(Session.create(session.id,structuredClone(session.snapshotEvents())).deriveMessages(),session.deriveMessages());
 assert.equal(compactGroundedMessageResults(session,{key:'group:999',messages:[dialogue]}).count,0);
});
