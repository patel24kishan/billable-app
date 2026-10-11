// @vitest-environment node
// Step 15: URL policy of the desktop window (electron/navigation.js).
import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { classifyNavigation, classifyWindowOpen, isAppUrl, isExternalWebUrl } from '../../electron/navigation.js';

const APP = pathToFileURL('C:\\Program Files\\Billable\\resources\\app.asar\\dist\\index.html').href;
const DEV = 'http://localhost:5173/';

describe('step 15: navigation policy (packaged file:// app)', () => {
  it('allows the app\'s own index.html, with or without hash/query', () => {
    expect(classifyNavigation(APP, APP)).toBe('allow');
    expect(classifyNavigation(APP + '#clients', APP)).toBe('allow');
    expect(classifyNavigation(APP + '?x=1', APP)).toBe('allow');
    expect(isAppUrl(APP.replace('Program%20Files', 'Program Files'), APP)).toBe(true);
  });

  it('opens http and https links externally', () => {
    expect(classifyNavigation('https://example.com/help', APP)).toBe('external');
    expect(classifyNavigation('http://example.com', APP)).toBe('external');
    expect(isExternalWebUrl('https://example.com')).toBe(true);
  });

  it.each([
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'file:///C:/Program%20Files/Billable/resources/app.asar/dist/other.html',
    'file://evil-server/share/index.html',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:file:///abc',
    'about:blank',
    'mailto:someone@example.com',
    'ms-settings:privacy',
    'chrome://settings',
    'ftp://example.com/x',
    'not a url',
    '',
    'http://'
  ])('denies %j', (url) => {
    expect(classifyNavigation(url, APP)).toBe('deny');
    expect(classifyWindowOpen(url, APP)).toBe('deny');
  });

  it('new windows are never opened inside the app', () => {
    expect(classifyWindowOpen(APP, APP)).toBe('deny');
    expect(classifyWindowOpen(APP + '#x', APP)).toBe('deny');
    expect(classifyWindowOpen('https://example.com', APP)).toBe('external');
  });

  it('is not fooled by look-alike paths', () => {
    expect(isAppUrl(APP.replace('dist/index.html', 'dist/../index.html'), APP)).toBe(false);
    expect(isAppUrl(APP.replace('index.html', 'index.html.evil'), APP)).toBe(false);
    expect(isAppUrl('https://index.html', APP)).toBe(false);
  });
});

describe('step 15: navigation policy (electron:dev with BILLABLE_DEV_URL)', () => {
  it('allows the dev server origin and nothing else in-app', () => {
    expect(classifyNavigation('http://localhost:5173/', DEV)).toBe('allow');
    expect(classifyNavigation('http://localhost:5173/index.html#x', DEV)).toBe('allow');
    expect(classifyNavigation('http://localhost:5174/', DEV)).toBe('external');
    expect(classifyNavigation('https://localhost:5173/', DEV)).toBe('external');
    expect(classifyNavigation('file:///C:/x/index.html', DEV)).toBe('deny');
  });

  it('a bad app URL allows nothing', () => {
    expect(isAppUrl('http://localhost:5173/', 'not a url')).toBe(false);
    expect(isAppUrl('ms-settings:x', 'ms-settings:x')).toBe(false);
  });
});
