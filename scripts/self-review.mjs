#!/usr/bin/env node
/**
 * self-review.mjs — 轻量自我更新：快速总结最近 N 小时的对话/运行情况，写入持久优化记忆。
 * 纯本地规则，不调用 AI、不占用聊天会话；几秒内完成。
 *
 * 用法：node scripts/self-review.mjs [--hours 6]
 * 输出：一行 JSON（ok/summary/file）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv;
const hoursArg = args.includes('--hours') ? Number(args[args.indexOf('--hours') + 1]) : 0;
let hours = Number.isFinite(hoursArg) && hoursArg > 0 ? hoursArg : 6;
let configuredMemoryFile = 'state/memory/_optimization.md';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  if (!hoursArg) hours = Number(cfg?.socialV2?.selfReview?.intervalHours) || 6;
  configuredMemoryFile = String(cfg?.socialV2?.selfReview?.memoryFile || configuredMemoryFile).trim() || configuredMemoryFile;
} catch {}
const MEM_FILE = path.isAbsolute(configuredMemoryFile) ? configuredMemoryFile : path.join(ROOT, configuredMemoryFile);
const now = Date.now();
const windowMs = hours * 3600 * 1000;

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); } catch { return []; }
}
function readActivityLines() {
  const dir = path.join(ROOT, 'state');
  const files = ['qq-activity.log', 'qq-activity.log.1', 'qq-activity.log.2'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  const out = [];
  for (const f of files) out.push(...readLines(f));
  return out;
}

// 解析 "HH:MM:SS" 时间；日志跨天时按“最近的”猜测：若时间比当前时间大很多则视为昨天。
function parseClock(line) {
  const m = /^(?:\[)?(\d{2}):(\d{2}):(\d{2})(?:\])?/.exec(line);
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3]), 0);
  if (d.getTime() > now + 60 * 1000) d.setDate(d.getDate() - 1);
  return d.getTime();
}
function withinWindow(line) {
  const t = parseClock(line);
  return t !== null && now - t <= windowMs;
}

// 1) 用户不满 / 问题关键词
const COMPLAINTS = /太吵|别发|闭嘴|烦死|很烦|别贴|表情太多|表情包太多|刷屏|别@|别@我|没回|没回复|不理我|重复|复读|说错|不对|别这样|吵死/;
const complaintHits = [];
for (const line of readActivityLines()) {
  if (!/消息已入未读/.test(line) || !withinWindow(line)) continue;
  const m = /^(?:\[(\d{2}:\d{2}:\d{2})\])?\s*([^ ]+)\s.*消息已入未读：(.*)$/.exec(line.replace(/^\[/, '['));
  const text = line.slice(line.indexOf('消息已入未读：') + 7).trim();
  if (!COMPLAINTS.test(text)) continue;
  complaintHits.push({ key: (line.split(' ')[1] || '').replace(/^\w+$/, ''), time: (line.match(/^\[?(\d{2}:\d{2})/) || [])[1] || '', text: text.slice(0, 120) });
}

// 2) 消息量/活跃会话（最近窗口内）
const perKey = {};
let totalMsg = 0;
for (const line of readActivityLines()) {
  if (!withinWindow(line)) continue;
  if (!/消息已入未读/.test(line)) continue;
  const m = /^\[?(\d{2}:\d{2}:\d{2})\]?\s+(\S+)/.exec(line);
  if (!m) continue;
  totalMsg += 1;
  perKey[m[2]] = (perKey[m[2]] || 0) + 1;
}

// 3) 异常/失败/重连统计（bridge.log）
const bridgeLines = readLines(path.join(ROOT, 'state', 'bridge.log')).filter(withinWindow);
const errors = bridgeLines.filter((l) => /异常|失败|错误|超时|ECONN|fetch failed/.test(l) && !/跳过首次连接失败/.test(l)).slice(-8);
const restarts = bridgeLines.filter((l) => /桥接已启动/.test(l)).length;
const reconnects = bridgeLines.filter((l) => /重连成功|事件流已重连/.test(l)).length;
const busyQueued = bridgeLines.filter((l) => /会话繁忙，暂存唤醒原因/.test(l)).length;
const skippedWake = bridgeLines.filter((l) => /繁忙期间唤醒.*跳过补发/.test(l)).length;

// 3.5) 工具调用 / 上下文 / 环境执行评估
import { execSync } from 'node:child_process';
const toolSendLines = bridgeLines.filter((l) => /工具统一发送/.test(l));
let toolOk = 0, toolTotal = 0;
for (const l of toolSendLines) {
  const m = /成功\s*(\d+)\/(\d+)/.exec(l);
  if (m) { toolOk += Number(m[1]); toolTotal += Number(m[2]); }
}
const toolFailLines = bridgeLines.filter((l) => /发送失败|工具.*失败|工具未启用|拒绝执行|403|权限不足/.test(l));
const contextResets = bridgeLines.filter((l) => /退役会话|新会话|上下文|恢复进行中的回合|compact/i.test(l)).length;
const envChecks = [];
async function probe(url, name) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    envChecks.push({ name, ok: r.status < 500, status: r.status });
  } catch { envChecks.push({ name, ok: false, status: 0 }); }
}
await probe('http://127.0.0.1:9222/json/version', 'Edge(9222)');
await probe('http://127.0.0.1:3000/get_login_info', 'SnowLuma(3000)');
await probe('http://127.0.0.1:3100/api/status', '桥接控制台(3100)');
let taskChecks = [];
try {
  const out = execSync('schtasks /Query /TN "CampusWatch30m" /FO LIST', { encoding: 'utf8', timeout: 5000 });
  taskChecks.push({ name: 'CampusWatch30m', status: (/Status:\s*(\S+)/.exec(out) || [])[1] || '?' });
} catch { taskChecks.push({ name: 'CampusWatch30m', status: 'missing' }); }
try {
  const out = execSync('schtasks /Query /TN "LectureFastCheck1m" /FO LIST', { encoding: 'utf8', timeout: 5000 });
  taskChecks.push({ name: 'LectureFastCheck1m', status: (/Status:\s*(\S+)/.exec(out) || [])[1] || '?' });
} catch { taskChecks.push({ name: 'LectureFastCheck1m', status: 'missing' }); }
let fastLogAgeMin = -1;
try { fastLogAgeMin = Math.round((now - fs.statSync(path.join(ROOT, 'state', 'campus-watch-fast.log')).mtimeMs) / 60000); } catch {}
let bridgeLogMB = 0;
try { bridgeLogMB = Math.round(fs.statSync(path.join(ROOT, 'state', 'bridge.log')).size / 1048576 * 10) / 10; } catch {}

// 4) 建议（规则）
const suggestions = [];
if (complaintHits.length) {
  if (complaintHits.some((c) => /表情|贴/.test(c.text))) suggestions.push('降低表情/已读戳频率：检查 socialV2.sticker.sendProbability、readReceipt.probability');
  if (complaintHits.some((c) => /吵|别发|烦/.test(c.text))) suggestions.push('降低主动频率：检查 socialV2.proactive.probability / care / timeBubbles，必要时提高宵禁覆盖');
  if (complaintHits.some((c) => /没回|不理/.test(c.text))) suggestions.push('排查漏回复：检查会话是否卡在 busy（回合未结束）或 mark_read 水位误吞新消息');
  if (complaintHits.some((c) => /重复|复读/.test(c.text))) suggestions.push('检查是否同话题重复唤醒/重复发送');
}
if (errors.length) suggestions.push('处理 bridge.log 里最近的错误/异常（见下方样本）');
if (toolTotal > 0 && toolOk < toolTotal) suggestions.push('工具发送有失败：' + (toolTotal - toolOk) + '/' + toolTotal + '，检查 QQ 发送/白名单/敏感信息拦截');
if (envChecks.some((e) => !e.ok)) suggestions.push('环境探活异常：' + envChecks.filter((e) => !e.ok).map((e) => e.name).join('、'));
if (taskChecks.some((t) => t.status === 'missing' || t.status === 'Disabled')) suggestions.push('计划任务未就绪：' + taskChecks.filter((t) => t.status === 'missing' || t.status === 'Disabled').map((t) => t.name).join('、'));
if (fastLogAgeMin > 5) suggestions.push('讲座快检超过 ' + fastLogAgeMin + ' 分钟没跑，检查计划任务/隐藏启动');
if (bridgeLogMB > 20) suggestions.push('bridge.log 已 ' + bridgeLogMB + 'MB，考虑轮转');
if (busyQueued > 10) suggestions.push('频繁“会话繁忙”说明回合耗时偏长或卡住，考虑轮询/超时策略');
if (skippedWake > 3) suggestions.push('多发“跳过补发”，确认是否有新消息被误判为已处理');
if (!suggestions.length) suggestions.push('最近未发现明显问题，保持当前参数');

// 5) 汇总并写入 MD
const stamp = new Date(now).toLocaleString('zh-CN', { hour12: false });
const topKeys = Object.entries(perKey).sort((a, b) => b[1] - a[1]);
const lines = [];
lines.push(`## [${stamp}] 自我更新总结（最近 ${hours} 小时）`);
lines.push('');
lines.push(`- 消息量：${totalMsg} 条，活跃会话 ${topKeys.length} 个`);
if (topKeys.length) lines.push(`- 会话分布：${topKeys.slice(0, 6).map(([k, v]) => k + ' ' + v).join('；')}`);
lines.push(`- 运行异常：${errors.length} 条，桥接重启 ${restarts} 次，断线重连 ${reconnects} 次，繁忙排队 ${busyQueued} 次，跳过补发 ${skippedWake} 次`);
lines.push('- 工具调用：发送 ' + toolOk + '/' + toolTotal + ' 成功，失败/拒绝样本 ' + toolFailLines.length + ' 条');
lines.push('- 上下文：会话重置/切换相关事件 ' + contextResets + ' 次');
lines.push('- 环境：' + envChecks.map((e) => e.name + (e.ok ? ' OK' : ' 异常(' + e.status + ')')).join('；'));
lines.push('- 计划任务：' + taskChecks.map((t) => t.name + ' ' + t.status).join('；') + '；快检日志 ' + (fastLogAgeMin < 0 ? '缺失' : fastLogAgeMin + ' 分钟前') + '；bridge.log ' + bridgeLogMB + 'MB');
if (toolFailLines.length) {
  lines.push('');
  lines.push('**工具/权限失败样本**');
  for (const l of toolFailLines.slice(-5)) lines.push('- ' + l.replace(/^\[[^\]]+\]\s*/, '').slice(0, 160));
}
if (complaintHits.length) {
  lines.push('');
  lines.push('**用户点名/不满（需关注）**');
  for (const c of complaintHits.slice(-8)) lines.push(`- ${c.time ? c.time + ' ' : ''}${c.text}`);
}
if (errors.length) {
  lines.push('');
  lines.push('**最近错误样本**');
  for (const e of errors) lines.push('- ' + e.replace(/^\[[^\]]+\]\s*/, '').slice(0, 180));
}
lines.push('');
lines.push('**建议**');
for (const s of suggestions) lines.push('- ' + s);
lines.push('');
const section = lines.join('\n');

