// Read SnowLuma's own bounded event cache. Never calls a QQ/OneBot endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function readLocalConversationHistory({ runtimeRoot, botUin, key, allowedKeys = [], limit = 40, since = 0, until = Date.now() } = {}) {
  if (!/^[1-9]\d*$/.test(String(botUin)) || !/^(private|group):[1-9]\d*$/.test(String(key))
      || !allowedKeys.includes(key)) return { ok: false, reason: 'not_allowed', messages: [] };
  const count = Math.max(0, Math.min(100, Math.floor(Number(limit) || 0)));
  if (!count) return { ok: true, source: 'snowluma-local', messages: [] };
  let db;
  try {
    const root = fs.realpathSync(runtimeRoot), account = path.join(root, 'data', String(botUin));
    const file = path.join(account, 'messages.db'), resolved = fs.realpathSync(file);
    if (path.dirname(resolved).toLowerCase() !== account.toLowerCase()) return { ok: false, reason: 'account_path_mismatch', messages: [] };
    db = new DatabaseSync(resolved, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100;');
    const [kind, id] = key.split(':');
    const rows = db.prepare('SELECT message_hash,timestamp,private_direction,data FROM messages WHERE is_group=? AND session_id=? AND timestamp>=? AND timestamp<=? AND data IS NOT NULL AND length(data)<=1048576 ORDER BY timestamp DESC,sequence DESC LIMIT ?')
      .all(kind === 'group' ? 1 : 0, Number(id), Math.floor(Math.max(0, Number(since) || 0) / 1000), Math.floor(Number(until) / 1000), count);
    const messages = [];
    for (const row of rows.reverse()) {
      let event;
      try { event = JSON.parse(row.data); } catch { continue; }
      if (!event || event.message_type !== kind || event.self_id != null && String(event.self_id) !== String(botUin)) continue;
      if (kind === 'group' && String(event.group_id) !== id) continue;
      if (kind === 'private' && ![event.user_id, event.target_id, event.peer_id].some(value => String(value) === id)) continue;
      messages.push({ ...event, message_id: event.message_id ?? row.message_hash,
        time: event.time || row.timestamp, localDirection: row.private_direction, historySource: 'snowluma-local' });
    }
    return { ok: true, source: 'snowluma-local', partial: rows.length >= count, messages };
  } catch (error) {
    return { ok: false, reason: error?.code === 'ENOENT' ? 'cache_missing' : 'cache_unavailable', messages: [] };
  } finally { db?.close(); }
}
