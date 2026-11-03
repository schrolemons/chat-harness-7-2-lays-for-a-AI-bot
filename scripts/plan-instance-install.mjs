import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseExpressionAt } from 'acorn';
import yaml from 'js-yaml';
import { readInstanceSessionPolicy } from '../src/instance-session-policy.mjs';
import { readManifest } from '../src/instance-manifest.mjs';
import { normalizeInstanceDescriptor, readInstanceDescriptor } from '../src/instance-descriptor.mjs';

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => value && typeof value==='object' ? Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const rowHash = row => sha256(JSON.stringify(canonical(row)));
const same = (a,b) => process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const contains = (parent,child) => { const r=path.relative(parent,child);return r==='' || (!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r)); };
export const installError=(code)=>Object.assign(Error(code),{code});
export async function pathState(file) {
  let s;try{s=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return {kind:'missing'};throw e;}
  if(s.isSymbolicLink())return {kind:'link',target:await fs.realpath(file)};
  if(!s.isFile() || s.nlink!==1)throw installError('UNSAFE_INSTALL_PATH');
  return {kind:'file',sha256:sha256(await fs.readFile(file))};
}
export const sameState=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function assertPlainDirectory(dir) {
  if(!path.isAbsolute(dir))throw installError('ABSOLUTE_PATH_REQUIRED');
  for(let p=dir;;p=path.dirname(p)) {
    const s=await fs.lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw installError('UNSAFE_INSTALL_PATH');
    if(path.dirname(p)===p)break;
  }
}
function jsonEdit(raw,keys,value,remove=false) {
  const ast=parseExpressionAt(raw,0,{ecmaVersion:'latest'});
  let node=ast;
  for(let i=0;i<keys.length-1;i++) {
    const property=node.properties?.find(p=>(p.key.value??p.key.name)===keys[i]);
    if(!property) {
      let nested=value;for(let n=keys.length-1;n>i;n--)nested={[keys[n]]:nested};
      return jsonEdit(raw,keys.slice(0,i+1),nested);
    }
    node=property.value;
  }
  if(node.type!=='ObjectExpression')throw installError('PROFILE_STRUCTURE_INVALID');
  const index=node.properties.findIndex(p=>(p.key.value??p.key.name)===keys.at(-1)),property=node.properties[index];
  if(property) {
    if(remove) {
      const start=index===0?property.start:node.properties[index-1].end;
      const end=index===0&&node.properties.length>1?node.properties[1].start:property.end;
      return raw.slice(0,start)+raw.slice(end);
    }
    return raw.slice(0,property.value.start)+JSON.stringify(value)+raw.slice(property.value.end);
  }
  if(remove)return raw;
  const insertion=(node.properties.length?',':'')+JSON.stringify(keys.at(-1))+':'+JSON.stringify(value);
  return raw.slice(0,node.end-1)+insertion+raw.slice(node.end-1);
}
function yamlRows(raw) {
  const stack=[],spans=new Map();
  const document=yaml.load(raw,{listener:(event,state)=>{
    if(event==='open')stack.push(state.position);
    else {const start=stack.pop();if(state.kind==='mapping')spans.set(state.result,{start,end:state.position});}
  }})||[];
  if(!Array.isArray(document))throw installError('PROFILE_STRUCTURE_INVALID');
  return {document,spans,rows:document.flatMap(p=>Array.isArray(p.insert)?p.insert:[])};
}
function removeYamlRows(raw,parsed,selected) {
  const edits=[];
  const remove=row=>{
      const span=parsed.spans.get(row),start=raw.lastIndexOf('\n',span.start)+1;
      if(!/^\s*-\s+$/.test(raw.slice(start,span.start)))throw installError('UNSUPPORTED_YAML_EDIT');
      let end=span.end;while(end>span.start&&/[ \t]/.test(raw[end-1]))end--;
      const indent=raw.slice(start,span.start).indexOf('-');
      for(let cursor=raw.indexOf('\n',span.start)+1;cursor>0&&cursor<end;) {
        const next=raw.indexOf('\n',cursor),line=raw.slice(cursor,next<0?raw.length:next);
        if(line.trim() && line.search(/\S/)<=indent){end=cursor;break;}
        if(next<0)break;cursor=next+1;
      }
      edits.push({start,end,text:''});
  };
  for(const patch of parsed.document) {
    if(selected.has(patch)){remove(patch);continue;}
    if(!Array.isArray(patch.insert))continue;
    for(const row of patch.insert)if(selected.has(row))remove(row);
    if(patch.insert.length && patch.insert.every(r=>selected.has(r))) {
      // Keep the parent and any other keys/comments; an empty insert is valid.
      const span=parsed.spans.get(patch),lineEnd=raw.indexOf('\n',span.start);
      const key=raw.slice(span.start,lineEnd<0?raw.length:lineEnd);
      if(!/^insert:\s*(?:#.*)?$/.test(key))throw installError('UNSUPPORTED_YAML_EDIT');
      edits.push({start:span.start+7,end:span.start+7,text:' []'});
    }
  }
  for(const e of edits.sort((a,b)=>b.start-a.start))raw=raw.slice(0,e.start)+e.text+raw.slice(e.end);
  yamlRows(raw);return raw;
}
async function moduleFile(name,profilePath) {
  if(name.startsWith('file:'))return fs.realpath(fileURLToPath(new URL(name)));
  if(path.isAbsolute(name))return fs.realpath(name);
  return fs.realpath(createRequire(path.join(profilePath,'package.json')).resolve(name));
}
export async function verifyLegacyRow(row,proof,descriptor,profilePath) {
  try {
    if(row.id!==proof.id || rowHash(row)!==proof.rowHash || !same(await fs.realpath(proof.sourceRoot),descriptor.root))return false;
    const module=await moduleFile(row.name||proof.sourceBundle,profilePath),expected=await fs.realpath(proof.modulePath);
    if(!same(module,expected))return false;
    if(contains(descriptor.root,module))return true;
    // Native host MCP modules live outside the bot. Their exact command argument
    // must resolve into this known installation; an ID/module name is insufficient.
    if(!proof.commandPath || !path.isAbsolute(row.config?.command||''))return false;
    const command=await fs.realpath(proof.commandPath);
    return contains(descriptor.root,command) && (await pathState(command)).kind==='file'
      && (row.config.args||[]).some(arg=>typeof arg==='string'&&path.isAbsolute(arg)&&same(arg,command));
  } catch {return false;}
}

/** Read-only exact plan. Contents can contain profile secrets; store only in a
 * protected local audit directory. Nothing is inferred from a legacy ID. */
export async function planInstanceInstall({descriptor,profilePath,legacy={rows:[],bundles:[]},runtime,creation,protectedFiles=[]}={}) {
  if(!descriptor || descriptor.entryId!==descriptor.settingsNamespace || !/^[a-z0-9][a-z0-9._-]*$/.test(descriptor.bundleName||''))throw installError('INSTALL_IDENTITY_INVALID');
  await assertPlainDirectory(descriptor.root);await assertPlainDirectory(profilePath);
  descriptor={...descriptor,root:await fs.realpath(descriptor.root)};readInstanceSessionPolicy({descriptor});
  if(creation && !(await import('./release-public.mjs')).isFreshReleaseCreation(creation,descriptor.root))throw installError('CREATION_CAPABILITY_REQUIRED');
  if(!same(profilePath,path.join(descriptor.dshHome,'profiles',descriptor.profile)))throw installError('PROFILE_IDENTITY_INVALID');
  if(descriptor.root.split(path.sep).includes('.worktrees'))throw installError('DEVELOPMENT_ROOT_REJECTED');
  const packageFile=path.join(profilePath,'package.json'),patchFile=path.join(profilePath,'cordis.patch.yml');
  const beforeHashes={},operations=[],conflicts=[],ownedEvidence=[];
  const observe=async file=>{const state=await pathState(file);beforeHashes[file]=state;return state;};
  for(const file of protectedFiles){if(!path.isAbsolute(file))throw installError('ABSOLUTE_PATH_REQUIRED');await observe(file);}
  const write=async(file,content)=>{const before=await observe(file),after={kind:'file',sha256:sha256(content)};if(!sameState(before,after))operations.push({kind:'write',path:file,before,after,content,previous:before.kind==='file'?await fs.readFile(file,'utf8'):null});};
  await observe(packageFile);await observe(patchFile);
  let pkgRaw=await fs.readFile(packageFile,'utf8'),raw=beforeHashes[patchFile].kind==='missing'?'[]\n':await fs.readFile(patchFile,'utf8');
  const pkg=JSON.parse(pkgRaw),sourcePackage=path.join(descriptor.root,'package.json');await observe(sourcePackage);
  if(JSON.parse(await fs.readFile(sourcePackage,'utf8')).name!==descriptor.bundleName)conflicts.push({code:'PACKAGE_IDENTITY_CONFLICT',path:sourcePackage});
  const parsed=yamlRows(raw),selected=new Set(),prior=await readManifest(descriptor.root);
  let previousMode={};
  for(const proof of legacy.rows||[]) {
    const candidates=parsed.rows.filter(r=>r.id===proof.id);
    if(candidates.length===0)continue; // previously migrated, or absent: never infer ownership
    if(candidates.length!==1 || !await verifyLegacyRow(candidates[0],proof,descriptor,profilePath)) {conflicts.push({code:'LEGACY_ROW_CONFLICT',id:proof.id});continue;}
    const row=candidates[0];selected.add(row);ownedEvidence.push({kind:'legacy-row',row,proof});
    await observe(await moduleFile(row.name,profilePath));if(proof.commandPath)await observe(proof.commandPath);
    if(row.id===descriptor.entryId)previousMode=row.config||{};
  }
  for(const row of parsed.rows)if(row.id===descriptor.entryId&&!selected.has(row))conflicts.push({code:'ENTRY_ID_CONFLICT',id:row.id});
  for(const proof of legacy.bundles||[]) {
    const link=path.join(profilePath,'node_modules',proof.name),state=await observe(link);
    if(state.kind==='missing' && !(pkg.dsh?.profile?.bundles||[]).includes(proof.name) && !pkg.dependencies?.[proof.name])continue;
    let valid=false;try {valid=/^[a-z0-9][a-z0-9._-]*$/.test(proof.name)&&same(await fs.realpath(proof.sourceRoot),descriptor.root)&&contains(descriptor.root,await fs.realpath(proof.target))&&state.kind==='link'&&same(state.target,await fs.realpath(proof.target));}catch{}
    const dependency=pkg.dependencies?.[proof.name];
    if(dependency) {
      try {
        if(!dependency.startsWith('link:'))valid=false;
        else {
          const dependencyPath=path.resolve(profilePath,dependency.slice(5));
          if(!same(await fs.realpath(dependencyPath),await fs.realpath(proof.target)))valid=false;
          for(let current=dependencyPath;;current=path.dirname(current)) {
            if((await fs.lstat(current)).isSymbolicLink())await observe(current);
            if(path.dirname(current)===current)break;
          }
        }
      }catch {valid=false;}
    }
    if(!valid){conflicts.push({code:'LEGACY_BUNDLE_CONFLICT',name:proof.name});continue;}
    ownedEvidence.push({kind:'legacy-bundle',proof});
    await observe(path.join(proof.target,'package.json'));
    pkgRaw=jsonEdit(pkgRaw,['dependencies',proof.name],null,true);
    operations.push({kind:'unlink',path:link,before:state,after:{kind:'missing'}});
  }
  for(const proof of legacy.overrides||[]) {
    const rows=parsed.document.filter(r=>r.id===proof.id&&!r.insert);
    if(!rows.length)continue;
    if(rows.length!==1||!ownedEvidence.some(e=>e.kind==='legacy-bundle'&&e.proof.name===proof.sourceBundle)||!await verifyLegacyRow(rows[0],proof,descriptor,profilePath)){conflicts.push({code:'LEGACY_OVERRIDE_CONFLICT',id:proof.id});continue;}
    const row=rows[0];selected.add(row);ownedEvidence.push({kind:'legacy-row',row,proof});await observe(await moduleFile(row.name||proof.sourceBundle,profilePath));
    if(row.id===descriptor.entryId)previousMode={...previousMode,...row.config};
  }
  const dependency='link:'+descriptor.root.replaceAll('\\','/'),existing=pkg.dependencies?.[descriptor.bundleName];
  if(existing&&existing!==dependency)conflicts.push({code:'DEPENDENCY_CONFLICT',name:descriptor.bundleName});
  const link=path.join(profilePath,'node_modules',descriptor.bundleName),linkState=await observe(link);
  if(linkState.kind==='missing')operations.push({kind:'link',path:link,before:linkState,after:{kind:'link',target:descriptor.root}});
  else if(linkState.kind!=='link'||!same(linkState.target,descriptor.root))conflicts.push({code:'LINK_CONFLICT',path:link});
  pkgRaw=jsonEdit(pkgRaw,['dependencies',descriptor.bundleName],dependency);
  const removed=new Set(ownedEvidence.filter(r=>r.kind==='legacy-bundle').map(r=>r.proof.name));
  pkgRaw=jsonEdit(pkgRaw,['dsh','profile','bundles'],[...new Set([...(pkg.dsh?.profile?.bundles||[]).filter(n=>!removed.has(n)),descriptor.bundleName])]);
  raw=removeYamlRows(raw,parsed,selected);
  const overrides=parsed.document.filter(r=>r.id===descriptor.entryId&&!r.insert&&!selected.has(r));
  const previous=prior?.profileEntries.find(r=>r.id===descriptor.entryId&&r.path===patchFile);
  if(overrides.length) {
    if(overrides.length!==1 || !previous || rowHash(overrides[0])!==previous.sha256)conflicts.push({code:'OVERRIDE_CONFLICT',id:descriptor.entryId});
  } else {
    if(!path.isAbsolute(runtime?.nodePath||'')||!path.isAbsolute(runtime?.snowHome||''))conflicts.push({code:'RUNTIME_PATH_REQUIRED'});
    const override={id:descriptor.entryId,name:descriptor.bundleName,disabled:true,config:{...previousMode,root:descriptor.root,nodePath:runtime?.nodePath,snowHome:runtime?.snowHome}};
    if(raw.trim()==='[]')raw='';raw+=(raw.endsWith('\n')||!raw?'':'\n')+yaml.dump([override],{lineWidth:-1});
  }
  const descriptorFile=path.join(descriptor.root,'.qq-bridge-instance.json');const descriptorState=await observe(descriptorFile);
  if(descriptorState.kind==='missing')await write(descriptorFile,JSON.stringify(descriptor,null,2)+'\n');
  else if(rowHash(await readInstanceDescriptor(descriptor.root))!==rowHash(await normalizeInstanceDescriptor(descriptor,descriptor.root)))conflicts.push({code:'DESCRIPTOR_CONFLICT'});
  await write(packageFile,pkgRaw);await write(patchFile,raw);
  const override=yamlRows(raw).document.find(r=>r.id===descriptor.entryId&&!r.insert);
  const priorLink=prior?.links.find(r=>r.path===link);
  const evidence={profileEntries:[{path:patchFile,id:descriptor.entryId,name:descriptor.bundleName,sha256:rowHash(override),source:'created',cleanup:'owned'}],links:[{path:link,target:descriptor.root,source:linkState.kind==='missing'?'created':(priorLink?.source||'verified-legacy'),cleanup:linkState.kind==='missing'?'owned':(priorLink?.cleanup||'preserve')}],paths:[prior?.paths.find(r=>r.kind==='code'&&r.path===descriptor.root)||{path:descriptor.root,kind:'code',source:creation?'created':'verified-legacy',cleanup:creation?'owned':'preserve',sha256:beforeHashes[sourcePackage].sha256,...(creation?{createdByTransaction:creation.transactionId,files:creation.files}:{})}]};
  const transactionId=crypto.randomUUID(),journalPath=path.join(descriptor.root,'.instance-install','transactions',transactionId+'.json');
  return {version:1,transactionId,descriptor,profilePath,beforeHashes,operations,ownedEvidence,conflicts,evidence,journalPath,codeDisposition:creation?'installer-created':'preserve'};
}
