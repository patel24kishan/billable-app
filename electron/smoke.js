// End-to-end smoke run of the real desktop window (BILLABLE_SMOKE=1).
// Started by scripts/smoke.mjs with a temporary userData folder; never used
// in normal runs. The renderer half runs in the page through
// webContents.executeJavaScript and drives the UI like a user would.
import fs from 'node:fs';
import path from 'node:path';

// Console output that is expected and must not fail the run.
const EXPECTED_CONSOLE = [
  // Our own CSP probe (see rendererSmoke step "CSP is enforced").
  /csp-probe\.invalid/,
  // TEMPORARY until plan step 14 (offline fonts) is merged: index.html still
  // links Google Fonts, which this CSP blocks on purpose (fallback fonts are used).
  // Remove this entry once the <link> to fonts.googleapis.com is gone.
  /Refused to load the stylesheet 'https:\/\/fonts\.googleapis\.com\//
];

/** True for console messages that make the smoke fail: errors and any CSP report. */
export function isProblemMessage(level, message) {
  const text = String(message || '');
  if (EXPECTED_CONSOLE.some((re) => re.test(text))) return false;
  const isError = level === 'error' || level === 3;
  return isError || /Content Security Policy|Refused to /i.test(text);
}

/**
 * Runs inside the page (serialised with Function#toString, so it must be
 * self-contained). Resolves with a list of passed checks; rejects on the first failure.
 */
