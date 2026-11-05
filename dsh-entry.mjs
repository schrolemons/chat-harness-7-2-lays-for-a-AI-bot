import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { Config as ModeConfig } from './plugins/qq-mode-console/lib/index.js';
import { readInstanceDescriptor } from './src/instance-descriptor.mjs';
import { mountInstanceController } from './src/dsh-instance-controller.mjs';
import { PROFILE_BUNDLE, PROFILE_ENTRY, PROFILE_RUNTIME_RECEIPT, profileRuntimeRoot } from './src/profile-chat-bridge.mjs';
import { resolveInstanceNode, createProductionFactories } from './src/dsh-instance-factories.mjs';

export const name = 'bot-instance';
export const inject = ['loader', 'tools', 'agentPresets', 'sessions', 'sessionTitle'];
export const Config = z.object({
  ...ModeConfig.dict,
  root: z.string().default(path.dirname(fileURLToPath(import.meta.url))),
  nodePath: z.string().default(''),
  snowHome: z.string().default(''),
  nativeProfile: z.boolean().default(false),
});

export async function apply(ctx, config = {}, deps = {}) {
  let root = config.root || path.dirname(fileURLToPath(import.meta.url));
  if (config.nativeProfile) {
    const profile = ctx.get('profileContext');
    if (!profile) throw Error('Chat Bridge requires a DSH profile');
    root = profileRuntimeRoot(profile.home, profile.name);
    const receipt = path.join(root, PROFILE_RUNTIME_RECEIPT);
    let runtime;
    try { runtime = JSON.parse(await fs.readFile(receipt, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ctx.logger('chat-bridge').info('Chat Bridge is installed. Run the Windows setup ZIP to initialize SnowLuma.');
      // Re-enter through Cordis after an atomic setup receipt appears. No profile edits.
      ctx.effect(() => {
        let pending = false;
        let disposed = false;
        const timer = setInterval(async () => {
          if (pending || disposed) return;
          pending = true;
          try {
            await fs.access(receipt);
            if (!disposed) {
              clearInterval(timer);
              await ctx.fiber.restart();
            }
          } catch (failure) {
            if (failure.code !== 'ENOENT' && !disposed) ctx.logger('chat-bridge').error(failure);
          } finally { pending = false; }
        }, 1500);
        timer.unref();
        return () => { disposed = true; clearInterval(timer); };
      }, 'chat-bridge.wait-for-setup');
      return;
    }
    if (runtime.version !== 1 || !path.isAbsolute(runtime.snowHome || '')) throw Error('Invalid Chat Bridge setup receipt');
    config = new Proxy(config, {
      get(target, key, receiver) {
        if (key === 'snowHome') return runtime.snowHome;
        if (key === 'nodePath') return '';
        return Reflect.get(target, key, receiver);
      },
    });
  }
  const descriptor = await readInstanceDescriptor(root);
  if (config.nativeProfile && (descriptor.bundleName !== PROFILE_BUNDLE || descriptor.entryId !== PROFILE_ENTRY ||
      descriptor.profile !== ctx.get('profileContext').name || path.relative(descriptor.dshHome, ctx.get('profileContext').home)))
    throw Error('Chat Bridge runtime does not belong to this profile');
  if (ctx.fiber.entry && ctx.fiber.entry.options.id !== descriptor.entryId) throw Error('Controller entry does not match its instance descriptor');
  const nodePath = await resolveInstanceNode({descriptor,config});
  const controller = await mountInstanceController(ctx, descriptor, { ...createProductionFactories({nodePath}), ...deps, nodePath, config });
  // Keep the live Config object, including native volatile refs. No startup scalar cache.
  deps.onController?.(controller, descriptor);
  return () => controller.dispose();
}
