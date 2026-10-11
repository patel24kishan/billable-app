// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(__dirname, '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('index.html has no remote resources', () => {
  it('has no Google Fonts URLs or preconnect hints', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(html).not.toMatch(/rel=["']preconnect["']/);
  });

  it('has no http(s) stylesheet, script, or other loaded resource', () => {
    const tags = html.match(/<(link|script|img|iframe|source|video|audio)\b[^>]*>/gi) || [];
    for (const tag of tags) {
      expect(tag, tag).not.toMatch(/(?:href|src)\s*=\s*["']?(?:https?:)?\/\//i);
    }
    expect(html).not.toMatch(/@import\s+url\(\s*["']?https?:/i);
  });
});

describe('production build bundles fonts locally', () => {
  let out;
  let files;
  let css;
  let distHtml;

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'billable-fonts-'));
    await build({ root, logLevel: 'silent', build: { outDir: out, emptyOutDir: true, write: true, sourcemap: false } });
    files = readdirSync(join(out, 'assets'));
    css = files.filter(f => f.endsWith('.css')).map(f => readFileSync(join(out, 'assets', f), 'utf8')).join('\n');
    distHtml = readFileSync(join(out, 'index.html'), 'utf8');
  }, 120000);

  afterAll(() => { if (out && existsSync(out)) rmSync(out, { recursive: true, force: true }); });

  it('emits woff2 files for all three families', () => {
    const woff2 = files.filter(f => f.endsWith('.woff2'));
    expect(woff2.some(f => /^fraunces-latin/.test(f))).toBe(true);
    expect(woff2.some(f => /^ibm-plex-sans-latin/.test(f))).toBe(true);
    expect(woff2.some(f => /^ibm-plex-mono-latin/.test(f))).toBe(true);
    expect(files.some(f => /(latin-ext|cyrillic|greek|vietnamese)/.test(f))).toBe(false);
  });

  it('keeps the family names used by style.css', () => {
    for (const fam of ['Fraunces', 'IBM Plex Sans', 'IBM Plex Mono']) {
      expect(css).toMatch(new RegExp(`font-family:\s*["']?${fam}["']?[;}]`));
    }
  });

  it('dist/index.html has no remote font URLs', () => {
    expect(distHtml).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(distHtml).not.toMatch(/(?:href|src)\s*=\s*["']https?:/i);
  });

  it('references fonts with relative URLs only', () => {
    const urls = [...css.matchAll(/url\(\s*["']?([^"')]+\.woff2?)["']?\s*\)/g)].map(m => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(7);
    for (const u of urls) {
      expect(u).not.toMatch(/^(?:[a-z]+:)?\/\//i);
      expect(u.startsWith('/')).toBe(false);
      expect(u).not.toMatch(/^data:/);
    }
    expect(css).not.toMatch(/https?:\/\/[^"')\s]*\.woff2?/);
  });
});
