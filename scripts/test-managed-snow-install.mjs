import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import crypto from 'node:crypto';
import { initializeManifest } from '../src/instance-manifest.mjs';
const api = await import('./install-managed-snow.mjs').catch(e => { if(e.code==='ERR_MODULE_NOT_FOUND')return {}; throw e; });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
// Small independent stored-ZIP writer; unsafe names/modes are intentional test inputs.
function zip(items) {
  let offset=0; const locals=[],central=[];
  for(const [name,data='x',mode=0] of items){
    const n=Buffer.from(name),b=Buffer.from(data),l=Buffer.alloc(30),c=Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20,4); l.writeUInt32LE(crc32(b),14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc32(b),16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE((mode*65536)>>>0,38);c.writeUInt32LE(offset,42);
    locals.push(l,n,b);central.push(c,n);offset+=l.length+n.length+b.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,cd,end]);
}
test('ZIP validation refuses traversal, Windows aliases, links, duplicates, corruption and missing runtime',()=>{
  assert.equal(typeof api.inspectManagedSnowArchive,'function');
  const base=[['index.mjs','entry'],['node.exe','runtime']];
  assert.equal(api.inspectManagedSnowArchive(zip(base)).length,2);
  for(const name of ['../outside','/outside','C:/outside','x\\outside','file:stream','AUX','x./file','x/../a'])
    assert.throws(()=>api.inspectManagedSnowArchive(zip([...base,[name]])),/ARCHIVE_INVALID/);
  assert.throws(()=>api.inspectManagedSnowArchive(zip([...base,['link','target',0o120777]])),/ARCHIVE_INVALID/);
  assert.throws(()=>api.inspectManagedSnowArchive(zip([...base,['INDEX.MJS']])),/ARCHIVE_INVALID/);
  assert.throws(()=>api.inspectManagedSnowArchive(zip([base[0]])),/ARCHIVE_INVALID/);
  assert.throws(()=>api.inspectManagedSnowArchive(Buffer.from('broken')),/ARCHIVE_INVALID/);
  const damaged=zip(base);damaged[30+'index.mjs'.length]^=1;
  assert.throws(()=>api.inspectManagedSnowArchive(damaged),/ARCHIVE_INVALID/);
});
async function fixture(t){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'managed-snow-install-')),root=path.join(base,'bot'),home=path.join(base,'host');
  await fs.mkdir(root);const descriptor={version:1,instanceId:'test-bot',label:'Test bot',root,dshHome:home,profile:'test',bundleName:'test-bot',entryId:'test-bot',settingsNamespace:'test-bot',presetIdMap:{}};
  await fs.writeFile(path.join(root,'.qq-bridge-instance.json'),JSON.stringify(descriptor));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));return {base,root,descriptor};
}
test('installer requires declared descriptor, pinned artifact and ordinary input; never adopts existing directories',async t=>{
  assert.equal(typeof api.installManagedSnow,'function');
  const f=await fixture(t),artifact=path.join(f.base,'release.zip');await fs.writeFile(artifact,zip([['index.mjs'],['node.exe']]));
  await assert.rejects(api.installManagedSnow({descriptor:f.descriptor,artifact,expectedDigest:api.SNOW_RELEASE.sha256}),/ROOT_UNDECLARED/);
  await initializeManifest(f.root,f.descriptor);
  await assert.rejects(api.installManagedSnow({descriptor:f.descriptor,artifact,expectedDigest:hash(await fs.readFile(artifact))}),/ARTIFACT_UNTRUSTED/);
  await assert.rejects(api.installManagedSnow({descriptor:f.descriptor,artifact,expectedDigest:api.SNOW_RELEASE.sha256}),/ARTIFACT_DIGEST/);
  const external=path.join(f.base,'external');await fs.mkdir(external);await fs.writeFile(path.join(external,'sentinel'),'untouched');
  await fs.rmdir(path.join(f.root,'managed-dependencies'));
  await fs.symlink(external,path.join(f.root,'managed-dependencies'),'junction');
  await assert.rejects(api.installManagedSnow({descriptor:f.descriptor,artifact,expectedDigest:api.SNOW_RELEASE.sha256}),/MANAGED_PATH_INVALID/);
  assert.equal(await fs.readFile(path.join(external,'sentinel'),'utf8'),'untouched');
});
test('official artifact installs all assets, preserves reviewed quote patch and leaves upstream unchanged', {skip:!process.env.TEST_SNOW_ARTIFACT},async t=>{
  const f=await fixture(t);await initializeManifest(f.root,f.descriptor);
  const artifact=process.env.TEST_SNOW_ARTIFACT,before=hash(await fs.readFile(artifact));
  const result=await api.installManagedSnow({descriptor:f.descriptor,artifact,expectedDigest:api.SNOW_RELEASE.sha256});
  const marker=JSON.parse(await fs.readFile(result.manifestPath,'utf8'));
  assert.equal(marker.artifact.version,'2.4.0');
  assert.equal(Object.keys(marker.files).length,72);assert.equal(marker.files['node.exe'],'d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5');
  assert.equal(marker.patches[0].inputSha256,'2af79d5759b65a15a97a1f6d600b4ce895b54d2b2fc475b8aa566f57035c2e93');
  assert.match(await fs.readFile(path.join(result.snowHome,'index.mjs'),'utf8'),/Math.abs\(_prevStored.time - _qt\) < 21600/);
  for(const [name,digest] of Object.entries(marker.files))assert.equal(hash(await fs.readFile(path.join(result.snowHome,name))),digest);
  assert.equal(hash(await fs.readFile(artifact)),before);
  await assert.rejects(api.installManagedSnow({descriptor:f.descriptor,artifact,expectedDigest:api.SNOW_RELEASE.sha256}),/MANAGED_ALREADY_INSTALLED/);
});
