// 按 QQ 号读写 JSON 人物档案，并为作息冒泡提供兼容服务。
//
// 桥接只做两件事：收消息时 emitIncoming（插件自己记身份），拼提示词时 collectPromptBlocks。
// 不再读取旧 notes/fields 档案；首次加载时仅做一次迁移。

import fs from 'node:fs';
import path from 'node:path';
import { routineView, routineBlockLines, foodTaste } from '../../../src/user-routines.js';

const PROFILE_FIELDS = ['routine_food', 'hobbies', 'relationships', 'catchphrases'];

function asText(value) { return String(value ?? '').trim(); }
function visibleProfile(profile, key) {
  return String(key).startsWith('group:')
    ? Object.fromEntries(PROFILE_FIELDS.map((field) => [field, profile[field] || '']))
    : profile;
}
function profileDoc(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (/^[a-z][a-z0-9_]{0,63}$/i.test(key) && typeof value === 'string') out[key] = value;
  }
  for (const key of PROFILE_FIELDS) if (!(key in out)) out[key] = '';
  return out;
}

function legacyProfile(user) {
  const f = user?.fields || {};
  const join = (values) => (Array.isArray(values) ? values : []).map((x) => String(x || '').trim()).filter(Boolean).join('；');
  const interest = [...(f.hobbies || []), ...(f.likes || []).map((x) => '喜欢' + x), ...(f.dislikes || []).map((x) => '回避' + x)];
  return profileDoc({
    routine_food: join(f.routines),
    hobbies: join(interest),
    relationships: join((user?.notes || []).map((x) => x?.text || x)),
    catchphrases: join(f.quotes)
  });
}

const BAD_NAMES = new Set(['私聊', '群聊', '我']);

const NON_CHAT_REASONS = /^(selfReview|selfOptimize|memoryWrite|timeBubble|startupGreeting|reminder|newFriend|newsShare|careCheck|idleRescue|proactiveCheck|replyCheck)/;

