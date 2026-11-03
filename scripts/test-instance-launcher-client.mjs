import test from 'node:test';
import assert from 'node:assert/strict';
import {clientFixture} from './instance-launcher-client-fixture.mjs';

test('A/B/external DOM, requests, settings and disposal are independently owned', async t => {
  const p = await clientFixture(t); p.add('a', 4199); p.add('b', 5199);
  const external = { isConnected: true }; p.body.children.push(external);
  const a = p.mount('a'), b = p.mount('b'); await p.flush();
  assert.ok(p.nodes.get('qq-launcher-a-button')); const bNode = p.nodes.get('qq-launcher-b-button');
  await p.click('a', 'button'); await p.click('a', 'button');
  assert.equal(p.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(p.requests.find(r => r.method === 'POST').url, 'http://127.0.0.1:4199/start');
  assert.equal(p.opened[0][0], 'http://127.0.0.1:4200');
  await p.click('a', 'settings'); assert.equal(p.nodes.get('qq-launcher-a-settings-panel').style.display, 'block');
  assert.equal(p.nodes.get('qq-launcher-b-settings-panel').style.display, 'none');
  p.nodes.get('qq-launcher-a-port-launcher').value = '4299'; await p.submit('a');
  await p.click('a', 'stop'); assert.equal(p.requests.at(-1).url, 'http://127.0.0.1:4299/stop');
  a.dispose(); assert.equal(p.nodes.get('qq-launcher-b-button'), bNode); assert.equal(bNode.isConnected, true);
  assert.equal(external.isConnected, true); assert.equal(p.body.children.length, 2); b.dispose(); assert.equal(p.body.children.length, 1);
  assert.equal(p.timers.size, 0); assert.equal(p.events.get('resize').size, 0);
});

test('old responses and old disposers cannot overwrite a moved or re-enabled instance', async t => {
  const p = await clientFixture(t); p.add('a', 4199); const a = p.mount('a'); await p.flush();
  let resolve; p.pending.set('http://127.0.0.1:4199/status', () => new Promise(r => resolve = r));
  const old = p.tick(); await p.flush();
  await p.click('a', 'settings'); p.nodes.get('qq-launcher-a-port-launcher').value = '4299'; await p.submit('a');
  const titleAfterSave=p.nodes.get('qq-launcher-a-button').title;
  resolve({ ok: true, json: async () => ({ ok: true, instanceId: 'a', generation: 'a-1', serviceUrl: 'http://127.0.0.1:4199', runtime: { state: 'running' } }) }); await old;
  assert.equal(p.nodes.get('qq-launcher-a-button').title,titleAfterSave,'obsolete status cannot repaint the moved instance');
  await p.click('a', 'stop'); assert.ok(p.requests.some(r => r.url === 'http://127.0.0.1:4299/stop'));
  a.dispose(); p.registry.a = { ...p.registry.a, generation: 'a-enabled', serviceUrl: 'http://127.0.0.1:4399' };
  const next = p.mount('a'); await p.flush(); a.dispose(); await p.click('a', 'stop');
  assert.ok(p.requests.some(r => r.url === 'http://127.0.0.1:4399/stop')); next.dispose();
});

test('authoritative discovery absence never falls back to initial HTML or a fixed port', async t => {
  const p = await clientFixture(t); p.add('a', 4199); const identity = p.registry.a; delete p.registry.a;
  const s = { connection: { rpc: { call: async () => ({ ok: true, value: {} }) } }, on() {} };
  const dispose = p.api.mountBotLauncher(s, { instanceId: 'a', clientModuleId: identity.clientModuleId }); t.after(dispose);
  await p.flush(); assert.equal(p.requests.length, 0); assert.match(p.nodes.get('qq-launcher-a-button').title, /发现|等待|不可用/);
});

test('connection reset rejects an in-flight save transition and requires fresh settings', async t => {
  const p = await clientFixture(t); p.add('a', 4199); const a = p.mount('a'); await p.flush();
  await p.click('a','settings');
  let resolve; p.pending.set('http://127.0.0.1:4199/config', () => new Promise(r => resolve = r));
  p.nodes.get('qq-launcher-a-port-launcher').value = '4299'; const saving = p.submit('a'); await p.flush();
  p.registry.a = { ...p.registry.a, serviceUrl: 'http://127.0.0.1:4399', generation: 'a-reset' };
  a.listeners.get('connection/reset')();
  resolve({ ok: true, json: async () => ({ ...p.configs.a, ok:true, instanceId:'a', serviceUrl:'http://127.0.0.1:4299',generation:'old-save-next',message:'late saved' }) }); await saving;
  assert.equal(p.nodes.get('qq-launcher-a-settings-save').disabled,true);
  assert.doesNotMatch(p.nodes.get('qq-launcher-a-settings-message').textContent,/late saved/);
  await p.click('a','stop'); assert.equal(p.requests.at(-1).url,'http://127.0.0.1:4399/stop');
  assert.equal(p.requests.at(-1).body.generation,'a-reset');
});

test('wrong response instance identity and later discovery absence cannot send a mutation', async t => {
  const p=await clientFixture(t);p.add('a',4199);p.mount('a');await p.flush();
  p.pending.set('http://127.0.0.1:4199/config',async()=>({ok:true,json:async()=>({...p.configs.a,ok:true,instanceId:'b',generation:'a-1',serviceUrl:'http://127.0.0.1:4199'})}));
  await p.click('a','button');assert.equal(p.requests.some(x=>x.method==='POST'),false);
  delete p.registry.a;const count=p.requests.length;await p.tick();await p.click('a','stop');assert.equal(p.requests.length,count);
});

test('a status read issued before stop cannot repaint its later successful result',async t=>{
  const p=await clientFixture(t);p.add('a',4199);p.statuses.a='running';p.mount('a');await p.flush();
  let resolve;p.pending.set('http://127.0.0.1:4199/status',()=>new Promise(r=>resolve=r));const old=p.tick();await p.flush();
  await p.click('a','stop');assert.match(p.nodes.get('qq-launcher-a-button').title,/已停止/);
  resolve({ok:true,json:async()=>({ok:true,instanceId:'a',generation:'a-1',serviceUrl:'http://127.0.0.1:4199',runtime:{state:'running'}})});await old;
  assert.match(p.nodes.get('qq-launcher-a-button').title,/已停止/);
});

test('a polling discovery cannot cancel a user start waiting for the same fresh snapshot',async t=>{
  const p=await clientFixture(t);p.add('a',4199);p.mount('a');await p.flush();let resolve;
  const waiting=new Promise(r=>resolve=r);p.discovery.read=()=>waiting;
  const action=p.click('a','button');await p.flush();const polling=p.tick();
  resolve({ok:true,value:structuredClone(p.registry)});await Promise.all([action,polling]);
  assert.equal(p.requests.filter(x=>x.url.endsWith('/start')).length,1);
});

test('discovery rejects non-local, credentialed, non-root and invalid-port addresses',async t=>{
  for(const serviceUrl of ['http://127.0.0.1:0','https://127.0.0.1:4199','http://remote.example.test:4199','http://user:pass@127.0.0.1:4199','http://127.0.0.1:4199/private']){
    const p=await clientFixture(t);p.add('a',4199);p.registry.a.serviceUrl=serviceUrl;p.mount('a');await p.flush();assert.equal(p.requests.length,0,serviceUrl);
  }
});

test('an initially unavailable native RPC retries fresh discovery without HTML fallback',async t=>{
  const p=await clientFixture(t);p.add('a',4199);p.discovery.read=async()=>{throw Error('native channel pending');};p.mount('a');await p.flush();assert.equal(p.requests.length,0);
  p.discovery.read=async()=>({ok:true,value:structuredClone(p.registry)});await p.tick();await p.click('a','button');assert.equal(p.requests.filter(x=>x.url.endsWith('/start')).length,1);
});

test('late native menu and geometry changes reposition existing A/B without resize or new timers',async t=>{
  const p=await clientFixture(t);p.add('a',4199);p.add('b',5199);const a=p.mount('a'),b=p.mount('b');await p.flush();
  const shared=p.body.children[0],bNode=p.nodes.get('qq-launcher-b-button');
  assert.equal(shared.style.left,'12px');assert.equal(shared.style.top,'8px');assert.equal(p.timers.size,2);
  const rect={right:168,width:120,height:40};p.insertMenu(rect);await p.tick();
  assert.equal(shared.style.left,'174px');assert.equal(shared.style.top,'0px');assert.equal(shared.style.height,'40px');
  rect.right=184;await p.tick();assert.equal(shared.style.left,'190px');
  assert.equal(p.nodes.get('qq-launcher-b-button'),bNode);assert.equal(p.timers.size,2);assert.equal(p.events.get('resize').size,1);
  a.dispose();assert.equal(p.nodes.get('qq-launcher-b-button'),bNode);assert.equal(p.body.children.includes(shared),true);assert.equal(p.timers.size,1);
  b.dispose();assert.equal(p.body.children.includes(shared),false);assert.equal(p.body.children.length,1);assert.equal(p.timers.size,0);assert.equal(p.events.get('resize').size,0);
});
