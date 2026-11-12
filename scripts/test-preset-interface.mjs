import assert from 'node:assert/strict';
import {requestedPreset,adminPresetConfig,simulationPreset} from '../src/preset-policy.js';
for(const mode of ['chat','reserved','reserved2','closed-agent']) {
 for(const preset of [undefined,'','qq-chat-dev','custom-powerful','standard','qq-chat-v2','qq-admin']) {
  assert.deepEqual(requestedPreset({mode,owner:true,admin:{enabled:true,preset}}),{id:'qq-admin',strict:true});
  const expected=mode==='reserved2'?'qq-chat-v2':'qq-chat';
  assert.deepEqual(requestedPreset({mode,owner:true,admin:{enabled:false,preset}}),{id:expected,strict:true});
  assert.deepEqual(requestedPreset({mode,owner:false,admin:{enabled:true,preset}}),{id:expected,strict:true});
 }
}
assert.deepEqual(adminPresetConfig(),{enabled:false,preset:'qq-admin'});
assert.equal(simulationPreset('reserved2'),'qq-chat-v2');
assert.equal(simulationPreset('reserved'),'qq-chat');
assert.equal(simulationPreset('closed-agent'),null);
console.log('PASS fixed admin binding, all four disabled modes, legacy selections ignored');
