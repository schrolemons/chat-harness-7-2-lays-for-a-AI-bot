import test from 'node:test';
import assert from 'node:assert/strict';
import {clientFixture} from './instance-launcher-client-fixture.mjs';

async function page(t, options={}) {
 const p=await clientFixture(t);p.add('a',4199);if(options.unconfigured){p.configs.a.botUin='';p.configs.a.configured=false;}
 let current=p.mount('a');await p.flush();
 return {...p, async reload(){const old=current;current=p.mount('a');await p.flush();return old.dispose;}};
}
test('first click starts once; a second click opens this instance console',async t=>{
 const p=await page(t);await p.click('a','button');await p.click('a','button');
 assert.deepEqual(p.requests.filter(x=>x.method==='POST').map(x=>x.url),['http://127.0.0.1:4199/start']);assert.equal(p.opened[0][0],'http://127.0.0.1:4200');
});
test('missing bot QQ opens independently owned required settings; cancel never starts',async t=>{
 const p=await page(t,{unconfigured:true});await p.click('a','button');
 assert.equal(p.nodes.get('qq-launcher-a-settings-panel').style.display,'block');assert.equal(p.nodes.get('qq-launcher-a-bot-qq').required,true);
 await p.click('a','settings-cancel');assert.equal(p.requests.some(x=>x.method==='POST'),false);
});
test('empty QQ blocks saving; valid configuration saves and continues the requested start',async t=>{
 const p=await page(t,{unconfigured:true});await p.click('a','button');await p.submit('a');assert.equal(p.requests.some(x=>x.method==='POST'),false);
 p.nodes.get('qq-launcher-a-bot-qq').value='123456789';await p.submit('a');
 assert.deepEqual(p.requests.filter(x=>x.method==='POST').map(x=>x.url.split('/').at(-1)),['config','start']);
});
test('restart, stop and start remain explicit independently routed controls',async t=>{
 const p=await page(t);await p.click('a','restart');await p.click('a','stop');await p.click('a','button');
 assert.deepEqual(p.requests.filter(x=>x.method==='POST').map(x=>x.url.split('/').at(-1)),['restart','stop','start']);
 assert.equal(p.nodes.get('qq-launcher-a-stop').textContent,'停止');
});
test('last-instance hot reload replaces only its widget; old disposer cannot remove the replacement',async t=>{
 const p=await page(t);for(let i=0;i<4;i++){const old=await p.reload();old();}
 assert.equal(p.body.children.length,1);assert.equal(p.body.children[0].isConnected,true);assert.equal(p.timers.size,1);assert.equal(p.events.get('resize').size,1);
});
test('spawned runtime is labelled pending connection confirmation and never shown as QQ ready',async t=>{
 const p=await page(t);p.statuses.a='running';await p.tick();assert.match(p.nodes.get('qq-launcher-a-button').title,/连接状态待确认/);
 p.statuses.a='stopped';await p.tick();assert.match(p.nodes.get('qq-launcher-a-button').title,/已停止/);
});
test('all six ports roundtrip and port changes survive a full client reload through live discovery',async t=>{
 const p=await page(t);await p.click('a','settings');
 for(const key of ['dsh','console','snowHttp','snowWs','launcher','snowWebui'])assert.ok(p.nodes.get('qq-launcher-a-port-'+key).value);
 p.nodes.get('qq-launcher-a-port-launcher').value='4299';await p.submit('a');await p.reload();await p.click('a','stop');
 assert.equal(p.requests.at(-1).url,'http://127.0.0.1:4299/stop');
 const patch=p.requests.find(x=>x.method==='POST'&&x.url.endsWith('/config')).body;assert.equal(patch.revision,'initial');assert.equal(patch.instanceId,'a');assert.equal(patch.generation,'a-1');
});
test('invalid or duplicate ports block writes while retaining an editable form',async t=>{
 const p=await page(t);await p.click('a','settings');for(const value of ['0','65536','3000','12.5','4e3','']){
 p.nodes.get('qq-launcher-a-port-launcher').value=value;await p.submit('a');assert.equal(p.requests.some(x=>x.method==='POST'),false);assert.match(p.nodes.get('qq-launcher-a-settings-message').textContent,/端口/);assert.equal(p.nodes.get('qq-launcher-a-settings-save').disabled,false);}
});
test('HTTP default port 80 remains canonical after save and reload',async t=>{
 const p=await page(t);await p.click('a','settings');p.nodes.get('qq-launcher-a-port-launcher').value='80';await p.submit('a');await p.reload();await p.click('a','stop');
 assert.equal(p.requests.at(-1).url,'http://127.0.0.1/stop');
});
