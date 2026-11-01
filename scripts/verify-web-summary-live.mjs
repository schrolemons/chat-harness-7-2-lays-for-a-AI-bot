// A single real model call using the owner's pasted example; no QQ delivery or website requests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWebChange, prepareWebNotifications } from '../plugins/qq-components/life-campus-watch/web-changes.mjs';
import { generateWebSummary } from '../plugins/qq-components/life-campus-watch/summarizer.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = { name: '算法设计与分析', url: 'http://example.invalid/~wx309/lecture/alg2026/index.html' };
const lines = ['G3-108 · 第 2–5、7–16 周', '授课教师：汪炀、徐殷', '一班：周一 6–7 节、周二 1–2 节 | 二班：周一 8–9 节、周二 3–4 节', '中国科学技术大学 · 课程团队所在实验室', '数据智能实验室', '访问主页', ...['一', '二', '三', '四', '五'].map(n => '分布式算法课件' + n + ' PPT')];
const change = buildWebChange({ site, previous: { lines: [], contentVersion: 2, linkDetails: [] }, current: { lines, links: [] } });
const result = await prepareWebNotifications([change], { generate: payload => generateWebSummary(payload, { root }), onError: error => console.log('MODEL_ERROR=' + error.message) });
const report = { observedAt: new Date().toISOString(), mode: result.changes[0]?.summaryMode, text: result.changes[0]?.msg, noQqDelivery: true };
fs.writeFileSync(path.join(root, 'state', 'web-summary-live-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.mode !== 'ai') process.exitCode = 1;
