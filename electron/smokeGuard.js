// Pure guard for the smoke run's userData folder (no Electron imports, unit-tested).
//
// A smoke run writes a client, an entry and an invoice and auto-saves a PDF, so
// it must never run against real app data. The folder is either a fresh temp
// folder, or BILLABLE_USER_DATA_DIR when that resolves (following symlinks and
// junctions) to a folder strictly inside the system temp folder.
import path from 'node:path';

export const SMOKE_USER_DATA_ERROR = 'SMOKE FAIL: BILLABLE_USER_DATA_DIR must be inside the temp folder';

function isMissing(err) {
  return !!err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
}

/**
 * Real path of `p`, also for a path that does not exist yet: the nearest
 * existing ancestor is resolved with `realpath` and the missing tail appended.
 */
export function realpathOrNearest(p, { realpath, pathApi = path }) {
  const tail = [];
  let current = pathApi.resolve(p);
  for (;;) {
    try {
      const real = realpath(current);
      return tail.length ? pathApi.join(real, ...tail.reverse()) : real;
    } catch (err) {
      if (!isMissing(err)) throw err;
      const parent = pathApi.dirname(current);
      if (parent === current) throw err; // no existing ancestor at all
      tail.push(pathApi.basename(current));
      current = parent;
    }
  }
}

/** True when `child` is strictly inside `parent` (separator-safe, case-insensitive on Windows). */
export function isStrictlyInside(child, parent, { pathApi = path, caseInsensitive = pathApi === path.win32 } = {}) {
  const norm = (p) => {
    let s = pathApi.resolve(p);
    if (caseInsensitive) s = s.toLowerCase();
    return s;
  };
  const rel = pathApi.relative(norm(parent), norm(child));
  return !!rel && rel !== '..' && !rel.startsWith('..' + pathApi.sep) && !pathApi.isAbsolute(rel);
}

/**
 * Decides the smoke run's userData folder.
 *  envDir   - BILLABLE_USER_DATA_DIR (may be unset/empty)
 *  tmpdir   - os.tmpdir()
 *  realpath - fs.realpathSync.native (throws ENOENT for missing paths)
 *  mkdtemp  - fs.mkdtempSync
 * Returns { ok: true, dir, created } or { ok: false, error }.
 */
export function resolveSmokeUserData({ envDir, tmpdir, realpath, mkdtemp, pathApi = path, caseInsensitive }) {
  // On Windows `path` is `path.win32`, so the default follows the platform.
  const ci = caseInsensitive !== undefined ? caseInsensitive : pathApi === path.win32;
  if (!envDir) {
    return { ok: true, dir: mkdtemp(pathApi.join(tmpdir, 'billable-smoke-')), created: true };
  }
  if (!pathApi.isAbsolute(envDir)) return { ok: false, error: SMOKE_USER_DATA_ERROR + ' (got a relative path)' };
  let realTmp, realDir;
  try {
    realTmp = realpath(tmpdir);
    realDir = realpathOrNearest(envDir, { realpath, pathApi });
  } catch (err) {
    return { ok: false, error: SMOKE_USER_DATA_ERROR + ' (' + (err && err.message ? err.message : err) + ')' };
  }
  if (!isStrictlyInside(realDir, realTmp, { pathApi, caseInsensitive: ci })) {
    return { ok: false, error: SMOKE_USER_DATA_ERROR + ' (got ' + envDir + ')' };
  }
  return { ok: true, dir: realDir, created: false };
}
