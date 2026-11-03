import path from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { Config as ModeConfig } from './plugins/qq-mode-console/lib/index.js';
import { readInstanceDescriptor } from './src/instance-descriptor.mjs';
import { mountInstanceController } from './src/dsh-instance-controller.mjs';

export const name = 'bot-instance';
export const inject = ['loader', 'tools', 'agentPresets', 'sessions', 'sessionTitle'];
export const Config = z.object({
  ...ModeConfig.dict,
  root: z.string().default(path.dirname(fileURLToPath(import.meta.url))),
  nodePath: z.string().default(process.versions.electron ? 'node' : process.execPath),
});

export async function apply(ctx, config = {}, deps = {}) {
  const descriptor = await readInstanceDescriptor(config.root || path.dirname(fileURLToPath(import.meta.url)));
  if (ctx.fiber.entry && ctx.fiber.entry.options.id !== descriptor.entryId) throw Error('Controller entry does not match its instance descriptor');
  const controller = await mountInstanceController(ctx, descriptor, { ...deps, config });
  // Keep the live Config object, including native volatile refs. No startup scalar cache.
  deps.onController?.(controller, descriptor);
  return () => controller.dispose();
}
