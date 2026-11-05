import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { inflateRawSync, crc32 } from 'node:zlib';
import { readInstanceDescriptor, claimInstanceRoot } from '../src/instance-descriptor.mjs';
import { patchSnowQuote, SNOW_QUOTE_PATCH_ID, SNOW_QUOTE_PATCH_INPUT, LEGACY_SNOW_QUOTE_PATCH_INPUT } from './snow-quote-patch.mjs';

export const LEGACY_SNOW_RELEASE = Object.freeze({ version: '2.1.1', platform: 'win-x64',
  url: 'https://github.com/SnowLuma/SnowLuma/releases/download/v2.1.1/SnowLuma-v2.1.1-win-x64.zip',
  sha256: 'c739171f95c27706767e69ba36099707c222fcec639b46f4d59689997b527772' });
export const SNOW_RELEASE = Object.freeze({ version: '2.4.0', platform: 'win-x64',
  url: 'https://github.com/SnowLuma/SnowLuma/releases/download/v2.4.0/SnowLuma-v2.4.0-win-x64.zip',
  sha256: '93096cb6d4cf576999094e9f7d1c9fb08e22f6b41c879182f015e639dc437613' });
const fail = (code, message = code) => Object.assign(Error(`${code}: ${message}`), { code });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const markerName = '.qq-bridge-managed.json';

/** Bounded ordinary ZIP only. Reject ambiguous Windows names, special files,
 * links, duplicate paths and local/central disagreement before any extraction.
 * The pinned upstream uses stored/deflate, no ZIP64, encryption or disk splits. */
export function inspectManagedSnowArchive(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length > 256 * 1024 * 1024) throw Error('size');
    let end = buffer.length - 22;
    const minimum = Math.max(0, end - 65535);
    while (end >= minimum && buffer.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < minimum || end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length
      || buffer.readUInt16LE(end+4) || buffer.readUInt16LE(end+6)) throw Error('directory');
    const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
    if (!count || count>4096 || count!==buffer.readUInt16LE(end+8) || offset+size!==end) throw Error('directory');
    let cursor=offset,total=0;const entries=[],names=new Set(),ranges=[];
    for(let i=0;i<count;i++){
      if(buffer.readUInt32LE(cursor)!==0x02014b50)throw Error('entry');
      const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),crc=buffer.readUInt32LE(cursor+16),packed=buffer.readUInt32LE(cursor+20),length=buffer.readUInt32LE(cursor+24);
      const n=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),attributes=buffer.readUInt32LE(cursor+38),local=buffer.readUInt32LE(cursor+42);
      const name=buffer.subarray(cursor+46,cursor+46+n).toString('utf8');cursor+=46+n+extra+comment;
      const directory=name.endsWith('/'),parts=(directory?name.slice(0,-1):name).split('/'),key=name.replace(/\/$/,'').toLowerCase(),mode=(attributes>>>16)&0xf000;
      if(cursor>end || !n || flags&~0x808 || ![0,8].includes(method) || buffer.readUInt16LE(cursor-46-n-extra-comment+34)
        || name.includes('\\') || name.includes(':') || name.includes('\ufffd') || parts.some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f<>"|?*]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
        || names.has(key) || ![0,0x8000,0x4000].includes(mode) || (attributes&0x400) || name===markerName)throw Error('unsafe path or type');
      names.add(key);total+=length;
      if(length>160*1024*1024 || total>384*1024*1024 || local>=offset || buffer.readUInt32LE(local)!==0x04034b50
        || buffer.readUInt16LE(local+6)!==flags || buffer.readUInt16LE(local+8)!==method)throw Error('local entry');
      const ln=buffer.readUInt16LE(local+26),le=buffer.readUInt16LE(local+28),start=local+30+ln+le;
      if(buffer.subarray(local+30,local+30+ln).toString('utf8')!==name || start+packed>offset)throw Error('local name');
      if(!(flags&8) && (buffer.readUInt32LE(local+14)!==crc||buffer.readUInt32LE(local+18)!==packed||buffer.readUInt32LE(local+22)!==length))throw Error('local size');
      ranges.push([local,start+packed]);
      const compressed=buffer.subarray(start,start+packed),data=method===0?Buffer.from(compressed):inflateRawSync(compressed,{maxOutputLength:Math.max(1,length)});
      if(data.length!==length || crc32(data)!==crc || directory&&length)throw Error('CRC or size');
      entries.push({name,directory,data});
    }
    if(cursor!==end)throw Error('directory size');
    ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw Error('overlapping entries');
    for(const entry of entries)for(const other of entries)if(!entry.directory&&other.name.toLowerCase().startsWith(entry.name.toLowerCase()+'/'))throw Error('file parent');
    for(const name of ['index.mjs','node.exe'])if(!entries.some(e=>e.name===name&&!e.directory&&e.data.length))throw Error('missing runtime');
    return entries;
  } catch(error){throw fail('ARCHIVE_INVALID',error.message);}
}

