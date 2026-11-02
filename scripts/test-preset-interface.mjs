import assert from 'node:assert/strict';
import {requestedPreset,adminPresetConfig,simulationPreset} from '../src/preset-policy.js';
for(const mode of ['chat','reserved','reserved2','closed-agent']) {
  assert.deepEqual(requestedPreset({mode,owner:true,admin:{enabled:true,preset:'custom-powerful'}}),{id:'custom-powerful',strict:true});
  assert.deepEqual(requestedPreset({mode,owner:true,admin:{enabled:true,preset:''}}),{id:'',strict:false});
}
assert.deepEqual(requestedPreset({mode:'closed-agent',owner:true,admin:{enabled:false,preset:'custom'}}),{id:'qq-chat',strict:true});
assert.deepEqual(requestedPreset({mode:'reserved2',owner:true,admin:{enabled:false,preset:'custom'}}),{id:'qq-chat-v2',strict:true});
assert.deepEqual(requestedPreset({mode:'reserved2',owner:false,admin:{enabled:true,preset:'custom'}}),{id:'qq-chat-v2',strict:true});
assert.deepEqual(requestedPreset({mode:'reserved',owner:false}),{id:'qq-chat',strict:true});
assert.equal(adminPresetConfig({preset:'qq-chat-dev'}).preset,'');
assert.equal(simulationPreset('reserved2'),'qq-chat-v2');
assert.equal(simulationPreset('reserved'),'qq-chat');
assert.equal(simulationPreset('closed-agent'),null);
console.log('PASS unified admin bindings, default selection, fixed chat protocols, legacy migration');