// 去重节流：桥接每次重启都会跑一次本脚本，同一段总结短时间内会重复写好几遍，
// 把优化记忆刷成噪音。规则：内容与上一段完全一致、且上一段在 30 分钟内 → 跳过写入。
function bodyOf(text) {
  return text.replace(/^## \[[^\]]*\][^\n]*\n+/, '').trim();
}
let prev = '';
try { prev = fs.readFileSync(MEM_FILE, 'utf8'); } catch {}
const lastHeadAt = prev.lastIndexOf('\n## [');
const lastSection = (lastHeadAt >= 0 ? prev.slice(lastHeadAt + 1) : prev).trim();
const lastStamp = /^## \[([^\]]+)\]/.exec(lastSection);
let lastAt = 0;
if (lastStamp) {
  const parsed = Date.parse(String(lastStamp[1]).replace(/\//g, '-').replace(' ', 'T'));
  if (Number.isFinite(parsed)) lastAt = parsed;
}
const isDuplicate = Boolean(lastSection) && bodyOf(lastSection) === bodyOf(section) && now - lastAt < 30 * 60 * 1000;
if (!isDuplicate) {
  try {
    fs.mkdirSync(path.dirname(MEM_FILE), { recursive: true });
    fs.writeFileSync(MEM_FILE, (prev + '\n' + section + '\n').slice(-20000), 'utf8');
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    process.exit(1);
  }
}

console.log(JSON.stringify({
  ok: true,
  hours,
  totalMsg,
  active: topKeys.map(([k, v]) => ({ key: k, count: v })),
  complaints: complaintHits.slice(-8),
  errors: errors.length,
  reconnects,
  busyQueued,
  skippedWake,
  toolStats: { ok: toolOk, total: toolTotal, failSamples: toolFailLines.length },
  contextResets,
  envChecks,
  taskChecks,
  suggestions,
  skippedDuplicate: isDuplicate,
  file: MEM_FILE,
  summary: section
}));
