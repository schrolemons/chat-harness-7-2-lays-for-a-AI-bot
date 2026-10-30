#!/usr/bin/env node
// Offline package validation/indexing. No AI calls, network access or original-document edits.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {loadLibrary,inspectLibrary,packageFile,hashBytes} from '../plugins/qq-components/personal-core/library.mjs';
export function indexLibrary(directory,{reviewed=false,dryRun=false}={}){
 if(!reviewed&&!dryRun)throw Error('写入前必须指定--reviewed，确认已按整理规范复核卡片与原文；可先--dry-run');
 const root=fs.realpathSync(path.resolve(directory)),manifestFile=packageFile(root,'manifest.json'),manifestBytes=fs.readFileSync(manifestFile),manifest=JSON.parse(manifestBytes),catalogFile=packageFile(root,manifest.catalog),catalogBytes=fs.readFileSync(catalogFile),catalog=JSON.parse(catalogBytes),files=new Map();
 const fileHash=relative=>{const bytes=fs.readFileSync(packageFile(root,relative));files.set(relative,bytes);return hashBytes(bytes);};
 for(const source of manifest.sources){source.sha256=fileHash(source.path);if(source.converted_path)source.converted_sha256=fileHash(source.converted_path);}
 for(const topic of catalog.topics){topic.sha256=fileHash(topic.path);if(topic.source_markdown)topic.source_sha256=fileHash(topic.source_markdown);else if(topic.source_snapshot)topic.source_sha256=fileHash(topic.source_snapshot);}
 if(manifest.guide)manifest.guide.sha256=fileHash(manifest.guide.path);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'core-index-'));let report;
 try{for(const [relative,bytes]of files){const dest=path.resolve(temp,relative);if(!dest.startsWith(temp+path.sep))throw Error('非法资料路径');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}fs.writeFileSync(path.join(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');const dest=path.join(temp,manifest.catalog);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(catalog,null,2)+'\n');loadLibrary(temp);report=inspectLibrary(temp);}finally{if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('core-index-'))fs.rmSync(temp,{recursive:true,force:true});}
 if(!dryRun){if(!manifestBytes.equals(fs.readFileSync(manifestFile))||!catalogBytes.equals(fs.readFileSync(catalogFile)))throw Error('索引在整理期间发生变化');for(const [relative,bytes]of files)if(hashBytes(fs.readFileSync(packageFile(root,relative)))!==hashBytes(bytes))throw Error('原文在整理期间发生变化');const suffix='.bak-core-index-'+Date.now()+'-'+process.pid;fs.copyFileSync(manifestFile,manifestFile+suffix,fs.constants.COPYFILE_EXCL);fs.copyFileSync(catalogFile,catalogFile+suffix,fs.constants.COPYFILE_EXCL);try{fs.writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n');fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');}catch(error){fs.writeFileSync(catalogFile,catalogBytes);fs.writeFileSync(manifestFile,manifestBytes);throw error;}}
 return{...report,dryRun,originalDocumentsModified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [action,directory,...flags]=process.argv.slice(2);try{if(!directory||!['validate','index'].includes(action))throw Error('用法: node scripts/personal-core.mjs validate <目录> | index <目录> [--dry-run | --reviewed]');const result=action==='validate'?inspectLibrary(directory):indexLibrary(directory,{reviewed:flags.includes('--reviewed'),dryRun:flags.includes('--dry-run')});console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
