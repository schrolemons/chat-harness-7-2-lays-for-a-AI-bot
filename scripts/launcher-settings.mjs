import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_LAUNCHER_PORTS = Object.freeze({
  dsh: 3080, console: 3100, snowHttp: 3000, snowWs: 3001, launcher: 3199, snowWebui: 5099
});
const PORT_LABELS = { dsh: 'DSH HTTP', console: '桥接控制台', snowHttp: 'SnowLuma HTTP',
  snowWs: 'SnowLuma WebSocket', launcher: '启动器服务', snowWebui: 'SnowLuma WebUI' };

function endpointPort(value, fallback) {
  try {
    const url = new URL(value);
    // These are local binding preferences, independent of remote endpoints.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return fallback;
    if (url.port) return Number(url.port);
    if (url.protocol === 'https:' || url.protocol === 'wss:') return 443;
    if (url.protocol === 'http:' || url.protocol === 'ws:') return 80;
  } catch {}
  return fallback;
}

export function readLauncherPorts(cfg = {}) {
  return validateLauncherPorts({ ...DEFAULT_LAUNCHER_PORTS,
    dsh: endpointPort(cfg.dsh?.baseUrl, DEFAULT_LAUNCHER_PORTS.dsh),
    console: cfg.consolePort ?? DEFAULT_LAUNCHER_PORTS.console,
    snowHttp: endpointPort(cfg.snowluma?.httpUrl, DEFAULT_LAUNCHER_PORTS.snowHttp),
    snowWs: endpointPort(cfg.snowluma?.wsUrl, DEFAULT_LAUNCHER_PORTS.snowWs),
    ...Object.fromEntries(Object.keys(DEFAULT_LAUNCHER_PORTS)
      .filter(key => cfg.launcher?.ports?.[key] !== undefined).map(key => [key, cfg.launcher.ports[key]])) });
}

export function validateLauncherPorts(value, current = DEFAULT_LAUNCHER_PORTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('端口设置必须为对象');
  const result = {};
  const used = new Map();
  for (const key of Object.keys(DEFAULT_LAUNCHER_PORTS)) {
    const raw = Object.hasOwn(value, key) ? value[key] : current[key];
    const port = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${PORT_LABELS[key]} 端口必须为 1–65535 的整数`);
    if (used.has(port)) throw new Error(`${PORT_LABELS[key]} 与 ${PORT_LABELS[used.get(port)]} 端口重复`);
    used.set(port, key);
    result[key] = port;
  }
  return result;
}

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
    allow: { private: cfg.allow?.private ?? [], groups: cfg.allow?.groups ?? [] }, ports: readLauncherPorts(cfg) };
  return { ...selected, revision: crypto.createHash('sha256').update(JSON.stringify(selected)).digest('hex') };
}

export function saveLauncherSettings(root, input) {
  const target = path.join(root, 'config.json');
  const previous = readConfig(root);
  const current = readLauncherSettings(root, previous);
  if (input.revision && input.revision !== current.revision) {
    const error = new Error('配置已被其他页面更新，请重新读取后保存'); error.status = 409; throw error;
  }
  const botUin = input.botUin === undefined ? current.botUin : validateBotUin(input.botUin);
  const ports = input.ports === undefined ? current.ports : validateLauncherPorts(input.ports, current.ports);
  let ownerQQ = previous.ownerQQ ?? null;
  if (input.ownerQQ !== undefined) ownerQQ = String(input.ownerQQ ?? '').trim() === '' ? null : normalizeQqList([input.ownerQQ])[0];
  const allow = { ...previous.allow,
    private: input.allow?.private !== undefined ? normalizeQqList(input.allow.private) : current.allow.private,
    groups: input.allow?.groups !== undefined ? normalizeQqList(input.allow.groups) : current.allow.groups };
  const next = { ...previous, snowluma: { ...previous.snowluma, botUin }, ownerQQ, allow };
  if (input.ports !== undefined) {
    next.launcher = { ...previous.launcher, ports };
    // An unchanged save must preserve remote hosts, credentials and URL paths.
    // Editing a port explicitly selects the corresponding local service.
    if (ports.dsh !== current.ports.dsh) next.dsh = { ...previous.dsh, baseUrl: `http://127.0.0.1:${ports.dsh}` };
    if (ports.console !== current.ports.console) next.consolePort = ports.console;
    if (ports.snowHttp !== current.ports.snowHttp) next.snowluma.httpUrl = `http://127.0.0.1:${ports.snowHttp}`;
    if (ports.snowWs !== current.ports.snowWs) next.snowluma.wsUrl = `ws://127.0.0.1:${ports.snowWs}`;
  }
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.copyFileSync(target, `${target}.bak-launcher-${Date.now()}-${crypto.randomUUID()}`, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
  return readLauncherSettings(root, next);
}
