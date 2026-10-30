import {api,esc} from '../../shared/api.js';
function markup(plugin){
 const info=plugin.state?.mountInspection||{},disabled=plugin.enabled===false,when=info.validatedAt?new Date(info.validatedAt).toLocaleString('zh-CN',{hour12:false}):'暂无记录';
 const title=disabled?'组件已停用':!plugin.config?.libraryDir?'尚未挂载资料包':info.ok?'当前挂载：'+info.title:'资料包未就绪';
 return '<div class="core-mount-heading"><b>'+esc(title)+'</b><button class="small" type="button" data-core-recheck'+(disabled?' disabled':'')+'>重新校验当前目录</button></div>'
  +(info.ok?'<dl class="core-mount-facts"><div><dt>作者</dt><dd>'+esc(info.author)+'</dd></div><div><dt>版本</dt><dd>'+esc(info.version)+'</dd></div><div><dt>主题</dt><dd>'+esc(info.topicCount)+'</dd></div><div><dt>原稿</dt><dd>'+esc(info.sourceCount)+'</dd></div></dl>':'<p class="meta">'+esc(info.error||'填写目录并保存后开始使用。')+'</p>')
  +'<p class="meta core-mount-path">已保存目录：<code>'+esc(plugin.config?.libraryDir||'未设置')+'</code></p><p class="meta">最近校验：'+esc(when)+'。未保存的输入不替换当前挂载；文件变化后可重新校验。</p><p class="core-mount-message meta" role="status"></p>';
}
export function mountPersonalCore({id,body,p}){
 const panel=document.createElement('section');panel.className='core-mount-status';panel.setAttribute('aria-label','当前资料包挂载状态');
 const fields=body.querySelector('.component-fields');fields.before(panel);
 if(p.enabled===false){const save=body.querySelector('.comp-save');if(save)save.disabled=true;panel.insertAdjacentHTML('afterend','<p class="meta">请先启用此组件，再保存并校验挂载目录。</p>');}
 const render=plugin=>{panel.innerHTML=markup(plugin);panel.querySelector('[data-core-recheck]').addEventListener('click',async event=>{const button=event.currentTarget,msg=panel.querySelector('[role=status]');button.disabled=true;msg.textContent='正在校验已保存的目录…';try{const out=await api('/api/plugins/config','POST',{id,config:{}});if(out.ok!==true)throw Error(out.error||'校验失败');const latest=await api('/api/plugins/detail?id='+encodeURIComponent(id));render(latest.plugin||latest);panel.querySelector('[role=status]').textContent='已重新校验；未更改表单中尚未保存的输入。';}catch(error){panel.querySelector('.core-mount-heading b').textContent='当前校验失败；以下为最近一次挂载记录';msg.textContent=error.message;msg.classList.add('err');}finally{button.disabled=false;}});};
 render(p);
}
