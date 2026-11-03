// Entry point for the isolated plugin-audit checkout; no real QQ or balance API.
import fs from 'node:fs';
const directory=new URL('../plugins/qq-components/tool-deepseek-balance/test/',import.meta.url);
for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.test.mjs')))await import(new URL(name,directory));
await import('./test-milk-scheduled-conversation.mjs');
await import('./test-milk-social-gate.mjs');
await import('./test-milk-delivery.mjs');
