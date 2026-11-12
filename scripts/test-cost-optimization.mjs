import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin} from '../plugins/qq-components/obs-cost-policy/index.js';
test('legacy economy and upgrade switches no longer change user-selected models',()=>{
 for(const autoUpgradeComplexTasks of [true,false]){
  const select=createPlugin({config:{autoUpgradeComplexTasks}}).services['cost-policy'].select;
  for(const payload of [{task:'请用 Pro 严格证明并重构代码'},{incomingText:'高强度执行'},{reason:'memoryWrite'},{reason:'timeBubble'}])assert.equal(select(payload).model,'deepseek-flash');
 }
});
