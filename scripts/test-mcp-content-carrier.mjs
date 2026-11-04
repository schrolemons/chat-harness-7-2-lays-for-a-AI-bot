import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('send tool contracts require explicit grouping before a one-message answer to several inputs',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 const field=createReplyContentCarrier().decorate('qq_send_message',['send',{},async()=>{}])[1].contentId.description;
 assert.match(field,/多条来信/);assert.match(field,/只发一条/);assert.match(field,/先.*qq_reply_contents/);assert.match(field,/显式.*contentId/);
 const source=fs.readFileSync(new URL('../src/mcp-snowluma-safe.js',import.meta.url),'utf8');
 for(const name of ['qq_send_message','qq_reply']){
  const description=source.match(new RegExp("'"+name+"',\\s*'([^']+)'"))?.[1];
  assert.match(description,/先.*qq_reply_contents/);assert.match(description,/contentId/);
 }
});
test('send tools expose one semantic content id and concurrent calls carry independent source scopes',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 const carrier=createReplyContentCarrier(),observed=[];
 const original=['send description',{message:{}},async input=>{await new Promise(r=>setTimeout(r,input.delay));observed.push(carrier.headers({}).get('x-reply-content-id'));}];
 const decorated=carrier.decorate('qq_send_message',original);
 assert(decorated[1].contentId);assert.equal(original[1].contentId,undefined);
 await Promise.all([decorated[2]({contentId:'content:a',delay:10}),decorated[2]({contentId:'content:b',delay:0})]);
 assert.deepEqual(observed,['content:b','content:a']);assert.equal(carrier.headers({}).get('x-reply-content-id'),null);
 assert.equal(carrier.decorate('qq_get_recent_messages',original),original);
 for(const name of ['qq_schedule','qq_task_spawn','qq_task_input','qq_task_cancel'])assert(carrier.decorate(name,original)[1].contentId);
 for(const name of ['qq_diary','qq_task_list','qq_task_result','worklog_history','diary_history','diary_read'])assert.equal(carrier.decorate(name,original),original);
});
test('a new send without a content id cannot inherit a previous call id',async()=>{
 const {createReplyContentCarrier}=await import('../src/mcp-content-carrier.mjs');
 const carrier=createReplyContentCarrier(),seen=[];
 const decorated=carrier.decorate('qq_send_sticker',['sticker',{},async()=>seen.push(carrier.headers({}).get('x-reply-content-id'))]);
 await decorated[2]({contentId:'content:a'});await decorated[2]({});assert.deepEqual(seen,['content:a',null]);
 assert.throws(()=>decorated[1].contentId.parse('bad\r\nheader'));
});
