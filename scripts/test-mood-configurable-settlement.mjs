import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPluginHost} from '../src/plugin-host.js';
import {moodPolicy,validateMoodConfig} from '../plugins/qq-components/ctx-user-mood/policy.mjs';
import {replayHistory} from '../plugins/qq-components/ctx-user-mood/history.mjs';

const id='ctx-user-mood',key='private:123',minute=60000,day=86400000;
const at=time=>Date.parse('2026-11-01T'+time+':00+08:00');
async function fixture(t,config={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mood-config-'));
  fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  fs.cpSync(new URL('../plugins/qq-components/ctx-user-mood',import.meta.url),path.join(root,'plugins/qq-components',id),{recursive:true});
  fs.mkdirSync(path.join(root,'state/plugins/config'),{recursive:true});
  fs.writeFileSync(path.join(root,'state/plugins/config',id+'.json'),JSON.stringify(config));
  const host=createPluginHost({root,startTimers:false});await host.loadAll();
  t.after(async()=>{await host.dispose();fs.rmSync(root,{recursive:true,force:true});});
  const call=(method,payload={})=>host.callService('mood',method,payload);
  return {host,call,read:(k=key)=>call('read',{key:k}),
    sent:(extra={})=>call('sent',{key,deliveryId:'d',proactiveId:'p',wakeReason:'proactiveCheck',sentAt:at('10:00'),success:true,expectsReply:true,...extra}),
    configure:async patch=>{assert.equal(host.setConfig(id,patch).ok,true);await host.reload(id);}};
}

test('settlement settings keep defaults and accept explicit zero values',()=>{
  assert.deepEqual([moodPolicy().dailyRecoveryHour,moodPolicy().dailyFloor,moodPolicy().noReplyPenalty],[4,60,10]);
  const p=moodPolicy({dailyRecoveryHour:0,dailyFloor:0,noReplyPenalty:0});
  assert.deepEqual([p.dailyRecoveryHour,p.dailyFloor,p.noReplyPenalty,p.initial],[0,0,0,60]);
});

test('host rejects invalid settlement inputs and accepts the documented endpoints',async t=>{
  const f=await fixture(t);
  for(const [name,bad] of [['dailyRecoveryHour',[-1,24,4.5,'4']],['dailyFloor',[-1,101,'60']],['noReplyPenalty',[-1,101,'10']]]) {
    for(const value of bad)assert.equal(f.host.setConfig(id,{[name]:value}).ok,false,name+':'+value);
  }
  for(const config of [{dailyRecoveryHour:0,dailyFloor:0,noReplyPenalty:0},{dailyRecoveryHour:23,dailyFloor:100,noReplyPenalty:100}]) {
    assert.equal(f.host.setConfig(id,config).ok,true);
    assert.equal(validateMoodConfig({...moodPolicy(),...config}).ok,true);
  }
});

test('new waits freeze their configured penalty; repeated settlement and reload do not charge twice',async t=>{
  const f=await fixture(t,{noReplyPenalty:7});
  f.sent();await f.configure({noReplyPenalty:2});
  f.call('settle',{now:at('10:20')});assert.equal(f.read().score,53);
  f.call('settle',{now:at('10:21')});assert.equal(f.read().score,53);
  const first=f.call('history',{key}).items[0];assert.equal(first.noReplyPenalty,7);
  f.sent({deliveryId:'d2',proactiveId:'p2',sentAt:at('10:22')});
  f.call('settle',{now:at('10:42')});assert.equal(f.read().score,51);
});

test('configured recovery uses Shanghai hour, preserves higher scores and runs once per cycle',async t=>{
  const f=await fixture(t,{dailyRecoveryHour:8,dailyFloor:72});
  f.call('initialize',{conversations:[{key,score:10},{key:'group:456',score:85}],now:at('07:59')});
  f.call('settle',{now:at('07:59')});assert.equal(f.read().score,10);
  f.call('settle',{now:at('08:00')});assert.equal(f.read().score,72);assert.equal(f.read('group:456').score,85);
  const event=f.call('history',{key}).items[0];
  assert.equal(event.dailyFloor,72);assert.equal(event.dailyRecoveryHour,8);assert.match(event.reason,/08:00/);
  f.call('adjust',{key,action:'dec',value:10,now:at('08:01')});
  await f.configure({dailyRecoveryHour:9,dailyFloor:90});
  f.call('initialize',{now:at('09:01')});assert.equal(f.read().score,62,'changing settings cannot repeat a completed daily recovery');
  f.call('settle',{now:at('09:01')+3*day});assert.equal(f.read().score,90);
  assert.equal(f.call('history',{key}).items.filter(x=>x.source==='daily-recovery').length,2,'offline catch-up runs once');
});

test('midnight and late-evening boundaries are valid, and a zero floor never lowers mood',async t=>{
  for(const hour of [0,23]) {
    const f=await fixture(t,{dailyRecoveryHour:hour,dailyFloor:0,noReplyPenalty:0});
    const boundary=at(String(hour).padStart(2,'0')+':00');
    f.call('initialize',{conversations:[{key,score:33}],now:boundary-minute});
    f.call('settle',{now:boundary});assert.equal(f.read().score,33);
    f.sent({sentAt:boundary+minute});f.call('settle',{now:boundary+21*minute});assert.equal(f.read().score,33);
  }
});

test('history replay uses per-event rules and keeps legacy 60/10 records intact',()=>{
  const entry={baseScore:40,history:[
    {at:1,source:'daily-recovery',dailyFloor:72,delta:32},
    {at:2,source:'unanswered',noReplyPenalty:7,delta:-7},
    {at:3,source:'daily-recovery',delta:0},
    {at:4,source:'unanswered',delta:-10},
  ]};
  replayHistory(entry);assert.equal(entry.score,55);
  entry.history[1].voided=true;replayHistory(entry);assert.equal(entry.score,62);
});
