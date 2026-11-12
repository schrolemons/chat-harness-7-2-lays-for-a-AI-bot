import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/obs-cost-policy/index.js';
import {normalizeModelPolicy} from '../plugins/qq-components/obs-cost-policy/policy.mjs';
const chat={provider:'a',model:'chat',effort:'low'},task={provider:'b',model:'work',effort:'high'};
test('explicit task defaults and presets replace keyword escalation',()=>{
 const p=createPlugin({config:{conversation:chat,task,presets:{custom:{provider:'c',model:'special',effort:''}}}}),select=p.services['cost-policy'].select;
 assert.equal(p.hooks,undefined);
 for(const incomingText of ['你好','请用 Pro 严格证明并修复并发死锁','普通消息'.repeat(100)])assert.equal(select({incomingText}).model,'chat');
 assert.equal(select({task:'你好'}).model,'work');assert.equal(select({preset:'custom',task:'用Pro'}).model,'special');assert.equal('reasoningEffort' in select({preset:'custom'}),false);
});
test('legacy baseline migrates read-only; retired upgrade values cannot override explicit routes',()=>{
 const legacy={defaultProvider:'a',defaultModel:'chat',defaultEffort:'off',upgradeModel:'obsolete',autoUpgradeComplexTasks:true};
 assert.deepEqual(normalizeModelPolicy(legacy),{conversation:{...chat,effort:'off'},task:{...chat,effort:'off'},presets:{}});assert.equal(legacy.upgradeModel,'obsolete');
 assert.throws(()=>normalizeModelPolicy({conversation:chat,task,presets:JSON.parse('{"__proto__":{}}')}),/预设 ID/);
});
