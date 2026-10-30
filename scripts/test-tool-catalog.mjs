import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

test('tool inventory displays short names in alphabetical order and retains complete call IDs on hover', async () => {
  const {toolRows}=await import('../console/layers/T/tool-inventory.js');
  const tools=[{name:'core_status',qualifiedName:'mcp__personal-core__core_status',server:'personal-core',description:'状态'},
    {name:'alpha',qualifiedName:'mcp__snowluma__alpha',server:'snowluma',description:'首项'}];
  const html=toolRows(tools);
  assert.ok(html.indexOf('>alpha</code>')<html.indexOf('>core_status</code>'));
  assert.ok(html.includes('title="mcp__personal-core__core_status"'));
  assert.ok(!html.includes('>mcp__'));
  assert.equal(tools[0].name,'core_status');
});
test('removed registrations remain visible when an existing request still carries their schemas', async () => {
  const { mergeToolEvidence } = await import('../src/tools/catalog.js');
  assert.equal(typeof mergeToolEvidence,'function');
  const rows=mergeToolEvidence([{name:'snowluma',audience:'qq',layer:'T',ok:true,tools:[{name:'new_tool'}]}],[{preset:'qq-chat-v2',names:['mcp__snowluma__old_tool','mcp__codex-peer__codex_chat_send']}]);
  assert.equal(rows.find(x=>x.name==='old_tool').registered,false);
  assert.equal(rows.find(x=>x.name==='old_tool').botInjectedSessions,1);
  assert.equal(rows.find(x=>x.name==='codex_chat_send').audience,'admin');
  assert.equal(rows.find(x=>x.name==='new_tool').botInjectedSessions,0);
});
test('tool injection evidence follows the latest actual request header across zstd frames', async () => {
  const { toolHeaderFromFrames } = await import('../src/tools/session-evidence.js');
  const pack=x=>zlib.zstdCompressSync(Buffer.from(JSON.stringify(x)+'\n'));
  const input=Buffer.concat([pack({type:'session',agentPreset:'qq-chat-v2'}),pack({type:'user/message',data:{content:'must never leave the reader'}}),pack({type:'request/header',time:'old',data:{header:{tools:[{name:'old_tool'}]}}}),pack({type:'request/header',time:'latest',data:{header:{tools:[{name:'mcp__snowluma__qq_send_message'}]}}})]);
  const result=toolHeaderFromFrames(input);
  assert.deepEqual(result.names,['mcp__snowluma__qq_send_message']);
  assert.equal(result.preset,'qq-chat-v2');
  assert.equal(JSON.stringify(result).includes('must never leave'),false);
});
test('admin MCP schemas stay excluded when a late server registers its tools', async () => {
  const { installWhaleToolVisibility } = await import('../plugins/qq-agent-presets/tool-visibility.mjs');
  const names=['mcp__snowluma__qq_send_message','mcp__codex-peer__codex_chat_send'];
  const denied=[];let changed;
  installWhaleToolVisibility({tools:{schemas:()=>names.map(name=>({name})),restrict:({deny})=>denied.push(...deny)},on:(event,handler)=>{assert.equal(event,'tools/change');changed=handler;}});
  assert.deepEqual(denied,['mcp__codex-peer__codex_chat_send']);
  names.push('mcp__bridge-health__bridge_health'); changed(); changed();
  assert.deepEqual(denied,['mcp__codex-peer__codex_chat_send','mcp__bridge-health__bridge_health']);
});