export function createPlugin(ctx) {
  const cfg = ctx.config || {};
  const personFile = path.join(ctx.root, 'state', 'person-profiles.json');
  const lastSpeakerByKey = new Map();

  function readPersonProfiles() {
    try {
      const raw = JSON.parse(fs.readFileSync(personFile, 'utf8').replace(/^\uFEFF/, ''));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || !raw.profiles || typeof raw.profiles !== 'object' || Array.isArray(raw.profiles)
        || !raw.people || typeof raw.people !== 'object' || Array.isArray(raw.people)) {
        throw new Error('人物档案文件结构无效，原文件未覆盖');
      }
      const { profiles, people } = raw;
      return { version: 2, updatedAt: Number(raw.updatedAt) || 0, profiles: Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, profileDoc(p)])), people };
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 2, updatedAt: 0, profiles: {}, people: {} };
      throw error;
    }
  }
  function writePersonProfiles(data) {
    const dir = path.dirname(personFile);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = personFile + '.tmp';
    data.updatedAt = Date.now();
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, personFile);
  }
  function ensurePerson(id) {
    const data = readPersonProfiles();
    if (!data.profiles[id]) {
      data.profiles[id] = profileDoc({});
      writePersonProfiles(data);
    }
    return data.profiles[id] || profileDoc({});
  }
  // One-time import only when the new store does not exist. Runtime reads/writes never depend on legacy storage.
  try {
    if (!fs.existsSync(personFile)) {
      const data = { version: 2, updatedAt: 0, profiles: {}, people: {} };
      const legacyFile = path.join(ctx.root, 'state', 'user-profiles.json');
      let legacyUsers = {};
      try { legacyUsers = JSON.parse(fs.readFileSync(legacyFile, 'utf8'))?.users || {}; } catch {}
      for (const [key, user] of Object.entries(legacyUsers)) {
        const id = String(user?.userId || (key.startsWith('u:') ? key.slice(2) : ''));
        if (!/^\d{1,20}$/.test(id)) continue;
        data.profiles[id] = legacyProfile(user);
        data.people[id] = { name: cleanName(user?.names?.[0]), keys: Array.isArray(user?.keys) ? user.keys.filter((k) => /^(private|group):\d+$/.test(k)) : [], warmConnectionAt: Number(user?.warmConnectionAt) || 0 };
      }
      writePersonProfiles(data);
    }
  } catch (error) { ctx.warn('人物档案迁移未完成: ' + (error?.message ?? error)); }

  function authorizedTarget({ userId, key, adminCrossSession } = {}) {
    const id = String(userId || '').trim(), convKey = String(key || '').trim();
    if (!/^\d{1,20}$/.test(id) || !convKey) return false;
    if (adminCrossSession === true) return convKey === 'private:' + id;
    if (convKey === 'private:' + id) return true;
    if (convKey.startsWith('group:')) return lastSpeakerByKey.get(convKey) === id;
    return false;
  }

  function updatePerson(id, patch, deleteKeys = []) {
    if (!/^\d{1,20}$/.test(String(id || '')) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    const data = readPersonProfiles();
    const next = profileDoc(data.profiles[id] || {});
    for (const [key, value] of Object.entries(patch)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key) || typeof value !== 'string') return false;
      next[key] = value;
    }
    for (const key of deleteKeys) {
      if (typeof key === 'string' && !PROFILE_FIELDS.includes(key) && /^[a-z][a-z0-9_]{0,63}$/i.test(key)) delete next[key];
    }
    for (const key of PROFILE_FIELDS) if (!(key in next)) next[key] = '';
    data.profiles[id] = next;
    data.people[id] ||= { name: "", keys: [], warmConnectionAt: 0 };
    writePersonProfiles(data);
    return true;
  }

  function isWarmTarget({ key, target } = {}) {
    const convKey = String(key || '').trim(), wanted = String(target || '').trim().toLocaleLowerCase();
    if (!convKey.startsWith('group:') || !wanted) return false;
    const people = readPersonProfiles().people;
    return Object.values(people).some((person) => Number(person.warmConnectionAt) > 0
      && Array.isArray(person.keys) && person.keys.includes(convKey)
      && String(person.name || '').trim().toLocaleLowerCase() === wanted);
  }

  // 固定作息 → 定时冒泡槽位。解析交给 user-routines.js；JSON 作息字段支持多句短文。
  function routineSlots({ key } = {}) {
    const id = String(key || '').startsWith('private:') ? String(key).slice(8) : '';
    const canonical = id ? ensurePerson(id) : null;
    if (!canonical) return [];
    const routines = canonical.routine_food.split(/[；;\n]+/).filter(Boolean);
    const view = routineView(routines);
    const slots = [];
    const labels = { breakfast: '早餐时间', morning: '起床时间', lunch: '午饭点', dinner: '晚饭点', sleep: '睡觉时间', work: '工作/上课' };
    const push = (id, item) => {
      if (!item || !item.start || slots.some((slot) => slot.id === id)) return;
      const span = item.display || `${String(item.start.hour).padStart(2, '0')}:${String(item.start.minute).padStart(2, '0')}`;
      slots.push({
        id,
        hour: item.start.hour,
        minute: item.start.minute,
        label: labels[id],
        hint: `对方明确分享的作息（${span}${item.taste ? '，' + item.taste : ''}）；只在本私聊顺口贴合一句，不要催促，也不要假设对方有空。`,
        enabled: true
      });
    };
    push('breakfast', view.breakfast);
    push('morning', view.wake);
    push('lunch', view.lunch);
    push('dinner', view.dinner);
    push('sleep', view.sleep);
    for (const item of view.work) push('work', item);
    return slots;
  }

  // 作息块 / 口味单独可查（只对本人私聊 key 生效，别的会话一律空）。
  function routineCard({ key } = {}) {
    const id = String(key || '').startsWith('private:') ? String(key).slice(8) : '';
    const canonical = id ? ensurePerson(id) : null;
    if (!canonical) return { ok: false, lines: [], taste: { likes: [], dislikes: [] } };
    const routines = canonical.routine_food.split(/[；;\n]+/).filter(Boolean);
    const lines = routineBlockLines(routines);
    return { ok: true, lines, taste: foodTaste({}), slots: routineSlots({ key }) };
  }

  function cleanName(name) {
    const n = String(name || '').trim();
    return BAD_NAMES.has(n) ? '' : n;
  }

  ctx.registerTool('profile_get', {
    description: '查看一个 QQ 号对应的 JSON 人物档案；私聊本人只查自己，群聊仅能查当前正在回复的实际发言者并返回四个固定词条；管理员私聊可按明确目标 QQ 跨档案查看。',
    schema: { type: 'object', required: ['userId', 'key'], properties: { userId: { type: 'string', description: '档案对象 QQ 号' }, key: { type: 'string', description: '当前私聊/群聊 key；管理员跨档案请传 private:<目标QQ>' } } },
    handler: ({ userId, key, adminCrossSession } = {}) => {
      if (!authorizedTarget({ userId, key, adminCrossSession })) return { ok: false, error: '档案对象不属于当前会话可访问范围。' };
      const complete = ensurePerson(String(userId));
      const profile = visibleProfile(complete, key);
      return { ok: true, userId: String(userId), profile };
    }
  });
  ctx.registerTool('profile_update', {
    description: '根据档案对象本人亲自表达的信息，用 JSON 字符串字段创建或修改其档案。默认字段 routine_food/hobbies/relationships/catchphrases；只更新传入字段，遗漏字段保留。普通用户只能操作本人；群聊只可修改当前实际发言者的四个固定字段，扩展字段仅限本人或管理员私聊管理。管理员私聊可跨档案管理。',
    schema: { type: 'object', required: ['userId', 'key', 'profile'], properties: { userId: { type: 'string' }, key: { type: 'string' }, profile: { type: 'object', additionalProperties: { type: 'string' }, description: 'key 是字段名，value 必须为完整文本字符串；只传需要变更的键，允许增加新键' }, deleteKeys: { type: 'array', items: { type: 'string' }, description: '明确删除的扩展字段名；固定四个字段只能清空，不能删除' } } },
    handler: ({ userId, key, profile, deleteKeys, adminCrossSession } = {}) => {
      if (!authorizedTarget({ userId, key, adminCrossSession })) return { ok: false, changed: false, error: '只能修改当前发言者本人档案；跨档案修改须由管理员私聊发起。' };
      const patch = profile && typeof profile === 'object' && !Array.isArray(profile) ? { ...profile } : null;
      if (!patch) return { ok: false, changed: false, error: 'profile 必须是 JSON 对象。' };
      if (String(key).startsWith('group:') && [...Object.keys(patch), ...(Array.isArray(deleteKeys) ? deleteKeys : [])]
        .some((field) => !PROFILE_FIELDS.includes(field))) {
        return { ok: false, changed: false, error: '群聊只能修改四个固定字段；扩展字段只能在本人或管理员私聊管理。' };
      }
      const changed = updatePerson(String(userId), patch, Array.isArray(deleteKeys) ? deleteKeys : []);
      return { ok: changed, changed, userId: String(userId), profile: changed ? visibleProfile(ensurePerson(String(userId)), key) : undefined };
    }
  });
  ctx.registerTool('profile_delete', {
    description: '删除一个 QQ 号对应的整份 JSON 人物档案及其档案元数据。私聊本人只能删除自己；群聊只能删除本轮真实发言者；管理员私聊可按明确 QQ 号跨档案删除。',
    schema: { type: 'object', required: ['userId', 'key'], properties: { userId: { type: 'string' }, key: { type: 'string' } } },
    handler: ({ userId, key, adminCrossSession } = {}) => {
      if (!authorizedTarget({ userId, key, adminCrossSession })) return { ok: false, deleted: false, error: '只能删除当前发言者本人档案；跨档案删除须由管理员私聊发起。' };
      const id = String(userId), data = readPersonProfiles();
      const existed = Object.prototype.hasOwnProperty.call(data.profiles, id) || Object.prototype.hasOwnProperty.call(data.people, id);
      delete data.profiles[id]; delete data.people[id];
      writePersonProfiles(data);
      return { ok: true, deleted: existed, userId: id };
    }
  });
  ctx.registerTool('profile_snapshot', {
    description: '查看用户画像。普通会话不可调用；管理员私聊可按 userId 或 key 查看指定用户/会话，也可按明确请求查看完整索引。',
    schema: {
      type: 'object', properties: {
        userId: { type: 'string', description: '指定 QQ 号，只返回该用户档案' },
        key: { type: 'string', description: '指定会话 key，只返回关联到该会话的用户档案' }
      }
    },
    handler: ({ userId, key } = {}) => {
      const wantedId = String(userId || '').trim(), wantedKey = String(key || '').trim();
      let data = readPersonProfiles();
      if (wantedId && /^\d{1,20}$/.test(wantedId) && !data.profiles[wantedId]) { ensurePerson(wantedId); data = readPersonProfiles(); }
      const ids = Object.keys(data.profiles).filter((id) => (!wantedId || id === wantedId)
        && (!wantedKey || data.people[id]?.keys?.includes(wantedKey)));
      return { ok: true, version: data.version, updatedAt: data.updatedAt,
        profiles: Object.fromEntries(ids.map((id) => [id, data.profiles[id]])),
        people: Object.fromEntries(ids.map((id) => [id, data.people[id] || { name: '', keys: [] }])) };
    }
  });

  return {
    services: { profileStore: { isWarmTarget, routineSlots, routineCard } },
    hooks: {
      onIncoming(payload) {
        const text = String(payload?.text ?? '');
        if (!text) return;
        const key = String(payload?.key || ''), userId = String(payload?.userId || '').trim();
        if (!/^\d{1,20}$/.test(userId)) return;
        if (key.startsWith('group:')) lastSpeakerByKey.set(key, userId);
        const data = readPersonProfiles(), id = userId;
        data.profiles[id] ||= profileDoc({});
        const meta = data.people[id] || { name: '', keys: [], warmConnectionAt: 0 };
        const sender = cleanName(payload?.sender);
        data.people[id] = { ...meta, ...(sender ? { name: sender } : {}), keys: [...new Set([...(Array.isArray(meta.keys) ? meta.keys : []), key].filter((x) => /^(private|group):\d+$/.test(x)))], isOwner: !!payload?.isOwner, lastSeenAt: Number(payload?.at) || Date.now() };
        writePersonProfiles(data);
      },
      beforePrompt(payload) {
        if (payload?.reason && NON_CHAT_REASONS.test(String(payload.reason))) return '';
        const key = String(payload?.key || '');
        if (!key.startsWith('private:')) return '';
        const id = key.slice(8);
        if (!/^\d{1,20}$/.test(id)) return '';
        const profile = ensurePerson(id);
        const lines = Object.entries(profile).filter(([, value]) => String(value || '').trim())
          .map(([field, value]) => `- ${field}: ${String(value).trim()}`);
        return lines.length ? `【当前私聊对象人物档案｜QQ ${id}】以下 JSON 字段只描述本人；只在相关时自然参考，不要主动暴露或机械复述。\n${JSON.stringify(profile, null, 2)}` : '';
      }
    }
  };
}
