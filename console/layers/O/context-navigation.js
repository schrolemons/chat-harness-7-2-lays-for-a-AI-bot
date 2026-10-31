import {requestEntries} from './context-inspector.js';
import {processingEntries} from './context-processing.js';

// Source buttons resolve inside the current projection. Only the explicit debug
// switch may choose native request order; a missing link never changes renderers.
export function resolveInspectorTarget(request,target,preferred=''){
 const messages=requestEntries(request),view=processingEntries(request,messages);
 if(preferred&&view.entries.some(row=>row.key===preferred))return preferred;
 if(view.entries.some(row=>row.key===target))return target;
 const native=messages.find(row=>row.key===target);if(!native)return null;
 const qq=view.records.filter(row=>row.sourcePositions.includes(native.position));
 if(qq.length)return qq[0].key;
 return view.entries.find(row=>row.originalKey===target)?.key||null;
}
