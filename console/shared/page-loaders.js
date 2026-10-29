
const loaders = new Map();
export function registerPageLoader(page, loader) { loaders.set(page, loader); }
export function loadPageData(page) { return loaders.get(page)?.(); }
