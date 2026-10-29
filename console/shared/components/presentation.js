import { COMPONENT_OWNERS } from './ownership.js';
// Prompt assembly is internal; its runtime enablement remains in the registry.
export function isInternalPromptComponent(plugin) {
 if(COMPONENT_OWNERS[plugin.id]?.presentation==='internal')return true;
 const keys=plugin.configKeys ?? Object.keys(plugin.config || {});
 return Array.isArray(plugin.hooks) && plugin.hooks.includes('beforePrompt')
  && !(plugin.tools || []).length && keys.every(key=>key==='disabledBlocks');
}
