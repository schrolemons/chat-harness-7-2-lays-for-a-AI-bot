import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPlugin} from '../plugins/qq-components/ctx-memory-store/index.js';
function fixture(t,{repair}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'memory-worker-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let state={},resolve;const model=new Promise(r=>resolve=r),calls=[];let plugin;
 const ctx={root,config:{dailyDiary:{enabled:false}},state:{get:()=>state,set:p=>state={...state,...p}},log(){},warn(){},registerTool(){},
  capabilities:{memoryWorkerContext:()=>({messages:[{seq:1,userId:'123',sender:'本人',text:'我喜欢散步',bodyComplete:true,at:Date.now()}],role:'角色语气原文'}),runReadOnlyWorker:async p=>{calls.push(p);return calls.length>1&&repair?repair(p):model;}},
  callService:(s,m,p)=>s==='memory'?plugin.services.memory[m](p):s==='profileStore'&&m==='workerSnapshot'?{profiles:[],revisions:{}}:null};
 plugin=createPlugin(ctx);return {plugin,resolve,calls,state:()=>state};
}
const answer=()=>({text:JSON.stringify({memory:'<MEMORY>【重要事实】\n- 本人说喜欢散步。\n【用户画像】\n【日记】\n今天聊到散步，心里亮了一点。</MEMORY>',profileUpdates:[]})});
test('memory drafts run independently, deduplicate jobs and commit only after a complete worker result',async t=>{
 const f=fixture(t),w=f.plugin.services.memoryWorker;assert.ok(w,'independent memory worker service');
 assert.equal(w.request({key:'private:123'}),true);assert.equal(w.request({key:'private:123'}),false);assert.equal(f.calls.length,1);
 assert.equal(f.plugin.services.memory.read({key:'private:123'}).text,'');
 f.resolve(answer());await w.whenIdle({key:'private:123'});
 assert.equal(w.status({key:'private:123'}).status,'completed');assert.match(f.plugin.services.memory.read({key:'private:123'}).text,/喜欢散步/);
 assert.ok(!f.calls[0].prompt.includes('会话令牌'),'no live chat credentials enter a worker');
 assert.match(f.calls[0].prompt.split('会话资料JSON：')[1],/资料结束[\s\S]*只输出一个JSON对象/,'data is followed by the final output contract');
});
test('concurrent chat edits prevent an old worker draft overwriting new memory',async t=>{
 const f=fixture(t),w=f.plugin.services.memoryWorker;assert.ok(w);w.request({key:'private:123'});
 f.plugin.services.memory.write({key:'private:123',text:'【重要事实】\n- 主聊天刚确认的新事实。'});f.resolve(answer());await w.whenIdle({key:'private:123'});
 assert.equal(w.status({key:'private:123'}).status,'conflict');assert.match(f.plugin.services.memory.read({key:'private:123'}).text,/刚确认/);assert.doesNotMatch(f.plugin.services.memory.read({key:'private:123'}).text,/喜欢散步/);
});
test('malformed or oversized diary output preserves existing memory',async t=>{
 const f=fixture(t),w=f.plugin.services.memoryWorker;assert.ok(w);w.request({key:'private:123'});f.resolve({text:'这不是完整JSON草稿'});await w.whenIdle({key:'private:123'});
 assert.equal(w.status({key:'private:123'}).status,'failed');assert.equal(f.plugin.services.memory.read({key:'private:123'}).text,'');
});

test('a complete split JSON draft commits through the real memory store without another model request',async t=>{
 const f=fixture(t),w=f.plugin.services.memoryWorker;w.request({key:'private:123'});const draft=JSON.parse(answer().text);
 f.resolve({text:JSON.stringify({memory:draft.memory.slice(8,-9)})+'\n'+JSON.stringify({profileUpdates:draft.profileUpdates})});await w.whenIdle({key:'private:123'});
 assert.equal(w.status({key:'private:123'}).status,'completed');assert.equal(f.calls.length,1);assert.match(f.plugin.services.memory.read({key:'private:123'}).text,/喜欢散步/);
});

const oversized=()=>({text:JSON.stringify({memory:'<MEMORY>【重要事实】\n- 本人说喜欢散步。\n【用户画像】\n【日记】\n'+'散步时感到开心。'.repeat(50)+'</MEMORY>',profileUpdates:[]})});
test('incidental diary output from facts maintenance is ignored without another model request',async t=>{
 const f=fixture(t),w=f.plugin.services.memoryWorker,m=f.plugin.services.memory;
 const day=m.diaryCurrent({key:'private:123'}).day;m.updateDiary({key:'private:123',day,text:'保留原日记'});
 w.request({key:'private:123'});f.resolve(oversized());await w.whenIdle({key:'private:123'});
 assert.equal(f.calls.length,1);assert.equal(w.status({key:'private:123'}).status,'completed');
 assert.match(m.read({key:'private:123'}).text,/本人说喜欢散步/);assert.equal(m.diaryText({key:'private:123'}),'保留原日记');
});
test('a concurrent diary-only edit does not discard valid facts or overwrite the new diary',async t=>{
 const f=fixture(t),w=f.plugin.services.memoryWorker,m=f.plugin.services.memory;
 w.request({key:'private:123'});const day=m.diaryCurrent({key:'private:123'}).day;m.updateDiary({key:'private:123',day,text:'刚改好的日记'});
 f.resolve(answer());await w.whenIdle({key:'private:123'});assert.equal(w.status({key:'private:123'}).status,'completed');
 assert.match(m.read({key:'private:123'}).text,/喜欢散步/);assert.equal(m.diaryText({key:'private:123'}),'刚改好的日记');
});
