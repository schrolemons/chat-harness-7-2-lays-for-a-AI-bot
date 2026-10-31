import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordEnrollment, pendingEnrollments } from './ustc-course-policy.mjs';
import { dispatchOwnerChanges } from './ustc-notifications.mjs';

function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ustc-notify-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));recordEnrollment(dir,{bgbm:'one',title:'报告',time:'2099-01-01 10:00'});return dir;}

test('failed QQ delivery is retried by the next process without re-enrollment',async t=>{
 const dir=setup(t),state={};let sent=[];
 const failed=await dispatchOwnerChanges({dir,state,changes:[],send:async()=>false});
 assert.equal(failed.sent,false);assert.equal(pendingEnrollments(dir).length,1);assert.equal(state.notifiedGrab?.one,undefined);
 const next=await dispatchOwnerChanges({dir,state,changes:[],send:async text=>{sent.push(text);return true}});
 assert.equal(next.sent,true);assert.equal(sent.length,1);assert.ok(sent[0].includes('报告'));
 assert.equal(pendingEnrollments(dir).length,0);assert.ok(state.notifiedGrab.one);
 await dispatchOwnerChanges({dir,state,changes:[],send:async text=>{sent.push(text);return true}});
 assert.equal(sent.length,1);
});

test('login reminder cooldown never suppresses an enrollment success',async t=>{
 const dir=setup(t),state={lastLoginNoticeAt:Date.now()};let text='';
 await dispatchOwnerChanges({dir,state,changes:[{kind:'login',msg:'需要登录'}],send:async x=>{text=x;return true}});
 assert.ok(text.includes('已抢到报告'));assert.ok(!text.includes('需要登录'));
 assert.equal(pendingEnrollments(dir).length,0);
});
