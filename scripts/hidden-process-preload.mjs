// Loaded before SnowLuma's updater and inherited through process.execArgv by its child.
// Windows detached console processes allocate a new console even with stdio ignored.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

export function hiddenOptions(options = {}, platform = process.platform) {
  return { ...options, windowsHide: true, ...(platform === 'win32' ? { detached: false } : {}) };
}

if (process.platform === 'win32') {
  const spawn = childProcess.spawn;
  childProcess.spawn = function(file, args, options) {
    if (!Array.isArray(args)) return spawn.call(this, file, hiddenOptions(args));
    return spawn.call(this, file, args, hiddenOptions(options));
  };
  const execFile = childProcess.execFile;
  childProcess.execFile = function(file, args, options, callback) {
    if (!Array.isArray(args)) {
      callback = typeof options === 'function' ? options : typeof args === 'function' ? args : callback;
      options = typeof args === 'object' ? args : {};
      args = [];
    } else if (typeof options === 'function') { callback = options; options = {}; }
    return execFile.call(this, file, args, hiddenOptions(options), callback);
  };
  for (const name of ['spawnSync', 'execFileSync']) {
    const original = childProcess[name];
    childProcess[name] = function(file, args, options) {
      if (!Array.isArray(args)) return original.call(this, file, hiddenOptions(args));
      return original.call(this, file, args, hiddenOptions(options));
    };
  }
  syncBuiltinESMExports();
}
