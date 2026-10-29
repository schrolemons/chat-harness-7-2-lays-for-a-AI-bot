
import { componentUI } from '../../shared/components/service.js';
import { registerPageLoader } from '../../shared/page-loaders.js';
export function initialize() {
  const load = () => componentUI.renderLayer('S', 'sLayerRoot');
  registerPageLoader('layer-s', load);
  document.getElementById('sLayerRefresh').addEventListener('click', load);
}
