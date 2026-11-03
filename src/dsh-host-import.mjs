/** Import from the active host. loader.import's second argument is not a URL. */
export function createHostImport(ctx, override) {
  return async name => {
    const loader = ctx.loader;
    const baseUrl = ctx.root.baseUrl || loader?.config?.baseUrl || loader?.ctx?.baseUrl;
    if (override) return override(name, baseUrl);
    if (loader?.internal?.import) {
      if (!baseUrl) throw Error('The active DSH host loader has no host baseUrl');
      return loader.internal.import(name, baseUrl, {});
    }
    if (typeof loader?.import === 'function') return loader.import(name);
    throw Error('The active DSH host loader cannot import runtime modules');
  };
}
