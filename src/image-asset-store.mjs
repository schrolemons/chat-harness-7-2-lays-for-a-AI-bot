import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_ASSETS_PER_SESSION = 100;
const validSession = /^(?:private|group):[1-9]\d*$/;

function inspectImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mimeType: 'image/png', extension: 'png' };
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return { mimeType: 'image/gif', extension: 'gif' };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' };
  return null;
}

function safeName(value, fallback, extension) {
  let name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
  if (!name) name = fallback;
  name = name.slice(0, 140);
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) name += `.${extension}`;
  return name;
}

function publicAsset(item) {
  return {
    imageId: item.id,
    name: item.name,
    source: item.source,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    delivery: item.delivery ?? null
  };
}

function imageLabels(content) {
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const parsed = JSON.parse(block.text);
      if (Array.isArray(parsed?.imageEvidence)) return parsed.imageEvidence.map(value => String(value ?? '').trim());
    } catch {}
  }
  return [];
}

export function createImageAssetStore({
  root,
  now = Date.now,
  retentionMs = DEFAULT_RETENTION_MS,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  maxAssetsPerSession = DEFAULT_MAX_ASSETS_PER_SESSION
} = {}) {
  if (!root) throw new Error('IMAGE_STORE_ROOT_REQUIRED');
  const stateDir = path.join(root, 'state', 'image-cache');
  const assetsDir = path.join(stateDir, 'assets');
  const indexPath = path.join(stateDir, 'index.json');
  fs.mkdirSync(assetsDir, { recursive: true, mode: 0o700 });
  let state;
  try {
    state = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    state = { assets: [] };
  }
  if (!Array.isArray(state.assets)) state.assets = [];
  let recoveredDelivery = false;
  for (const item of state.assets) {
    if (item?.delivery === 'sending') {
      item.delivery = 'unknown';
      recoveredDelivery = true;
    }
  }

  const save = () => {
    const temp = `${indexPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, indexPath);
  };
  if (recoveredDelivery) save();
  const removeFile = item => {
    if (!/^[0-9a-f-]{36}$/i.test(String(item?.id ?? ''))) return;
    for (const extension of ['png', 'jpg', 'gif', 'webp']) {
      try { fs.unlinkSync(path.join(assetsDir, `${item.id}.${extension}`)); } catch {}
    }
  };

  function prune() {
    const time = Number(now());
    const kept = [];
    for (const item of state.assets) {
      if (!item || !Number.isFinite(Number(item.expiresAt)) || Number(item.expiresAt) <= time) removeFile(item);
      else kept.push(item);
    }
    if (kept.length !== state.assets.length) {
      state.assets = kept;
      save();
    }
    return kept.length;
  }

  function stage({ key, name, source, sourceRef, data } = {}) {
    prune();
    const sessionKey = String(key ?? '');
    if (!validSession.test(sessionKey)) return { ok: false, error: 'INVALID_SESSION' };
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data ?? []);
    const image = inspectImage(bytes);
    if (!image) return { ok: false, error: 'UNSUPPORTED_IMAGE_TYPE' };
    if (!bytes.length || bytes.length > maxImageBytes) return { ok: false, error: 'IMAGE_TOO_LARGE' };
    const normalizedSource = String(source ?? 'unknown').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) || 'unknown';
    const normalizedSourceRef = String(sourceRef ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
    if (normalizedSourceRef) {
      const existing = state.assets.find(item => item.key === sessionKey && item.source === normalizedSource && item.sourceRef === normalizedSourceRef);
      if (existing) return { ok: true, ...publicAsset(existing) };
    }
    if (state.assets.filter(item => item.key === sessionKey).length >= maxAssetsPerSession) return { ok: false, error: 'IMAGE_CACHE_SESSION_LIMIT' };

    const id = crypto.randomUUID();
    const createdAt = Number(now());
    const item = {
      id,
      key: sessionKey,
      name: safeName(name, `图片-${id.slice(0, 8)}`, image.extension),
      source: normalizedSource,
      sourceRef: normalizedSourceRef,
      mimeType: image.mimeType,
      extension: image.extension,
      sizeBytes: bytes.length,
      createdAt,
      expiresAt: createdAt + Math.max(1000, Number(retentionMs) || DEFAULT_RETENTION_MS),
      delivery: null
    };
    fs.writeFileSync(path.join(assetsDir, `${id}.${image.extension}`), bytes, { flag: 'wx', mode: 0o600 });
    state.assets.push(item);
    save();
    return { ok: true, ...publicAsset(item) };
  }

  function stageToolResult({ key, toolName, callId, content } = {}) {
    const labels = imageLabels(content);
    const out = [];
    let index = 0;
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type !== 'image' || typeof block.data !== 'string') continue;
      index += 1;
      if (block.data.length > Math.ceil(maxImageBytes * 1.4) + 8) continue;
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(block.data)) continue;
      const label = String(block.name ?? labels[index - 1] ?? '').trim();
      const sourceName = String(toolName ?? 'mcp-tool').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 60) || 'mcp-tool';
      const stored = stage({
        key,
        name: label || `${sourceName}-图片-${index}`,
        source: `mcp:${sourceName}`,
        sourceRef: callId == null ? '' : `${String(callId)}:${index}`,
        data: Buffer.from(block.data, 'base64')
      });
      if (stored.ok) out.push(stored);
    }
    return out;
  }

  function list({ key } = {}) {
    prune();
    const sessionKey = String(key ?? '');
    if (!validSession.test(sessionKey)) return [];
    return state.assets.filter(item => item.key === sessionKey).sort((a, b) => b.createdAt - a.createdAt).map(publicAsset);
  }

  function get({ key, imageId } = {}) {
    prune();
    const item = state.assets.find(candidate => candidate.id === imageId && candidate.key === key);
    if (!item) return { ok: false, error: 'IMAGE_NOT_FOUND' };
    try {
      return { ok: true, ...publicAsset(item), image: { mimeType: item.mimeType, data: fs.readFileSync(path.join(assetsDir, `${item.id}.${item.extension}`)) } };
    } catch {
      return { ok: false, error: 'IMAGE_NOT_FOUND' };
    }
  }

  function claimSend({ key, imageId } = {}) {
    const item = state.assets.find(candidate => candidate.id === imageId && candidate.key === key);
    if (!item) return { ok: false, error: 'IMAGE_NOT_FOUND' };
    if (item.delivery) return { ok: false, error: 'IMAGE_DELIVERY_ALREADY_ATTEMPTED', status: item.delivery };
    item.delivery = 'sending';
    save();
    return { ok: true };
  }

  function finishSend({ key, imageId, success } = {}) {
    const item = state.assets.find(candidate => candidate.id === imageId && candidate.key === key && candidate.delivery === 'sending');
    if (!item) return { ok: false, error: 'IMAGE_SEND_NOT_CLAIMED' };
    item.delivery = success ? 'sent' : 'unknown';
    save();
    return { ok: true, status: item.delivery };
  }

  prune();
  return { stage, stageToolResult, list, get, claimSend, finishSend, prune };
}
