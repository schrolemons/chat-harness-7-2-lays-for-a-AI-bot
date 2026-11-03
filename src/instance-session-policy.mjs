import fs from 'node:fs';
import path from 'node:path';
import { createTitledSession } from './session-titles.js';

export const OWNED_PRESET_SOURCES = Object.freeze(['qq-chat', 'qq-chat-v2', 'qq-admin', 'qq-learning', 'qq-task-worker', 'campus-summary']);
const invalid = message => Object.assign(Error(`PRESET_MAP_INVALID: ${message}`), { code: 'PRESET_MAP_INVALID' });
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/** Explicit local descriptor only. Absence is legacy; malformed/announced identity is never legacy. */
export function loadInstanceSessionPolicy({ root, env = process.env, descriptor } = {}) {
  root ??= env.QQ_BRIDGE_ROOT;
  if (!descriptor && root) {
    try { descriptor = JSON.parse(fs.readFileSync(path.join(root, '.qq-bridge-instance.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw invalid('Unreadable instance descriptor'); }
    if (descriptor && !samePath(descriptor.root || '', root)) throw invalid('Descriptor root mismatch');
  }
  if (env.QQ_BRIDGE_INSTANCE_ID && !descriptor) throw invalid('Instance descriptor required');
  return readInstanceSessionPolicy({ env, descriptor });
}

export function readInstanceSessionPolicy({ env = {}, descriptor } = {}) {
  const active = descriptor !== undefined || Object.hasOwn(env, 'QQ_BRIDGE_PRESET_MAP');
  if (env.QQ_BRIDGE_INSTANCE_ID && env.QQ_BRIDGE_INSTANCE_ID !== descriptor?.instanceId) throw invalid('Instance identity mismatch');
  if (env.QQ_BRIDGE_SETTINGS_NAMESPACE && env.QQ_BRIDGE_SETTINGS_NAMESPACE !== descriptor?.settingsNamespace) throw invalid('Settings namespace mismatch');
  if (active && (!descriptor || descriptor.version!==1 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(descriptor.instanceId)
    || !path.isAbsolute(descriptor.root || '') || !descriptor.settingsNamespace || descriptor.settingsNamespace !== descriptor.entryId)) throw invalid('Explicit root and settings entry required');
  if(descriptor && (!descriptor.presetIdMap || typeof descriptor.presetIdMap!=='object' || Array.isArray(descriptor.presetIdMap) || Object.keys(descriptor.presetIdMap).some(id=>!OWNED_PRESET_SOURCES.includes(id)))) throw invalid('Unknown descriptor preset sources');
  const expected = descriptor ? Object.fromEntries(OWNED_PRESET_SOURCES.map(id => [id, descriptor.presetIdMap?.[id] ?? `${descriptor.instanceId}:${id}`])) : {};
  let map = expected;
  if (Object.hasOwn(env, 'QQ_BRIDGE_PRESET_MAP')) {
    try { map = JSON.parse(env.QQ_BRIDGE_PRESET_MAP); } catch { throw invalid('Malformed JSON'); }
  }
  if (active && (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length !== OWNED_PRESET_SOURCES.length
    || OWNED_PRESET_SOURCES.some(id => typeof map[id] !== 'string' || !map[id].trim() || map[id]!==map[id].trim() || (OWNED_PRESET_SOURCES.includes(map[id])&&map[id]!==id) || map[id] !== expected[id])
    || new Set(Object.values(map)).size !== OWNED_PRESET_SOURCES.length)) throw invalid('Complete exact owned map required');
  map = Object.freeze({ ...map });
  const reverse = new Map(Object.entries(map).map(([source, target]) => [target, source]));
  const canonicalPreset = id => reverse.get(String(id)) ?? String(id ?? '');
  const resolvePreset = id => Object.hasOwn(map, String(id)) ? map[id] : String(id ?? '');
  const workspace = kind => {
    if (!active) return undefined;
    if (!['chat', 'learning', 'task', 'summary'].includes(kind)) throw invalid('Unknown workspace kind');
    const directory = descriptor.workspaces?.[kind] ?? path.join(descriptor.root, 'state', 'workspaces', descriptor.instanceId, kind);
    if (!path.isAbsolute(directory)) throw invalid('Absolute workspace required');
    return directory;
  };
  if (active) for (const kind of ['chat','learning','task','summary']) workspace(kind);
  return Object.freeze({ active, presetMap: map, settingsNamespace: descriptor?.settingsNamespace || 'qq-mode',
    workspaceTitle:kind=>active ? `${descriptor.label || descriptor.instanceId} · ${{chat:'聊天',learning:'学习',task:'任务',summary:'网页整理'}[kind] || kind}` : undefined,
    resolvePreset, canonicalPreset, ownsPreset: id => reverse.has(String(id)), workspace,
    compareSessionPolicy: (saved,expected) => {
      try { const a=JSON.parse(saved),b=JSON.parse(expected);
        if(!Array.isArray(a)||!Array.isArray(b)||a.length!==3||b.length!==3||!a[1]||!b[1])return null;
        return a[0]===b[0] && canonicalPreset(a[1])===canonicalPreset(b[1]) && a[2]===b[2];
      } catch { return null; }
    },
    equivalentPreset: (a,b) => !!a && !!b && canonicalPreset(a) === canonicalPreset(b),
    workspaceKind: id => ({ 'qq-learning':'learning', 'qq-task-worker':'task', 'campus-summary':'summary' }[canonicalPreset(id)] || 'chat'),
  });
}

/** One adapter for every NodeApiClient creation. Existing IDs are read-compatible, never claimed. */
export async function createInstanceSession(api, create, payload = {}, signal, { policy, recordCreatedSession, onOwnershipError = () => {} } = {}) {
  if (!policy?.active || payload.sessionId !== undefined) return createTitledSession(api, create, payload, signal);
  const request = { ...payload, agentPreset: policy.resolvePreset(payload.agentPreset) };
  if (!request.agentPreset) throw invalid('Instance creation requires an explicit preset');
  if (!request.workspaceId) {
    const directory = policy.workspace(policy.workspaceKind(request.agentPreset));
    fs.mkdirSync(directory, { recursive: true });
    const response = await api.workspace.create({ path: directory }, signal);
    const workspace = response.result?.ok && response.result.value?.workspace;
    if (!workspace?.workspaceId || !samePath(workspace.path || '', directory)) throw Error('INSTANCE_WORKSPACE_MISMATCH');
    request.workspaceId = workspace.workspaceId;
    if(response.result.value.created){
      const renamed=await api.workspace.rename({workspaceId:workspace.workspaceId,title:policy.workspaceTitle(policy.workspaceKind(request.agentPreset))},signal);
      if(!renamed.result?.ok)throw Error('INSTANCE_WORKSPACE_TITLE_FAILED');
    }
  }
  delete request.cwd;
  const response = await createTitledSession(api, create, request, signal);
  if (!response.result?.ok) return response;
  // Recording is a post-create outcome. Never turn it into a failed creation or retry.
  try {
    if (!recordCreatedSession) throw Error('SESSION_OWNERSHIP_UNSUPPORTED: owned child recorder is unavailable');
    await recordCreatedSession({ sessionId: response.result.value.sessionId, workspaceId: request.workspaceId });
    return { ...response, ownership: { status: 'recorded' } };
  } catch (error) {
    try { onOwnershipError(error, { sessionId: response.result.value.sessionId, workspaceId: request.workspaceId }); } catch {}
    return { ...response, ownership: { status: 'unrecorded', error: String(error?.message || error) } };
  }
}
