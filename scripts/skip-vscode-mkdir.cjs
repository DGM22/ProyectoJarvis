const fs = require('fs');
const childProcess = require('child_process');
const REQUIRE_FLAG = [
  '--require',
  '/Users/danielgarza/ProyectoJarvis/scripts/skip-vscode-mkdir.cjs',
];

function inject(command, args) {
  const cmd = String(command);
  if (cmd === 'node' || cmd.endsWith('/node')) {
    const next = Array.isArray(args) ? args.slice() : [];
    if (!next.includes(REQUIRE_FLAG[1])) {
      next.unshift(...REQUIRE_FLAG);
    }
    return [command, next];
  }
  return [command, args];
}

const spawn = childProcess.spawn;
childProcess.spawn = function patchedSpawn(command, args, options) {
  const injected = inject(command, args);
  return spawn.call(this, injected[0], injected[1], options);
};

const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = function patchedSpawnSync(command, args, options) {
  const injected = inject(command, args);
  return spawnSync.call(this, injected[0], injected[1], options);
};

const execFile = childProcess.execFile;
childProcess.execFile = function patchedExecFile(file, args, options, callback) {
  if (typeof args === 'function') {
    return execFile.call(this, file, args);
  }
  if (!Array.isArray(args)) {
    return execFile.call(this, file, args, options, callback);
  }
  const injected = inject(file, args);
  return execFile.call(this, injected[0], injected[1], options, callback);
};

function skip(path) {
  return (
    typeof path === 'string' && /\/\.(vscode|claude|cursor)(\/|$)/.test(path)
  );
}

function wrapCallback(original, args, callbackIndex) {
  const callback = args[callbackIndex];
  if (skip(args[0]) || skip(args[1])) {
    if (typeof callback === 'function') callback(null);
    return;
  }
  return original.apply(fs, args);
}

function wrapSync(original, args) {
  if (skip(args[0]) || skip(args[1])) return undefined;
  return original.apply(fs, args);
}

async function wrapPromise(original, args) {
  if (skip(args[0]) || skip(args[1])) return undefined;
  return original(...args);
}

const mkdir = fs.mkdir;
fs.mkdir = function patchedMkdir(path, options, callback) {
  if (typeof options === 'function') {
    return wrapCallback(mkdir, [path, options], 1);
  }
  return wrapCallback(mkdir, [path, options, callback], 2);
};
const mkdirSync = fs.mkdirSync;
fs.mkdirSync = function patchedMkdirSync(path, options) {
  return wrapSync(mkdirSync, [path, options]);
};
const promisesMkdir = fs.promises.mkdir.bind(fs.promises);
const patchedPromisesMkdir = function patchedPromisesMkdir(path, options) {
  return wrapPromise(promisesMkdir, [path, options]);
};
fs.promises.mkdir = patchedPromisesMkdir;

const copyFile = fs.copyFile;
fs.copyFile = function patchedCopyFile(src, dest, flags, callback) {
  if (typeof flags === 'function') {
    return wrapCallback(copyFile, [src, dest, flags], 2);
  }
  return wrapCallback(copyFile, [src, dest, flags, callback], 3);
};
const copyFileSync = fs.copyFileSync;
fs.copyFileSync = function patchedCopyFileSync(src, dest, flags) {
  return wrapSync(copyFileSync, [src, dest, flags]);
};
const promisesCopyFile = fs.promises.copyFile.bind(fs.promises);
const patchedPromisesCopyFile = function patchedPromisesCopyFile(src, dest, flags) {
  return wrapPromise(promisesCopyFile, [src, dest, flags]);
};
fs.promises.copyFile = patchedPromisesCopyFile;

const fspEarly = require('fs/promises');
fspEarly.mkdir = patchedPromisesMkdir;
fspEarly.copyFile = patchedPromisesCopyFile;

const fsp = require('fs/promises');

for (const name of ['unlink', 'rmdir', 'rm']) {
  const original = fs[name];
  fs[name] = function patched(path, options, callback) {
    if (typeof options === 'function') {
      return wrapCallback(original, [path, options], 1);
    }
    return wrapCallback(original, [path, options, callback], 2);
  };
  const originalSync = fs[`${name}Sync`];
  fs[`${name}Sync`] = function patchedSync(path, options) {
    return wrapSync(originalSync, [path, options]);
  };
  const originalPromise = fs.promises[name].bind(fs.promises);
  const patchedPromise = function patchedPromise(path, options) {
    return wrapPromise(originalPromise, [path, options]);
  };
  fs.promises[name] = patchedPromise;
  fsp[name] = patchedPromise;
}
