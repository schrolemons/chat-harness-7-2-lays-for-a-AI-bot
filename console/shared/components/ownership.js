import layerC from '../../layers/C/ownership.js';
import layerE from '../../layers/E/ownership.js';
import layerV from '../../layers/V/ownership.js';
import layerG from '../../layers/G/ownership.js';
import layerR from '../../layers/R/ownership.js';
import layerL from '../../layers/L/ownership.js';
import layerO from '../../layers/O/ownership.js';
import layerS from '../../layers/S/ownership.js';
import layerT from '../../layers/T/ownership.js';
export const COMPONENT_OWNERS = Object.assign({}, layerC,layerE,layerV,layerG,layerR,layerL,layerO,layerS,layerT);
export const DEFAULT_LAYER_PAGES = {"C":"setting-c-1","T":"v2-t","E":"environments","L":"setting-l-0","O":"overview","V":"layer-v","G":"access","S":"layer-s","R":"registry"};
export function componentPage(plugin) { return COMPONENT_OWNERS[plugin.id]?.page || DEFAULT_LAYER_PAGES[plugin.layer || "R"]; }
