import test from 'node:test';
import assert from 'node:assert/strict';
import { zstdCompressSync } from 'node:zlib';
import { decodeLog, samplesFromEvents, summarizeSamples } from './audit-cost.mjs';
const at = Date.parse('2026-10-25T12:00:00+08:00');
const selection = (seq, model) => ({ type: 'model/selection', seq, time: at, data: { provider: 'deepseek-official', model } });
const msg = (seq, n, type = 'assistant/message') => ({ type, seq, time: at, data: { turn: 1, step: 1, usage: { inputTokens: n, outputTokens: 10 } } });

test('raw history audit preserves model prices across later model changes', () => {
  const samples = samplesFromEvents([selection(0, 'deepseek-v4-pro'), msg(1, 1000000), selection(2, 'deepseek-flash'), { ...msg(3, 1000000), data: { ...msg(3, 1000000).data, step: 2 } }], 's');
  const summary = summarizeSamples(samples);
  assert.equal(summary.requests, 2);
  assert.ok(Math.abs(summary.costCny - 5.500175) < 1e-9);
});
test('stream attempt is replaced by final usage, real retries remain separate', () => {
  const events = [selection(0, 'deepseek-flash'), msg(1, 100), msg(2, 200), { type: 'llm/retry-started', seq: 3, time: at, data: { turn: 1, step: 1, retry: 1 } }, msg(4, 300)];
  const samples = samplesFromEvents(events, 's');
  assert.equal(samples.length, 2);
  assert.equal(summarizeSamples(samples).buckets.cacheMiss, 500);
});
test('compaction generation is a paid call separate from conversation usage', () => {
  const samples = samplesFromEvents([selection(0, 'deepseek-v4-pro'), { type: 'compaction/summary', seq: 1, time: at, data: { compactionId: 'c1', provider: 'deepseek-official', model: 'deepseek-flash', usage: { inputTokens: 1000, outputTokens: 100 } } }], 's');
  assert.equal(samples[0].model, 'deepseek-flash');
  assert.equal(samples[0].kind, 'compaction');
  assert.ok(Math.abs(summarizeSamples(samples).costCny - 0.0014) < 1e-10);
});
test('concatenated Zstandard frames are all decoded without mutating the log', () => {
  const encoded = Buffer.concat([zstdCompressSync('{"type":"session"}\n'), zstdCompressSync('{"type":"turn/start"}\n')]);
  assert.deepEqual(decodeLog(encoded, true).map(x => x.type), ['session', 'turn/start']);
});
test('reasoning is informational and is not charged again on top of output', () => {
  const r = msg(1, 0); r.data.usage.reasoningTokens = 10;
  assert.equal(summarizeSamples(samplesFromEvents([selection(0, 'deepseek-flash'), r], 's')).costCny, 0.00004);
});
