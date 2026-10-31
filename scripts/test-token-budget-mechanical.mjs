import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlugin } from '../plugins/qq-components/life-token-budget/index.js';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const billedEvent = (sessionId) => ({ sessionId, at: Date.now() - 10, model: 'deepseek-flash', event: {
  type: 'assistant/message', seq: 1, data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 100 } }
} });

test('hard mechanical replies attempt unique private arrivals or directed group arrivals',()=>{
 let state={};const budget=createPlugin({config:{mechanicalPrivateReplies:['hard private'],mechanicalGroupReplies:['hard group']},state:{get:()=>state,set:p=>state={...state,...p}}}).services.tokenBudget;
 for(const [kind,expected] of [['private','hard private'],['group','hard group']])for(let i=1;i<=4;i++)assert.equal(budget.onSilentIncoming({key:kind+':1',kind,messageId:String(i),atSelf:kind==='group',stage:'silent',periodStart:123,at:10000+i*20000}).text,expected);
 assert.equal(budget.onSilentIncoming({key:'private:1',kind:'private',messageId:'4',stage:'silent',periodStart:123,at:200000}).duplicate,true);
});

test('per-conversation group weak-reply interval uses minutes at the real dispatch boundary', () => {
  let state={};
  const config={sessions:{'group:1':{coldLimitYuan:0.1,hardLimitYuan:0,weakMinIntervalMin:7}}};
  const plugin=createPlugin({config,state:{get:()=>state,set:patch=>{state={...state,...patch};}}});
  const budget=plugin.services.tokenBudget;
  assert.equal(budget.assess({key:'group:1',cost:0.2}).stage,'weak');
  budget.noteDispatch({key:'group:1',stage:'weak',now:1_000_000});
  assert.equal(budget.canDispatch({key:'group:1',stage:'weak',now:1_000_000+7*60_000-1}),false);
  assert.equal(budget.canDispatch({key:'group:1',stage:'weak',now:1_000_000+7*60_000}),true);
  config.sessions['group:1'].weakMinIntervalMin=8;
  assert.equal(budget.canDispatch({key:'group:1',stage:'weak',now:1_000_000+7*60_000}),false,'changed parameter must affect dispatch');
});

test('bridge forwards only verified same-group bot quote evidence to the silent budget handler',async()=>{
 const h=await bridgeHarness({files:{'state/plugins/config/life-token-budget.json':{sessions:{'group:456':{hardLimitYuan:0.1}},mechanicalGroupReplies:['引用已收到']}}});
 try{
  h.setMode('reserved2');const sid=await h.ensureSession('group:456');h.tokenLedger.ingestEvent(billedEvent(sid));
  h.bot.getMessage=async id=>id===10?{message_id:10,group_id:456,sender:{user_id:999,nickname:'AI助手'},get message(){throw Error('silent targeting must not read the quoted body');}}:id===11?{message_id:11,group_id:456,sender:{user_id:222,nickname:'群友'},message:[{type:'text',data:{text:'别人的话'}}]}:id===12?{message_id:12,group_id:789,sender:{user_id:999},message:[{type:'text',data:{text:'其他群的话'}}]}:id===14?{message_id:999,group_id:456,sender:{user_id:999}}:id===15?{message_id:15,sender:{user_id:999}}:null;
  for(const id of [11,12,13,14,15])await h.handleIncoming('group',456,{self_id:999,user_id:222,group_id:456,message_id:100+id,message:[{type:'reply',data:{id:String(id)}},{type:'text',data:{text:'回复'}}]},h.cfg);
  assert.equal(h.calls.sent.length,0,'human, foreign-group and unresolved quotes cannot trigger a mechanical reply');
  await h.handleIncoming('group',456,{self_id:999,user_id:222,group_id:456,message_id:110,message:[{type:'reply',data:{id:'10'}}]},h.cfg);
  assert.deepEqual(h.calls.sent.map(x=>[x.kind,x.text]),[['group','引用已收到']]);assert.equal(h.calls.prompts.length,0);
  const state=h.pluginHost.get('life-token-budget').state;assert.equal(state.recovery['group:456'].messages.find(x=>x.id==='110').quoteTargetIsSelf,true);
 }finally{await h.close();}
});

