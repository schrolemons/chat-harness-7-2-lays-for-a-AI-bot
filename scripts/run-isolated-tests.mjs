import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
// Windows TEMP can use an 8.3 alias; receipts and link guards compare physical paths.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tempRoot=fs.realpathSync.native(os.tmpdir()),dir=fs.mkdtempSync(path.join(tempRoot,'qq-release-tests-'));
try{
 for(const name of ['src','plugins','scripts','dsh','console','public','roles','examples','assets','docs'])if(fs.existsSync(path.join(root,name)))fs.cpSync(path.join(root,name),path.join(dir,name),{recursive:true,filter:file=>!['node_modules','private','knowledge','__pycache__'].includes(path.basename(file))&&!/\.bak(?:-|\.|$)/.test(file)});
 for(const name of ['package.json','package-lock.json','release-files.json','README.md','LICENSE','construct.md','config.example.json','browser-sites.example.json','cordis.patch.yml','dsh-entry.mjs','dsh-mcp-entry.mjs','dsh-client.js','release-edition.json'])if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(dir,name));
 // A private physical dependency copy keeps fixture patch/install writes away
 // from the developer cache. No local descriptors, profiles or state are copied.
 fs.cpSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),{recursive:true,dereference:true});
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),files=pkg.qqBridge.testFiles;
 if(new Set(files).size!==files.length)throw Error('Duplicate registered test');
 const home=path.join(dir,'.test-home');fs.mkdirSync(home);
 // Keep Windows USERPROFILE coherent with the OS browser profile APIs. Every
 // browser fixture uses a disposable user-data-dir; DSH and npm use fresh homes.
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('DSH_')||key.startsWith('QQ_BRIDGE_')||key.startsWith('SNOWLUMA_')||['TEMP','TMP','TMPDIR'].includes(key.toUpperCase()))delete env[key];
 Object.assign(env,{TEMP:tempRoot,TMP:tempRoot,TMPDIR:tempRoot,DSH_HOME:home,HOME:home,npm_config_cache:path.join(dir,'.npm-cache'),NODE_OPTIONS:'',NODE_PATH:'',ELECTRON_RUN_AS_NODE:'',QQ_BRIDGE_SKIP_DSH_INSTALL:'1',PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH});
 console.log(JSON.stringify({isolatedRunner:{node:process.version,registeredFiles:files.length,home:'fresh',dependencies:'physical isolated copy',npmCache:'fresh',snowArtifact:!!env.TEST_SNOW_ARTIFACT,ownedBrowser:!!env.TEST_OWNED_BROWSER_PATH,desktopCarrier:!!env.TEST_DESKTOP_MAIN}}));
 const result=spawnSync(process.execPath,['--test','--test-concurrency=3','--test-timeout=90000',...files],{cwd:dir,stdio:'inherit',windowsHide:true,env});process.exitCode=result.status??1;
}finally{if(path.dirname(dir)!==tempRoot||!path.basename(dir).startsWith('qq-release-tests-'))throw Error('Unexpected test directory');fs.rmSync(dir,{recursive:true,force:true});}
