
import { api } from '../api.js';
const PRIVATE_FIELDS = /(?:api.?key|secret|token|password|credential)/i;
const INTERNAL_FIELDS = new Set(['mcpProfileConfigured', 'watchUrlsConfigured', 'bbCoursesConfigured', 'bbCourses', 'disabledReasons', 'lateMinutes']);

// The manifest owns the available keys; layer forms provide labels and specialized editors only.
export function resolveComponentFields(plugin, specification, selectedKeys) {
  const declaredKeys = plugin.configKeys || [];
  const overrides = new Map((specification?.fields || []).map(field => [field.key, field]));
  const order=new Map([...overrides.keys()].map((key,index)=>[key,index]));
  const keys=[...declaredKeys].sort((a,b)=>(order.get(a)??Infinity)-(order.get(b)??Infinity));
  return keys.filter(key => !PRIVATE_FIELDS.test(key) && !INTERNAL_FIELDS.has(key) && plugin.configSchema?.[key]?.editable !== false && plugin.configSchema?.[key]?.readOnly !== true && (!selectedKeys || selectedKeys.includes(key))).map(key => {
    const value = plugin.config?.[key];
    const rule = plugin.configSchema?.[key] || {};
    const type = rule.enum ? 'select' : Array.isArray(value) ? (value.some(x => typeof x === 'object') ? 'json' : 'lines') : value !== null && typeof value === 'object' ? 'json' : typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text';
    return { key, label: rule.label || key, help: rule.description || '', example: rule.example || '', type, ...overrides.get(key), ...(rule.min == null ? {} : {min:rule.min}), ...(rule.max == null ? {} : {max:rule.max}), ...(rule.maxLength == null ? {} : {maxLength:rule.maxLength}), ...(rule.enum ? {options:rule.enum} : {}) };
  });
}
