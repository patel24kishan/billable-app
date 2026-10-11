// @vitest-environment node
// Step 15 (review fix): the smoke run only accepts a userData folder inside the
// system temp folder (electron/smokeGuard.js). Real filesystem cases use the
// real os.tmpdir(); a junction/symlink escape and platform rules are also
// covered with an injected realpath.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSmokeUserData, isStrictlyInside, realpathOrNearest, SMOKE_USER_DATA_ERROR } from '../../electron/smokeGuard.js';

const realpath = fs.realpathSync.native;
const tmp = os.tmpdir();
const realTmp = realpath(tmp);
const worktree = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const guard = (envDir, extra = {}) => resolveSmokeUserData({ envDir, tmpdir: tmp, realpath, mkdtemp: fs.mkdtempSync, ...extra });

let base; // a scratch folder inside tmp for this test file
const cleanup = [];

beforeAll(() => {
  base = fs.mkdtempSync(path.join(tmp, 'billable-guard-test-'));
  cleanup.push(base);
});
afterAll(() => {
  for (const p of cleanup) fs.rmSync(p, { recursive: true, force: true });
});

describe('step 15: smoke userData guard (real filesystem)', () => {
  it('unset or empty -> a fresh folder created inside tmp', () => {
    for (const envDir of [undefined, '']) {
      const res = guard(envDir);
      expect(res.ok).toBe(true);
      expect(res.created).toBe(true);
      cleanup.push(res.dir);
      expect(fs.statSync(res.dir).isDirectory()).toBe(true);
      expect(path.basename(res.dir)).toMatch(/^billable-smoke-/);
      expect(isStrictlyInside(realpath(res.dir), realTmp)).toBe(true);
    }
  });

  it('an existing folder inside tmp is accepted (returned as its real path)', () => {
    const res = guard(base);
    expect(res).toEqual({ ok: true, dir: realpath(base), created: false });
  });

  it('a folder that does not exist yet inside tmp is accepted and not created by the guard', () => {
    const missing = path.join(base, 'not-yet', 'deeper');
    const res = guard(missing);
    expect(res.ok).toBe(true);
    expect(res.dir).toBe(path.join(realpath(base), 'not-yet', 'deeper'));
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('trailing separators and (on Windows) case variants are accepted', () => {
    expect(guard(base + path.sep).ok).toBe(true);
    expect(guard(base + path.sep + path.sep).ok).toBe(true);
    if (process.platform === 'win32') {
      expect(guard(base.toUpperCase()).ok).toBe(true);
      expect(guard(base.toLowerCase() + '\\').ok).toBe(true);
    }
  });

  it('the real app profile and other folders outside tmp are refused', () => {
    const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
    for (const envDir of [path.join(appData, 'billable'), path.join(appData, 'Billable'), os.homedir(), path.join(worktree, 'not-temp-smoke'), path.parse(tmp).root]) {
      const res = guard(envDir);
      expect(res.ok, envDir).toBe(false);
      expect(res.error.startsWith(SMOKE_USER_DATA_ERROR)).toBe(true);
    }
    expect(fs.existsSync(path.join(worktree, 'not-temp-smoke'))).toBe(false);
  });

  it('tmp itself is refused (must be strictly inside)', () => {
    expect(guard(tmp).ok).toBe(false);
    expect(guard(tmp + path.sep).ok).toBe(false);
    expect(guard(path.join(base, '..')).ok).toBe(false);
  });

  it('a ".." escape is refused', () => {
    expect(guard(path.join(base, '..', '..', 'escaped')).ok).toBe(false);
    expect(guard(path.join(tmp, '..', 'Temp-evil', 'x')).ok).toBe(false);
    expect(guard(base + path.sep + '..' + path.sep + '..').ok).toBe(false);
  });

  it('a sibling with the same prefix as tmp (<tmp>2, <tmp>-evil) is refused', () => {
    expect(guard(realTmp + '2').ok).toBe(false);
    expect(guard(realTmp + '-evil' + path.sep + 'x').ok).toBe(false);
    expect(guard(realTmp + '2' + path.sep + 'billable-smoke-x').ok).toBe(false);
  });

  it('a relative path is refused', () => {
    expect(guard('billable-smoke-x').ok).toBe(false);
    expect(guard('.' + path.sep + 'x').ok).toBe(false);
  });

  it('a junction/symlink inside tmp that points outside tmp is refused', () => {
    const outside = fs.mkdtempSync(path.join(worktree, '.guard-outside-'));
    cleanup.push(outside);
    const link = path.join(base, 'escape-link');
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
      // Cannot create links here; the injected-realpath test below covers it.
      console.warn('symlink not created: ' + err.message);
      return;
    }
    expect(guard(link).ok).toBe(false);
    expect(guard(path.join(link, 'child-not-existing')).ok).toBe(false);
    fs.rmSync(link, { recursive: false, force: true });
  });
});

describe('step 15: smoke userData guard (injected realpath, both platforms)', () => {
  function fakeFs(map, pathApi) {
    // map: existing path -> real path. Anything else is ENOENT.
    return (p) => {
      const key = Object.keys(map).find((k) => pathApi === path.win32 ? k.toLowerCase() === p.toLowerCase() : k === p);
      if (key === undefined) throw Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
      return map[key];
    };
  }

  it('posix: link escaping tmp refused, real child accepted, prefix sibling refused, case matters', () => {
    const P = path.posix;
    const rp = fakeFs({ '/': '/', '/tmp': '/private/tmp', '/tmp/ok': '/private/tmp/ok', '/tmp/link': '/home/me/.config/billable', '/tmp2': '/tmp2' }, P);
    const g = (envDir) => resolveSmokeUserData({ envDir, tmpdir: '/tmp', realpath: rp, mkdtemp: vi.fn(), pathApi: P });
    expect(g('/tmp/ok')).toEqual({ ok: true, dir: '/private/tmp/ok', created: false });
    expect(g('/tmp/ok/new/deeper').dir).toBe('/private/tmp/ok/new/deeper');
    expect(g('/tmp/link').ok).toBe(false);
    expect(g('/tmp/link/sub').ok).toBe(false);
    expect(g('/tmp2/x').ok).toBe(false);
    expect(g('/tmp/../etc').ok).toBe(false);
    expect(g('/TMP/ok').ok).toBe(false); // '/TMP' does not exist on a case-sensitive fs -> resolves to '/TMP/ok', outside
  });

  it('win32: junction escaping tmp refused; case-insensitive compare; drive root refused', () => {
    const W = path.win32;
    const TMP = 'C:\\Users\\me\\AppData\\Local\\Temp';
    const rp = fakeFs({
      'C:\\': 'C:\\',
      [TMP]: TMP,
      [TMP + '\\ok']: TMP + '\\ok',
      [TMP + '\\junction']: 'C:\\Users\\me\\AppData\\Roaming\\billable',
      'C:\\Users\\me\\AppData\\Local\\Temp2': 'C:\\Users\\me\\AppData\\Local\\Temp2'
    }, W);
    const g = (envDir) => resolveSmokeUserData({ envDir, tmpdir: TMP, realpath: rp, mkdtemp: vi.fn(), pathApi: W });
    expect(g(TMP + '\\ok').ok).toBe(true);
    expect(g('c:\\users\\ME\\appdata\\local\\temp\\OK\\').ok).toBe(true);
    expect(g(TMP + '\\junction').ok).toBe(false);
    expect(g(TMP + '\\junction\\x').ok).toBe(false);
    expect(g('C:\\Users\\me\\AppData\\Local\\Temp2\\x').ok).toBe(false);
    expect(g('C:\\Users\\me\\AppData\\Roaming\\billable').ok).toBe(false);
    expect(g('C:\\').ok).toBe(false);
    expect(g('D:\\nowhere\\x').ok).toBe(false); // no existing ancestor -> refused
  });

  it('unset uses mkdtemp with a billable-smoke- prefix under tmp', () => {
    const mkdtemp = vi.fn((prefix) => prefix + 'abc');
    const res = resolveSmokeUserData({ envDir: undefined, tmpdir: '/tmp', realpath: () => { throw new Error('unused'); }, mkdtemp, pathApi: path.posix });
    expect(mkdtemp).toHaveBeenCalledWith('/tmp/billable-smoke-');
    expect(res).toEqual({ ok: true, dir: '/tmp/billable-smoke-abc', created: true });
  });

  it('realpathOrNearest rethrows non-ENOENT errors as a refusal', () => {
    const rp = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
    expect(() => realpathOrNearest('/tmp/x', { realpath: rp, pathApi: path.posix })).toThrow('EACCES');
    const res = resolveSmokeUserData({ envDir: '/tmp/x', tmpdir: '/tmp', realpath: rp, mkdtemp: vi.fn(), pathApi: path.posix });
    expect(res.ok).toBe(false);
  });
});

describe('step 15: main.js uses the guard before any window', () => {
  it('main.js resolves userData via the guard and exits 4 on refusal before taking the lock', () => {
    const src = fs.readFileSync(path.join(worktree, 'electron/main.js'), 'utf8');
    expect(src).toContain("import { resolveSmokeUserData } from './smokeGuard.js'");
    expect(src).not.toMatch(/process\.env\.BILLABLE_USER_DATA_DIR\s*\|\|/);
    expect(src).toMatch(/userData: 4/);
    const refuse = src.indexOf('app.exit(EXIT.userData)');
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(src.indexOf('requestSingleInstanceLock'));
    expect(refuse).toBeLessThan(src.indexOf("app.setPath('userData'"));
    expect(src).toContain('setPermissionCheckHandler(() => false)');
  });
});