async function realDirectory(directory) {
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('MANAGED_PATH_INVALID');
}
async function ordinary(file) {
  const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw fail('MANAGED_PATH_INVALID');
  return stat;
}

/** Install only a freshly supplied, digest-pinned official ZIP; never discover,
 * copy, update in place, adopt an external installation, or execute vendor code.
 * Task7 initializes descriptor/receipt/inventory before calling this API. */
export async function installManagedSnow({descriptor,artifact,expectedDigest}={}) {
  if(!descriptor?.root || !path.isAbsolute(artifact||''))throw fail('INSTALL_INPUT_INVALID');
  const selected=await readInstanceDescriptor(descriptor.root);
  if(['instanceId','entryId','settingsNamespace','profile','bundleName','dshHome'].some(k=>selected[k]!==descriptor[k])
    || selected.entryId!==selected.settingsNamespace)throw fail('DESCRIPTOR_INVALID');
  const release=await claimInstanceRoot({root:{}},selected);
  let staging,lock;
  try{
    await realDirectory(selected.root);
    const managed=path.join(selected.root,'managed-dependencies');
    await fs.mkdir(managed,{recursive:true});await realDirectory(managed);
    const artifactRelease = [SNOW_RELEASE, LEGACY_SNOW_RELEASE].find(candidate => candidate.sha256 === expectedDigest);
    if(!artifactRelease)throw fail('ARTIFACT_UNTRUSTED');
    if((await ordinary(artifact)).size>256*1024*1024)throw fail('ARCHIVE_INVALID','Artifact is too large');
    const buffer=await fs.readFile(artifact);
    if(hash(buffer)!==expectedDigest)throw fail('ARTIFACT_DIGEST');
    const entries=inspectManagedSnowArchive(buffer);
    const snowHome=path.join(managed,`snowluma-${artifactRelease.version}-${artifactRelease.platform}-${expectedDigest.slice(0,12)}`);
    lock=path.join(managed,'.snow-install.lock');
    try{await fs.mkdir(lock);}catch(error){lock=null;if(error.code==='EEXIST')throw fail('INSTALL_BUSY');throw error;}
    try{await fs.lstat(snowHome);throw fail('MANAGED_ALREADY_INSTALLED');}catch(error){if(error.code!=='ENOENT')throw error;}
    staging=await fs.mkdtemp(path.join(managed,'.snow-staging-'));
    const files={};
    for(const entry of entries){
      const target=path.join(staging,entry.name);
      if(entry.directory){await fs.mkdir(target,{recursive:true});continue;}
      await fs.mkdir(path.dirname(target),{recursive:true});
      const data=entry.name==='index.mjs'?patchSnowQuote(entry.data):entry.data;
      await fs.writeFile(target,data,{flag:'wx',mode:0o600});await ordinary(target);
      const actual=hash(await fs.readFile(target));if(actual!==hash(data))throw fail('INSTALL_VERIFY_FAILED');files[entry.name]=actual;
    }
    // Pinned archive has no config entry; exclusive creation cannot adopt vendor/user output.
    await fs.mkdir(path.join(staging,'config'),{mode:0o700});
    const marker={version:1,kind:'snowluma',instanceId:selected.instanceId,entry:'index.mjs',runtime:'node.exe',files,createdDirectories:['config'],
      artifact:{...artifactRelease},patches:[{id:SNOW_QUOTE_PATCH_ID,file:'index.mjs',inputSha256:artifactRelease === SNOW_RELEASE ? SNOW_QUOTE_PATCH_INPUT : LEGACY_SNOW_QUOTE_PATCH_INPUT,outputSha256:files['index.mjs']}]};
    await fs.writeFile(path.join(staging,markerName),JSON.stringify(marker,null,2)+'\n',{flag:'wx',mode:0o600});
    await realDirectory(managed);await fs.rename(staging,snowHome);staging=null;
    return {snowHome,manifestPath:path.join(snowHome,markerName)};
  } finally {
    // Only the exact fresh staging directory created by this invocation is removed.
    if(staging)await fs.rm(staging,{recursive:true,force:true});
    if(lock)await fs.rmdir(lock);
    await release();
  }
}
