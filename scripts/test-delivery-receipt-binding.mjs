import test from 'node:test';
import assert from 'node:assert/strict';
import {registerSuccessfulReplyV2} from '../src/bridge-core/receipt-state.js';

test('a confirmed exact quote records delivery without inventing read or reply stamps',()=>{
 const msg={seq:1,messageId:'-9001'},st={unread:[msg]};
 registerSuccessfulReplyV2(st,{replyToMessageId:-9001,at:100});
 assert.deepEqual(st.receiptSendPendingSeqs,[1]);assert.equal(st.receiptSendPendingAt,100);
 assert.equal(msg.seenAt,undefined);assert.equal(msg.repliedAt,undefined);
 st.unread.push({seq:2,messageId:'-9002'});
 assert.deepEqual(st.receiptSendPendingSeqs,[1],'later arrivals cannot inherit old delivery evidence');
});

test('unknown quotes and cold, rejected or self messages never acquire delivery evidence',()=>{
 const st={unread:[{seq:1,messageId:'1'},{seq:2,messageId:'2',quotaAdmission:'pending'},{seq:3,messageId:'3',quotaAdmission:'rejected'},{seq:4,messageId:'4',budgetDisposition:'outside-cold-window'},{seq:5,messageId:'5',isSelf:true}]};
 for(const id of ['unknown','2','3','4','5'])registerSuccessfulReplyV2(st,{replyToMessageId:id});
 assert.deepEqual(st.receiptSendPendingSeqs,[]);
});

test('unquoted sends retain only already-seen pending inputs and remain idempotent',()=>{
 const st={unread:[{seq:1,messageId:'1',seenAt:10},{seq:2,messageId:'2'},{seq:3,messageId:'3',seenAt:10,repliedAt:20}]};
 registerSuccessfulReplyV2(st,{at:50});registerSuccessfulReplyV2(st,{at:60});
 assert.deepEqual(st.receiptSendPendingSeqs,[1]);assert.equal(st.unread[1].seenAt,undefined);
});
