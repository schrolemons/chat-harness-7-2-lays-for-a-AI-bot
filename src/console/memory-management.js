// Transport only. Bridge invokes this after Host, console auth and CSRF gates.
export async function routeMemoryManagement({ req, url, readBody, sendJson, pluginHost, agentTokenOk, agentEnabled = () => true, affairsMaxChars }) {
  if (url.pathname !== '/api/socialV2/affairs') return false;
  if (!['GET', 'POST'].includes(req.method)) { sendJson({ ok: false, error: '方法不支持' }, 405); return true; }
  try {
    const input = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await readBody();
    const key = String(input.key || '').trim();
    if (!/^(private|group):\d{1,20}$/.test(key)) { sendJson({ ok: false, error: '会话 key 格式无效' }, 400); return true; }
    if (req.headers['x-agent-token'] && !agentTokenOk(key, req.headers['x-agent-token'])) { sendJson({ ok: false, error: 'agent token 无效' }, 403); return true; }
    if (req.headers['x-agent-token'] && !agentEnabled(key)) { sendJson({ ok: false, error: '当前会话或事务工具未启用' }, 403); return true; }
    if (req.method === 'GET') {
      const list = pluginHost.callService('affairs', 'list', { key, status: input.status || 'active', offset: input.offset, limit: input.limit });
      if (!list) { sendJson({ ok: false, error: '记忆存储组件不可用' }, 503); return true; }
      const preview = pluginHost.callService('affairs', 'context', { key, maxChars: affairsMaxChars });
      sendJson({ ...list, preview }); return true;
    }
    if (input.action !== 'upsert') { sendJson({ ok: false, error: '支持 action=upsert；用 id/expectedRevision 修改已有事务' }, 400); return true; }
    const out = pluginHost.callService('affairs', 'upsert', { key, ...Object.fromEntries(['id', 'expectedRevision', 'title', 'detail', 'status', 'priority', 'nextAction', 'source']
      .filter(field => Object.hasOwn(input, field)).map(field => [field, input[field]])) });
    if (!out) { sendJson({ ok: false, error: '记忆存储组件不可用' }, 503); return true; }
    sendJson(out, out.conflict ? 409 : out.ok ? 200 : 400);
  } catch (error) { sendJson({ ok: false, error: error?.message || '事务操作失败' }, 400); }
  return true;
}
