import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQmcAAAAASUVORK5CYII=', 'base64');

async function withStore(run, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-image-assets-'));
  try {
    const { createImageAssetStore } = await import('../src/image-asset-store.mjs');
    const store = createImageAssetStore({ root, ...options });
    await run(store, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('stages an MCP image block with a stable name, source, and retrievable bytes', async () => {
  await withStore(async store => {
    const [asset] = store.stageToolResult({
      key: 'group:12345',
      toolName: 'bili_video_frames',
      content: [
        { type: 'text', text: JSON.stringify({ imageEvidence: ['视频关键帧拼图（0s–10s；帧时间：2s、7s）'] }) },
        { type: 'image', mimeType: 'image/png', data: png.toString('base64') }
      ]
    });

    assert.equal(asset.name, '视频关键帧拼图（0s–10s；帧时间：2s、7s）.png');
    assert.equal(asset.source, 'mcp:bili_video_frames');
    assert.match(asset.imageId, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(store.get({ key: 'group:12345', imageId: asset.imageId }).image.data, png);
  });
});

test('distinct images returned by one MCP call get distinct staged assets', async () => {
  await withStore(async store => {
    const result = store.stageToolResult({
      key: 'private:10001', toolName: 'bili_video_frames', callId: 'same-call',
      content: [
        { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
        { type: 'image', mimeType: 'image/png', data: png.toString('base64') }
      ]
    });
    assert.equal(result.length, 2);
    assert.notEqual(result[0].imageId, result[1].imageId);
  });
});

test('staged image assets are isolated to the QQ conversation that received them', async () => {
  await withStore(async store => {
    const [asset] = store.stageToolResult({
      key: 'private:10001', toolName: 'image_tool',
      content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }]
    });

    assert.deepEqual(store.list({ key: 'group:12345' }), []);
    assert.equal(store.get({ key: 'group:12345', imageId: asset.imageId }).error, 'IMAGE_NOT_FOUND');
  });
});

test('a failed or unknown send attempt cannot be retried automatically', async () => {
  await withStore(async store => {
    const [asset] = store.stageToolResult({
      key: 'private:10001', toolName: 'image_tool',
      content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }]
    });

    assert.equal(store.claimSend({ key: 'private:10001', imageId: asset.imageId }).ok, true);
    assert.equal(store.finishSend({ key: 'private:10001', imageId: asset.imageId, success: false }).status, 'unknown');
    assert.equal(store.claimSend({ key: 'private:10001', imageId: asset.imageId }).error, 'IMAGE_DELIVERY_ALREADY_ATTEMPTED');
  });
});

test('temporary assets disappear after their configured retention period', async () => {
  let now = 1000;
  await withStore(async store => {
    const [asset] = store.stageToolResult({
      key: 'group:12345', toolName: 'image_tool',
      content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }]
    });
    now += 1001;
    store.prune();
    assert.equal(store.get({ key: 'group:12345', imageId: asset.imageId }).error, 'IMAGE_NOT_FOUND');
  }, { now: () => now, retentionMs: 1000 });
});

test('the same incoming QQ image is staged only once across prompt preparation and relay detection', async () => {
  await withStore(async store => {
    const first = store.stage({ key: 'private:10001', name: 'QQ图片-42-1.png', source: 'qq-incoming', sourceRef: 'qq:42:1', data: png });
    const second = store.stage({ key: 'private:10001', name: 'QQ图片-42-1.png', source: 'qq-incoming', sourceRef: 'qq:42:1', data: png });
    assert.equal(first.imageId, second.imageId);
    assert.equal(store.list({ key: 'private:10001' }).length, 1);
  });
});

test('an interrupted in progress delivery is recovered as unknown and cannot be retried', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-image-assets-restart-'));
  try {
    const { createImageAssetStore } = await import('../src/image-asset-store.mjs');
    const store = createImageAssetStore({ root });
    const asset = store.stage({ key: 'private:10001', name: 'test.png', source: 'local-file', data: png });
    assert.equal(store.claimSend({ key: 'private:10001', imageId: asset.imageId }).ok, true);
    const recovered = createImageAssetStore({ root });
    assert.deepEqual(recovered.claimSend({ key: 'private:10001', imageId: asset.imageId }), {
      ok: false, error: 'IMAGE_DELIVERY_ALREADY_ATTEMPTED', status: 'unknown'
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
