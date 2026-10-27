// Read-only reconstruction from original session logs. Never sends a model/QQ request.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { normalizeUsage, priceUsage, resolvePriceTable } from '../src/model-prices.js';
import { usageOfEvent } from '../src/token-ledger.js';

export function decodeLog(buffer, compressed = false) {
  const pieces = [];
  if (compressed) {
    let offset = 0;
    while (offset < buffer.length) {
      const result = zstdDecompressSync(buffer.subarray(offset), { info: true });
      if (!(result.engine.bytesWritten > 0)) throw Error('Zstandard frame did not advance');
      offset += result.engine.bytesWritten;
      pieces.push(result.buffer.toString('utf8'));
    }
  } else pieces.push(buffer.toString('utf8'));
  return pieces.join('').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

export function samplesFromEvents(events, sessionId) {
  const samples = new Map(), retries = new Map();
  let route = {}, turn = 0, step = 0;
  for (const e of [...events].sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1))) {
    const d = e.data || {};
    if (e.type === 'model/selection') route = { ...route, ...d };
    if (e.type === 'request/header') route = { ...route, ...(d.header?.config || {}) };
    if (e.type === 'turn/start') turn = d.turn;
    if (e.type === 'step/start') step = d.step;
    const t = d.turn ?? turn, s = d.step ?? step, axis = `${t}:${s}`;
    if (e.type === 'llm/retry-started') retries.set(axis, d.retry ?? (retries.get(axis) || 0) + 1);
    const isSummary = e.type === 'compaction/summary';
    const usage = isSummary ? d.usage : usageOfEvent(e);
    if (!usage) continue;
    const retry = retries.get(axis) || 0;
    const id = isSummary ? `summary:${d.compactionId ?? e.seq}` : `${t}:${s}:${retry}`;
    samples.set(id, {
      sessionId, turn: t, step: s, retry, seq: e.seq, at: Number(e.time),
      model: isSummary ? d.model || route.model : route.model,
      provider: isSummary ? d.provider || route.provider : route.provider,
      kind: isSummary ? 'compaction' : 'conversation', buckets: normalizeUsage(usage),
    });
  }
  return [...samples.values()];
}

export function summarizeSamples(samples, table = resolvePriceTable()) {
  const buckets = { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  const components = { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0 };
  const byModel = {}, inputs = [], turns = new Set();
  let costCny = 0, flashCounterfactualCny = 0, estimatedRequests = 0, compactions = 0;
  for (const s of samples) {
    const p = priceUsage(s.buckets, { model: s.model, at: s.at, table });
    costCny += p.cost.total;
    flashCounterfactualCny += priceUsage(s.buckets, { model: 'deepseek-flash', at: s.at, table }).cost.total;
    estimatedRequests += Number(p.rates.estimated);
    compactions += Number(s.kind === 'compaction');
    for (const k in buckets) buckets[k] += s.buckets[k] || 0;
    for (const k in components) components[k] += p.cost[k];
    const model = byModel[s.model || 'unknown'] ??= { requests: 0, costCny: 0 };
    model.requests++; model.costCny += p.cost.total;
    inputs.push(s.buckets.cacheHit + s.buckets.cacheMiss + s.buckets.cacheWrite);
    if (s.kind !== 'compaction') turns.add(`${s.sessionId}:${s.turn}`);
  }
  inputs.sort((a, b) => a - b);
  return {
    requests: samples.length, turns: turns.size, compactions, estimatedRequests, costCny,
    flashCounterfactualCny, buckets, components, byModel,
    inputTokens: { median: inputs[Math.floor(inputs.length * .5)] || 0, p90: inputs[Math.floor(inputs.length * .9)] || 0,
      max: inputs.at(-1) || 0, mean: inputs.reduce((a, b) => a + b, 0) / (inputs.length || 1) },
  };
}

export function auditCost({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh') } = {}) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const table = resolvePriceTable(cfg.pricing), samples = [], failures = [];
  const base = path.join(home, 'sessions'), seen = new Set();
  let sessionCount = 0;
  for (const workspace of fs.readdirSync(base, { withFileTypes: true })) {
    if (!workspace.isDirectory() || !/qq-bridge|DSH~0020BOT/.test(workspace.name)) continue;
    const dir = path.join(base, workspace.name);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sessionDir = path.join(dir, entry.name);
      const files = fs.readdirSync(sessionDir).filter(n => /^session\.v\d+\.jsonl(?:\.zstd)?$/.test(n))
        .sort((a, b) => Number(b.match(/v(\d+)/)[1]) - Number(a.match(/v(\d+)/)[1]));
      if (!files.length) continue;
      try {
        const rows = decodeLog(fs.readFileSync(path.join(sessionDir, files[0])), files[0].endsWith('.zstd'));
        const header = rows.find(x => x.type === 'session');
        const sid = header?.id || entry.name;
        if (seen.has(sid)) continue;
        seen.add(sid); sessionCount++;
        samples.push(...samplesFromEvents(rows, sid));
      } catch (error) { failures.push({ session: entry.name, error: error.code || error.name }); }
    }
  }
  const byDay = {};
  for (const [day, rows] of Object.entries(Object.groupBy(samples, s => new Date(s.at + 8 * 3600000).toISOString().slice(0, 10)))) byDay[day] = summarizeSamples(rows, table);
  const report = { generatedAt: new Date().toISOString(), scope: 'Retained original bridge-owned session logs; local rate estimate, not provider invoice. Includes retired sessions and compaction generation. No cumulative baselines are added.',
    timezone: 'Asia/Shanghai', currency: 'CNY', sessionCount, failures, totals: summarizeSamples(samples, table), byDay };
  const out = path.join(root, 'state', 'cost-audit.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) console.log(JSON.stringify(auditCost(), null, 2));
