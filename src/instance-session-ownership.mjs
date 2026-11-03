import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { appendOwnedSession } from './instance-manifest.mjs';
import { readInstanceSessionPolicy } from './instance-session-policy.mjs';
const fail = (code,message) => Object.assign(Error(`${code}: ${message}`),{code});
const unsupported = message => fail('SESSION_OWNERSHIP_UNSUPPORTED',message);
const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;

/** Logical header v1 serialization, not a hash of physical JSONL bytes. Reuse in cleanup inspection. */
export function normalizeSessionHeader(header) {
  const fields=['version','id','createdAt','isSeeded','delegationDepth','cwd','parentSession','origin','agentPreset'];
  if (!header || Object.keys(header).some(key=>!fields.includes(key)) || !header.id || header.version!==4
    || !Number.isFinite(header.createdAt) || typeof header.isSeeded!=='boolean' || (header.delegationDepth!==undefined&&!Number.isInteger(header.delegationDepth))) throw unsupported('Unknown logical session header');
  return Object.fromEntries(fields.filter(key=>header[key]!==undefined).map(key=>[key,header[key]]));
}
export function fingerprintSessionHeader(header) {
  return 'sha256:logical-header-v1:'+createHash('sha256').update(JSON.stringify(normalizeSessionHeader(header))).digest('hex');
}

/** Pin both package metadata and the actual provider Fiber's module identity. No storage discovery. */
async function pinnedJsonl(ctx,hostBaseUrl,hostImport) {
  try {
    if (!hostBaseUrl || !hostImport || !ctx.reflect?._getImpl) throw unsupported('Active host resolution anchor/provider reflection unavailable');
    const hostRequire=createRequire(hostBaseUrl),baseRequire=createRequire(hostRequire.resolve('@deepseek-ai/dsh-base/package.json'));
    const metadata=JSON.parse(await fs.readFile(baseRequire.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json'),'utf8'));
    if(metadata.name!=='@deepseek-ai/dsh-session-persistence-jsonl'||metadata.version!=='0.2.1-rc.2')throw unsupported('Unknown JSONL package/version');
    const module=await hostImport(pathToFileURL(baseRequire.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href);
    const runtime=ctx.registry.get(module),provider=ctx.reflect._getImpl('sessionPersistence');
    if(!runtime||runtime.callback!==module.apply||typeof module.apply!=='function'||!provider||typeof provider.value?.locate!=='function')throw unsupported('No verified JSONL provider');
    let fiber=provider.fiber,owned=false;
    while(fiber){if(fiber.runtime===runtime&&fiber.state===2){owned=true;break;}fiber=fiber.parent?.fiber;}
    if(!owned)throw unsupported('Persistence provider is not owned by the pinned JSONL module');
    return {provider, persistence:ctx.get('sessionPersistence')};
  } catch(error) { if(error.code==='SESSION_OWNERSHIP_UNSUPPORTED')throw error;throw unsupported(error.message); }
}

/** Host-only callback. Runtime must call only for its current child's no-sessionId successful creates. */
export async function createSessionOwnershipRecorder({ctx,descriptor,scope,hostBaseUrl,hostImport,isActive=()=>true}) {
  const backend=await pinnedJsonl(ctx,hostBaseUrl,hostImport);
  const policy=readInstanceSessionPolicy({descriptor,env:{QQ_BRIDGE_PRESET_MAP:JSON.stringify(scope.presetMap)}});
  return async function recordCreatedSession({sessionId,workspaceId}={}) {
    const reject=message=>{throw fail('SESSION_OWNERSHIP_MISMATCH',message);};
    if(!isActive())reject('Instance generation is closed');
    if(typeof sessionId!=='string'||!sessionId||typeof workspaceId!=='string'||!workspaceId)reject('Explicit successful create IDs required');
    if(ctx.reflect._getImpl('sessionPersistence')!==backend.provider)throw unsupported('Persistence provider changed');
    const agent=ctx.get('agents')?.get(sessionId),header=agent?.session?.header;
    if(!agent||agent.id!==sessionId||header?.id!==sessionId||!scope.ownsContext(agent.ctx)||!policy.ownsPreset(header.agentPreset))reject('Live agent/header/scope/preset evidence differs');
    const workspace=ctx.get('workspaceRegistry')?.get(workspaceId);
    if(!workspace?.sessionIds.includes(sessionId))reject('Workspace has no exact session member');
    const expected=await fs.realpath(policy.workspace(policy.workspaceKind(header.agentPreset)));
    if(!header.cwd||pathKey(await fs.realpath(header.cwd))!==pathKey(expected)||pathKey(await fs.realpath(workspace.path))!==pathKey(expected))reject('Workspace/header directory differs');
    const location=backend.persistence.locate(header);
    if(location?.kind!=='jsonl'||!path.isAbsolute(location.path||''))throw unsupported('Unsupported locate result');
    if(ctx.reflect._getImpl('sessionPersistence')!==backend.provider)throw unsupported('Persistence provider changed before append');
    if(!isActive()||ctx.get('agents')?.get(sessionId)!==agent||!scope.ownsContext(agent.ctx))reject('Ownership changed before append');
    // path is the current-generation LOG FILE, which may not exist yet.
    return appendOwnedSession(descriptor.root,{sessionId,workspaceId,path:location.path,source:'created',cleanup:'owned',headerFingerprint:fingerprintSessionHeader(header)});
  };
}
