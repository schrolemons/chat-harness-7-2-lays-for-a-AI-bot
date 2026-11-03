import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import { pendingMessagesV2, receiptStateV2, registerSuccessfulReplyV2 } from '../src/bridge-core/receipt-state.js';
import { timelineEntries } from '../console/layers/O/context-timeline.js';
import { createPlugin as startupGreeting } from '../plugins/qq-components/life-proactive-startup-greeting/index.js';
import { createPlugin as sessionContext } from '../plugins/qq-components/ctx-context-session/index.js';

test('recovery retains only the latest configurable private window without forging either receipt stamp', async () => {
  const h = await bridgeHarness();
  try {
    const st = h.getSocialV2State('private:123');
    for (let i = 1; i <= 9; i++) h.appendSocialV2Message('private:123', 'peer', 'old ' + i, '', false, false, String(i));
    const result = h.pluginHost.callService('historyContext', 'recover', { key: 'private:123', state: st });
    assert.equal(result?.privateReplyLimit, 5);
    assert.deepEqual(Array.from(pendingMessagesV2(st), m => m.seq), [5, 6, 7, 8, 9]);
    assert.equal(st.recentMessages[0].seenAt, undefined);
    assert.equal(st.recentMessages[0].repliedAt, undefined);
    assert.equal(receiptStateV2(st.recentMessages[0]), 'unseen');
    assert.equal(st.recentMessages[0].replyDisposition, 'history');
    h.appendSocialV2Message('private:123', 'peer', 'NEW REQUIREMENT', '', false, false, 'new');
    assert.equal(pendingMessagesV2(st).at(-1).text, 'NEW REQUIREMENT');
    assert.equal(h.pluginHost.setConfig('life-history-context', { privateReplyLimit: 2 }).ok, true);
    await h.pluginHost.reload('life-history-context');
    h.pluginHost.callService('historyContext', 'recover', { key: 'private:123', state: st });
    assert.deepEqual(Array.from(pendingMessagesV2(st), m => m.seq), [8, 9, 10]);
  } finally { await h.close(); }
});

test('all recovered group messages become context only and remain distinct from delivered replies', async () => {
  const h = await bridgeHarness();
  try {
    const key = 'group:456', st = h.getSocialV2State(key);
    for (let i = 1; i <= 4; i++) h.appendSocialV2Message(key, 'peer', 'old group ' + i, '', false, false, String(i));
    h.pluginHost.callService('historyContext', 'recover', { key, state: st });
    assert.equal(pendingMessagesV2(st).length, 0);
    assert.equal(st.recentMessages.length, 4);
    assert.equal(st.recentMessages.some(m => m.seenAt || m.repliedAt), false);
    h.appendSocialV2Message(key, 'peer', 'live group question', '', false, false, 'live');
    assert.equal(pendingMessagesV2(st).length, 1);
    assert.equal(h.calls.sent.length, 0);
  } finally { await h.close(); }
});

test('bounded wake snapshots reserve the newest incoming body before old backlog and receipt context', async () => {
  const h = await bridgeHarness({ config: { socialV2: { context: { wakeMessageLimit: 2, wakeMaxChars: 1500, wakeRecentLimit: 2 } } } });
  try {
    h.setMode('reserved2');
    for (let i = 1; i <= 8; i++) h.appendSocialV2Message('group:456', 'peer', i === 8 ? 'LATEST FULL BODY' : 'old ' + i, '', false, false, String(i));
    const snapshot = h.buildWakeSnapshotV2('group:456');
    assert.ok(snapshot.messages.some(m => m.seq === 8 && String(m.text || m.plain).includes('LATEST FULL BODY')));
    assert.deepEqual(Array.from(snapshot.messages, m => m.seq), [7, 8]);
    assert.equal(snapshot.partial, true);
    assert.equal(h.getSocialV2State('group:456').unread[0].seenAt, undefined);
  } finally { await h.close(); }
});

test('business context orders both QQ directions by dialogueSeq across receipt-state partitions', () => {
  const rows = [
    { key: 'outgoing', kind: 'delivery', region: 'history', position: 3, dialogueSeq: 12 },
    { key: 'waiting', kind: 'qq', region: 'arrivals', position: 8, dialogueSeq: 10 },
    { key: 'old', kind: 'qq', region: 'history', position: 2, dialogueSeq: 11 },
    { key: 'tool', kind: 'result', region: 'history', position: 4 },
  ];
  const before = JSON.stringify(rows);
  assert.deepEqual(timelineEntries(rows).filter(r => r.dialogueSeq).map(r => r.dialogueSeq), [10, 11, 12]);
  assert.equal(JSON.stringify(rows), before);
});

