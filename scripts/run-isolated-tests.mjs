import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-release-tests-'));
try{
 for(const name of ['src','plugins','scripts','dsh','console','public','roles','examples','assets','docs'])if(fs.existsSync(path.join(root,name)))fs.cpSync(path.join(root,name),path.join(dir,name),{recursive:true,filter:file=>!['node_modules','private','knowledge','__pycache__'].includes(path.basename(file))&&!/\.bak(?:-|\.|$)/.test(file)});
 for(const name of ['package.json','package-lock.json','release-files.json','README.md','LICENSE','construct.md','config.example.json','browser-sites.example.json','campus-watch.example.json','cordis.patch.yml','dsh-entry.mjs','dsh-mcp-entry.mjs','dsh-client.js','release-edition.json'])if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(dir,name));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),files=[...new Set(pkg.qqBridge.testFiles)];
 const result=spawnSync(process.execPath,['--test','--test-concurrency=3','--test-timeout=90000',...files],{cwd:dir,stdio:'inherit',windowsHide:true,env:{...process.env,QQ_BRIDGE_SKIP_DSH_INSTALL:'1'}});process.exitCode=result.status??1;
}finally{if(path.dirname(dir)!==os.tmpdir()||!path.basename(dir).startsWith('qq-release-tests-'))throw Error('Unexpected test directory');fs.rmSync(dir,{recursive:true,force:true});}