test('a verified bot quote without @ remains eligible for one recovery batch',async()=>{
 let state={},stage='silent';const delivered=[];
 const plugin=createPlugin({config:{recoveryWindows:{privateMessages:5,groupMessages:1,groupAtMessages:1}},state:{get:()=>state,set:p=>state={...state,...p}},capabilities:{budgetRecoveryStatus:()=>({stage,allowed:true}),dispatchBudgetRecovery:async r=>{delivered.push(r);return {ok:true};}}});
 const api=plugin.services.tokenBudget;
 api.onSilentIncoming({key:'group:2',kind:'group',messageId:'quote',quoteTargetIsSelf:true,stage:'silent',text:'引用bot的请求',at:1000});
 api.onSilentIncoming({key:'group:2',kind:'group',messageId:'ordinary',stage:'silent',text:'普通背景',at:2000});
 stage='normal';await plugin.hooks.onTick();assert.equal(delivered.length,1);assert.deepEqual(delivered[0].messages.map(x=>x.id),['quote','ordinary']);assert.match(delivered[0].prompt,/经核实引用/);assert.equal(api.recoveryPending({key:'group:2'}),0);
});

test('recovery processes only the configured recent private window once', async () => {
  let state = {};
  let stage = 'silent';
  const delivered = [];
  const plugin = createPlugin({
    config: { recoveryWindows: {privateMessages:2,groupMessages:5,groupAtMessages:5} },
    state: { get: () => structuredClone(state), set: (patch) => { state = { ...state, ...structuredClone(patch) }; } },
    capabilities: {
      budgetRecoveryStatus: () => ({ stage, allowed: true }),
      dispatchBudgetRecovery: async (request) => { delivered.push(request); return { ok: true }; }
    }
  });
  for (let id = 1; id <= 3; id++) plugin.services.tokenBudget.onSilentIncoming({
    key: 'private:1', kind: 'private', messageId: String(id), stage: 'silent', periodStart: 123,
    text: `私聊消息${id}`, at: id * 1000
  });
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 0);
  stage = 'normal';
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].messages.map((message) => message.text), ['私聊消息2', '私聊消息3']);
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 1);
});

test('group recovery independently selects context and at-mention windows and retries failed dispatch', async () => {
  let state = {};
  let accepted = false;
  const delivered = [];
  const plugin = createPlugin({
    config: { recoveryWindows: {privateMessages:5,groupMessages:2,groupAtMessages:1} },
    state: { get: () => structuredClone(state), set: (patch) => { state = { ...state, ...structuredClone(patch) }; } },
    capabilities: {
      budgetRecoveryStatus: () => ({ stage: 'normal', allowed: true }),
      dispatchBudgetRecovery: async (request) => { delivered.push(request); return { ok: accepted }; }
    }
  });
  const incoming = plugin.services.tokenBudget.onSilentIncoming;
  incoming({ key: 'group:2', kind: 'group', messageId: '1', stage: 'silent', periodStart: 123, text: '过早背景', at:1000 });
  incoming({ key: 'group:2', kind: 'group', messageId: '2', stage: 'silent', periodStart: 123, text: '群聊消息2', at:2000 });
  incoming({ key: 'group:2', kind: 'group', messageId: '3', stage: 'silent', periodStart: 123, text: '群聊消息3', at:3000 });
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 0);
  assert.equal(plugin.services.tokenBudget.recoveryPending({key:'group:2'}),0,'background-only group window should be settled without a model request');
  incoming({ key: 'group:2', kind: 'group', messageId: '4', stage: 'silent', periodStart: 456, text: '较早的 @', atSelf: true,at:4000 });
  incoming({ key: 'group:2', kind: 'group', messageId: '5', stage: 'silent', periodStart: 456, text: '被截去的背景',at:5000 });
  incoming({ key: 'group:2', kind: 'group', messageId: '6', stage: 'silent', periodStart: 456, text: '新的 @', atSelf: true,at:6000 });
  incoming({ key: 'group:2', kind: 'group', messageId: '7', stage: 'silent', periodStart: 456, text: '保留背景7',at:7000 });
  incoming({ key: 'group:2', kind: 'group', messageId: '8', stage: 'silent', periodStart: 456, text: '保留背景8',at:8000 });
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].messages.map(message=>message.id),['6','7','8'],'latest @ survives even when it predates the ordinary-context window');
  assert.equal(plugin.services.tokenBudget.recoveryPending({key:'group:2'}),5,'failed dispatch must retain pending messages');
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 2);
  accepted = true;
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 3);
  assert.equal(plugin.services.tokenBudget.recoveryPending({key:'group:2'}),0);
  await plugin.hooks.onTick();
  assert.equal(delivered.length, 3);
});

