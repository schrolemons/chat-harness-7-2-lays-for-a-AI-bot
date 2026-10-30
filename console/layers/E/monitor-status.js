import {esc} from '../../shared/api.js';
const states=new Set(['green','red','stable','changed','baseline','pending','none','unknown','sent']);
const names={fetch:{green:'读取正常',red:'读取失败',unknown:'待检查'},auth:{green:'访问正常',red:'需要登录',unknown:'待确认'},diff:{green:'暂无变化',stable:'暂无变化',changed:'发现更新',baseline:'已记录初始内容',red:'对比失败',unknown:'待对比'},delivery:{green:'已发送',sent:'已发送',red:'发送失败',pending:'等待发送',none:'暂无待发送',unknown:'尚无发送记录'}};
const oneLine=value=>String(value||'').replace(/\s+/g,' ').trim();
export function siteStatusMarkup(sites=[]){
 if(!sites.length)return '<p class="meta">尚未添加监控网址，可在上方填写。</p>';
 return sites.map(site=>{const health=site.health||{},raw=String(site.url||'');let url='';try{const parsed=new URL(raw);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)url=parsed.href;}catch{}
  const at=Number(health.checkedAt),date=at>0?new Date(at):null;
  const time=date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date):'尚未检查';
  const rows=[['fetch','读取'],['auth','访问／登录'],['diff','内容变化'],['delivery','通知发送']].map(([key,label])=>{const state=states.has(health[key])?health[key]:'unknown';return '<div class="watch-state"><dt>'+label+'</dt><dd class="watch-value '+state+'">'+esc(names[key][state]||names[key].unknown)+'</dd></div>';}).join('');
  const hint=oneLine(health.hint),showHint=hint&&!/^(页面可读取|页面读取正常|访问正常|无变化)$/.test(hint);
  return '<article class="watch-site"><div class="watch-site-heading"><h4>'+esc(site.name||'未命名网页')+'</h4><span class="watch-check-time">'+esc(time)+'</span></div>'+(url?'<a class="watch-site-url" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(raw)+'</a>':'<span class="watch-site-url">'+esc(raw)+'</span>')+'<dl class="watch-state-grid">'+rows+'</dl>'+(showHint?'<p class="watch-note">'+esc(hint)+'</p>':'')+'</article>';
 }).join('');
}
export function fillScriptDescriptions(root,scripts=[]){
 if(!root)return;
 const normalize=value=>String(value||'').trim().replace(/\\/g,'/'),byPath=new Map(scripts.map(s=>[normalize(s.path),s]));
 for(const row of root.querySelectorAll('.comp-item')){
  const input=row.querySelector('.comp-item-val');if(!input)continue;
  const script=byPath.get(normalize(input.value)),state=script?.health||'unknown';
  const status={green:'运行正常',red:'运行失败',paused:'已暂停',stale:'心跳过期',fallback:'备用流程正常',unknown:'暂无心跳'}[state]||'暂无心跳';
  const description=oneLine(script?.description)||'执行与搜索约定尚未记录，由开发者与 AI 确定';
  const text=status+' · '+description;
  let line=row.querySelector('.script-brief');if(!line){line=document.createElement('small');line.className='script-brief';row.append(line);}
  line.textContent=text;line.title=text;line.setAttribute('aria-label',text);
 }
}
