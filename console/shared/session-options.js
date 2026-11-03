import { api } from './api.js';
export function initialize() {
 const splitKinds={aiNotifyId:'aiNotifyKind'};
 let keys=[],sessions=[];
 function enhanceSelects(unavailable){
  for(const select of document.querySelectorAll('select[data-session-kind]')){
   const kindSelect=document.getElementById(select.dataset.sessionKind);
   if(!kindSelect)continue;
   const selections=new Map();let activeKind=kindSelect.value;
   const fill=()=>{
    if(select.value)selections.set(activeKind,select.value);
    activeKind=kindSelect.value;
    const label=activeKind==='private'?'私聊':'群聊';
    const rows=keys.filter(key=>key.startsWith(activeKind+':'));
    select.replaceChildren(new Option(unavailable?'会话读取失败，请刷新重试':rows.length?'请选择'+label+'会话…':'暂无'+label+'会话',''),
     ...rows.map(key=>{const id=key.slice(activeKind.length+1);return new Option(label+' · '+id,id);}));
    select.value=selections.get(activeKind)||'';
    select.disabled=!rows.length;
    select.dispatchEvent(new Event('change',{bubbles:true}));
   };
   select.addEventListener('change',()=>{if(select.value)selections.set(activeKind,select.value);else selections.delete(activeKind);});
   kindSelect.addEventListener('change',fill);fill();
  }
 }
 function enhance(){
  for(const input of document.querySelectorAll('input[type=text],input:not([type]),textarea')){
   if(input.matches('.comp-form-json') || input.dataset.sessionPicker || input.closest('.session-options,[data-session-picker-scope="explicit"]') || /token|secret|password|apikey/i.test(input.id))continue;
   const field=input.closest('[data-config-key]'),name=field?.dataset.configKey||'',hint=(input.placeholder||'')+' '+input.id;
   const opaque=/sessionId/i.test(input.id),kindId=splitKinds[input.id];
   if(!opaque&&!kindId&&!/(?:group:|private:|session|会话)/i.test(hint)&&!/(?:session|conversation|targetKey|notifyKey)/i.test(name))continue;
   input.dataset.sessionPicker='1';
   if(input.tagName!=='TEXTAREA'){
    const list=document.createElement('datalist');list.id=(input.id||'session-'+document.querySelectorAll('datalist[data-sessions]').length)+'-sessions';list.dataset.sessions='1';
    const fill=()=>{const kind=kindId?document.getElementById(kindId)?.value:null;const rows=opaque?sessions.map(s=>[s.sessionId||s.id,s.key]):keys.filter(k=>!kind||k.startsWith(kind+':')).map(k=>[kindId?k.split(':').slice(1).join(':'):k,k]);list.replaceChildren(...rows.filter(r=>r[0]).map(([v,label])=>new Option(label||v,v)));};
    fill();if(kindId)document.getElementById(kindId)?.addEventListener('change',fill);input.setAttribute('list',list.id);input.setAttribute('aria-label',input.getAttribute('aria-label')||'选择或输入会话');input.after(list);continue;
   }
   const select=document.createElement('select');select.className='session-options';select.setAttribute('aria-label','选择已有会话');
   const fill=()=>{const kind=kindId?document.getElementById(kindId)?.value:null;const rows=opaque?sessions.map(s=>[s.sessionId||s.id,s.key]):keys.filter(k=>!kind||k.startsWith(kind+':')).map(k=>[k,k]);select.replaceChildren(new Option('选择已有会话…',''),...rows.filter(r=>r[0]).map(([v,label])=>new Option(label||v,v)));};
   fill();if(kindId)document.getElementById(kindId)?.addEventListener('change',fill);
   select.addEventListener('change',()=>{if(!select.value)return;const value=kindId?select.value.split(':').slice(1).join(':'):select.value;
    input.value=input.tagName==='TEXTAREA'?[...new Set([...input.value.split('\n').filter(Boolean),value])].join('\n'):value;
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));select.value='';
   });input.before(select);
  }
 }
 Promise.allSettled([api('/api/socialV2/states'),api('/api/sessions')]).then(([a,b])=>{sessions=b.status==='fulfilled'?b.value.sessions||[]:[];keys=[...new Set([...(a.status==='fulfilled'?a.value.conversations||[]:[]).map(s=>s.key),...sessions.map(s=>s.key)])].filter(k=>/^(private|group):\d+$/.test(k));enhanceSelects(a.status==='rejected'&&b.status==='rejected');enhance();new MutationObserver(enhance).observe(document.getElementById('mainContent'),{childList:true,subtree:true});});
}
