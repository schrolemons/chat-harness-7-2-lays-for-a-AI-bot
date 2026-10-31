import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BILI_KEYWORDS,
  chooseWeightedTopic,
  chooseTopicUploader,
  isWhitelistedSession,
  normalizeKeywords,
  normalizeSessionWhitelist,
  normalizeTopicUploaders,
  pickVideos,
  resolveShareConfig
} from '../src/bili-share.js';

test('normalizes custom topics from console text and bounds the list', () => {
  const values = normalizeKeywords('海洋\n鲸鱼, 科普，海洋');
  assert.deepEqual(values, ['海洋', '鲸鱼', '科普']);
  assert.equal(normalizeKeywords(Array.from({ length: 20 }, (_, i) => `主题${i}`)).length, 12);
  assert.deepEqual(resolveShareConfig({ keywords: [] }).keywords, DEFAULT_BILI_KEYWORDS);
});

test('topic draw uses one base weight plus the sum of related uploader weights', () => {
  const topics = ['海洋', '鲸鱼'];
  const ups = [{ topic: '鲸鱼', uploader: '指定UP', weight: 2 }];
  assert.equal(chooseWeightedTopic(topics, ups, () => 0), '海洋');
  assert.equal(chooseWeightedTopic(topics, ups, () => 0.25), '鲸鱼');
  assert.equal(chooseWeightedTopic(topics, ups, () => 0.999), '鲸鱼');
});

test('topic related uploader list uses weighted targeting, while keeping broad search possible', () => {
  const ups = normalizeTopicUploaders('鲸鱼 | 示例创作者 | 2\n海洋 | 其他UP | 1', ['鲸鱼', '海洋']);
  assert.deepEqual(ups, [
    { topic: '鲸鱼', uploader: '示例创作者', weight: 2 },
    { topic: '海洋', uploader: '其他UP', weight: 1 }
  ]);
  assert.equal(chooseTopicUploader('鲸鱼', ups, () => 0), '');
  assert.equal(chooseTopicUploader('鲸鱼', ups, () => 0.34), '示例创作者');
  assert.equal(chooseTopicUploader('鲸鱼', ups, () => 0.99), '示例创作者');
  const multi = [...ups, { topic: '鲸鱼', uploader: '另一位UP', weight: 1 }];
  assert.equal(chooseTopicUploader('鲸鱼', multi, () => 0.8), '另一位UP');
  assert.equal(chooseTopicUploader('少年', ups, () => 0), '');
});

test('normalizes both group/private delivery sessions', () => {
  assert.deepEqual(normalizeSessionWhitelist(['group:12345', 'private:67890', 'private:no', 'group:12345']), ['group:12345', 'private:67890']);
  assert.equal(isWhitelistedSession('private:67890', ['private:67890']), true);
  assert.equal(isWhitelistedSession('group:12345', ['private:67890']), false);
});

test('share config exposes topic-associated uploader weights and delivery targets', () => {
  assert.deepEqual(resolveShareConfig({
    keywords: ['海洋', '鲸鱼'],
    topicUploaders: [{ topic: '鲸鱼', uploader: '示例创作者', weight: 2 }],
    sessionWhitelist: ['private:67890']
  }), {
    keywords: ['海洋', '鲸鱼'],
    topicUploaders: [{ topic: '鲸鱼', uploader: '示例创作者', weight: 2 }],
    sessionWhitelist: ['private:67890'],
    maxItems: 2
  });
});

test('only selects videos with source title, uploader, summary, and a fresh BV id', () => {
  const items = pickVideos([
    { bvid: 'BV1ab411c7mD', title: '鲸鱼纪录片', uploader: '海洋频道', description: '记录鲸群迁徙。' },
    { bvid: 'BV1ab411c7mE', title: '缺少 UP 主', description: '简介' },
    { bvid: 'BV1ab411c7mF', title: '缺少简介', uploader: '海洋频道' },
    { bvid: 'BV1ab411c7mG', title: '重复项', uploader: '海洋频道', description: '内容' }
  ], { excludeBvids: ['BV1ab411c7mG'], maxItems: 2 });

  assert.deepEqual(items.map(({ bvid, uploader, description, url }) => ({ bvid, uploader, description, url })), [
    {
      bvid: 'BV1ab411c7mD',
      uploader: '海洋频道',
      description: '记录鲸群迁徙。',
      url: 'https://www.bilibili.com/video/BV1ab411c7mD'
    }
  ]);
});
