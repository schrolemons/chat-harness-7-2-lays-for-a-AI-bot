import test from 'node:test';import assert from 'node:assert/strict';
import {createPlugin,TOOL_LOADING_RULE} from '../plugins/qq-components/ctx-chat-reply-shape/index.js';
test('tool loading guidance preserves the plan and does not update receipts or ledger',()=>{
 const state={sendLedger:{conversations:{},turns:{}}},before=JSON.stringify(state);let writes=0;
 const plugin=createPlugin({config:{},state:{get:()=>state,set(){writes++;}}});
 const plan={line:'original-plan'},text=plugin.hooks.beforePrompt({replyPlan:plan});
 assert.equal(text.split('\n')[0],plan.line);assert(text.endsWith(TOOL_LOADING_RULE));
 assert.equal(plugin.hooks.beforePrompt({}),TOOL_LOADING_RULE);assert.equal(JSON.stringify(state),before);assert.equal(writes,0);
 assert.equal(plugin.services.replyPlan.validateContext({agent:true,requiredSeqs:[1,2],selectedSeqs:[2]}).reason,'required_reply_order');
 assert.equal(plugin.services.replyPlan.validateContext({agent:true,targetIncomplete:true}).reason,'message_context_pending');
});
