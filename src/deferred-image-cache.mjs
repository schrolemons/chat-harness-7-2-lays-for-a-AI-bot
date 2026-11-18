// Raw byte I/O only. Decode/animation extraction belong to explicit image reads.
export function createDeferredImageCache({
  store, fetchRaw, concurrency = 2, maxQueued = 32, ttlMs = 3600000, onError = () => {}
} = {}) {
  const queue = [], jobs = new Map();
  let active = 0;
  const jobKey = (key, ref) => key + '\n' + ref;

  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(async () => {
        const cached = store.findSource({key: job.key, sourceRef: job.ref});
        if (cached.ok) return {ok: true, imageId: cached.imageId};
        const raw = await fetchRaw(job.media);
        if (!raw?.buffer) throw Error('图片原始字节暂存失败');
        const saved = store.stage({
          key: job.key, name: 'QQ暂存图片-' + (job.index + 1),
          source: 'qq-incoming', sourceRef: job.ref, data: raw.buffer, ttlMs
        });
        if (!saved.ok) throw Error(saved.error);
        return saved;
      }).catch(error => {
        onError(error);
        return {ok: false, error: String(error.message).slice(0, 160)};
      }).then(job.resolve).finally(() => {
        active--;
        drain();
      });
    }
  }

  return {
    enqueue({key, messageId, media = []} = {}) {
      if (!/^(private|group):[1-9]\d*$/.test(String(key)) || !messageId) return [];
      const parts = media.slice(0, 5).map((item, index) => {
        const ref = item._imageSourceRef || `qq:${messageId}:${index + 1}`;
        item._imageSourceRef = ref;
        if (item.kind === 'face') return {type: 'text', text: '[一个QQ表情，尚未分析]'};
        const id = jobKey(key, ref);
        if (!jobs.has(id) && queue.length < maxQueued) {
          let resolve;
          const promise = new Promise(done => { resolve = done; });
          jobs.set(id, promise);
          queue.push({key, ref, media: item, index, resolve});
          while (jobs.size > 512) jobs.delete(jobs.keys().next().value);
        }
        return {type: 'text', text: '[一张图片，尚未分析；需要时从本会话临时缓存查看]'};
      });
      drain();
      return parts;
    },

    async read({key, media} = {}) {
      const ref = media?._imageSourceRef;
      if (!ref) return null;
      const cached = store.findSource({key, sourceRef: ref});
      if (cached.ok) return cached;
      const pending = jobs.get(jobKey(key, ref));
      if (!pending) return null;
      const result = await pending;
      if (!result.ok) return {...result, attempted: true};
      return store.findSource({key, sourceRef: ref});
    },

    status: () => ({active, queued: queue.length})
  };
}