test('maximum recovery window retains its last message without truncating the prompt', async () => {
  let state = {};
  const delivered = [];
  const plugin = createPlugin({
    config: { recoveryWindows: {privateMessages:30,groupMessages:30,groupAtMessages:30} },
    state: { get: () => structuredClone(state), set: (patch) => { state = { ...state, ...structuredClone(patch) }; } },
    capabilities: {
      budgetRecoveryStatus: () => ({ stage: 'normal', allowed: true }),
      dispatchBudgetRecovery: async (request) => { delivered.push(request); return { ok: true }; }
    }
  });
  for (let id = 1; id <= 35; id++) plugin.services.tokenBudget.onSilentIncoming({
    key: 'private:1', kind: 'private', messageId: String(id), stage: 'silent', periodStart: 123,
    text: `第${id}条-${'字'.repeat(480)}`
  });
  await plugin.hooks.onTick();
  assert.equal(delivered[0].messages.length, 30);
  assert.equal(delivered[0].messages[0].id, '6');
  assert.equal(delivered[0].messages.at(-1).id, '35');
  assert.ok(delivered[0].prompt.includes('第35条'));
  assert.ok(delivered[0].prompt.length < 80000);
});

test('hard cap routes private and group inbound messages to mechanical replies only', async () => {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': {
    sessions: { 'private:123': { hardLimitYuan: 0.1 }, 'group:456': { hardLimitYuan: 0.1 } },
    mechanicalPrivateReplies: ['用户我好饿...'], mechanicalGroupReplies: ['咕噜，我在潜水~']
  } } });
  try {
    h.setMode('reserved2');
    const privateSession = await h.ensureSession('private:123');
    const groupSession = await h.ensureSession('group:456');
    h.tokenLedger.ingestEvent(billedEvent(privateSession));
    h.tokenLedger.ingestEvent(billedEvent(groupSession));
    for (let id = 1; id <= 5; id++) await h.handleIncoming('private', 123, {
      self_id: 999, user_id: 123, message_id: id,
      message: [{ type: 'text', data: { text: '你好' } }]
    }, h.cfg);
    await h.handleIncoming('group', 456, {
      self_id: 999, user_id: 222, group_id: 456, message_id: 6,
      message: [{ type: 'text', data: { text: '普通群消息' } }]
    }, h.cfg);
    assert.equal(h.calls.sent.filter(x=>x.kind==='group').length,0,'ordinary group traffic stays silent without occupying the later @ slot');
    await h.handleIncoming('group', 456, {
      self_id: 999, user_id: 222, group_id: 456, message_id: 7,
      message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: 'AI助手' } }]
    }, h.cfg);
    assert.deepEqual(h.calls.sent.map(x => [x.kind, x.text]), [
      ['private', '用户我好饿...'], ['group', '咕噜，我在潜水~']
    ]);
    assert.equal(h.calls.prompts.length, 0);
  } finally { await h.close(); }
});

test('bridge restores only the latest configured messages after the cap is lifted', async () => {
  const h = await bridgeHarness({ config:{socialV2:{persistentMemory:{enabled:false},dailyDiary:{enabled:false}}},files: { 'state/plugins/config/life-token-budget.json': {
    sessions: { 'private:123': { hardLimitYuan: 0.1 } },recoveryWindows:{privateMessages:2,groupMessages:5,groupAtMessages:5}
  } } });
  try {
    h.setMode('reserved2');
    h.setReady(true);
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billedEvent(sid));
    for (let id = 1; id <= 3; id++) await h.handleIncoming('private', 123, {
      self_id: 999, user_id: 123, message_id: id,
      message: [{ type: 'text', data: { text: `恢复消息${id}` } }]
    }, h.cfg);
    assert.equal(h.calls.prompts.length, 0);
    assert.equal(h.pluginHost.callService('tokenBudget', 'recoveryPending', { key: 'private:123' }), 3);
    const config = h.pluginHost.get('life-token-budget').config;
    assert.equal(h.pluginHost.setConfig('life-token-budget', { sessions: {
      ...config.sessions, 'private:123': { ...config.sessions['private:123'], hardLimitYuan: 0 }
    } }).ok, true);
    await h.pluginHost.reload('life-token-budget');
    await h.pluginHost.tick();
    assert.equal(h.calls.prompts.length, 1);
    const submitted = h.calls.prompts[0].content[0].text;
    assert.ok(submitted.includes('恢复消息2'));
    assert.ok(submitted.includes('恢复消息3'));
    assert.ok(!submitted.includes('恢复消息1'));
    await h.pluginHost.tick();
    assert.equal(h.calls.prompts.filter(call => call.content[0].text.includes('额度恢复后的补处理')).length, 1);
  } finally { await h.close(); }
});

