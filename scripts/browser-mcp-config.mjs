import path from 'node:path';

// On-demand administrator browser. Never attach DOM tools to the monitoring
// process, import daily Edge profiles, or copy a monitoring cookie jar.
export function browserMcpArgs(root) {
  return ['--browser','msedge','--user-data-dir',path.join(root,'state','dom-browser-profile'),'--timeout-navigation','30000'];
}
