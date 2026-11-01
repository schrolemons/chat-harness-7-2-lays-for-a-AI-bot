import {initializePresetOverview,loadPresetOverview} from './preset-overview.js';
import {refreshAdminPresets} from './admin-presets.js';

import { registerPageLoader } from '../../shared/page-loaders.js';
import { componentUI } from '../../shared/components/service.js';
import { api } from '../../shared/api.js';
import {siteStatusMarkup,fillScriptDescriptions} from './monitor-status.js';
// layers/E/environment-components: explicit imports; initialize is called in the application startup order.



export function initialize() {
  initializePresetOverview();
  registerPageLoader('environment-presets',loadPresetOverview);
(() => {
  let lastScripts=[],lastSites=[],statusRequest=null,lastStatusAt=0;
  const loadEnvironmentPage = async page => {
    if(page==='environment-admin')await refreshAdminPresets();
    if (!componentUI.renderIds) return;
    await Promise.all([...document.querySelectorAll('section[data-page="'+page+'"] .env-comp-root')].map(root => {
      const ids = (root.dataset.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
      return componentUI.renderIds(ids, root.id);
    }));
    if(['environment-watch','environment-scripts'].includes(page))void loadStatus();
  };
  const loadStatus = async ({force=false}={}) => {
    if(statusRequest){if(!force)return statusRequest;await statusRequest;}
    const status = document.getElementById('envMonitorStatus');
    const scriptStatus = document.getElementById('envScriptStatus');
    if (!status) return;
    statusRequest=api('/api/plugins/call', 'POST', { tool: 'campus_watch_status', input: {} }).then(response => {
      const result = response.result || {};
      if(response.ok!==true||result.ok!==true)throw Error(result.error||'状态读取失败');
      lastSites=result.sites||[];lastStatusAt=Date.now();
      status.innerHTML=siteStatusMarkup(lastSites);
      lastScripts=result.scripts||[];
      fillScriptDescriptions(document.getElementById('envCompScript'),lastScripts);
      if(scriptStatus)scriptStatus.textContent=lastScripts.length?'':'尚未登记协同脚本，可在上方添加地址。';
    }).catch(error => {
      status.textContent='读取监控状态失败：'+error.message;
      if (scriptStatus) scriptStatus.textContent='读取脚本状态失败：'+error.message;
    }).finally(()=>{statusRequest=null;});
    return statusRequest;
  };
  for(const page of ['environment-chat','environment-admin','environment-web','environment-watch','environment-scripts','images'])registerPageLoader(page,()=>loadEnvironmentPage(page));
  document.getElementById('envStatusRefresh').addEventListener('click',loadStatus);
  document.getElementById('envMonitorRefresh').addEventListener('click',loadStatus);
  document.getElementById('envMonitorStatus').addEventListener('click',async event=>{
    const button=event.target.closest('[data-watch-retry]');if(!button)return;
    button.disabled=true;
      button.textContent='正在请求重新监管…';
      try{const response=await api('/api/plugins/config','POST',{id:'life-campus-watch',config:{manualRetry:{url:button.dataset.watchRetry,nonce:crypto.randomUUID()}}});if(response.ok!==true)throw Error(response.error||'重新监管失败');await loadStatus({force:true});}
      catch(error){button.disabled=false;button.textContent='重新监管';let note=button.closest('.watch-site').querySelector('[data-watch-retry-error]');if(!note){note=document.createElement('p');note.dataset.watchRetryError='';note.className='watch-note';button.closest('.watch-site').append(note);}note.textContent=error.message;}
  });
  document.getElementById('envCompScript').addEventListener('input',()=>fillScriptDescriptions(document.getElementById('envCompScript'),lastScripts));
  document.getElementById('envCompScript').addEventListener('component-config-saved',loadStatus);
  document.getElementById('envCompBrowserWatch').addEventListener('component-config-saved',()=>loadStatus({force:true}));
  setInterval(()=>{const urgent=lastSites.some(site=>['needed','waiting'].includes(site.loginRecovery?.phase));if(!urgent&&Date.now()-lastStatusAt<30000)return;if(document.visibilityState==='visible' && ['section-environment-watch','section-environment-scripts'].some(id=>!document.getElementById(id).hidden))loadStatus();},5000);
})();
}
