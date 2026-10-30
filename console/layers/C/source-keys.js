import {api,esc} from '../../shared/api.js';
export function readSourceKeys(id) {
  const keys=[...new Set(document.getElementById(id).value.split(/[\s,，;；]+/).filter(Boolean))];
  if(keys.length>50||keys.some(key=>!/^(group|private):[1-9]\d{0,19}$/.test(key)))throw Error('适用来源请填写 group:群号 或 private:QQ号，每行一个，最多50个。');
  return keys;
}
export const sourceKeysText=entry=>(entry.sourceKeys||[]).join('\n');
export function sourceKeysMarkup(entry) {
  const keys=entry.sourceKeys||[];if(!keys.length)return '<span class="meta">仅供查询</span>';
  const render=key=>'<code class="learning-source-key">'+esc(key)+'</code>';
  return keys.slice(0,2).map(render).join(' ')+(keys.length>2?'<details><summary>另有 '+(keys.length-2)+' 个来源</summary>'+keys.slice(2).map(render).join(' ')+'</details>':'');
}

// Do not silently save new fields against an old running bridge.
export async function requireLearningScopes(){let result;try{result=await api('/api/learning/sources');}catch{throw Error('资料多来源后端尚未启用，请先完成桥接整合后再保存。');}if(result.scopeVersion!==1)throw Error('资料多来源后端尚未启用，请先完成桥接整合后再保存。');}
