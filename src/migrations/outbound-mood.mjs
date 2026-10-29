// One-time conversion only. Runtime policy and state remain owned by components.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateProactivePolicy } from '../../plugins/qq-components/life-wake-reasons/proactive-policy.mjs';
import { validateMoodConfig } from '../../plugins/qq-components/ctx-user-mood/policy.mjs';
import { validateReplyPolicy } from '../reply-shape.js';

const IDS = ['ctx-user-mood', 'life-wake-reasons', 'ctx-chat-reply-shape', 'ctx-chat-topic-drive'];
const RETIRED = ['mood', 'send', 'proactive', 'care', 'idleRescue', 'curfew', 'conversationDrive', 'replyShape'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const present = (value, fallback) => value === undefined ? fallback : value;
const number = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const pick = (defaults, values) => Object.fromEntries(Object.keys(defaults).map(key => [key, structuredClone(present(values[key], defaults[key]))]));
const bounded = (value, min, max) => Math.max(min, Math.min(max, value));

function migratedRules(defaults, old, negative = false) {
  const mapping = negative ? { 'explicit-annoyance': 'mutePenalty', 'insult-offense': 'rudePenalty' }
    : { 'friendly-greeting': 'neutralBonus', 'engaged-response': 'neutralBonus', 'praise-care': 'politeBonus' };
  return defaults.flatMap(rule => {
    const magnitude = old[mapping[rule.id]];
    if (magnitude === 0) return [];
    return [{ ...rule, ...(typeof magnitude === 'number' && Number.isFinite(magnitude) && magnitude > 0
      ? { delta: bounded(magnitude, 0, 100) * (negative ? -1 : 1) } : {}) }];
  });
}

export function planOutboundMigration({ config = {}, overrides = {}, socialState = {}, manifests, now = Date.now() } = {}) {
  if (!Number.isFinite(now)) throw Error('无效迁移时间');
  for (const id of IDS) if (!manifests?.[id]?.config) throw Error('缺少迁移拥有源：' + id);
  // Fixed v1 contract: a partially deployed manifest must never shrink ownership.
  const required = {
  "ctx-user-mood": {
    "enabled": "boolean",
    "initial": "number",
    "noReplyAfterMinutes": "number",
    "modeThreshold": "number",
    "normalName": "string",
    "criticalName": "string",
    "normalStyle": "string",
    "criticalStyle": "string",
    "maxAdjustment": "number",
    "burstEnabled": "boolean",
    "recoverMinutes": "number",
    "positiveRules": "array",
    "negativeRules": "array"
  },
  "life-wake-reasons": {
    "disabledReasons": "array",
    "proactiveEnabled": "boolean",
    "silenceMinutes": "number",
    "initialProbability": "number",
    "probabilityStep": "number",
    "probabilityMax": "number",
    "checkMinMinutes": "number",
    "checkMaxMinutes": "number",
    "intervalStepMinutes": "number",
    "checkFloorMinutes": "number",
    "minActiveGapMinutes": "number",
    "maxSilenceMinutes": "number",
    "initialWillingness": "number",
    "activityWillingnessDelta": "number",
    "purposeWillingnessDelta": "number",
    "curfewEnabled": "boolean",
    "curfewStartHour": "number",
    "curfewEndHour": "number"
  },
  "ctx-chat-reply-shape": {
    "maxMessagesNormal": "number",
    "maxMessagesCasual": "number",
    "maxMessagesSerious": "number",
    "longIncomingChars": "number",
    "intervalMinMs": "number",
    "intervalMaxMs": "number",
    "longGapProbability": "number",
    "longGapMinMs": "number",
    "longGapMaxMs": "number",
    "maxSendPerMinute": "number",
    "maxSendPerHour": "number",
    "maxMessageChars": "number"
  },
  "ctx-chat-topic-drive": {
    "privateFollowupEnabled": "boolean",
    "minIntervalMinutes": "number",
    "dailyLimit": "number",
    "sessionLimits": "object",
    "followUpCooldownMinutes": "number",
    "newTopicCooldownMinutes": "number",
    "newTopicMaxPerHour": "number"
  }
};
  for (const [id, fields] of Object.entries(required)) for (const [key,type] of Object.entries(fields)) {
    const value=manifests[id].config[key];
    if (!Object.hasOwn(manifests[id].config,key) || value===null || (Array.isArray(value)?'array':typeof value)!==type)
      throw Error('迁移拥有源 contract 缺失或类型错误：'+id+'.'+key);
  }
  const next = structuredClone(config), old = config.socialV2 || {}, values = {};
  const mood = old.mood || {}, send = old.send || {}, proactive = old.proactive || {}, care = old.care || {}, curfew = old.curfew || {};
  const defaults = id => manifests[id].config;
  const existing = id => overrides[id] || {};
  const m = defaults('ctx-user-mood');
  values['ctx-user-mood'] = pick(m, {
    initial: mood.initial, enabled: mood.enabled, burstEnabled: mood.burstEnabled, recoverMinutes: mood.recoverMinutes,
    // Explicit newer user requirement supersedes the old lowThreshold=45.
    modeThreshold: 40,
    positiveRules: migratedRules(m.positiveRules, mood), negativeRules: migratedRules(m.negativeRules, mood, true),
    ...existing('ctx-user-mood')
  });
  const wakeDefaults = defaults('life-wake-reasons');
  values['life-wake-reasons'] = pick(wakeDefaults, {
    proactiveEnabled: proactive.enabled === undefined ? care.enabled : proactive.enabled,
    silenceMinutes: proactive.idleThresholdMs === undefined ? undefined : proactive.idleThresholdMs / 60000,
    initialProbability: proactive.probability,
    checkMinMinutes: proactive.checkIntervalMinMs === undefined ? undefined : proactive.checkIntervalMinMs / 60000,
    checkMaxMinutes: proactive.checkIntervalMaxMs === undefined ? undefined : proactive.checkIntervalMaxMs / 60000,
    minActiveGapMinutes: care.minIntervalMin,
    maxSilenceMinutes: old.idleRescue?.idleMinutes,
    curfewEnabled: curfew.enabled, curfewStartHour: curfew.startHour, curfewEndHour: curfew.endHour,
    ...existing('life-wake-reasons')
  });
  const valid = validateProactivePolicy(values['life-wake-reasons']);
  if (!valid.ok) throw Error('主动编排迁移区间无效：' + valid.errors.join('; '));
  const shapeId = 'ctx-chat-reply-shape';
  const shape = pick(defaults(shapeId), {
    ...(old.replyShape || {}), intervalMinMs: send.burstIntervalMinMs, intervalMaxMs: send.burstIntervalMaxMs,
    longGapProbability: send.longGapProbability, longGapMinMs: send.longGapMinMs, longGapMaxMs: send.longGapMaxMs,
    maxSendPerMinute: send.maxSendPerMinute, maxSendPerHour: send.maxSendPerHour, maxMessageChars: send.maxMessageChars,
    ...existing(shapeId)
  });
  const oldCap = number(send.burstMaxMessages, Infinity);
  for (const key of ['maxMessagesNormal', 'maxMessagesCasual', 'maxMessagesSerious']) {
    const rule = manifests[shapeId].configSchema?.[key] || {};
    shape[key] = send.burstEnabled === false ? 1 : bounded(Math.round(Math.min(number(shape[key], defaults(shapeId)[key]), oldCap)), rule.min ?? 1, rule.max ?? 20);
  }
  shape.longIncomingChars = bounded(Math.round(number(shape.longIncomingChars, 60)), 20, 500);
  if (shape.intervalMinMs > shape.intervalMaxMs || shape.longGapMinMs > shape.longGapMaxMs) throw Error('发送间隔 range 无效');
  values[shapeId] = shape;
  values['ctx-chat-topic-drive'] = pick(defaults('ctx-chat-topic-drive'), { ...(old.conversationDrive || {}), ...existing('ctx-chat-topic-drive') });
  for (const id of IDS) for (const [key, value] of Object.entries(values[id])) {
    const reference = manifests[id].config[key], rule = manifests[id].configSchema?.[key] || {};
    const wrongType = value === null || (Array.isArray(reference) ? !Array.isArray(value) : typeof value !== typeof reference);
    const wrongNumber = typeof value === 'number' && (!Number.isFinite(value) || (rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max));
    if (wrongType || wrongNumber) throw Error('迁移配置类型或范围无效：' + id + '.' + key);
  }
  for (const [id, validator] of [['ctx-user-mood', validateMoodConfig], [shapeId, validateReplyPolicy]]) {
    const checked = validator(values[id]);
    if (!checked.ok) throw Error('迁移组件规则无效：' + id + ' ' + checked.errors.join('; '));
  }
  next.socialV2 = { ...(next.socialV2 || {}), tools: { ...(next.socialV2?.tools || {}), mood: present(next.socialV2?.tools?.mood, true) } };
  for (const key of RETIRED) delete next.socialV2[key];
  // Retire disabled voice's local bucket; do not tighten every text send to its old limit.
  if(next.socialV2.voice && typeof next.socialV2.voice==='object'){delete next.socialV2.voice.maxPerMinute;delete next.socialV2.voice.maxPerHour;}

  const moodSeed = { conversations: [] }, replySeed = { conversations: [] };
  for (const [key, state] of Object.entries(socialState.conversations || {})) {
    if (!/^(private|group):\d+$/.test(key) || !state || typeof state !== 'object') continue;
    const target = bounded(number(mood.initial, 60), 0, 100);
    const base = bounded(number(state.moodScore, target), 0, 100);
    const at = number(state.moodUpdatedAt, 0);
    const drift = at > 0 ? Math.max(0, now - at) / 3600000 * Math.max(0, number(mood.decayPerHour, 6)) : 0;
    const effective = base < target ? Math.min(target, base + drift) : Math.max(target, base - drift);
    moodSeed.conversations.push({ key, score: Math.round(effective) });
    replySeed.conversations.push({ key, sendTimes: (Array.isArray(state.sendTimes) ? state.sendTimes : [])
      .filter(at => typeof at === 'number' && Number.isFinite(at) && at <= now && now - at < 3600000) });
  }
  return { config: next, overrides: values, moodSeed, replySeed };
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return structuredClone(fallback);
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + process.pid;
  try { fs.writeFileSync(temporary, data, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
const json = value => JSON.stringify(value, null, 2) + '\n';

// Run synchronously before creating the plugin host. A journal supports interrupted
// multi-file conversion; every resumed path must still match its before/after hash.
export function migrateOutboundMood(root, { now = Date.now() } = {}) {
  root = path.resolve(root);
  const markerFile = path.join(root, 'state/migrations/outbound-mood-v1.json');
  let journal = readJson(markerFile, null);
  if (journal && journal.version !== 1) throw Error('未知主动编排迁移版本');
  if (journal?.phase === 'complete') return { applied: false, version: 1 };
  if (!journal) {
    if (!fs.existsSync(path.join(root, 'config.json'))) return { applied: false, reason: 'no-local-config' };
    const snapshots=new Map();
    const snapshot=(relative,fallback)=>{
      if(!snapshots.has(relative)){
        const file=path.join(root,relative),bytes=fs.existsSync(file)?fs.readFileSync(file):null;
        snapshots.set(relative,{relative,bytes,beforeSha256:bytes===null?null:sha(bytes)});
      }
      const bytes=snapshots.get(relative).bytes;
      return bytes===null?structuredClone(fallback):JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    };
    const config=snapshot('config.json',{});
    const manifests=Object.fromEntries(IDS.map(id=>[id,snapshot('plugins/qq-components/'+id+'/plugin.json',null)]));
    const overrides=Object.fromEntries(IDS.map(id=>[id,snapshot('state/plugins/config/'+id+'.json',{})]));
    const socialState=snapshot('state/social-v2.json',{});
    snapshot('state/migrations/outbound-mood-seeds.json',null);
    const result=planOutboundMigration({config,manifests,overrides,socialState,now});
    const backupRelative = 'state/audits/outbound-mood-migration-' + now;
    const outputs = { 'config.json': result.config,
      ...Object.fromEntries(IDS.map(id => ['state/plugins/config/' + id + '.json', result.overrides[id]])),
      'state/migrations/outbound-mood-seeds.json': { version: 1, capturedAt: now, mood: result.moodSeed, reply: result.replySeed } };
    // Verify ALL inputs against the bytes used to plan, before creating any journal/backup.
    for(const item of snapshots.values()){
      const file=path.join(root,item.relative),current=fs.existsSync(file)?sha(fs.readFileSync(file)):null;
      if(current!==item.beforeSha256)throw Error('迁移期间文件已被其他工作修改：'+item.relative);
    }
    const files=Object.entries(outputs).map(([relative,value])=>{
      const after=json(value);return {relative,beforeSha256:snapshots.get(relative).beforeSha256,afterSha256:sha(after),after};
    });
    const sources=[...snapshots.values()].filter(item=>!Object.hasOwn(outputs,item.relative)).map(({relative,beforeSha256})=>({relative,beforeSha256}));
    for(const {relative,bytes} of snapshots.values())if(bytes!==null){
      const backup=path.join(root,backupRelative,relative);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,bytes,{mode:0o600});
    }
    journal={version:1,phase:'prepared',at:now,backupRelative,files,sources};
    writeAtomic(markerFile, json(journal));
  }
  if (journal.version !== 1 || journal.phase !== 'prepared') throw Error('未知主动编排迁移状态');
  const allowed = new Set(['config.json', ...IDS.map(id => 'state/plugins/config/' + id + '.json'), 'state/migrations/outbound-mood-seeds.json']);
  if (!Array.isArray(journal.files) || journal.files.length !== allowed.size || new Set(journal.files.map(item => item.relative)).size !== allowed.size) throw Error('迁移日志文件集合不完整');
  const sourcePaths=new Set(['state/social-v2.json',...IDS.map(id=>'plugins/qq-components/'+id+'/plugin.json')]);
  if(!Array.isArray(journal.sources)||journal.sources.length!==sourcePaths.size||new Set(journal.sources.map(x=>x.relative)).size!==sourcePaths.size)throw Error('迁移日志来源集合不完整');
  for(const item of journal.sources){
    if(!sourcePaths.has(item.relative))throw Error('迁移日志来源不合法');
    const file=path.join(root,item.relative),current=fs.existsSync(file)?sha(fs.readFileSync(file)):null;
    if(current!==item.beforeSha256)throw Error('迁移期间文件已被其他工作修改：'+item.relative);
  }
  // Validate the whole resumed set before touching even one file.
  for (const item of journal.files) {
    if (!allowed.has(item.relative) || sha(item.after) !== item.afterSha256) throw Error('迁移日志拥有源或校验失败');
    const file = path.join(root, item.relative), current = fs.existsSync(file) ? sha(fs.readFileSync(file)) : null;
    if (current !== item.beforeSha256 && current !== item.afterSha256) throw Error('迁移期间文件已被其他工作修改：' + item.relative);
  }
  for (const item of journal.files) writeAtomic(path.join(root, item.relative), item.after);
  writeAtomic(markerFile, json({ version: 1, phase: 'complete', at: journal.at, completedAt: now,
    backupRelative: journal.backupRelative, sources: journal.sources, files: journal.files.map(({ after, ...hashes }) => hashes) }));
  return { applied: true, version: 1, backupDir: path.join(root, journal.backupRelative), files: journal.files.length };
}
