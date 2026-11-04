// 把「字符串数组」或「{value, enabled} 数组」统一成已启用条目的字符串数组（勾选=启用，取消勾选不生效但保留）。
function normalizeItems(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((e) => (typeof e === 'string' ? { value: e, enabled: true } : e))
    .filter((e) => e && e.enabled !== false)
    .map((e) => String(e.value ?? '').trim())
    .filter(Boolean);
}

export function parseWatchUrls(lines) {
  const active = normalizeItems(lines);
  if (!active.length) return [];
  if (active.length > 20) throw Error('最多监控 20 个网址');
  const seen = new Set();
  return active.map((raw, index) => {
    const split = raw.indexOf('|');
    const name = split < 0 ? '网页 ' + (index + 1) : raw.slice(0, split).trim().slice(0, 60);
    const urlText = split < 0 ? raw : raw.slice(split + 1).trim();
    let url;
    try { url = new URL(urlText); } catch { throw Error('网址格式无效：' + urlText); }
    if (url.username || url.password) throw Error('网址不能包含用户名或密码');
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('监控网址只接受 http/https');
    if (seen.has(url.href)) throw Error('重复网址：' + url.href);
    seen.add(url.href);
    return { name: name || '网页 ' + (index + 1), url: url.href };
  });
}

export function parseScriptPaths(lines) {
  const values = normalizeItems(lines);
  if (values.length > 30) throw Error('最多登记 30 个脚本');
  if (values.some(value => /[\r\n\0]/.test(value))) throw Error('脚本路径不能包含换行或空字符');
  if (new Set(values).size !== values.length) throw Error('脚本路径不能重复');
  return values;
}
