// C-layer consumers use the one enabled S-layer service; no filesystem or source-specific rules here.
export function createTurnPolicy(ctx){return payload=>ctx.isPluginEnabled?.('personal-core')===false?{mode:'off'}:ctx.callService?.('personal-core','route',payload)||{mode:'off',reason:'library-service-unavailable'};}
