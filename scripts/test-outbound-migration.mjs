import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ids = ['ctx-user-mood', 'life-wake-reasons', 'ctx-chat-reply-shape', 'ctx-chat-topic-drive'];
const manifests = Object.fromEntries(ids.map(id => [id, JSON.parse(fs.readFileSync(new URL('../plugins/qq-components/' + id + '/plugin.json', import.meta.url), 'utf8'))]));
// This independent fixture states the new send contract, before Task3 changes its manifest.
manifests['ctx-chat-reply-shape'].config = {
  maxMessagesNormal: 2, maxMessagesCasual: 3, maxMessagesSerious: 1, longIncomingChars: 60,
  intervalMinMs: 1500, intervalMaxMs: 3000, longGapProbability: .1,
  longGapMinMs: 4000, longGapMaxMs: 8000, maxSendPerMinute: 8, maxSendPerHour: 100, maxMessageChars: 500
};
const now = Date.UTC(2026, 9, 29, 14);
const legacy = () => ({
  consoleToken: 'fixture-secret-stays-local', ownerQQ: '10001', socialV2: {
    mood: { initial: 60, enabled: true, decayPerHour: 1, lowThreshold: 45, recoverMinutes: 20, politeBonus: 22, neutralBonus: 8, rudePenalty: 28, mutePenalty: 12 },
    send: { burstEnabled: true, burstMaxMessages: 3, burstIntervalMinMs: 1500, burstIntervalMaxMs: 3000, longGapProbability: .1, longGapMinMs: 4000, longGapMaxMs: 8000, maxSendPerMinute: 8, maxSendPerHour: 100, maxMessageChars: 500 },
    proactive: { enabled: true, idleThresholdMs: 1200000, probability: .15, checkIntervalMinMs: 3600000, checkIntervalMaxMs: 7200000 },
    care: { enabled: true, minIntervalMin: 90, maxIntervalMin: 240, probability: 1 },
    idleRescue: { enabled: true, idleMinutes: 180 }, curfew: { enabled: true, startHour: 0, endHour: 7 },
    tools: { slangQuery: false }, wait: { maxMs: 12345 }, dailyNews: { enabled: true }
  }
});
const overrides = () => ({
  'ctx-chat-reply-shape': { maxMessagesNormal: 3, maxMessagesCasual: 3, maxMessagesSerious: 3, longIncomingChars: 3 },
  'ctx-chat-topic-drive': { followUpProbability: .5, newTopicProbability: .35, followUpCooldownMinutes: 8, newTopicCooldownMinutes: 45, newTopicMaxPerHour: 2 }
});
async function module() { return import('../src/migrations/outbound-mood.mjs'); }

test('migration unifies owners while preserving actual settings and private credentials', async () => {
  const { planOutboundMigration } = await module();
  const original = legacy(), before = structuredClone(original);
  const result = planOutboundMigration({ config: original, overrides: overrides(), manifests, now });
  assert.deepEqual(original, before);
  assert.equal(result.config.consoleToken, before.consoleToken);
  for (const key of ['mood', 'send', 'proactive', 'care', 'idleRescue', 'curfew', 'conversationDrive', 'replyShape']) assert.equal(Object.hasOwn(result.config.socialV2, key), false, key);
  assert.deepEqual(result.config.socialV2.wait, before.socialV2.wait);
  assert.equal(result.config.socialV2.tools.slangQuery, false);
  assert.equal(result.config.socialV2.tools.mood, true);
  const p = result.overrides['life-wake-reasons'];
  assert.equal(p.silenceMinutes, 20); assert.equal(p.initialProbability, .15);
  assert.equal(p.checkMinMinutes, 60); assert.equal(p.checkMaxMinutes, 120);
  assert.equal(p.minActiveGapMinutes, 90); assert.equal(p.maxSilenceMinutes, 180);
  assert.equal(p.curfewStartHour, 0); assert.equal(p.curfewEndHour, 7);
  const m = result.overrides['ctx-user-mood'];
  assert.equal(m.modeThreshold, 40); assert.equal(m.recoverMinutes, 20);
  assert.equal(m.positiveRules.find(rule => rule.id === 'praise-care').delta, 22);
  assert.equal(m.negativeRules.find(rule => rule.id === 'insult-offense').delta, -28);
  const s = result.overrides['ctx-chat-reply-shape'];
  assert.equal(s.maxMessagesSerious, 3); assert.equal(s.intervalMinMs, 1500); assert.equal(s.longIncomingChars, 20);
  for (const [id, value] of Object.entries(result.overrides)) assert.deepEqual(Object.keys(value).sort(), Object.keys(manifests[id].config).sort());
});

