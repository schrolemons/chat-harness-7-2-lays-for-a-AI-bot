import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  absWorkingDir: root, entryPoints: { app: 'console/app.js', 'theme-init': 'console/shared/theme-init.js' },
  outdir: 'public/console', bundle: true, format: 'iife', target: ['es2022'],
  charset: 'utf8', legalComments: 'none', metafile: true, write: false,
});
const fingerprint = crypto.createHash('sha256');
for (const file of result.outputFiles) fingerprint.update(file.contents);
const version = fingerprint.digest('hex').slice(0,16);
fs.mkdirSync(path.join(root, 'public/console'), { recursive: true });
for (const file of result.outputFiles) fs.writeFileSync(file.path, file.contents);
fs.writeFileSync(path.join(root, 'public/console/manifest.json'), JSON.stringify({ build: version, inputs: Object.keys(result.metafile.inputs).sort() }, null, 2) + '\n');
console.log(`Console ${version}: ${Object.keys(result.metafile.inputs).length} modules, ${result.outputFiles.length} assets`);
