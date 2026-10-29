// Called after bridge Host/auth/agent/CSRF gates; session-tool execution stays in its transport layer.
export async function routePluginManagement({req,url,pluginHost,readBody,sendJson}) {
if (req.method === 'GET' && url.pathname === '/api/plugins') {
          sendJson({ ok: true, ...pluginHost.summary(), tools: pluginHost.listTools() });
          return true;
        }
if (req.method === 'GET' && url.pathname === '/api/plugins/layers') {
          sendJson({ ok: true, layers: pluginHost.layers() });
          return true;
        }
if (req.method === 'GET' && url.pathname === '/api/plugins/detail') {
          const id = String(url.searchParams.get('id') || '');
          const one = pluginHost.get(id);
          if (!one) { sendJson({ ok: false, error: '没有这个插件' }, 404); return true; }
          sendJson({ ok: true, plugin: one });
          return true;
        }
if (req.method === 'POST' && url.pathname === '/api/plugins/toggle') {
          let body = {};
          try { body = await readBody(); } catch { sendJson({ ok: false, error: 'body 必须是 JSON' }, 400); return true; }
          const out = pluginHost.setEnabled(body.id, body.enabled !== false);
          if (out.ok) await pluginHost.reload(body.id);
          sendJson({ ...out, ...pluginHost.summary() });
          return true;
        }
if (req.method === 'POST' && url.pathname === '/api/plugins/reload') {
          await pluginHost.reload();
          sendJson({ ok: true, ...pluginHost.summary() });
          return true;
        }
if (req.method === 'POST' && url.pathname === '/api/plugins/config') {
          const body=await readBody();const out=pluginHost.setConfig(body.id,body.config);
          if(out.ok)await pluginHost.reload(body.id);sendJson(out,out.ok?200:400);return true;
        }
if (req.method === 'POST' && url.pathname === '/api/plugins/harnessify') {
          const body=await readBody();const out=await pluginHost.harnessify(body.id,{layer:body.layer});
          sendJson(out,out.ok?200:400);return true;
        }
if (req.method === 'POST' && url.pathname === '/api/plugins/order') {
          let body = {};
          try { body = await readBody(); } catch { sendJson({ ok: false, error: 'body 必须是 JSON' }, 400); return true; }
          sendJson({ ok: true, ...pluginHost.setOrder(body.order) });
          return true;
        }
if (req.method === 'GET' && url.pathname.startsWith('/api/plugins/skill/')) {
          const id = decodeURIComponent(url.pathname.slice('/api/plugins/skill/'.length));
          const text = pluginHost.getSkill(id);
          if (!text) { sendJson({ ok: false, error: '没有找到 skill.md' }, 404); return true; }
          sendJson({ ok: true, id, text });
          return true;
        }
return false;
}