test('migration seeds preserve effective old mood, real rate history, zero and new owned config', async () => {
  const { planOutboundMigration } = await module();
  const source = legacy(); source.socialV2.mood.decayPerHour = 2;
  const current = overrides(); current['ctx-user-mood'] = { modeThreshold: 33, initial: 0, recoverMinutes: 0, positiveRules: [] };
  const socialState = { paused: true, conversations: {
    'private:10001': { moodScore: 0, moodUpdatedAt: now, sendTimes: [now - 500, now - 3600001, 'bad', now + 5000] },
    'group:20001': { moodScore: 80, moodUpdatedAt: now - 3600000, sendTimes: [now - 1000] }
  } };
  const result = planOutboundMigration({ config: source, overrides: current, manifests, socialState, now });
  assert.deepEqual(result.moodSeed.conversations, [{ key: 'private:10001', score: 0 }, { key: 'group:20001', score: 78 }]);
  assert.deepEqual(result.replySeed.conversations[0], { key: 'private:10001', sendTimes: [now - 500] });
  assert.equal(result.overrides['ctx-user-mood'].modeThreshold, 33);
  assert.equal(result.overrides['ctx-user-mood'].initial, 0);
  assert.equal(result.overrides['ctx-user-mood'].recoverMinutes, 0);
  assert.deepEqual(result.overrides['ctx-user-mood'].positiveRules, []);
  const again = planOutboundMigration({ config: result.config, overrides: result.overrides, manifests, socialState, now });
  assert.deepEqual(again.config, result.config); assert.deepEqual(again.overrides, result.overrides);
});

test('disabled burst migrates into the only per-turn caps and invalid endpoint ranges are explicit', async () => {
  const { planOutboundMigration } = await module();
  const source = legacy(); source.socialV2.send.burstEnabled = false;
  const result = planOutboundMigration({ config: source, overrides: overrides(), manifests, now });
  assert.deepEqual(['Normal', 'Casual', 'Serious'].map(kind => result.overrides['ctx-chat-reply-shape']['maxMessages' + kind]), [1, 1, 1]);
  source.socialV2.proactive.checkIntervalMinMs = 8000000;
  source.socialV2.proactive.checkIntervalMaxMs = 1000000;
  assert.throws(() => planOutboundMigration({ config: source, manifests, now }), /checkMinMinutes|区间|range/);
});

test('a partial source deployment cannot silently drop migrated send settings', async () => {
  const { planOutboundMigration } = await module();
  const incomplete = structuredClone(manifests); delete incomplete['ctx-chat-reply-shape'].config.intervalMinMs;
  assert.throws(() => planOutboundMigration({ config: legacy(), manifests: incomplete, now }), /拥有源|contract|intervalMinMs/);
});

test('already-canonical values use their owner limits and malformed rule arrays do not disappear', async () => {
  const { planOutboundMigration } = await module();
  const current = overrides(); current['ctx-chat-reply-shape'].maxMessagesNormal = 7;
  const result = planOutboundMigration({ config: { socialV2: {} }, overrides: current, manifests, now });
  assert.equal(result.overrides['ctx-chat-reply-shape'].maxMessagesNormal, 7);
  current['ctx-user-mood'] = { positiveRules: [{ id: 'bad', label: 'wrong sign', delta: -2, description: 'invalid' }] };
  assert.throws(() => planOutboundMigration({ config: legacy(), overrides: current, manifests, now }), /规则|分值|positiveRules/);
});

