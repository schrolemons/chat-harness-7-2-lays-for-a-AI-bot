import path from 'node:path';import {fileURLToPath} from 'node:url';
import {bootstrapLocal} from './scripts/bootstrap-local.mjs';
import {apply as mountLauncher} from './plugins/qq-launcher/lib/index.js';
export const name='qq-bridge';
export const inject=[];
export function apply(ctx,config={}){
 const root=path.dirname(fileURLToPath(import.meta.url));bootstrapLocal(root);
 return mountLauncher(ctx,{...config,bridgeDir:root,nodePath:config.nodePath||(process.versions.electron?'node':process.execPath)});
}