test('recovery attaches a still-staged incoming image to the model turn', async () => {
  const h = await bridgeHarness({ config:{socialV2:{persistentMemory:{enabled:false},dailyDiary:{enabled:false}}},files: { 'state/plugins/config/life-token-budget.json': {
    sessions: { 'private:123': { hardLimitYuan: 0.1 } },recoveryWindows:{privateMessages:1,groupMessages:5,groupAtMessages:5}
  } } });
  try {
    h.setMode('reserved2');
    h.setReady(true);
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billedEvent(sid));
    await h.handleIncoming('private', 123, {
      self_id: 999, user_id: 123, message_id: 41,
      message: [{ type: 'image', data: { file: 'fixture-image.png' } }]
    }, h.cfg);
    assert.equal(h.calls.prompts.length, 0);
    const config = h.pluginHost.get('life-token-budget').config;
    h.pluginHost.setConfig('life-token-budget', { sessions: {
      ...config.sessions, 'private:123': { ...config.sessions['private:123'], hardLimitYuan: 0 }
    } });
    await h.pluginHost.reload('life-token-budget');
    await h.pluginHost.tick();
    assert.equal(h.calls.prompts.length, 1);
    assert.ok(h.calls.prompts[0].content.some((part) => part.type === 'image'));
  } finally { await h.close(); }
});

test('global cap blocks direct task and maintenance model prompts', async () => {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': { globalHardLimitYuan: 0.1 } } });
  try {
    h.setMode('reserved2');
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billedEvent(sid));
    await assert.rejects(h.api.sessions.prompt({ sessionId: 'background-task', mode: 'queue', content: [{ type: 'text', text: 'test' }] }), /额度|预算/);
    assert.equal(h.calls.prompts.length, 0);
  } finally { await h.close(); }
});

test('hard cap blocks ordinary queued QQ sends while allowing mechanical replies', async () => {
  const h = await bridgeHarness({ files: { 'state/plugins/config/life-token-budget.json': { globalHardLimitYuan: 0.1 } } });
  try {
    const sid = await h.ensureSession('private:123');
    h.tokenLedger.ingestEvent(billedEvent(sid));
    assert.equal(await h.sendToQQ('private:123', 'ordinary notification'), false);
    assert.equal(h.calls.sent.length, 0);
    assert.equal(await h.sendToQQ('private:123', '机械冒泡', { budgetMechanical: true }), true);
    assert.equal(h.calls.sent.length, 1);
  } finally { await h.close(); }
});

test('console manages separate private and group mechanical reply lists', async () => {
  const h = await bridgeHarness();
  const server = h.startConsoleServer();
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/tokens/budgets/replies`;
    const headers = { 'x-console-token': 'fixture-console-token' };
    const get = async () => fetch(url, { headers }).then(async response => ({ status: response.status, data: await response.json() }));
    const post = async (body, extraHeaders = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extraHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async response => ({ status: response.status, data: await response.json() }));
    const initial = await get();
    assert.equal(initial.status, 200);
    assert.ok(initial.data.privateReplies.length >= 2);
    assert.ok(initial.data.groupReplies.length >= 2);
    assert.equal((await post({ privateReplies: [], groupReplies: ['hi'] })).status, 400);
    assert.equal((await post({ privateReplies: ['私聊词条'], groupReplies: ['群聊词条'] }, { 'x-agent-token': 'forbidden' })).status, 403);
    assert.equal((await post({ privateReplies: ['私聊词条'], groupReplies: ['群聊词条'] })).status, 200);
    const saved = await get();
    assert.deepEqual(saved.data.privateReplies, ['私聊词条']);
    assert.deepEqual(saved.data.groupReplies, ['群聊词条']);
  } finally { await new Promise(resolve => server.close(resolve)); await h.close(); }
});

test('console validates and persists each private/group/group-at recovery window', async () => {
  const h = await bridgeHarness();
  const server = h.startConsoleServer();
  try {
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/tokens/budgets`;
    const headers = { 'x-console-token': 'fixture-console-token', 'content-type': 'application/json' };
    const base = {privateMessages:7,groupMessages:8,groupAtMessages:9};
    const post = (body) => fetch(url+'/recovery-windows', { method: 'POST', headers, body: JSON.stringify(body) });
    for(const field of Object.keys(base))for(const invalid of [0,31,2.5])assert.equal((await post({...base,[field]:invalid})).status,400,`${field} rejects ${invalid}`);
    assert.equal((await post(base)).status, 200);
    const data = await fetch(url, { headers }).then(response => response.json());
    assert.deepEqual(data.recoveryWindows,base);
    assert.deepEqual(h.pluginHost.callService('tokenBudget','recoveryWindows'),base,'saved windows must survive the API-triggered component reload');
  } finally { await new Promise(resolve => server.close(resolve)); await h.close(); }
});
