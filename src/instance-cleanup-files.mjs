import fs from 'node:fs/promises';
import path from 'node:path';
import {rowHash,sha256,assertPlainDirectory,jsonEdit,yamlRows,removeYamlRows} from '../scripts/plan-instance-install.mjs';
import {SNOW_RELEASE} from '../scripts/install-managed-snow.mjs';
export {rowHash,sha256,assertPlainDirectory};
export const cleanupError=(code,message=code)=>Object.assign(Error(message),{code});
export const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
export const within=(root,file)=>{const r=path.relative(root,file);return r!==''&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
export async function state(file,{link=false}={}) {
 try{await assertPlainDirectory(path.dirname(file));}catch(e){if(e.code==='ENOENT')return {kind:'missing'};throw e;}
 let s;try{s=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return {kind:'missing'};throw e;}
 if(s.isSymbolicLink()){if(!link)throw cleanupError('UNSAFE_PATH');return {kind:'link',target:await fs.readlink(file)};}
 if(s.isDirectory())return {kind:'directory'};
 if(!s.isFile()||s.nlink!==1)throw cleanupError('UNSAFE_PATH');
 return {kind:'file',sha256:sha256(await fs.readFile(file))};
}
export async function tree(root) {
 await assertPlainDirectory(root);const files=[],links=[],directories=[];
 async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){
  const file=path.join(dir,name),relative=path.relative(root,file).replaceAll('\\','/'),s=await fs.lstat(file);
  if(name==='.git')throw cleanupError('CHECKOUT_PRESERVED');
  if(s.isSymbolicLink()){const target=await fs.realpath(file);if(!within(root,target))throw cleanupError('EXTERNAL_LINK');links.push({path:relative,target,rawTarget:await fs.readlink(file)});}
  else if(s.isDirectory()){directories.push(relative);await walk(file);}
  else if(s.isFile()&&s.nlink===1)files.push({path:relative,sha256:sha256(await fs.readFile(file))});
  else throw cleanupError('UNSAFE_PATH');
 }}await walk(root);return {files,links,directories};
}
const plainJson=async file=>{if((await state(file)).kind!=='file')throw cleanupError('RECEIPT_INVALID');return JSON.parse(await fs.readFile(file,'utf8'));};
const resolved=(root,relative)=>{if(typeof relative!=='string'||path.isAbsolute(relative)||!within(root,path.resolve(root,relative)))throw cleanupError('EXTERNAL_PATH');return path.resolve(root,relative);};

