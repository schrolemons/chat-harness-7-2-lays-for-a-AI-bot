/** Build against the host's actual loader and scope modules, never development copies. */
export function createInstancePresetWrapper({ Group, EntryGroup, scopeOf, bindScopeParent }, { state, retain, release }) {
  if (typeof Group !== 'function' || typeof EntryGroup?.key !== 'symbol' || Group[EntryGroup.key] !== true) {
    throw new Error('Host loader does not support expression-preserving entry groups');
  }
  return class InstancePreset extends Group {
    static inject = ['tools'];
    // The loader must defer child expressions until each child has its own context.
    static [EntryGroup.key] = true;
    constructor(ctx, config) {
      const key = scopeOf(ctx);
      if (!key) throw new Error('Instance preset requires an agent-preset scope');
      bindScopeParent(key, state.key);
      // This effect belongs to the retained preset generation, not the instance.
      ctx.tools.guard(() => state.enabled ? undefined : 'BOT_INSTANCE_DISABLED');
      ctx.effect(() => { retain(); return release; }, 'bot-instance.preset-generation');
      super(ctx, config.plugins);
    }
  };
}
