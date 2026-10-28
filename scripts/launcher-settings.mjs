import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function validateBotUin(value) {
  const uin = String(value ?? '').trim();
  if (!/^[1-9]\d{4,19}$/.test(uin)) throw new Error('请输入有效的机器人 QQ 号（5–20 位数字）');
  return uin;
}

export function readConfig(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('桥接配置损坏或无法读取，请检查 config.json；未覆盖原文件'); }
}

export function normalizeQqList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\s,，;；]+/u).filter(Boolean);
  return [...new Set(list.map(value => {
    const normalized = validateBotUin(value);
    if (!Number.isSafeInteger(Number(normalized))) throw new Error('QQ 号或群号超出有效范围');
    return Number(normalized);
  }))];
}

export function readLauncherSettings(root, cfg) {
  cfg ??= readConfig(root);
  const value = cfg.snowluma?.botUin ?? '';
  const selected = { botUin: value === '' ? '' : validateBotUin(value), ownerQQ: cfg.ownerQQ ?? null,
    allow: { private: cfg.allow?.private ?? [], groups: cfg.allow?.groups ?? [] } };
  return { ...selected, revision: crypto.createHash('sha256').update(JSON.stringify(selected)).digest('hex') };
}

export function saveLauncherSettings(root, input) {
  const botUin = validateBotUin(input.botUin);
  const target = path.join(root, 'config.json');
  const previous = readConfig(root);
  const current = readLauncherSettings(root, previous);
  if (input.revision && input.revision !== current.revision) {
    const error = new Error('配置已被其他页面更新，请重新读取后保存'); error.status = 409; throw error;
  }
  let ownerQQ = previous.ownerQQ ?? null;
  if (input.ownerQQ !== undefined) ownerQQ = String(input.ownerQQ ?? '').trim() === '' ? null : normalizeQqList([input.ownerQQ])[0];
  const allow = { ...previous.allow,
    private: input.allow?.private !== undefined ? normalizeQqList(input.allow.private) : current.allow.private,
    groups: input.allow?.groups !== undefined ? normalizeQqList(input.allow.groups) : current.allow.groups };
  const next = { ...previous, snowluma: { ...previous.snowluma, botUin }, ownerQQ, allow };
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.copyFileSync(target, `${target}.bak-launcher-${Date.now()}`);
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
  return readLauncherSettings(root, next);
}
