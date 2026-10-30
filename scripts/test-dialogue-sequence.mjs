import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {ensureDialogueSequences} from '../src/bridge-core/dialogue-sequence.mjs';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {snapshotRecords} from '../plugins/qq-components/obs-context-assembly/message-snapshot.mjs';
test('model snapshot merges incoming and bot records in shared order without repeating a bot history entry',()=>{
 const one={seq:10,dialogueSeq:1},self={isSelf:true,dialogueSeq:2},two={seq:11,dialogueSeq:3};
 const records=snapshotRecords({recent:[one,self,two],receiptWindow:[{...one},{...two}],messages:[two]});assert.deepEqual(records.map(row=>row.dialogueSeq),[1,2,3]);assert.deepEqual(records.filter(row=>!row.isSelf).map(row=>row.seq),[10,11]);
});
test('shared conversation numbers include both directions and preserve receipt identities and stamps',()=>{
 const one={seq:1,time:10,seenAt:1,repliedAt:2},two={seq:2,time:30},bot={isSelf:true,time:20,text:'bot'};
 const st={recentMessages:[one,bot,two],unread:[{...one},{...two}],lastUnreadSeq:2};ensureDialogueSequences(st,{recovered:true});
 assert.deepEqual(st.recentMessages.map(row=>row.dialogueSeq),[1,2,3]);assert.deepEqual(st.unread.map(row=>row.dialogueSeq),[1,3]);assert.equal(st.lastUnreadSeq,2);assert.equal(one.seq,1);assert.equal(one.repliedAt,2);assert.equal(st.lastDialogueSeq,3);
 const saved=JSON.stringify(st);ensureDialogueSequences(st);assert.equal(JSON.stringify(st),saved);
});
test('counter persists beyond buffer eviction and same-text bot sends remain separate',()=>{
 const st={lastDialogueSeq:7,recentMessages:[{isSelf:true,text:'same',time:1},{isSelf:true,text:'same',time:1}],unread:[]};ensureDialogueSequences(st);assert.deepEqual(st.recentMessages.map(row=>row.dialogueSeq),[8,9]);st.recentMessages=[];st.recentMessages.push({seq:1,time:2});ensureDialogueSequences(st);assert.equal(st.recentMessages[0].dialogueSeq,10);
});
test('actual bridge snapshots and restart retain shared numbers without changing incoming seq semantics',async()=>{
 let saved;const h=await bridgeHarness();try{
  h.setMode('reserved2');const key='private:123';h.appendSocialV2Message(key,'用户','one','one',false,false,'m1');h.recordSentMessagesV2(key,['bot']);h.appendSocialV2Message(key,'用户','two','two',false,false,'m2');const st=h.getSocialV2State(key);
  assert.deepEqual(Array.from(st.recentMessages,row=>row.dialogueSeq),[1,2,3]);assert.deepEqual(Array.from(st.unread,row=>row.seq),[1,2]);assert.equal(st.lastUnreadSeq,2);
  const snapshot=h.buildWakeSnapshotV2(key);assert(snapshot.recent.every(row=>Number.isSafeInteger(row.dialogueSeq)));assert(snapshot.messages.every(row=>Number.isSafeInteger(row.dialogueSeq)));
  saved=fs.readFileSync(path.join(h.temp,'state/social-v2.json'),'utf8');assert.equal(JSON.parse(saved).conversations[key].lastDialogueSeq,3);
 }finally{await h.close();}
 const next=await bridgeHarness({files:{'state/social-v2.json':saved}});try{next.setMode('reserved2');next.recordSentMessagesV2('private:123',['after restart']);const st=next.getSocialV2State('private:123');assert.equal(st.recentMessages.at(-1).dialogueSeq,4);assert.equal(st.lastUnreadSeq,2);}finally{await next.close();}
});