async function rendererSmoke() {
  const passed = [];
  const fail = (msg) => { throw new Error(msg); };
  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(pred, what, ms = 15000) {
    const t0 = Date.now();
    for (;;) {
      let v = false;
      try { v = pred(); } catch { v = false; }
      if (v) return v;
      if (Date.now() - t0 > ms) fail('timed out waiting for ' + what);
      await sleep(50);
    }
  }
  function idbRequest(req) {
    return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  }

  // Window basics.
  if (document.title !== 'Billable') fail('document.title is ' + JSON.stringify(document.title));
  passed.push('title');
  const navItems = document.querySelectorAll('#nav .nav-item');
  if (navItems.length !== 4) fail('expected 4 nav items, found ' + navItems.length);
  passed.push('nav');

  // Isolation: no Node in the page, only the tiny bridge.
  for (const g of ['require', 'process', 'module', 'Buffer', 'global']) {
    if (typeof window[g] !== 'undefined') fail('renderer exposes Node global ' + g);
  }
  const bridge = window.billableDesktop;
  if (!bridge || typeof bridge.saveFile !== 'function') fail('window.billableDesktop.saveFile missing');
  passed.push('isolation+bridge');

  // Store opened and first snapshot rendered (fresh profile -> empty state shown).
  await waitFor(() => !$('#clientsEmpty').hidden || $('#clientList').children.length > 0, 'the clients list to render');

  // IndexedDB works in this profile.
  const probeDb = await (function () {
    const req = indexedDB.open('billable-smoke-probe', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    return idbRequest(req);
  })();
  await new Promise((resolve, reject) => {
    const tx = probeDb.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('ok', 'k');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  const probeValue = await idbRequest(probeDb.transaction('kv').objectStore('kv').get('k'));
  probeDb.close();
  if (probeValue !== 'ok') fail('IndexedDB read back ' + JSON.stringify(probeValue));
  passed.push('indexeddb');

  // Inline handler allowed by the CSP hash: the setup banner's "Open Settings" link.
  const bannerLink = $('#setupBanner button');
  if (!bannerLink) fail('setup banner link missing');
  bannerLink.click();
  if (!$('#view-settings').classList.contains('active')) fail('inline onclick handler did not run (CSP hash?)');
  passed.push('inline-handler');

  // Add a client through the UI form and read it back from the list and from IndexedDB.
  $('#nav .nav-item[data-view="clients"]').click();
  if (!$('#view-clients').classList.contains('active')) fail('clients view did not open');
  const clientName = 'Smoke Client ' + Date.now();
  $('#clientName').value = clientName;
  $('#clientEmail').value = 'smoke@example.com';
  $('#clientForm').requestSubmit();
  await waitFor(() => Array.from(document.querySelectorAll('#clientList .client-name')).some((el) => el.textContent.includes(clientName)), 'the new client in the list');
  const appDb = await idbRequest(indexedDB.open('billable'));
  const docs = await idbRequest(appDb.transaction('documents').objectStore('documents').getAll());
  appDb.close();
  const stored = docs.find((d) => d.path.startsWith('clients/') && d.data && d.data.name === clientName);
  if (!stored) fail('client not found in IndexedDB');
  if (stored.data.email !== 'smoke@example.com' || !stored.data.updatedAt) fail('stored client has unexpected fields');
  passed.push('client-form+readback');

  // data: images render (receipts are data URLs).
  const img = new Image();
  img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  await img.decode().catch(() => fail('data: image did not load'));
  if (img.naturalWidth !== 1) fail('data: image has width ' + img.naturalWidth);
  passed.push('data-image');

  // CSP is enforced: a remote image is refused before any request is made.
  const violation = new Promise((resolve) => {
    const onViolation = (e) => { if (String(e.blockedURI).includes('csp-probe.invalid')) { document.removeEventListener('securitypolicyviolation', onViolation); resolve(e.violatedDirective); } };
    document.addEventListener('securitypolicyviolation', onViolation);
  });
  const remote = new Image();
  remote.src = 'https://csp-probe.invalid/probe.png';
  const directive = await Promise.race([violation, sleep(5000).then(() => null)]);
  if (!directive || !/img-src/.test(directive)) fail('CSP did not block a remote image (got ' + directive + ')');
  passed.push('csp-enforced');

  // Save bridge rejects bad input in main, without opening a dialog.
  const bad = [
    { filename: 'x.pdf', data: 'not bytes' },
    { filename: '', data: new ArrayBuffer(4) },
    null
  ];
  for (const req of bad) {
    let rejected = null;
    try { await bridge.saveFile(req); } catch (err) { rejected = err; }
    if (!rejected || !/Invalid save request/.test(rejected.message)) fail('saveFile accepted bad input ' + JSON.stringify(req) + ': ' + (rejected && rejected.message));
  }
  passed.push('bridge-validation');

  // Full invoice: log time, preview, generate. jsPDF builds the blob, downloads.js
  // sends it over the bridge, and main (smoke dialog stub) writes it to disk.
  $('#nav .nav-item[data-view="track"]').click();
  const clientId = stored.path.split('/')[1];
  $('#manClient').value = clientId;
  if ($('#manClient').value !== clientId) fail('client missing from the manual entry dropdown');
  $('#manHours').value = '2.5';
  $('#manDesc').value = 'Smoke test work';
  $('#manualForm').requestSubmit();
  await waitFor(() => $('#entriesBody') && $('#entriesBody').textContent.includes('Smoke test work'), 'the manual entry in Recent entries');
  $('#nav .nav-item[data-view="invoices"]').click();
  $('#invClient').value = clientId;
  $('#invPreviewBtn').click();
  await waitFor(() => !$('#invPreviewWrap').hidden && $('#invPreviewBody').textContent.includes('Smoke test work'), 'the invoice preview');
  $('#invGenerateBtn').click();
  await waitFor(() => $('#invoicesBody').textContent.includes(clientName), 'the invoice in the history', 20000);
  passed.push('generate-invoice');

  return passed;
}

/** Source evaluated in the page. */
export const RENDERER_SMOKE_SOURCE = '(' + rendererSmoke.toString() + ')()';

/**
 * Main-process half: runs the renderer checks, then verifies the saved PDF and
 * the console. Resolves with the passed check names or throws.
 */
export async function runSmoke({ win, outDir, problems }) {
  const passed = await win.webContents.executeJavaScript(RENDERER_SMOKE_SOURCE, true);
  const pdfs = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];
  if (pdfs.length !== 1) throw new Error('expected 1 saved PDF, found ' + pdfs.length);
  const bytes = fs.readFileSync(path.join(outDir, pdfs[0]));
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-' || bytes.length < 1000) throw new Error('saved file is not a PDF (' + bytes.length + ' bytes)');
  passed.push('pdf-on-disk (' + pdfs[0] + ', ' + bytes.length + ' bytes)');
  // Let late console messages arrive before judging them.
  await new Promise((r) => setTimeout(r, 300));
  if (problems.length) throw new Error('renderer console problems:\n  ' + problems.join('\n  '));
  passed.push('console-clean');
  return passed;
}
