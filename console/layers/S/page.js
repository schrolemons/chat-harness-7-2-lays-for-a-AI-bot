
import { componentUI } from '../../shared/components/service.js';
import { registerPageLoader } from '../../shared/page-loaders.js';
export function initialize() {
  const load = async () => {
    const button=document.getElementById('sLayerRefresh'),status=document.getElementById('sLayerRefreshStatus');
    button.disabled=true;button.setAttribute('aria-busy','true');status.textContent='正在读取挂载信息…';
    try{await componentUI.renderLayer('S','sLayerRoot',{refresh:true});status.textContent='已刷新组件列表；校验时间以状态框为准。';}
    catch(error){status.textContent='刷新失败：'+error.message;}
    finally{button.disabled=false;button.removeAttribute('aria-busy');}
  };
  registerPageLoader('layer-s', load);
  document.getElementById('sLayerRefresh').addEventListener('click', load);
}
