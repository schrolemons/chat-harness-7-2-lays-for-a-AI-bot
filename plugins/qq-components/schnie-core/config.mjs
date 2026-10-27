import fs from 'node:fs';
import path from 'node:path';

/** Read the local host's config override and enable registry without returning secrets. */
export function loadLocalConfig(dir) {
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const manifest = read(path.join(dir, 'plugin.json'));
  const stateDir = path.resolve(dir, '../../../state/plugins');
  const overrideFile = path.join(stateDir, 'config/schnie-core.json');
  const registryFile = path.join(stateDir, 'registry.json');
  const override = fs.existsSync(overrideFile) ? read(overrideFile) : {};
  const registry = fs.existsSync(registryFile) ? read(registryFile) : {};
  if (!override || typeof override !== 'object' || Array.isArray(override)) throw Error('Invalid SCHNIE config override');
  const enabledOverride = Array.isArray(registry.enabled) && registry.enabled.includes('schnie-core');
  const disabled = (manifest.enabled === false && !enabledOverride) || (Array.isArray(registry.disabled) && registry.disabled.includes('schnie-core'));
  return { manifest, config: { ...manifest.config, ...override }, disabled };
}
