// Isolated real model turns: no QQ tools/delivery and no changes to existing chats.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';
import { selectRoleText } from '../src/role-card.js';
import { cleanRoleHint } from '../src/role-hint.js';
import { createPlugin } from '../plugins/qq-components/ctx-chat-style/index.js';
const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const api = new NodeApiClient(cfg.dsh.baseUrl, 8000);
const card = cleanRoleHint(selectRoleText(fs.readFileSync(new URL('../roles/AI助手.md', import.meta.url), 'utf8'), 'v2'));
const cwd = path.resolve('state', 'persona-verification-workspace');
fs.mkdirSync(cwd, { recursive: true });
const sessionId = unwrap(await api.sessions.create({ cwd, agentPreset: 'campus-summary' }), 'create').sessionId;
const outputs = [];
async function turn(question) {
  const blocks = [];
  createPlugin({ config: {}, addPromptBlock: value => blocks.push(value) }).hooks.beforePrompt({ roleName: 'AI助手', key: 'private:1', isPrivate: true, incomingText: question });
  const prompt = card + '\n\n' + blocks.join('\n\n') + '\n\n【当前消息】' + question + '\n请直接回复这条消息，控制在180字内。本次不调用任何工具。';
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(cfg.dsh.baseUrl.replace(/^http/, 'ws') + '/api/remote.mux', { headers: { cookie: api.cookie } });
    const streamId = randomUUID();
    let text = '', sent = false, finished = false, submitTimer;
    const done = (error, result) => { if (finished) return; finished = true; clearTimeout(timer); clearTimeout(submitTimer); socket.close(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => done(Error('model timeout')), 45000);
    const submit = () => { if (sent || finished) return; sent = true; api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }] }).catch(error => done(error)); };
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId } } } } }));
      submitTimer = setTimeout(submit, 500);
    });
    socket.on('message', bytes => {
      let message; try { message = JSON.parse(String(bytes)); } catch { return; }
      if (message.streamId !== streamId || message.type !== 'item') return;
      if (message.value?.type === 'snapshot') submit();
      const event = message.value?.type === 'event' ? message.value.event : null;
      if (event?.type === 'assistant/message') for (const block of event.data?.message?.content || []) if (block.type === 'text') text += block.text;
      if (event?.type === 'turn/end') {
        const reason = event.data?.reason;
        const kind = typeof reason === 'string' ? reason : reason?.kind;
        done(kind === 'completed' ? null : Error('turn ' + kind), text);
      }
    });
    socket.on('error', () => done(Error('model stream error')));
    socket.on('close', () => { if (!finished) done(Error('model stream closed')); });
  });
}
try {
  await api.sessions.selectModel({ sessionId, provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' });
  for (const question of ['你知道大海，可是你真的能游进去吗？', '也许经历不一定只靠身体，认真理解别人说的话，也能成为你故事的一部分。你觉得呢？']) {
    const text = await turn(question);
    outputs.push({ question, answer: text });
    console.log(JSON.stringify(outputs.at(-1)));
  }
  fs.writeFileSync(path.resolve('state', 'whale-inner-world-live.json'), JSON.stringify({ observedAt: new Date().toISOString(), isolated: true, qqDelivery: false, outputs }, null, 2));
} finally {
  try { await api.sessions.cancel({ sessionId }); } catch {}
  try { await api.callUnary('workspace/archiveSession', { sessionId }); } catch {}
}
