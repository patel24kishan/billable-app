// @vitest-environment node
// Step 15: CSP contents, the inline-handler hashes against index.html, and the
// static wiring of the Electron shell (package.json, preload, main security flags).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildCsp, INLINE_HANDLERS, sha256Source } from '../../electron/csp.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const directives = (csp) => Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

describe('step 15: Content-Security-Policy', () => {
  const d = directives(buildCsp());

  it('allows only self, inline styles, data:/blob: images and self/data fonts', () => {
    expect(d['default-src']).toEqual(["'none'"]);
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(d['font-src']).toEqual(["'self'", 'data:']);
    expect(d['connect-src']).toEqual(["'self'"]);
    for (const k of ['object-src', 'frame-src', 'worker-src', 'base-uri', 'form-action']) expect(d[k]).toEqual(["'none'"]);
  });

  it('scripts: self plus only the hashed inline handlers; no eval, no inline <script>', () => {
    const s = d['script-src'];
    expect(s[0]).toBe("'self'");
    expect(s).toContain("'unsafe-hashes'");
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
    expect(s.filter((x) => x.startsWith("'sha256-"))).toHaveLength(INLINE_HANDLERS.length);
  });

  it('names no network host in the packaged policy', () => {
    expect(buildCsp()).not.toMatch(/https?:|wss?:|googleapis|gstatic|\*/);
  });

  it('every inline on*="" handler in index.html is hashed (and nothing else is)', () => {
    const html = read('index.html');
    const handlers = [...html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
    expect(handlers.sort()).toEqual([...INLINE_HANDLERS].sort());
    const expected = "'sha256-" + createHash('sha256').update("goToView('settings')").digest('base64') + "'";
    expect(sha256Source("goToView('settings')")).toBe(expected);
    expect(d['script-src']).toContain(expected);
  });

  it('dev policy adds only the dev server origin and its websocket', () => {
    const dev = directives(buildCsp({ devUrl: 'http://localhost:5173/' }));
    expect(dev['script-src']).toContain('http://localhost:5173');
    expect(dev['connect-src']).toEqual(["'self'", 'http://localhost:5173', 'ws://localhost:5173']);
    expect(dev['img-src']).toEqual(d['img-src']);
  });
});

describe('step 15: Electron shell wiring', () => {
  const pkg = JSON.parse(read('package.json'));

  it('package.json: main, scripts, electron devDependency, still an ES module package', () => {
    expect(pkg.main).toBe('electron/main.js');
    expect(existsSync(resolve(root, pkg.main))).toBe(true);
    expect(pkg.type).toBe('module');
    expect(pkg.devDependencies.electron).toBeTruthy();
    expect(pkg.dependencies.electron).toBeUndefined();
    expect(pkg.scripts['electron:dev']).toMatch(/vite build.*&&.*electron \./);
    expect(pkg.scripts['electron:start']).toBe('electron .');
    expect(pkg.scripts.smoke).toMatch(/vite build.*&&.*node scripts\/smoke\.mjs/);
    expect(pkg.scripts.build).toBe('vite build');
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('step 17: declares a supported Electron major (>= 42) and the lockfile resolves to that major', () => {
    // Electron supports only its newest three majors; 42 was the oldest supported line
    // when Electron was upgraded to 44 (step 17). A downgrade below 42 must fail here.
    const range = pkg.devDependencies.electron;
    const m = /^\^?(\d+)\.\d+\.\d+$/.exec(range);
    expect(m, 'electron range ' + range).not.toBeNull();
    const major = Number(m[1]);
    expect(major).toBeGreaterThanOrEqual(42);
    const lock = JSON.parse(read('package-lock.json'));
    const locked = lock.packages['node_modules/electron'].version;
    expect(Number(locked.split('.')[0])).toBe(major);
    expect(Number(locked.split('.')[0])).toBeGreaterThanOrEqual(42);
  });

  it('.gitignore ignores release/', () => {
    expect(read('.gitignore').split(/\r?\n/)).toContain('release/');
  });

  it('preload is CommonJS and exposes only billableDesktop.saveFile over one channel', () => {
    const src = read('electron/preload.cjs');
    expect(src).toMatch(/require\('electron'\)/);
    expect(src).not.toMatch(/^\s*(import|export)\s/m);
    expect(src.match(/exposeInMainWorld\(/g)).toHaveLength(1);
    expect(src).toMatch(/exposeInMainWorld\('billableDesktop'/);
    expect(src.match(/ipcRenderer\.\w+/g)).toEqual(["ipcRenderer.invoke"]);
    expect(src).toContain("'billable:save-file'");
    expect(src).not.toMatch(/require\('(fs|path|child_process|os)'\)/);
  });

  it('main process: security defaults, preload path, min size, title, single instance', () => {
    const src = read('electron/main.js');
    for (const flag of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true', 'minWidth: 900', 'minHeight: 600', "title: 'Billable'", 'show: false', 'devTools: !app.isPackaged']) {
      expect(src).toContain(flag);
    }
    expect(src).toMatch(/preload: path\.join\(here, 'preload\.cjs'\)/);
    expect(src).toContain('requestSingleInstanceLock');
    expect(src).toContain("'ready-to-show'");
    expect(src).toContain('setWindowOpenHandler');
    expect(src).toContain("'will-navigate'");
    expect(src).toMatch(/path\.join\(app\.getAppPath\(\), 'dist', 'index\.html'\)/);
    expect(src).not.toMatch(/nodeIntegration: true|contextIsolation: false|sandbox: false|webSecurity: false/);
  });
});
