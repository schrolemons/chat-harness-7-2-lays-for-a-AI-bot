import test from 'node:test';
import assert from 'node:assert/strict';
test('send tools expose one semantic content id and concurrent calls carry independent source scopes',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 const carrier=createReplyContentCarrier(),observed=[];
 const original=['send description',{message:{}},async input=>{await new Promise(r=>setTimeout(r,input.delay));observed.push(carrier.headers({}).get('x-reply-content-id'));}];
 const decorated=carrier.decorate('qq_send_message',original);
 assert(decorated[1].contentId);assert.equal(original[1].contentId,undefined);
 await Promise.all([decorated[2]({contentId:'content:a',delay:10}),decorated[2]({contentId:'content:b',delay:0})]);
 assert.deepEqual(observed,['content:b','content:a']);assert.equal(carrier.headers({}).get('x-reply-content-id'),null);
 assert.equal(carrier.decorate('qq_get_recent_messages',original),original);
 for(const name of ['qq_schedule','qq_diary','qq_task_spawn','qq_task_input','qq_task_result'])assert(carrier.decorate(name,original)[1].contentId);
});
test('a new send without a content id cannot inherit a previous call id',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 const carrier=createReplyContentCarrier(),seen=[];
 const decorated=carrier.decorate('qq_send_sticker',['sticker',{},async()=>seen.push(carrier.headers({}).get('x-reply-content-id'))]);
 await decorated[2]({contentId:'content:a'});await decorated[2]({});assert.deepEqual(seen,['content:a',null]);
 assert.throws(()=>decorated[1].contentId.parse('bad\r\nheader'));
});
