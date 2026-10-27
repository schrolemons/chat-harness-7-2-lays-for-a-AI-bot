import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Controller } from './controller.mjs';
import { AppServer } from './app-server.mjs';
export const PLUGIN=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const ROOT=path.resolve(PLUGIN,'../../..');
export const STATE=path.join(ROOT,'state','codex-chat');
export function isEnabled() {
  try {
    const manifest=JSON.parse(fs.readFileSync(path.join(PLUGIN,'plugin.json'),'utf8'));
    let registry={};try{registry=JSON.parse(fs.readFileSync(path.join(ROOT,'state','plugins','registry.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')return false;}
    return manifest.enabled===true&&!(registry.disabled||[]).includes('tool-codex-chat');
  }catch{return false;}
}
export function makeController() {
  const settings=JSON.parse(fs.readFileSync(path.join(STATE,'settings.json'),'utf8'));
  if(!path.isAbsolute(settings.codexPath)||!fs.existsSync(settings.codexPath))throw Error('INSTALL_REQUIRED');
  const client=new AppServer({command:settings.codexPath,cwd:path.join(STATE,'workspace'),logFile:path.join(STATE,'app-server.log')});
  return new Controller({dir:STATE,client,enabled:isEnabled});
}
