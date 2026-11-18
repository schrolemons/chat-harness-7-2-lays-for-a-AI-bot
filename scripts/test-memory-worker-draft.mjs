import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';
import{decodeMemoryDraft}from'../plugins/qq-components/ctx-memory-store/worker-draft.mjs';
const memory='【重要事实】\n- 原话包含 } 与转义引号 " 和换行。\n【用户画像】\n普通聊天\n【日记】\n完整正文';
test('single JSON and disjoint adjacent JSON preserve all body text and restore only the outer delimiter',()=>{
 for(const raw of [JSON.stringify({memory,profileUpdates:[]}),JSON.stringify({memory})+'\n'+JSON.stringify({profileUpdates:[]})])assert.deepEqual(decodeMemoryDraft(raw),{memory:'<MEMORY>'+memory+'</MEMORY>',profileUpdates:[]});
});
test('malformed, ambiguous, duplicate, incomplete or extra output is rejected rather than silently dropped',()=>{
 for(const raw of [JSON.stringify({memory}),JSON.stringify({memory,profileUpdates:[]})+'\n附加说明',JSON.stringify({memory})+JSON.stringify({memory,profileUpdates:[]}),JSON.stringify({memory,profileUpdates:[],extra:1}),JSON.stringify({memory:'【重要事实】\n不完整',profileUpdates:[]}),JSON.stringify({memory,profileUpdates:[]}).slice(0,-2)])assert.throws(()=>decodeMemoryDraft(raw));
});
test('the exact real failed two-object response now decodes without a second model call',()=>{
 const root=JSON.parse(fs.readFileSync('workspace.local.json')).runtimeRoot;
 const file=path.join(root,'state/audits/memory-json-20261112/session-0ef11b4e-30ac-4447-958c-4043fee62c2a.json');
 const snapshot=JSON.parse(fs.readFileSync(file));const raw=snapshot.records.map(r=>r.event||r).filter(e=>e.type==='assistant/message').flatMap(e=>e.data.message.content).filter(b=>b.type==='text').map(b=>b.text).join('');
 assert.throws(()=>JSON.parse(raw));const draft=decodeMemoryDraft(raw);assert.equal(draft.profileUpdates.length,0);assert(draft.memory.endsWith('</MEMORY>'));assert.equal(raw.includes(draft.memory.slice(8,-9)),false,'JSON escaping remains data, not parsing by string slicing');
});
