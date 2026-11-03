import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { INSTANCE_PRESETS, patchFileFor } from '../scripts/build-agent-preset-patches.mjs';

/** Rewrite plugin names only; config values and native expressions remain data. */
function localRows(rows, root) {
  if (!Array.isArray(rows)) throw Error('Invalid preset plugin tree');
  return rows.map(row => {
    const next = { ...row };
    if (typeof row.name !== 'string') throw Error('Invalid preset plugin name');
    if (row.name.startsWith('qq-agent-presets/')) {
      const relative = row.name.slice('qq-agent-presets/'.length);
      if (relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw Error('Invalid local preset module');
      next.name = pathToFileURL(path.join(root, 'plugins/qq-agent-presets', relative)).href;
    }
    if (row.group === true) next.config = localRows(row.config, root);
    return next;
  });
}

export async function loadInstanceDefinitions(root, hostImport) {
  if (!path.isAbsolute(root)) throw Error('Instance root must be absolute');
  const { entryListSchema } = await hostImport('@deepseek-ai/cordis-plugin-include');
  if (!entryListSchema) throw Error('Host has no native expression YAML schema');
  const definitions = [];
  for (const id of INSTANCE_PRESETS) {
    const patches = yaml.load(await fs.readFile(patchFileFor(id, root), 'utf8'), { schema: entryListSchema });
    const rows = patches.flatMap(patch => patch.insert || []);
    if (rows.length !== 1 || rows[0].name !== '@deepseek-ai/dsh-agent-preset' || rows[0].config?.id !== id) throw Error(`Invalid generated preset: ${id}`);
    definitions.push({ ...rows[0].config, plugins: localRows(rows[0].config.plugins, root) });
  }
  return definitions;
}
