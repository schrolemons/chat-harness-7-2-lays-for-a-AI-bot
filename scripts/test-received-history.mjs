import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createReceivedMessageCache} from '../src/bridge-core/received-history.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
test('received history retains a bounded contiguous tail, full bodies and media references across reloads, isolated by account and conversation',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-received-test-')),writeJson=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data));};
 try{
  const options={root,writeJson,limit:()=>3},cache=createReceivedMessageCache(options),key='group:456';
  for(let id=1;id<=5;id++)assert(cache.record({botUin:'9',key,receivedAt:id,event:{self_id:9,message_id:id,message:[{type:'text',data:{text:'完整正文'.repeat(180)+id}},{type:'image',data:{file:'file-'+id}}]}}));
  assert.equal(cache.record({botUin:'9',key,event:{self_id:9,message_id:5}}),false);
  assert.equal(cache.record({botUin:'9',key,event:{self_id:8,message_id:6}}),false);
  assert.equal(cache.record({botUin:'9',key:'../invalid',event:{}}),false);
  const rows=createReceivedMessageCache(options).read({botUin:'9',key,until:6}).messages;
  assert.deepEqual(rows.map(x=>x.message_id),[3,4,5]);assert.equal(rows[0].message[0].data.text,'完整正文'.repeat(180)+'3');assert.equal(rows[0].message[1].data.file,'file-3');
  assert.equal(cache.read({botUin:'8',key}).messages.length,0);assert.equal(cache.read({botUin:'9',key:'group:457'}).messages.length,0);
 }finally{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('qq-received-test-'));fs.rmSync(root,{recursive:true,force:true});}
});
test('bridge caches receipts before pause, filter and failing image processing, without waking or replying',async()=>{
 const h=await bridgeHarness({config:{snowluma:{botUin:'9'},socialV2:{context:{recentLimit:5}}},globals:{normalizeImageForModel:async()=>{throw Object.assign(Error('fixture media failure'),{code:'EPERM'});}}});
 try{
  h.setMode('reserved2');h.socialV2.paused=true;
  for(let id=1;id<=6;id++)await h.handleIncoming('group',456,{message_id:id,user_id:789,self_id:9,sender:{nickname:'fixture'},message:[{type:'text',data:{text:'普通连续历史 '+id}}]},h.cfg);
  await h.handleIncoming('group',456,{message_id:7,user_id:789,self_id:9,sender:{nickname:'fixture'},message:[{type:'image',data:{file:'fixture.png'}}]},h.cfg);
  await h.handleIncoming('group',456,{message_id:8,user_id:789,self_id:9,sender:{nickname:'fixture'},message:[{type:'text',data:{text:'[自动回复] filtered source retained only in receipt cache'}}]},h.cfg);
  const cache=createReceivedMessageCache({root:path.join(h.temp,'state','received-messages')});
  assert.deepEqual(cache.read({botUin:'9',key:'group:456'}).messages.map(x=>x.message_id),[4,5,6,7,8]);
  assert(!h.getSocialV2State('group:456').recentMessages.some(x=>x.messageId==='8'),'raw caching does not bypass the content filter');
  assert.equal(h.calls.prompts.length,0);assert.equal(h.calls.sent.length,0);
  const history=await h.taskCaps.readLocalConversationHistory({key:'group:456',limit:5,forLookup:true});assert.deepEqual(Array.from(history.messages,x=>x.message_id),[4,5,6,7],'local lookup cannot reintroduce filtered content');
 }finally{await h.close();}
});
