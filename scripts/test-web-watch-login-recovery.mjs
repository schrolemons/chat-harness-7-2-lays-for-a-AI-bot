import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createLoginRecovery,validateLoginPolicy} from '../plugins/qq-components/life-web-watch/login-recovery.mjs';
const site={url:'https://course.example/private/a',name:'课程A'};
function fixture(t,config={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'login-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let now=10000000;const recovery=createLoginRecovery(root,{config,clock:()=>now});return {root,recovery,next(minutes=5){now+=minutes*60000;},now:()=>now};}
test('each failed attempt is immediately noticeable; same-origin pages share the interval and total cap',t=>{
 const f=fixture(t);let r=f.recovery.fail(site);assert.equal(r.attempts,1);assert.equal(r.phase,'waiting');assert.match(f.recovery.pendingNotices()[0].text,/1.*3/);
 assert.equal(f.recovery.fail({...site,url:'https://course.example/private/b'}).attempts,1);
 f.next();r=f.recovery.fail(site);assert.equal(r.attempts,2);f.next();r=f.recovery.fail(site);assert.equal(r.phase,'paused');assert.equal(r.attempts,3);
 assert.equal(f.recovery.get(site.url).notices.length,3);assert.match(f.recovery.pendingNotices().at(-1).text,/重新监管/);
 f.next(24*60);assert.equal(f.recovery.canCheck(site.url),false);assert.equal(f.recovery.fail(site).attempts,3);
});
test('pause and count survive worker replacement; manual retry grants a new independent budget',t=>{
 const f=fixture(t,{loginMaxAttempts:1});f.recovery.fail(site);assert.equal(createLoginRecovery(f.root).get(site.url).phase,'paused');
 const old=f.recovery.get(site.url).generation;f.recovery.retry(site.url);assert.equal(f.recovery.get(site.url).attempts,0);assert.notEqual(f.recovery.get(site.url).generation,old);assert.equal(f.recovery.canCheck(site.url),true);
 assert.equal(f.recovery.fail(site).attempts,1);
});
test('successful background verification resets the next outage; a stale login worker cannot undo a newer retry',t=>{
 const f=fixture(t),old=f.recovery.fail(site);f.recovery.retry(site.url);assert.equal(f.recovery.recovered(site.url,old.generation).ok,false);
 const current=f.recovery.fail(site);assert.equal(f.recovery.recovered(site.url,current.generation).ok,true);assert.equal(f.recovery.get(site.url).attempts,0);
 assert.equal(f.recovery.fail(site).attempts,1);
});
test('bridge boot resets notification opportunities once; component reload and worker processes do not',t=>{
 const f=fixture(t,{loginMaxAttempts:1});f.recovery.beginBoot('boot-a');f.recovery.fail(site);f.recovery.beginBoot('boot-a');assert.equal(f.recovery.get(site.url).phase,'paused');
 f.recovery.beginBoot('boot-b');assert.equal(f.recovery.get(site.url).attempts,0);assert.equal(f.recovery.canCheck(site.url),true);
});
test('notification acknowledgements are per-event and recovery discards old pending reminders',t=>{
 const f=fixture(t),entry=f.recovery.fail(site),notice=f.recovery.pendingNotices()[0];f.recovery.noticeResult(notice.id,true);assert.equal(f.recovery.pendingNotices().length,0);
 f.next();f.recovery.fail(site);assert.equal(f.recovery.pendingNotices().length,1);f.recovery.recovered(site.url,entry.generation);assert.equal(f.recovery.pendingNotices().length,1);assert.match(f.recovery.pendingNotices()[0].text,/无头|后台/);
});
test('limits are configurable, target pause does not block another website, invalid policy is rejected',t=>{
 const f=fixture(t,{loginMaxAttempts:2,loginRetryMinutes:7});f.recovery.fail(site);f.next(6);assert.equal(f.recovery.canCheck(site.url),false);f.next(1);assert.equal(f.recovery.canCheck(site.url),true);assert.equal(f.recovery.fail(site).phase,'paused');assert.equal(f.recovery.canCheck('https://other.example/page'),true);
 for(const config of [{loginMaxAttempts:0},{loginMaxAttempts:2.5},{loginRetryMinutes:0},{loginRetryMinutes:1441}])assert.equal(validateLoginPolicy(config).ok,false);
});

test('login notifications identify the website, link and latest detected failure/recovery times in Beijing',t=>{
 const f=fixture(t);const lost=f.recovery.fail(site);const failure=f.recovery.pendingNotices()[0].text;
 assert(failure.includes(site.name));assert(failure.includes(site.url));assert.match(failure,/最近检测到掉线/);assert.match(failure,/北京时间/);
 f.next(1);f.recovery.recovered(site.url,lost.generation);const recovered=f.recovery.pendingNotices()[0].text;assert(recovered.includes(site.url));assert.match(recovered,/恢复验证时间/);assert.match(recovered,/最近检测到掉线/);
});

test('a transient page-read failure and its recovery are silent',t=>{
 const f=fixture(t);f.recovery.checkFailed(site,'页面为空');assert.equal(f.recovery.pendingNotices().length,0);
 f.next(.05);f.recovery.checkRecovered(site.url);assert.equal(f.recovery.pendingNotices().length,0);
 f.next(10);assert.equal(createLoginRecovery(f.root).pendingNotices().length,0);
});

test('page access failures need a later failed check before notifying, and only delivered failures get a recovery notice',t=>{
 const f=fixture(t);f.recovery.checkFailed(site,'读取失败');f.next(4);f.recovery.checkFailed(site,'仍失败');assert.equal(f.recovery.pendingNotices().length,0);
 f.next(1);f.recovery.checkFailed(site,'仍失败');let notices=f.recovery.pendingNotices();assert.equal(notices.length,1);assert.match(notices[0].text,/访问失败/);
 f.recovery.checkRecovered(site.url);assert.equal(f.recovery.pendingNotices().length,0,'undelivered failure and recovery cancel each other');
 f.recovery.checkFailed(site,'再次失败');f.next();f.recovery.checkFailed(site,'再次确认');notices=f.recovery.pendingNotices();f.recovery.noticeResult(notices[0].id,true);
 f.recovery.checkRecovered(site.url);assert.equal(f.recovery.pendingNotices().length,1);assert.match(f.recovery.pendingNotices()[0].text,/恢复/);
 f.recovery.noticeResult(f.recovery.pendingNotices()[0].id,true);f.recovery.checkRecovered(site.url);assert.equal(f.recovery.pendingNotices().length,0);
});

test('another page on the same origin cannot clear a failed page, and independent failures survive worker replacement',t=>{
 const f=fixture(t),other={url:'https://course.example/private/b',name:'课程B'};
 f.recovery.checkFailed(site,'A失败');f.recovery.checkFailed(other,'B失败');f.recovery.checkRecovered(other.url);
 f.next();const next=createLoginRecovery(f.root,{clock:f.now});next.checkFailed(site,'A仍失败');assert.equal(next.pendingNotices().length,1);assert(next.pendingNotices()[0].text.includes(site.url));
 next.checkRecovered(other.url);assert.equal(next.pendingNotices().length,1);
 assert.equal(next.get(site.url).phase,'ready','page-read errors do not mark the whole login session failed');
});
