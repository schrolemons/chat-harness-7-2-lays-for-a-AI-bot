import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPluginHost} from '../src/plugin-host.js';
const four=Date.parse('2026-10-30T04:00:00+08:00'),minute=60000,day=86400000,key='private:123';
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mood-daily-'));
 fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
 fs.cpSync(new URL('../plugins/qq-components/ctx-user-mood',import.meta.url),path.join(root,'plugins/qq-components/ctx-user-mood'),{recursive:true});
 let host=createPluginHost({root,startTimers:false});await host.loadAll();
 const call=(method,args)=>host.callService('mood',method,args);
 t.after(async()=>{await host.dispose();fs.rmSync(root,{recursive:true,force:true});});
 return {call,read:k=>call('read',{key:k||key}),tick:now=>host.tick(now),
  restart:async now=>{await host.dispose();host=createPluginHost({root,startTimers:false});await host.loadAll();return call('initialize',{now});}};
}
test('Shanghai 04:00 floor raises low private/group scores and preserves higher scores',async t=>{
 const f=await fixture(t);f.call('initialize',{conversations:[{key,score:10},{key:'group:456',score:20},{key:'private:789',score:85}],now:four-1});
 await f.tick(four-1);assert.equal(f.read().score,10);
 await f.tick(four+minute);assert.equal(f.read().score,60);assert.equal(f.read('group:456').score,60);assert.equal(f.read('private:789').score,85);
});
test('recovery is once per cycle, not per message, repeated initialize or recreated chat',async t=>{
 const f=await fixture(t);f.call('initialize',{conversations:[{key,score:10}],now:four-1});
 f.call('settle',{now:four});f.call('adjust',{key,action:'dec',value:20,now:four+minute});
 f.call('initialize',{conversations:[{key,score:99}],now:four+2*minute});
 f.call('incoming',{key,messageId:'first',userId:'123',hasText:true,at:four+3*minute});
 f.call('settle',{now:four+4*minute});assert.equal(f.read().score,40);
 f.call('settle',{now:four+day});assert.equal(f.read().score,60);
 assert.equal(f.call('history',{key}).items.filter(x=>x.source==='daily-recovery').length,2);
});
test('offline startup catches up only the latest missed cycle and persists its receipt',async t=>{
 const f=await fixture(t);f.call('initialize',{conversations:[{key,score:10}],now:four-1});
 assert.equal((await f.restart(four+3*day+minute)).recovered,1);assert.equal(f.read().score,60);
 f.call('adjust',{key,action:'dec',value:20,now:four+3*day+2*minute});
 assert.equal((await f.restart(four+3*day+3*minute)).recovered,0);assert.equal(f.read().score,40);
 assert.equal(f.call('history',{key}).items.filter(x=>x.source==='daily-recovery').length,1);
});
test('restart before 04:00 does not consume the coming cycle; server timezone is irrelevant',async t=>{
 const previous=process.env.TZ;process.env.TZ='America/Los_Angeles';t.after(()=>{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;});
 const f=await fixture(t);f.call('initialize',{conversations:[{key,score:10}],now:four-day});
 assert.equal((await f.restart(four-1)).recovered,0);assert.equal(f.read().score,10);
 f.call('settle',{now:four});assert.equal(f.read().score,60);
});
test('penalties after recovery still lower mood; recurring ticks never erase them',async t=>{
 const f=await fixture(t);f.call('initialize',{conversations:[{key,score:70}],now:four-10*minute});
 f.call('sent',{key,proactiveId:'p',deliveryId:'d',wakeReason:'proactiveCheck',sentAt:four-5*minute,success:true,expectsReply:true});
 f.call('settle',{now:four});f.call('settle',{now:four+16*minute});assert.equal(f.read().score,60);
 f.call('adjust',{key,action:'dec',value:10,now:four+17*minute});f.call('settle',{now:four+18*minute});assert.equal(f.read().score,50);
});
