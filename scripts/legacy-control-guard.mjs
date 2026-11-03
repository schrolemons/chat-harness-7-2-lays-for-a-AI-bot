import fs from 'node:fs';
import path from 'node:path';
/** Presence is enough: malformed metadata must never downgrade to legacy. */
export function assertLegacyControlAllowed(root) {
  try{fs.lstatSync(path.join(root,'.qq-bridge-instance.json'));}
  catch(error){if(error.code==='ENOENT')return;throw error;}
  throw Object.assign(Error('INSTANCE_CONTROL_REQUIRED: use this instance controller; legacy force/setup/stop is disabled'),{code:'INSTANCE_CONTROL_REQUIRED'});
}
