import path from 'node:path';

export const PROFILE_BUNDLE = 'chat-bridge';
export const PROFILE_ENTRY = 'chat-bridge-mode';
export const PROFILE_RUNTIME_RECEIPT = 'chat-bridge-runtime.json';

export function profileRuntimeRoot(home, profile, bundle = PROFILE_BUNDLE) {
  if (!path.isAbsolute(home || '') || !/^[a-z0-9][a-z0-9_-]*$/i.test(profile || '') ||
      !/^[a-z0-9][a-z0-9_-]*$/i.test(bundle || '')) throw Error('INVALID_PROFILE');
  return path.join(home, 'bot-instances', 'runtime', profile, bundle);
}