test('a normal group discussion during an active turn does not promise a subsequent reply', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    const key = 'group:456', sid = await h.ensureSession(key);
    h.getSocialV2State(key).bootstrapSent = true;
    h.v2TurnStartAt.set(sid, Date.now());
    await h.handleIncoming('group', 456, { user_id: 124, self_id: 999, message_id: 100,
      message: [{ type: 'text', data: { text: '继续和其他群友闲聊' } }], sender: { nickname: 'peer' } }, h.cfg);
    assert.equal(h.messageAckArmed.has(key), false);
  } finally { await h.close(); }
});

test('local history synchronization is bounded and idempotent, does not send, wake, or fake outbound receipts', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');let reads=0;
    h.taskCaps.readLocalConversationHistory = async () => { reads++; return {ok:true,messages:Array.from({length:8},(_,i)=>({message_type:'private',user_id:123,message_id:'local-'+i,time:Math.floor(Date.now()/1000)-100+i,sender:{nickname:'peer'},message:[{type:'text',data:{text:'你好 '+i}}]}))}; };
    // The fixture must not have to call a real provider to classify cached context.
    const call=h.pluginHost.callService.bind(h.pluginHost);
    h.pluginHost.callService=(service,method,payload)=>service==='knowledgeQuota'&&method==='evaluate'?{action:'ignore'}:call(service,method,payload);
    const key='private:123',st=h.getSocialV2State(key),previousIncoming=st.lastIncomingAt;
    await h.pluginHost.callService('historyContext','sync',{key});await h.pluginHost.callService('historyContext','sync',{key});
    assert.equal(reads,1);assert.equal(pendingMessagesV2(st).length,5);assert.equal(st.recentMessages.length,8);
    assert.equal(st.lastIncomingAt,previousIncoming);assert.equal(st.lastOutboundAt||0,0);
    assert.equal(st.recentMessages.some(m=>m.seenAt||m.repliedAt),false);
    assert.equal(h.calls.sent.length,0);assert.equal(h.calls.http.length,0);assert.equal(h.calls.prompts.length,0);
    assert.equal(h.messageAckArmed.has(key),false);
  } finally { await h.close(); }
});

test('a delayed local import never reclassifies fresh group messages as recovered history', async () => {
  const h = await bridgeHarness();
  try {
    h.setMode('reserved2');
    const key='group:456',st=h.getSocialV2State(key);
    h.appendSocialV2Message(key,'peer','old group context','',false,false,'old');
    h.pluginHost.callService('historyContext','recover',{key,state:st});
    h.appendSocialV2Message(key,'peer','FRESH QUESTION','',false,false,'fresh');
    await h.taskCaps.importLocalConversationHistory({key,messages:[{message_type:'group',group_id:456,user_id:124,message_id:'cached',time:Math.floor(Date.now()/1000)-60,message:[{type:'text',data:{text:'cached group context'}}]}]});
    assert.deepEqual(Array.from(pendingMessagesV2(st),m=>m.messageId),['fresh']);
    assert.equal(st.recentMessages.find(m=>m.messageId==='cached').replyDisposition,'history');
    assert.equal(h.calls.sent.length,0);
  } finally { await h.close(); }
});

test('receipt reminders and startup greeting never turn context-only group messages into a reply obligation', async () => {
  const h=await bridgeHarness();
  try {
    const key='group:456',st=h.getSocialV2State(key);
    h.appendSocialV2Message(key,'peer','old context','',false,false,'old');
    h.pluginHost.callService('historyContext','recover',{key,state:st});
    const tail=h.pluginHost.collectWakeTails({key,st,reason:'message',doubleStampEnabled:true});
    assert.match(String(tail),/replyDisposition=history[^。]*不要求补答/);
    const greeting=startupGreeting({config:{cooldownMinutes:0},state:{get:()=>({})}}).hooks.beforePrompt({key,st,reason:'startupGreeting'});
    assert.doesNotMatch(greeting,/先正常回应它们/);
    const blocks=[];sessionContext({config:{},addPromptBlock:text=>blocks.push(text)}).hooks.beforePrompt({key,st});
    assert.match(blocks.join('\n'),/未读 0 条/);
  } finally { await h.close(); }
});

test('confirmed physical replies bind a deliberately quoted historical message, never all historical rows', () => {
  const old={seq:1,messageId:'old',replyDisposition:'history',seenAt:1},another={seq:2,messageId:'another',replyDisposition:'history',seenAt:1};
  const st={unread:[old,another],recentMessages:[old,another]};
  registerSuccessfulReplyV2(st);assert.deepEqual(st.receiptSendPendingSeqs,[]);
  registerSuccessfulReplyV2(st,{replyToMessageId:'old'});assert.deepEqual(st.receiptSendPendingSeqs,[1]);
  assert.equal(old.repliedAt,undefined);assert.equal(another.repliedAt,undefined);
});