/** Resolve only existing receipt inventories. Mutable state gets a stopped-writer CAS snapshot. */
export async function prepareFileCleanup(manifest) {
 const operations=[],preserve=[],root=manifest.root,approved=new Map(),dirs=new Set();
 const protectedPaths=manifest.paths.filter(row=>row.cleanup!=='owned'&&typeof row.path==='string'&&path.isAbsolute(row.path));
 const assertRemovable=file=>{
  for(const row of protectedPaths){
   // A preserved developer code root remains a container for separately owned working data.
   // It must itself survive; other preserve declarations protect their entire subtree/ancestors.
   const codeContainer=row.kind==='code'&&samePath(row.path,root);
   if(samePath(file,row.path)||within(file,row.path)||(!codeContainer&&within(row.path,file)))throw cleanupError('PRESERVED_PATH_OVERLAP',row.path);
  }
 };
 const addDirectory=directory=>{assertRemovable(directory);dirs.add(directory);};
 const addFile=async(file,phase,hash,link=false)=>{
  assertRemovable(file);
  const before=await state(file,{link});if(before.kind==='missing')throw cleanupError('OWNED_PATH_MISSING',file);
  if(hash&&before.sha256!==hash)throw cleanupError('PATH_CHANGED',file);
  const old=approved.get(file);if(old&&rowHash(old.before)!==rowHash(before))throw cleanupError('PATH_CONFLICT');
  if(!old)approved.set(file,{kind:'remove',path:file,before,phase});
  for(let d=path.dirname(file);within(root,d);d=path.dirname(d))addDirectory(d);
 };
 const code=manifest.paths.find(r=>r.kind==='code'&&r.cleanup==='owned');
 if(code) {
  if(!samePath(code.path,root)||code.source!=='created'||!code.createdByTransaction)throw cleanupError('CODE_NOT_OWNED');
  for(let d=root;;d=path.dirname(d)){try{await fs.lstat(path.join(d,'.git'));throw cleanupError('CHECKOUT_PRESERVED');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(d)===d)break;}
  const creationFile=path.join(root,'.instance-install','creation.json'),creation=await plainJson(creationFile);
  if(creation.transactionId!==code.createdByTransaction||!samePath(creation.root,root)||rowHash(creation.files)!==rowHash(code.files))throw cleanupError('CREATION_RECEIPT_MISMATCH');
  for(const file of code.files)await addFile(resolved(root,file.path),'code',file.sha256);
  await addFile(creationFile,'code');
  for(const name of ['.qq-bridge-instance.json','.qq-bridge-instance-manifest.json'])await addFile(path.join(root,name),'code');
  const candidateFile=path.join(root,'.instance-install','candidate.json');
  if((await state(candidateFile)).kind!=='missing'){
   const candidate=await plainJson(candidateFile);
   if(candidate.descriptor?.instanceId!==manifest.instanceId||!samePath(candidate.descriptor?.root,root)||candidate.conflicts?.length||candidate.journalPath!==path.join(root,'.instance-install','transactions',candidate.transactionId+'.json'))throw cleanupError('INSTALL_RECEIPT_MISMATCH');
   const journal=await plainJson(candidate.journalPath);
   if(journal.status!=='committed'||journal.planHash!==rowHash(candidate)||journal.receipt?.root!==root)throw cleanupError('INSTALL_RECEIPT_MISMATCH');
   await addFile(candidateFile,'code');await addFile(candidate.journalPath,'code');
  }
  const download=path.join(root,'.instance-install',`snow-${SNOW_RELEASE.sha256}.zip`);
  if((await state(download)).kind!=='missing')await addFile(download,'dependency',SNOW_RELEASE.sha256);
 } else preserve.push({path:root,reason:'Developer source and unowned metadata remain'});
 for(const row of manifest.paths) {
  if(row.cleanup!=='owned'){preserve.push(row);continue;}if(row.kind==='code')continue;
  if(!within(root,row.path)||!['created','verified-legacy'].includes(row.source))throw cleanupError('EXTERNAL_PATH');
  const current=await state(row.path);
  if(current.kind==='file'){await addFile(row.path,row.kind,row.mutable?undefined:row.sha256);continue;}
  if(current.kind!=='directory')throw cleanupError('OWNED_PATH_MISSING');
  const inventory=await tree(row.path);let expected=row;
  if(row.mutable){if(row.source!=='created'||row.namespace!=='instance-state'||!row.createdByTransaction)throw cleanupError('MUTABLE_NAMESPACE_UNPROVEN');}
  else if(!row.files){
   if(!row.manifestPath||!within(row.path,row.manifestPath))throw cleanupError('DEPENDENCY_INVENTORY_REQUIRED');
   if((await state(row.manifestPath)).sha256!==row.sha256)throw cleanupError('PATH_CHANGED');
   const marker=await plainJson(row.manifestPath);
   if(marker.version!==1||marker.kind!=='snowluma'||marker.instanceId!==manifest.instanceId||marker.artifact?.sha256!==SNOW_RELEASE.sha256)throw cleanupError('DEPENDENCY_INVENTORY_REQUIRED');
   expected={files:[...Object.entries(marker.files).map(([p,h])=>({path:p,sha256:h})),{path:path.relative(row.path,row.manifestPath).replaceAll('\\','/'),sha256:row.sha256}],links:[]};
   if(marker.createdDirectories!==undefined){
    if(rowHash(marker.createdDirectories)!==rowHash(['config']))throw cleanupError('DEPENDENCY_INVENTORY_REQUIRED');
    expected.directories=['config'];
    for(const entry of expected.files)for(let d=path.dirname(resolved(row.path,entry.path));within(row.path,d);d=path.dirname(d))expected.directories.push(path.relative(row.path,d).replaceAll('\\','/'));
    expected.directories=[...new Set(expected.directories)];
    for(const authored of manifest.paths.filter(p=>p.producer==='managed-snow-account'&&samePath(path.dirname(p.path),path.join(row.path,'config')))){
     if(authored.source!=='created'||authored.cleanup!=='owned'||!authored.mutable||!authored.createdByTransaction||!/^onebot_[1-9]\d{4,19}\.json$/.test(path.basename(authored.path)))throw cleanupError('MUTABLE_NAMESPACE_UNPROVEN');
     const current=await state(authored.path);if(current.kind!=='file')throw cleanupError('OWNED_PATH_MISSING');
     expected.files.push({path:path.relative(row.path,authored.path).replaceAll('\\','/'),sha256:current.sha256});
    }
   }
  }
  if(!row.mutable) {
   const normalize=v=>({files:[...v.files].sort((a,b)=>a.path.localeCompare(b.path)),links:(v.links||[]).map(({path,target})=>({path,target})).sort((a,b)=>a.path.localeCompare(b.path))});
   if(rowHash(normalize(inventory))!==rowHash(normalize(expected)))throw cleanupError('DEPENDENCY_INVENTORY_CHANGED');
   // Marker-only immutable assets prove their exact parent directories, never arbitrary empty
   // siblings observed today. Full installer inventories may additionally prove empty directories.
   const provenDirectories=new Set(expected.directories||[]);
   if(!expected.directories)for(const entry of [...expected.files,...(expected.links||[])]){
    for(let d=path.dirname(resolved(row.path,entry.path));within(row.path,d);d=path.dirname(d))provenDirectories.add(path.relative(row.path,d).replaceAll('\\','/'));
   }
   if(rowHash([...inventory.directories].sort())!==rowHash([...provenDirectories].sort()))throw cleanupError('UNKNOWN_DESCENDANT');
  }
  for(const f of inventory.files)await addFile(resolved(row.path,f.path),row.kind,f.sha256);
  for(const link of inventory.links)await addFile(resolved(row.path,link.path),row.kind,undefined,true);
  for(const d of inventory.directories)addDirectory(resolved(row.path,d));addDirectory(row.path);
 }
 if(code) {
  const actual=await tree(root);
  for(const f of [...actual.files,...actual.links])if(!approved.has(resolved(root,f.path)))throw cleanupError('UNKNOWN_DESCENDANT',f.path);
  // Even empty unknown directories are not silently adopted.
  for(const d of actual.directories)if(!dirs.has(resolved(root,d)))throw cleanupError('UNKNOWN_DESCENDANT',d);
 }
 operations.push(...approved.values());
 const profile=path.join(manifest.dshHome,'profiles',manifest.profile),patch=path.join(profile,'cordis.patch.yml');
 const rows=manifest.profileEntries.filter(r=>r.cleanup==='owned');
 if(rows.length){
  if(rows.some(r=>!samePath(r.path,patch)))throw cleanupError('PROFILE_PATH_CONFLICT');
  const before=await state(patch),raw=await fs.readFile(patch,'utf8'),parsed=yamlRows(raw),selected=new Set();
  const entries=[...parsed.rows,...parsed.document.filter(r=>!r.insert)];
  for(const row of rows){const matches=entries.filter(r=>r.id===row.id);if(matches.length!==1||matches[0].name!==row.name||rowHash(matches[0])!==row.sha256)throw cleanupError('PROFILE_ROW_CHANGED');selected.add(matches[0]);}
  const content=removeYamlRows(raw,parsed,selected);operations.push({kind:'write',path:patch,before,content,after:{kind:'file',sha256:sha256(content)},phase:'profile'});
  const file=path.join(profile,'package.json'),pkgBefore=await state(file);let contentPkg=await fs.readFile(file,'utf8');const pkg=JSON.parse(contentPkg);
  if(pkg.dependencies?.[manifest.bundleName]!=='link:'+root.replaceAll('\\','/')||!pkg.dsh?.profile?.bundles?.includes(manifest.bundleName))throw cleanupError('PROFILE_PACKAGE_CHANGED');
  contentPkg=jsonEdit(contentPkg,['dependencies',manifest.bundleName],null,true);contentPkg=jsonEdit(contentPkg,['dsh','profile','bundles'],pkg.dsh.profile.bundles.filter(n=>n!==manifest.bundleName));
  operations.push({kind:'write',path:file,before:pkgBefore,content:contentPkg,after:{kind:'file',sha256:sha256(contentPkg)},phase:'profile'});
 }
 for(const link of manifest.links){
  if(link.cleanup!=='owned'){preserve.push(link);continue;}
  if(!samePath(path.dirname(link.path),path.join(profile,'node_modules'))||!samePath(link.target,root)||!rows.some(r=>r.name===path.basename(link.path)))throw cleanupError('LINK_NOT_OWNED');
  const before=await state(link.path,{link:true});if(before.kind!=='link'||!samePath(await fs.realpath(link.path),root))throw cleanupError('LINK_CHANGED');
  operations.push({kind:'remove',path:link.path,before,phase:'profile'});
 }
 const inventoryFile=path.join(manifest.dshHome,'bot-instances','installation-roots.json'),before=await state(inventoryFile),inventory=await plainJson(inventoryFile);
 const matches=inventory.roots.filter(r=>r.installationId===manifest.installationId);
 if(matches.length!==1||matches[0].state!=='ready'||!['root','instanceId','profile','bundleName'].every(k=>matches[0][k]===manifest[k]))throw cleanupError('ROOT_DECLARATION_CONFLICT');
 const content=JSON.stringify({...inventory,roots:inventory.roots.filter(r=>r!==matches[0])},null,2)+'\n';
 operations.push({kind:'write',path:inventoryFile,before,content,after:{kind:'file',sha256:sha256(content)},phase:'registration'});
 const rank={data:1,dependency:2,profile:3,registration:4,code:5};operations.sort((a,b)=>rank[a.phase]-rank[b.phase]);
 // Remove junctions before their targets. Never traverse or recursively rm a link.
 for(const phase of ['data','dependency']){const indices=operations.map((op,i)=>op.phase===phase?i:-1).filter(i=>i>=0),ordered=indices.map(i=>operations[i]).sort((a,b)=>(a.before.kind==='link'?0:1)-(b.before.kind==='link'?0:1));indices.forEach((v,i)=>operations[v]=ordered[i]);}
 for(const d of [...dirs].sort((a,b)=>b.length-a.length))operations.push({kind:'rmdir',path:d,before:{kind:'directory'},phase:'code'});
 if(code)operations.push({kind:'rmdir',path:root,before:{kind:'directory'},phase:'code'});
 for(const op of operations)if(op.kind!=='write')assertRemovable(op.path);
 return {operations,preserve};
}
