
import { registerPageLoader } from '../../shared/page-loaders.js';
import { componentUI } from '../../shared/components/service.js';
import { api } from '../../shared/api.js';
import {siteStatusMarkup,fillScriptDescriptions} from './monitor-status.js';
// layers/E/environment-components: explicit imports; initialize is called in the application startup order.



export function initialize() {
(() => {
  let lastScripts=[];
  const loadEnvironmentPage = async page => {
    if (!componentUI.renderIds) return;
    await Promise.all([...document.querySelectorAll('section[data-page="'+page+'"] .env-comp-root')].map(root => {
      const ids = (root.dataset.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
      return componentUI.renderIds(ids, root.id);
    }));
    if(['environment-watch','environment-scripts'].includes(page))void loadStatus();
  };
  const loadStatus = () => {
    const status = document.getElementById('envMonitorStatus');
    const scriptStatus = document.getElementById('envScriptStatus');
    if (!status) return;
    api('/api/plugins/call', 'POST', { tool: 'campus_watch_status', input: {} }).then(response => {
      const result = response.result || {};
      if(response.ok!==true||result.ok!==true)throw Error(result.error||'状态读取失败');
      status.innerHTML=siteStatusMarkup(result.sites||[]);
      lastScripts=result.scripts||[];
      fillScriptDescriptions(document.getElementById('envCompScript'),lastScripts);
      if(scriptStatus)scriptStatus.textContent=lastScripts.length?'':'尚未登记协同脚本，可在上方添加地址。';
    }).catch(error => {
      status.textContent='读取监控状态失败：'+error.message;
      if (scriptStatus) scriptStatus.textContent='读取脚本状态失败：'+error.message;
    });
  };
  for(const page of ['environment-chat','environment-admin','environment-web','environment-watch','environment-scripts','images'])registerPageLoader(page,()=>loadEnvironmentPage(page));
  document.getElementById('envStatusRefresh').addEventListener('click',loadStatus);
  document.getElementById('envMonitorRefresh').addEventListener('click',loadStatus);
  document.getElementById('envCompScript').addEventListener('input',()=>fillScriptDescriptions(document.getElementById('envCompScript'),lastScripts));
  document.getElementById('envCompScript').addEventListener('component-config-saved',loadStatus);
  setInterval(()=>{if(document.visibilityState==='visible' && ['section-environment-watch','section-environment-scripts'].some(id=>!document.getElementById(id).hidden))loadStatus();},30000);
})();
}
