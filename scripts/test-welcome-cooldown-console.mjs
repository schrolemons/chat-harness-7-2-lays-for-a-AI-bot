import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshV2Mood} from '../console/layers/C/mood.js';

test('welcome display shows one pending reply and only the retrigger cooldown, never an expiry',async t=>{
 const previous=Object.fromEntries(['document','localStorage','fetch'].map(key=>[key,globalThis[key]]));
 t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const node={innerHTML:'',classList:{add(){},remove(){}}};
 globalThis.document={getElementById:id=>id==='v2MoodCurrent'?node:null};
 globalThis.localStorage={getItem:()=>null};
 globalThis.fetch=async()=>({status:200,json:async()=>({ok:true,conversations:[{key:'private:123',moodState:{score:60,mode:'normal',modeName:'普通',welcomeBurstActive:true,cooldownUntil:Date.parse('2026-10-30T22:38:11+08:00')},moodHistory:[]}]})});
 await refreshV2Mood();
 assert.match(node.innerHTML,/待首条成功回复使用/);
 assert.match(node.innerHTML,/再次触发冷却截止/);
 assert.doesNotMatch(node.innerHTML,/生效中，至|有效期|读取失败/);
});
