import assert from 'node:assert/strict';
import { parseWatchUrls, parseEnabledScripts } from '../plugins/qq-components/life-campus-watch/monitor-config.mjs';

const fallback = [{ name: '旧站点', url: 'https://old.example/' }];
assert.deepEqual(parseWatchUrls([], fallback), fallback, '未填写时保留既有监控网址');
assert.deepEqual(parseWatchUrls(['课程表 | https://example.com/a']), [{ name: '课程表', url: 'https://example.com/a' }]);
assert.throws(() => parseWatchUrls(['file:///private']), /http/i);
assert.throws(() => parseWatchUrls(['站点 | https://example.com/', '重复 | https://example.com/']), /重复/);
assert.deepEqual([...parseEnabledScripts('bookmarks|lectures')].sort(), ['bookmarks', 'lectures']);
assert.throws(() => parseEnabledScripts('bookmarks|unknown'), /无效/);
