const fragment=new URLSearchParams(location.hash.slice(1));
let key=fragment.get('key')||sessionStorage.getItem('view-key')||'';
if(key){sessionStorage.setItem('view-key',key);history.replaceState(null,'','/');}
const messages=document.getElementById('messages');let previous='';let failures=0;
function render(data){
 const signature=JSON.stringify(data.messages);const nearBottom=innerHeight+scrollY>=document.documentElement.scrollHeight-150;
 if(signature!==previous){
  previous=signature;messages.replaceChildren();
  for(const message of data.messages||[]){
   const row=document.createElement('article');row.className='message '+(message.role==='user'?'right':'left');
   const label=document.createElement('div');label.className='label';label.textContent=message.role==='user'?'AI助手 · DeepSeek':'Codex';
   const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=message.text;
   row.append(label,bubble);messages.append(row);
  }
  if(nearBottom)requestAnimationFrame(()=>scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'}));
 }
 document.getElementById('empty').hidden=Boolean(data.messages?.length);
 document.getElementById('activity').textContent=data.activeRequest?'Codex 正在回复…':data.circuitOpen?'通信已暂停，请机主检查':'对话已同步';
}
async function refresh(){
 if(!key){document.getElementById('connection').textContent='需要查看链接';document.getElementById('activity').textContent='请从 codex_chat_status 获取本次启动的 viewerUrl';return;}
 try{
  const response=await fetch('/api/chat',{headers:{authorization:'Bearer '+key},cache:'no-store'});
  if(!response.ok){const error=await response.json();throw Error(error.error);}
  const data=await response.json();failures=0;document.getElementById('connection').textContent='已连接';document.body.classList.remove('offline');render(data);
 }catch(error){failures++;document.getElementById('connection').textContent='连接已暂停';document.getElementById('activity').textContent=error.message==='PLUGIN_DISABLED'?'插件已停用':error.message==='VIEW_KEY_REQUIRED'?'查看链接已失效，请重新获取':'等待本机通信服务';document.body.classList.add('offline');}
 if(failures<10)setTimeout(refresh,failures?Math.min(15000,2000*failures):1500);
}
void refresh();
