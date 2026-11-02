import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isAdminEnvironmentAuthorized} from '../../src/tools/admin-policy.js';

export const name='admin-environment-guard';
export const inject=['tools','agents'];
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=(base,file)=>JSON.parse(fs.readFileSync(path.join(base,file),'utf8'));

// Recheck persisted configuration before each native DSH tool. A retired chat or
// previously created worker must not retain authority after the switch is off.
export function adminToolPermission(base,sessionId,{agent,agents}={}) {
  try {
    const cfg=read(base,'config.json'),state=read(base,'state/sessions.json');
    const ownerKey='private:'+String(cfg.ownerQQ||''),loaded=String(state.sessionPresets?.[ownerKey]||'');
    const admin=cfg.socialV2?.adminDev||{},selected=String(admin.preset||loaded);
    if(!isAdminEnvironmentAuthorized({owner:true,enabled:admin.enabled,selectedPreset:selected,loadedPreset:loaded,
      hasSession:!!state.sessions?.[ownerKey],knownPresets:[loaded]}))return '管理员环境未启用或预设已降权，已拒绝执行';
    if(sessionId && sessionId===state.sessions[ownerKey])return;
    const tasks=fs.existsSync(path.join(base,'state/tasks.json')) ? read(base,'state/tasks.json').tasks||{} : {};
    const authorized=id=>id && (id===state.sessions[ownerKey] || Object.values(tasks).some(task=>task.sessionId===id&&task.originKey===ownerKey&&['running','waiting_input'].includes(task.status)));
    if(authorized(sessionId))return;
    // Only DSH's live registry supplies ancestry. Tool arguments or a caller's
    // session-id/parent-id assertion cannot manufacture delegation authority.
    const seen=new Set();let current=agent;
    for(let depth=0;depth<32&&current;depth++){
      const id=current.session?.id,header=current.session?.header;
      if(!id || depth===0&&id!==sessionId || seen.has(id) || agents?.get?.(id)!==current)break;
      seen.add(id);
      if(authorized(id))return;
      if(header?.origin!=='subagent' || !header.parentSession)break;
      current=agents.get(header.parentSession);
    }
    return '当前会话不是已授权的管理员会话或有效工作会话，已拒绝执行';
  } catch { return '无法确认管理员环境授权，已拒绝执行'; }
}
export function apply(ctx) {ctx.tools.guard(exec=>adminToolPermission(root,exec.agent?.session?.id,{agent:exec.agent,agents:ctx.agents}));}
