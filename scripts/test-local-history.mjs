import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readLocalConversationHistory } from '../src/bridge-core/local-history.mjs';

test('local history is read-only, account/session scoped and bounded; no network access is used', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-local-history-'));
  try {
    const dir = path.join(root, 'data/999'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'messages.db'), db = new DatabaseSync(file);
    db.exec('CREATE TABLE messages(message_hash INTEGER PRIMARY KEY,is_group INTEGER,session_id INTEGER,sequence INTEGER,timestamp INTEGER,private_direction INTEGER,data TEXT)');
    const insert = db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)');
    for (let i = 1; i <= 10; i++) insert.run(i, 0, 123, i, 100 + i, 0, JSON.stringify({ message_type: 'private', self_id: 999, user_id: 123, message_id: i, message: [{ type: 'text', data: { text: 'local ' + i } }] }));
    insert.run(11, 0, 123, 11, 111, 0, JSON.stringify({ message_type: 'private', self_id: 888, user_id: 123, message_id: 11 }));
    insert.run(12, 0, 456, 12, 112, 0, JSON.stringify({ message_type: 'private', self_id: 999, user_id: 456, message_id: 12 }));
    db.close(); const before = fs.readFileSync(file);
    const opts = { runtimeRoot: root, botUin: '999', key: 'private:123', allowedKeys: ['private:123'], limit: 3 };
    assert.deepEqual(readLocalConversationHistory(opts).messages.map(m => m.message_id), [9, 10]);
    assert.equal(readLocalConversationHistory({ ...opts, key: 'private:456' }).reason, 'not_allowed');
    assert.equal(readLocalConversationHistory({ ...opts, botUin: '../888' }).reason, 'not_allowed');
    assert.deepEqual(readLocalConversationHistory({ ...opts, since: 110000 }).messages.map(m => m.message_id), [10]);
    assert.deepEqual(readLocalConversationHistory({ ...opts, until: 103000 }).messages.map(m => m.message_id), [1,2,3]);
    assert.deepEqual(fs.readFileSync(file), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
