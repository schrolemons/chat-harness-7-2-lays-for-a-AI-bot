import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { BiliError, planVideoRanges } from './bili-core.mjs';

const CDN_SUFFIXES = ['.bilivideo.com', '.bilivideo.cn', '.bilivideo.net', '.hdslb.com'];
const MAX_FRAME_COUNT = 18;
const MAX_FRAME_WIDTH = 1280;
const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;
const MAX_RETURN_BYTES = 16 * 1024 * 1024;
const REMOTE_PROTOCOLS = ['https', 'tls', 'tcp', 'crypto'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';

function fail(code, message, options) { return new BiliError(code, message, options); }

export function validateStreamUrl(value) {
  let url;
  try { url = new URL(String(value ?? '')); } catch { throw fail('UNSAFE_URL', 'Bilibili 视频流地址无效'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !CDN_SUFFIXES.some(suffix => host.endsWith(suffix)) || url.username || url.password || url.port) {
    throw fail('UNSAFE_URL', '视频流必须来自允许的 Bilibili CDN');
  }
  return url.href;
}

function validateReferer(value) {
  const url = new URL(String(value ?? 'https://www.bilibili.com/'));
  if (url.protocol !== 'https:' || !['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(url.hostname) || url.username || url.password) {
    throw fail('INVALID_FRAME_OPTIONS', 'Referer 仅允许 Bilibili 视频页面');
  }
  return url.href;
}

function validateFrameArgs({ outputPattern, startSeconds, endSeconds, frameCount, width, sceneThreshold = 0.15 }) {
  const count = Number(frameCount);
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  const tileWidth = Number(width);
  if (typeof outputPattern !== 'string' || /[\\/]|\.\./.test(outputPattern) || !/^frame-%03d\.jpg$/.test(outputPattern) ||
      !Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start ||
      !Number.isInteger(count) || count < 1 || count > MAX_FRAME_COUNT || !Number.isInteger(tileWidth) || tileWidth < 320 || tileWidth > MAX_FRAME_WIDTH ||
      ![0.08, 0.15, 0.3].includes(Number(sceneThreshold))) {
    throw fail('INVALID_FRAME_OPTIONS', '抽帧选项超出安全范围');
  }
  return { start, end, count, width: tileWidth };
}

function remoteProtocolWhitelist(useSystemProxy = false) {
  return [...REMOTE_PROTOCOLS, ...(useSystemProxy ? ['httpproxy'] : [])].join(',');
}

export function buildFfmpegArgs(options = {}) {
  const streamUrl = validateStreamUrl(options.streamUrl);
  const referer = validateReferer(options.referer);
  const { start, end, count, width } = validateFrameArgs(options);
  const sampleMode = options.sampleMode === 'scene' ? 'scene' : 'interval';
  const duration = (end - start).toFixed(3);
  const filter = sampleMode === 'scene'
    ? `select='gt(scene,${Number(options.sceneThreshold ?? 0.15)})',scale=${width}:-2,showinfo`
    : `fps=${count}/${duration},scale=${width}:-2,showinfo`;
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'info', '-headers', `Referer: ${referer}\r\nUser-Agent: Mozilla/5.0\r\n`,
    '-protocol_whitelist', remoteProtocolWhitelist(options.useSystemProxy === true), '-ss', start.toFixed(3), '-i', streamUrl, '-t', duration,
    '-vf', filter, '-frames:v', String(count), '-fps_mode', 'vfr', '-y', options.outputPattern
  ];
}

function parseSceneTimes(text) {
  const values = [...String(text ?? '').matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)].map(match => Number(match[1]));
  return [...new Set(values)].filter(value => Number.isFinite(value) && value > 0);
}

export function chooseFrameTimes({ durationSeconds, frameCount, sceneTimes = [] } = {}) {
  const duration = Number(durationSeconds);
  const count = Math.max(1, Math.min(MAX_FRAME_COUNT, Math.floor(Number(frameCount) || 1)));
  if (!Number.isFinite(duration) || duration <= 0) throw fail('INVALID_RANGE', '抽帧时间范围无效');
  const step = duration / count;
  const uniform = Array.from({ length: count }, (_, index) => (index + 0.5) * step);
  const candidates = [...new Set((Array.isArray(sceneTimes) ? sceneTimes : []).map(Number))]
    .filter(value => Number.isFinite(value) && value > 0.2 && value < duration)
    .sort((a, b) => a - b);
  if (!candidates.length) return uniform;
  const chosen = [];
  const used = new Set();
  for (const point of uniform) {
    const nearby = candidates.filter(scene => Math.abs(scene - point) <= step / 2 && !used.has(scene));
    const snap = nearby.sort((a, b) => Math.abs(a - point) - Math.abs(b - point))[0];
    const value = snap ?? point;
    const rounded = Math.round(value * 100) / 100;
    if (!used.has(rounded)) {
      chosen.push(rounded);
      used.add(rounded);
      if (snap !== undefined) used.add(snap);
    } else {
      const fallback = Math.round(point * 100) / 100;
      if (!used.has(fallback)) { chosen.push(fallback); used.add(fallback); }
    }
  }
  while (chosen.length < count) {
    const fallback = Math.round(((chosen.length + 0.5) * step) * 100) / 100;
    if (!used.has(fallback)) { chosen.push(fallback); used.add(fallback); }
    else break;
  }
  return chosen.sort((a, b) => a - b).slice(0, count);
}

async function defaultExists(file) {
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}

async function findFfmpeg(configuredPath, exists = defaultExists) {
  const candidate = String(configuredPath ?? '').trim();
  if (candidate) return await exists(candidate) ? candidate : null;
  const filename = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const directory of String(process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const fullPath = path.join(directory, filename);
    if (await exists(fullPath)) return fullPath;
  }
  return null;
}

export function buildFfmpegEnvironment(useSystemProxy = false, source = process.env) {
  if (useSystemProxy) return { ...source };
  return Object.fromEntries(Object.entries(source).filter(([name]) => !/proxy/i.test(name)));
}

function defaultRunFfmpeg(file, args, { timeoutMs = 180000, maxOutputBytes = 2 * 1024 * 1024, useSystemProxy = false } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(file, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: buildFfmpegEnvironment(useSystemProxy) }); }
    catch (cause) { reject(fail('FFMPEG_FAILED', '无法启动 FFmpeg', { cause })); return; }
    const stdout = [];
    const stderr = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(fail('FFMPEG_TIMEOUT', 'FFmpeg 处理超时'));
    }, Math.max(100, timeoutMs));
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    };
    const collect = (target, chunk) => {
      size += chunk.length;
      if (size > maxOutputBytes) {
        child.kill();
        finish(fail('FFMPEG_OUTPUT_TOO_LARGE', 'FFmpeg 日志超过上限'));
      } else target.push(chunk);
    };
    child.stdout.on('data', chunk => collect(stdout, chunk));
    child.stderr.on('data', chunk => collect(stderr, chunk));
    child.once('error', cause => finish(cause?.code === 'ENOENT' ? fail('FFMPEG_MISSING', '找不到 FFmpeg 可执行文件', { cause }) : fail('FFMPEG_FAILED', 'FFmpeg 启动失败', { cause })));
    child.once('close', code => code === 0 ? finish(null) : finish(fail('FFMPEG_FAILED', 'FFmpeg 无法处理该公开视频流')));
  });
}