test('bootstrap snapshots sources, writes seeds and is a true once-only operation', async () => {
  const { migrateOutboundMood } = await module();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-outbound-migrate-'));
  try {
    fs.mkdirSync(path.join(root, 'state/plugins/config'), { recursive: true });
    for (const id of ids) { const dir = path.join(root, 'plugins/qq-components', id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifests[id])); }
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(legacy()));
    fs.writeFileSync(path.join(root, 'state/social-v2.json'), JSON.stringify({ conversations: { 'private:10001': { moodScore: 0, moodUpdatedAt: now } } }));
    const profile = path.join(root, 'state/person-profiles.json'); fs.writeFileSync(profile, 'private profile remains unchanged');
    const result = migrateOutboundMood(root, { now }); assert.equal(result.applied, true);
    const seed = JSON.parse(fs.readFileSync(path.join(root, 'state/migrations/outbound-mood-seeds.json'), 'utf8'));
    assert.equal(seed.mood.conversations[0].score, 0);
    assert.equal(fs.readFileSync(profile, 'utf8'), 'private profile remains unchanged');
    assert.ok(result.backupDir.startsWith(path.join(root, 'state/audits/')));
    assert.equal(fs.readFileSync(path.join(result.backupDir, 'config.json'), 'utf8'), JSON.stringify(legacy()));
    const moodFile = path.join(root, 'state/plugins/config/ctx-user-mood.json');
    const later = JSON.parse(fs.readFileSync(moodFile, 'utf8')); later.modeThreshold = 12; fs.writeFileSync(moodFile, JSON.stringify(later));
    assert.equal(migrateOutboundMood(root, { now: now + 86400000 }).applied, false);
    assert.equal(JSON.parse(fs.readFileSync(moodFile, 'utf8')).modeThreshold, 12);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('interrupted conversion resumes only matching files and refuses concurrent edits', async () => {
  const { migrateOutboundMood } = await module();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-outbound-resume-'));
  try {
    for (const id of ids) { const dir = path.join(root, 'plugins/qq-components', id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifests[id])); }
    const configFile = path.join(root, 'config.json'); fs.writeFileSync(configFile, JSON.stringify(legacy()));
    migrateOutboundMood(root, { now });
    const marker = path.join(root, 'state/migrations/outbound-mood-v1.json');
    const completed = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const prepared = { ...completed, phase: 'prepared', files: completed.files.map(file => ({ ...file, after: fs.readFileSync(path.join(root, file.relative), 'utf8') })) };
    // A crash after some writes: config is old, the other files already match after hashes.
    fs.copyFileSync(path.join(root, completed.backupRelative, 'config.json'), configFile);
    fs.writeFileSync(marker, JSON.stringify(prepared));
    assert.equal(migrateOutboundMood(root, { now: now + 1 }).applied, true);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(configFile, 'utf8')).socialV2, 'mood'), false);
    fs.writeFileSync(marker, JSON.stringify(prepared));
    const changed = JSON.parse(fs.readFileSync(configFile, 'utf8')); changed.ownerQQ = '10002';
    fs.writeFileSync(configFile, JSON.stringify(changed));
    const shape = path.join(root, 'state/plugins/config/ctx-chat-reply-shape.json'), shapeBefore = fs.readFileSync(shape);
    assert.throws(() => migrateOutboundMood(root, { now: now + 2 }), /已被其他工作修改/);
    assert.deepEqual(fs.readFileSync(shape), shapeBefore);
    assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).ownerQQ, '10002');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('malformed real data fails before any configuration write', async () => {
  const { migrateOutboundMood } = await module();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-outbound-invalid-'));
  try {
    for (const id of ids) { const dir = path.join(root, 'plugins/qq-components', id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifests[id])); }
    const configFile = path.join(root, 'config.json'), original = JSON.stringify(legacy()); fs.writeFileSync(configFile, original);
    fs.mkdirSync(path.join(root, 'state'), { recursive: true }); fs.writeFileSync(path.join(root, 'state/social-v2.json'), '{malformed');
    assert.throws(() => migrateOutboundMood(root, { now }), SyntaxError);
    assert.equal(fs.readFileSync(configFile, 'utf8'), original);
    assert.equal(fs.existsSync(path.join(root, 'state/migrations/outbound-mood-v1.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('complete owner contract rejects missing preserved keys before planning',async()=>{
 const {planOutboundMigration}=await module();
 for(const [id,key] of [['ctx-user-mood','initial'],['life-wake-reasons','curfewEnabled'],['ctx-chat-topic-drive','dailyLimit']]){
  const partial=structuredClone(manifests);delete partial[id].config[key];
  assert.throws(()=>planOutboundMigration({config:legacy(),manifests:partial,now}),/contract/);
 }
});
function migrationFixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'outbound-race-'));
 for(const id of ids){const dir=path.join(root,'plugins/qq-components',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify(manifests[id]));}
 fs.mkdirSync(path.join(root,'state/plugins/config'),{recursive:true});
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(legacy()));
 fs.writeFileSync(path.join(root,'state/social-v2.json'),JSON.stringify({conversations:{'private:10001':{moodScore:19,moodUpdatedAt:now}}}));
 return root;
}
test('first prepare refuses config and override edits between input reads',async()=>{
 const {migrateOutboundMood}=await module();
 for(const relative of ['config.json','state/plugins/config/ctx-user-mood.json']){
  const root=migrationFixture(),original=fs.readFileSync;
  const file=path.join(root,relative),latest=relative==='config.json'?JSON.stringify({...legacy(),ownerQQ:'10002'}):JSON.stringify({initial:23});
  let changed=false;
  try{
   fs.readFileSync=function(target,...args){if(String(target)===path.join(root,'state/social-v2.json')&&!changed){changed=true;fs.writeFileSync(file,latest);}return original.call(fs,target,...args);};
   assert.throws(()=>migrateOutboundMood(root,{now}),/已被其他工作修改/);
   assert.equal(original(file,'utf8'),latest);assert.equal(fs.existsSync(path.join(root,'state/migrations/outbound-mood-v1.json')),false);
  }finally{fs.readFileSync=original;fs.rmSync(root,{recursive:true,force:true});}
 }
});
test('read-only seed sources are backed up and verified on interrupted resume',async()=>{
 const {migrateOutboundMood}=await module(),root=migrationFixture();
 try{
  const social=path.join(root,'state/social-v2.json'),before=fs.readFileSync(social);
  const result=migrateOutboundMood(root,{now});assert.deepEqual(fs.readFileSync(path.join(result.backupDir,'state/social-v2.json')),before);
  const marker=path.join(root,'state/migrations/outbound-mood-v1.json'),complete=JSON.parse(fs.readFileSync(marker,'utf8'));
  assert.ok(complete.sources.some(x=>x.relative==='state/social-v2.json'));
  fs.writeFileSync(marker,JSON.stringify({...complete,phase:'prepared',files:complete.files.map(x=>({...x,after:fs.readFileSync(path.join(root,x.relative),'utf8')}))}));
  fs.writeFileSync(social,JSON.stringify({conversations:{}}));
  assert.throws(()=>migrateOutboundMood(root,{now:now+1}),/已被其他工作修改/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown completed migration version is rejected',async()=>{
 const {migrateOutboundMood}=await module(),root=migrationFixture();
 try{const folder=path.join(root,'state/migrations');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'outbound-mood-v1.json'),JSON.stringify({version:99,phase:'complete'}));assert.throws(()=>migrateOutboundMood(root,{now}),/未知/);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('disabled old voice quota is retired without tightening all chat traffic',async()=>{
 const {planOutboundMigration}=await module(),config=legacy();
 config.socialV2.voice={enabled:false,maxPerMinute:2,maxPerHour:10,dir:'audio',maxSeconds:300,maxBytes:20000000};
 const result=planOutboundMigration({config,manifests,now});
 assert.deepEqual(result.config.socialV2.voice,{enabled:false,dir:'audio',maxSeconds:300,maxBytes:20000000});
 assert.equal(result.overrides['ctx-chat-reply-shape'].maxSendPerMinute,8);
 assert.equal(result.overrides['ctx-chat-reply-shape'].maxSendPerHour,100);
});
