import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { NodeApiClient, unwrap } from '../../../src/dsh-client.js';
import { SUMMARY_PROMPT } from './summary-policy.mjs';

/** One short, fresh, tool-free DSH turn for the whole change batch. Never sends to QQ. */
export async function generateWebSummary(payload, { root, timeoutMs = 35000, provider = 'deepseek-official', model = 'deepseek-flash' } = {}) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const api = new NodeApiClient(cfg.dsh.baseUrl, 8000, cfg.dsh.authToken ? { token: cfg.dsh.authToken } : {});
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(Error('网页整理超时')), Math.max(1000, Math.min(timeoutMs, 60000)));
  const signal = abort.signal;
  let sessionId, turnCompleted = false;
  try {
    const list = unwrap(await api.agentPresets.list({}, signal), 'agentPresets.list').presets;
    if (!list.some(preset => preset.id === 'campus-summary' && !preset.broken)) throw Error('网页整理预设未就绪');
    const cwd = path.join(root, 'state', 'web-summary-workspace');
    fs.mkdirSync(cwd, { recursive: true });
    const created = unwrap(await api.sessions.create({ cwd, agentPreset: 'campus-summary' }, signal), 'session.create');
    sessionId = created.sessionId;
    await api.sessions.selectModel({ sessionId, provider, model, reasoningEffort: 'low' }, signal);
    const url = new URL('/api/remote.mux', cfg.dsh.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const answer = await new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { headers: { cookie: api.cookie } });
      const streamId = randomUUID();
      let text = '', promptSent = false, done = false, startTimer;
      const finish = (error, result) => {
        if (done) return;
        done = true;
        clearTimeout(startTimer);
        signal.removeEventListener('abort', onAbort);
        try { socket.close(); } catch {}
        if (error) reject(error); else resolve(result);
      };
      const onAbort = () => finish(Error('网页整理超时'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }
      const submit = () => {
        if (promptSent || done) return;
        promptSent = true;
        api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: SUMMARY_PROMPT + '\n网页变化数据：\n' + JSON.stringify(payload) }] }, signal).catch(error => finish(error));
      };
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId } } } } }));
        startTimer = setTimeout(submit, 500);
      });
      socket.on('message', bytes => {
        let message; try { message = JSON.parse(String(bytes)); } catch { return; }
        if (message.streamId !== streamId || message.type !== 'item') return;
        if (message.value?.type === 'snapshot') submit();
        const event = message.value?.type === 'event' ? message.value.event : null;
        if (event?.type === 'assistant/message') for (const block of event.data?.message?.content || []) if (block.type === 'text') text += block.text;
        if (event?.type === 'turn/end') {
          const reason = event.data?.reason;
          if ((typeof reason === 'string' ? reason : reason?.kind) !== 'completed') finish(Error('网页整理回合未完成'));
          else finish(null, text);
        }
      });
      socket.on('error', () => finish(Error('网页整理事件连接失败')));
      socket.on('close', () => { if (!done) finish(Error('网页整理事件连接提前结束')); });
    });
    turnCompleted = true;
    return JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } finally {
    clearTimeout(timer);
    // Cancel any unfinished generation before archiving the disposable session.
    if (!turnCompleted && sessionId) try { await api.sessions.cancel({ sessionId }); } catch {}
    if (sessionId) try { await api.callUnary('workspace/archiveSession', { sessionId }); } catch {}
  }
}
