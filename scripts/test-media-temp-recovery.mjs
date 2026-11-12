import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {normalizeImageForModel} from '../src/media-normalize.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';
const frame='21f90401000000002c0000000001000100000202440100';const gif=Buffer.from('47494638396101000100800000ffffff000000'+frame+frame+'3b','hex');
test('unwritable temp returns a truthful small-image fallback and rejects oversized data without throwing',async t=>{
 t.mock.method(fs,'mkdtempSync',()=>{throw Object.assign(Error('fixture permission failure'),{code:'EPERM'});});
 const small=await normalizeImageForModel(gif,'image/gif');assert.equal(small.ok,true);assert.equal(small.buffer,gif);assert.match(small.note,/临时目录/);
 const large=await normalizeImageForModel(Buffer.concat([gif,Buffer.alloc(2*1024*1024)]),'image/gif',{maxModelBytes:1024*1024});assert.equal(large.ok,false);assert.match(large.error,/临时目录/);
});
test('bridge image normalization uses its instance temp directory, independent of system TEMP',async()=>{
 const seen=[];const h=await bridgeHarness({globals:{normalizeImageForModel:async(buffer,mimeType,opts)=>{seen.push(opts.tmpDir);return {ok:true,buffer,mimeType};}}});
 try{h.setMode('reserved2');h.socialV2.paused=true;await h.handleIncoming('private',123,{message_id:301,user_id:123,self_id:9,sender:{nickname:'fixture'},message:[{type:'image',data:{file:'fixture.png'}}]},h.cfg);assert(seen.length);for(const root of seen)assert.equal(root,path.join(h.temp,'state','tmp','model-media'));}finally{await h.close();}
});
