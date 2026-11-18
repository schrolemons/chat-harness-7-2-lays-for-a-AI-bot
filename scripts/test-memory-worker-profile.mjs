import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPlugin} from '../plugins/qq-components/ctx-memory-profile-store/index.js';
test('worker profile changes require same-chat speaker evidence and an unchanged profile revision',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'worker-profile-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const tools=new Map(),p=createPlugin({root,config:{},capabilities:{},registerTool:(n,s)=>tools.set(n,s),state:{get:()=>({}),set(){}},log(){},warn(){}}),s=p.services.profileStore;
 assert.equal(typeof s.workerSnapshot,'function');const messages=[{seq:1,userId:'123',text:'我喜欢散步',bodyComplete:true}],key='group:456',snapshot=s.workerSnapshot({key,messages});
 const update={key,userId:'123',profile:{hobbies:'喜欢散步'},evidence:[{seq:1,quote:'我喜欢散步'}],messages,revision:snapshot.revisions['123']};
 assert.equal(s.workerApply({...update,userId:'999'}).ok,false);assert.equal(s.workerApply({...update,evidence:[{seq:1,quote:'我喜欢游泳'}]}).ok,false);
 assert.equal(s.workerApply({...update,profile:{private_field:'群里无权写'}}).ok,false);
 assert.equal(s.workerApply(update).ok,true);assert.equal(s.workerApply({...update,profile:{hobbies:'旧草稿'}}).reason,'profile_changed');
 assert.deepEqual(s.workerSnapshot({key:'private:789',messages}).profiles,[],'private worker cannot read another speaker');
});