function safeConcatPath(value) {
  return String(value).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function frameArgs(inputFile, outputFile, seconds, width) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file', '-ss', Math.max(0, seconds).toFixed(3), '-i', inputFile,
    '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '3', '-y', outputFile];
}

async function writeContactSheet({ ffmpegPath, runFfmpeg, fileOps, directory, frames, width, rows, columns, strip = false }) {
  const listFile = path.join(directory, strip ? 'subtitle-frames.txt' : 'frames.txt');
  const files = frames.map(frame => `file '${safeConcatPath(frame.filePath)}'`).join('\n') + '\n';
  await fileOps.writeFile(listFile, files, { encoding: 'utf8', mode: 0o600 });
  const output = path.join(directory, strip ? 'subtitle-strip.jpg' : 'contact-sheet.jpg');
  const filter = strip
    ? `crop=iw:ih*0.17:0:ih*0.83,scale=1280:-2,tile=1x${frames.length}`
    : `scale=${width}:-2,tile=${columns}x${rows}`;
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', filter, '-frames:v', '1', '-y', output];
  await runFfmpeg(ffmpegPath, args);
  return output;
}

export async function extractVideoFrames(options = {}, deps = {}) {
  const ffmpegPath = await findFfmpeg(options.ffmpegPath, deps.exists);
  if (!ffmpegPath) throw fail('FFMPEG_MISSING', '未找到 FFmpeg；视频元数据和字幕仍可使用，画面抽帧暂不可用');
  const streamUrl = validateStreamUrl(options.streamUrl);
  const referer = validateReferer(options.referer);
  const duration = Number(options.durationSeconds);
  const maxVideoSeconds = Math.max(1, Number(options.maxVideoSeconds) || 3600);
  if (!Number.isFinite(duration) || duration <= 0 || duration > maxVideoSeconds) throw fail('VIDEO_TOO_LONG', `视频时长超出配置上限 ${maxVideoSeconds} 秒`);
  const startSeconds = Number(options.startSeconds ?? 0);
  const endSeconds = Number(options.endSeconds ?? duration);
  const ranges = planVideoRanges({ durationSeconds: duration, maxSegmentSeconds: Math.min(600, Number(options.maxSegmentSeconds) || 300), startSeconds, endSeconds });
  const frameCount = Math.max(1, Math.min(MAX_FRAME_COUNT, Math.floor(Number(options.frameCount) || 9)));
  const width = Math.max(320, Math.min(MAX_FRAME_WIDTH, Math.floor(Number(options.width) || 720)));
  if (frameCount < ranges.length) throw fail('INVALID_FRAME_OPTIONS', '帧数至少需要覆盖每个分析时间段');
  const sampleMode = options.sampleMode === 'interval' ? 'interval' : 'scene';
  const sceneThreshold = [0.08, 0.15, 0.3].includes(Number(options.sceneThreshold)) ? Number(options.sceneThreshold) : 0.15;
  const requestGate = deps.requestGate ?? (async () => {});
  const fileOps = deps.fileOps ?? fs;
  const runFfmpeg = deps.runFfmpeg ?? ((file, args) => defaultRunFfmpeg(file, args, {
    timeoutMs: Number(options.ffmpegTimeoutMs) || 180000,
    useSystemProxy: options.ffmpegUseSystemProxy === true
  }));
  const tempRoot = options.tempRoot || os.tmpdir();
  await fileOps.mkdir(tempRoot, { recursive: true });
  const tempDir = await (deps.mkdtemp ?? (prefix => fileOps.mkdtemp(prefix)))(path.join(tempRoot, 'bili-frame-'));
  const warnings = [];
  const contactSheets = [];
  let totalBytes = 0;
  try {
    await fileOps.mkdir(tempDir, { recursive: true });
    for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
      const range = ranges[rangeIndex];
      const rangeDuration = range.endSeconds - range.startSeconds;
      const rangeFrames = Math.max(1, Math.floor(frameCount / ranges.length) + (rangeIndex < frameCount % ranges.length ? 1 : 0));
      const rangeDir = path.join(tempDir, `part-${String(rangeIndex + 1).padStart(2, '0')}`);
      await fileOps.mkdir(rangeDir, { recursive: true });
      const segmentFile = path.join(rangeDir, 'segment.mp4');
      const headers = `Referer: ${referer}\r\nUser-Agent: ${USER_AGENT}\r\n`;
      const downloadArgs = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-headers', headers, '-protocol_whitelist', remoteProtocolWhitelist(options.ffmpegUseSystemProxy === true),
        '-ss', range.startSeconds.toFixed(3), '-i', streamUrl, '-t', rangeDuration.toFixed(3), '-map', '0:v:0', '-c', 'copy', '-fs', String(MAX_SEGMENT_BYTES), '-y', segmentFile];
      await requestGate();
      await runFfmpeg(ffmpegPath, downloadArgs);
      const sceneArgs = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-protocol_whitelist', 'file', '-i', segmentFile, '-vf', `select='gt(scene,${sceneThreshold})',metadata=print:file=-`, '-an', '-f', 'null', '-'];
      let sceneText = '';
      if (sampleMode === 'scene') {
        try {
          await requestGate();
          const scan = await runFfmpeg(ffmpegPath, sceneArgs);
          sceneText = `${scan?.stdout ?? ''}\n${scan?.stderr ?? ''}`;
        } catch { warnings.push(`第 ${rangeIndex + 1} 段场景检测失败，已回退等间隔取帧`); }
      }
      const chosen = sampleMode === 'scene'
        ? chooseFrameTimes({ durationSeconds: rangeDuration, frameCount: rangeFrames, sceneTimes: parseSceneTimes(sceneText) })
        : chooseFrameTimes({ durationSeconds: rangeDuration, frameCount: rangeFrames });
      const frames = [];
      for (let frameIndex = 0; frameIndex < chosen.length; frameIndex += 1) {
        const relativeTime = chosen[frameIndex];
        const absoluteTime = Math.round((range.startSeconds + relativeTime) * 100) / 100;
        const filePath = path.join(rangeDir, `frame-${String(frameIndex + 1).padStart(3, '0')}.jpg`);
        await requestGate();
        await runFfmpeg(ffmpegPath, frameArgs(segmentFile, filePath, relativeTime, width));
        const bytes = await fileOps.readFile(filePath);
        totalBytes += bytes.byteLength;
        if (!bytes.byteLength || totalBytes > MAX_RETURN_BYTES) throw fail('FRAME_OUTPUT_TOO_LARGE', '视频抽帧结果超过图像大小上限');
        frames.push({ filePath, timestampSeconds: absoluteTime, base64: Buffer.from(bytes).toString('base64'), bytes: bytes.byteLength });
      }
      const columns = Math.ceil(Math.sqrt(frames.length));
      const rows = Math.ceil(frames.length / columns);
      const sheetPath = await writeContactSheet({ ffmpegPath, runFfmpeg, fileOps, directory: rangeDir, frames, width, rows, columns });
      const sheet = await fileOps.readFile(sheetPath);
      totalBytes += sheet.byteLength;
      if (totalBytes > MAX_RETURN_BYTES) throw fail('FRAME_OUTPUT_TOO_LARGE', '视频抽帧结果超过图像大小上限');
      const result = {
        range: { startSeconds: range.startSeconds, endSeconds: range.endSeconds },
        columns, rows,
        frameTimestamps: frames.map(({ timestampSeconds }) => timestampSeconds),
        base64: Buffer.from(sheet).toString('base64'), bytes: sheet.byteLength
      };
      if (options.subtitleStrip === true) {
        try {
          const stripPath = await writeContactSheet({ ffmpegPath, runFfmpeg, fileOps, directory: rangeDir, frames, width, rows: frames.length, columns: 1, strip: true });
          const stripBytes = await fileOps.readFile(stripPath);
          totalBytes += stripBytes.byteLength;
          if (totalBytes <= MAX_RETURN_BYTES) result.subtitleStrip = { base64: Buffer.from(stripBytes).toString('base64'), bytes: stripBytes.byteLength, frameTimestamps: result.frameTimestamps };
          else warnings.push('字幕条图像超过返回大小上限，已省略');
        } catch { warnings.push(`第 ${rangeIndex + 1} 段字幕条生成失败，九宫格仍可用`); }
      }
      contactSheets.push(result);
    }
    return { status: 'available', sampling: sampleMode, ranges, contactSheets, warnings };
  } finally {
    await (deps.rm ?? fileOps.rm).call(fileOps, tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export { planVideoRanges };
