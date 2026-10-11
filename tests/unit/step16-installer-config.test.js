// @vitest-environment node
// Step 16: the electron-builder config in package.json (NSIS x64 per-user installer,
// files whitelist, icon) and the committed placeholder icon generator.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { makeIconPng, writeIcon, ICON_SIZE } from '../../scripts/make-icon.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const build = pkg.build || {};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Minimal PNG reader: checks signature and chunk CRC framing, returns IHDR fields and inflated IDAT.
function readPng(buf) {
  expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  expect(off).toBe(buf.length);
  expect(chunks[0].type).toBe('IHDR');
  expect(chunks.at(-1).type).toBe('IEND');
  const ihdr = chunks[0].data;
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    raw: inflateSync(idat)
  };
}

describe('step 16: electron-builder config', () => {
  it('identifies the app', () => {
    expect(build.appId).toBe('com.billable.desktop');
    expect(build.productName).toBe('Billable');
    expect(build.directories && build.directories.output).toBe('release');
    expect(build.publish).toBeNull(); // no auto-update feed (no app-update.yml / latest.yml)
  });

  it('builds a Windows NSIS installer for x64 only', () => {
    const targets = build.win && build.win.target;
    expect(Array.isArray(targets)).toBe(true);
    expect(targets).toEqual([{ target: 'nsis', arch: ['x64'] }]);
  });

  it('is an assisted per-user installer with a choosable folder and shortcuts', () => {
    const n = build.nsis || {};
    expect(n.oneClick).toBe(false);
    expect(n.perMachine).toBe(false);
    expect(n.allowToChangeInstallationDirectory).toBe(true);
    expect(n.createDesktopShortcut).toBe(true);
    expect(n.createStartMenuShortcut).toBe(true);
    expect(n.deleteAppDataOnUninstall).not.toBe(true); // uninstall keeps the user's data
  });

  it('names the installer Billable-Setup-<version>.exe', () => {
    const name = (build.nsis && build.nsis.artifactName) || build.artifactName;
    expect(name).toBe('Billable-Setup-${version}.exe');
    expect(name.replace('${version}', pkg.version)).toBe('Billable-Setup-1.0.0.exe');
  });

  it('packages only dist/, electron/ and package.json (no source maps)', () => {
    expect(build.files).toEqual(['dist/**', '!dist/**/*.map', 'electron/**', 'package.json']);
    for (const p of build.files) expect(p).not.toMatch(/src|tests|scripts|plan\.md|node_modules/);
  });

  it('has no runtime dependencies to bundle into the asar (Vite bundles them into dist/)', () => {
    expect(pkg.dependencies || {}).toEqual({});
    for (const dep of ['jspdf', 'jspdf-autotable', '@fontsource/ibm-plex-sans', '@fontsource/ibm-plex-mono', '@fontsource-variable/fraunces', 'electron-builder']) {
      expect(pkg.devDependencies[dep], dep).toBeTruthy();
    }
  });

  it('main entry exists and npm run dist builds the web app then the installer', () => {
    expect(existsSync(resolve(root, pkg.main))).toBe(true);
    expect(pkg.scripts.dist).toBe('vite build && electron-builder --win');
  });

  it('icon is a valid PNG of at least 512x512', () => {
    const iconPath = build.win && build.win.icon;
    expect(iconPath).toBe('build/icon.png');
    const abs = resolve(root, iconPath);
    expect(existsSync(abs)).toBe(true);
    const png = readPng(readFileSync(abs));
    expect(png.width).toBeGreaterThanOrEqual(512);
    expect(png.height).toBeGreaterThanOrEqual(512);
    expect(png.bitDepth).toBe(8);
    expect(png.colorType).toBe(6); // RGBA
  });
});

describe('step 16: scripts/make-icon.mjs', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'billable-icon-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes a valid 512x512 RGBA PNG', () => {
    const out = join(tmp, 'nested', 'icon.png');
    const bytes = writeIcon(out);
    expect(readFileSync(out).equals(bytes)).toBe(true);
    const png = readPng(bytes);
    expect([png.width, png.height, ICON_SIZE]).toEqual([512, 512, 512]);
    expect(png.raw.length).toBe((512 * 4 + 1) * 512);
  });

  it('is deterministic and matches the committed build/icon.png pixels', () => {
    const a = makeIconPng();
    const b = makeIconPng();
    expect(a.equals(b)).toBe(true);
    const committed = readPng(readFileSync(resolve(root, 'build/icon.png')));
    expect(readPng(a).raw.equals(committed.raw)).toBe(true);
  });

  it('draws a mark: opaque accent tile, white glyph, transparent corners', () => {
    const { raw } = readPng(makeIconPng());
    const px = (x, y) => [...raw.subarray(y * (512 * 4 + 1) + 1 + x * 4, y * (512 * 4 + 1) + 1 + x * 4 + 4)];
    expect(px(0, 0)[3]).toBe(0); // corner outside the rounded tile
    expect(px(60, 256)).toEqual([0x34, 0x52, 0xe1, 255]); // accent background
    expect(px(188, 256)).toEqual([255, 255, 255, 255]); // the B's stem
  });
});
