// Presentation categories only. Native request roles and sources stay untouched.
export const DISPLAY_ROLES=Object.freeze(['assistant','user','tool','system','developer']);
const systemSources=new Set(['system-prompt','runtime-context','qq-context-task','qq-context-tool-history','repeat-tool-reminder','tool-registry','qq-context-retired']);
const developerSources=new Set(['qq-context-stable','qq-context-current','qq-context-update','qq-context-latest','agent-instructions','skill-catalog','skill-invocation','compact-checkpoint']);
export function displayRole(row={}){
 if(['definition','component'].includes(row.kind))return null;
 if(row.kind==='delivery')return 'assistant';
 if(['qq','quote','forwarded'].includes(row.kind))return row.record?.isSelf===true?'assistant':'user';
 if(row.role==='tool'||row.toolResults?.length||row.kind==='result')return 'tool';
 if(row.role==='assistant')return 'assistant';
 if(row.role==='system'||systemSources.has(row.source)||['task','registry','notice','runtime'].includes(row.kind))return 'system';
 if(developerSources.has(row.source)||row.role==='developer')return 'developer';
 // A raw bridge batch may contain tasks and several speakers; its extracted
 // QQ cards above carry the individual user/assistant categories.
 if(row.source==='qq-context-dialogue')return 'system';
 if(['context','summary'].includes(row.kind))return 'developer';
 if(row.role==='user'||row.kind==='user')return 'user';
 return 'system';
}
