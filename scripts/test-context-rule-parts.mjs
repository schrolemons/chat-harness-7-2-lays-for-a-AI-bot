import test from'node:test';import assert from'node:assert/strict';import{renderedPromptParts}from'../src/prompt-parts.js';import{contextParts}from'../plugins/qq-components/obs-context-assembly/refill.mjs';
import{bridgeHarness}from'./audit-bridge-harness.mjs';
test('only explicitly declared rule blocks enter stable user context; dynamic facts stay ordered',()=>{
 const blocks=['常规规则','心情=80','完整核心风格示范'],parts=renderedPromptParts(blocks,['stable','current','current'],blocks.join('\n\n')),row={id:'ctx-context-dynamics',text:blocks.join('\n\n'),promptParts:parts};const split=contextParts(row);assert.equal(split.stable,'常规规则');assert.equal(split.current,'心情=80\n\n完整核心风格示范');assert.equal(parts.map(row=>row.text).join('\n\n'),row.text);
});
test('real memory component declares maintenance rules separately from changing topics',async()=>{
 const h=await bridgeHarness();try{const row=h.pluginHost.collectPromptModules({key:'private:123',reason:'message',st:{activeTopics:[{text:'今天去实验室'}]},memoryWindow:20},{only:['ctx-memory-context']})[0],parts=contextParts(row);assert.match(parts.stable,/事务维护/);assert.match(parts.current,/今天去实验室/);assert(!parts.current.includes('【事务维护'));assert.equal(row.promptParts.map(part=>part.text).join('\n\n'),row.text);}finally{await h.close();}
});
test('edited or truncated metadata cannot silently resurrect an old rule or lose dynamic text',()=>{
 const row={id:'custom-component',text:'管理员新内容',promptParts:[{placement:'stable',text:'旧内容'}]};assert.equal(contextParts(row).current,'管理员新内容');assert.equal(contextParts(row).stable,'');const parts=renderedPromptParts(['规则','消息正文'],['stable','current'],'规则\n\n消息');assert.deepEqual(parts,[{placement:'stable',text:'规则'},{placement:'current',text:'消息'}]);
});
test('unannotated parts preserve stable profile placement and identity/credential separation',()=>{
 const text='【你的身份】当前身份\n\n【会话令牌】当前令牌',parts=contextParts({id:'ctx-context-session',text,promptParts:[{placement:'current',text}]});assert.match(parts.stable,/当前身份/);assert(!parts.stable.includes('当前令牌'));assert.match(parts.current,/当前令牌/);assert.equal(contextParts({id:'ctx-memory-profile-store',placement:'stable',text:'权威档案',promptParts:[{placement:'current',text:'权威档案'}]}).stable,'权威档案');
});
