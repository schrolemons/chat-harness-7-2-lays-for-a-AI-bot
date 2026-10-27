import { fileURLToPath } from 'node:url';
import { loadLocalConfig } from './config.mjs';
import { createRouter } from './routing.mjs';

const dir = fileURLToPath(new URL('./', import.meta.url));
let cachedConfig, cachedRouter;
/** C-layer consumers use the same live local routing configuration as S. */
export function createTurnPolicy(ctx) {
  return payload => {
    if (ctx.isPluginEnabled?.('schnie-core') === false) return { mode: 'off' };
    const current = loadLocalConfig(dir);
    if (current.disabled) return { mode: 'off' };
    const signature = JSON.stringify(current.config);
    if (cachedConfig !== signature) { cachedRouter = createRouter(current.config); cachedConfig = signature; }
    return cachedRouter(payload);
  };
}
