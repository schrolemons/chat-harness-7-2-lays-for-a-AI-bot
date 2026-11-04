import assert from 'node:assert/strict';
import { parseWatchUrls, parseScriptPaths } from '../plugins/qq-components/life-web-watch/monitor-config.mjs';

assert.deepEqual(parseWatchUrls([]), []);
assert.deepEqual(parseWatchUrls([{value:'https://example.invalid/',enabled:false}]), []);
assert.deepEqual(parseWatchUrls(['公告 | https://example.invalid/a']), [{name:'公告',url:'https://example.invalid/a'}]);
assert.throws(() => parseWatchUrls(['file:///private']), /http/i);
assert.throws(() => parseWatchUrls(['https://user:password@example.invalid/']), /用户名或密码/);
assert.throws(() => parseWatchUrls(['https://example.invalid/', '重复 | https://example.invalid/']), /重复/);
assert.deepEqual(parseScriptPaths([{value:'synthetic.mjs',enabled:false}]), []);
assert.throws(() => parseScriptPaths(['synthetic.mjs','synthetic.mjs']), /重复/);
