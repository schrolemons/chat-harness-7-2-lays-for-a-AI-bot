// Carry the host generation through policy dependencies during hot reload.
const url=new URL('./runtime.mjs',import.meta.url);url.search=new URL(import.meta.url).search;
const {createPlugin,extractSelfAlias}=await import(url.href);
export {createPlugin,extractSelfAlias};
