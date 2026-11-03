import {planInstanceInstall} from './plan-instance-install.mjs';
import {applyInstanceInstall} from './migrate-instance-profile.mjs';
/** Explicit descriptor/profile only; no implicit desktop/home or ID-based cleanup. */
export async function installProfile(options={}) {
  if(!options.descriptor||!options.profilePath)throw Error('EXPLICIT_INSTANCE_AND_PROFILE_REQUIRED');
  const plan=await planInstanceInstall(options);
  if(!options.apply)return plan;
  return applyInstanceInstall(plan,{expectedHashes:options.expectedHashes,writersStopped:options.writersStopped});
}
