
import { componentUI } from '../../shared/components/service.js';
import { registerPageLoader } from '../../shared/page-loaders.js';
export function initialize() {
  const load = () => componentUI.renderLayer('V', 'vLayerRoot');
  registerPageLoader('layer-v', load);
  document.getElementById('vLayerRefresh').addEventListener('click', load);
}
