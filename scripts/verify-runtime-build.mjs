// Read-only proof that the running process loaded the reviewed core files.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {resolveConsoleToken} from '../plugins/qq-components/obs-bridge-health/health.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
const expected=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/bridge.js'))).update(fs.readFileSync(path.join(root,'src/plugin-host.js'))).digest('hex').slice(0,16);
const res=await fetch('http://127.0.0.1:'+(cfg.consolePort||3100)+'/api/plugins',{headers:{'x-console-token':resolveConsoleToken(root,cfg)},signal:AbortSignal.timeout(5000)});
if(!res.ok)throw Error('Runtime inspection rejected: '+res.status);const data=await res.json();const actual=data.runtime?.coreBuild||null;
console.log(JSON.stringify({expected,actual,matching:actual===expected,count:data.count,total:data.total,warnings:data.warnings||[]},null,2));
if(actual!==expected)process.exitCode=2;
