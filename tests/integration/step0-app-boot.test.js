// Step 0 regression anchor: boots the real app (index.html + src/main.js) in
// jsdom against a fresh fake IndexedDB and drives every screen end to end.
// Written against the pre-refactor main.js and kept green after the split.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
function localToday() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function localMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
function submit(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
function change(el) {
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
const WAIT = { timeout: 4000, interval: 10 };

describe('step 0: app boot characterization', () => {
  let errors;
  let toasts;
  let blobs;
  let toastObserver;
  const onError = (e) => errors.push(e.error || e.message || e);
  const onRejection = (e) => errors.push(e.reason || e);

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    errors = [];
    toasts = [];
    blobs = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return 'blob:test/' + blobs.length; });
    URL.revokeObjectURL = vi.fn();
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    const toastEl = $('#toast');
    toastObserver = new MutationObserver(() => {
      if (!toastEl.hidden) toasts.push({ text: toastEl.textContent, className: toastEl.className });
    });
    toastObserver.observe(toastEl, { attributes: true, childList: true, characterData: true, subtree: true });
  });

  afterEach(() => {
    toastObserver.disconnect();
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    vi.restoreAllMocks();
  });

  const lastToast = () => $('#toast').textContent;
  async function expectToast(text, type) {
    await vi.waitFor(() => {
      expect(toasts.some((t) => t.text === text && (type === undefined || t.className === 'toast' + (type ? ' ' + type : '')))).toBe(true);
    }, WAIT);
  }

  it('boots and drives every screen end to end', async () => {
    await import('../../src/main.js');
    await vi.waitFor(() => expect($('#taxProvince').options.length).toBe(13), WAIT);

    // 1. Initial state
    expect($('#clientsEmpty').hidden).toBe(false);
    expect($('#entriesEmpty').hidden).toBe(false);
    expect($('#expensesEmpty').hidden).toBe(false);
    expect($('#invoicesEmpty').hidden).toBe(false);
    expect($('#setupBanner').hidden).toBe(false);
    expect($('#manDate').value).toBe(localToday());
    expect($('#expDate').value).toBe(localToday());
    expect($('#invMonth').value).toBe(localMonth());
    expect(typeof window.goToView).toBe('function');
    window.goToView('settings');
    expect($('#view-settings').classList.contains('active')).toBe(true);
    expect($('#view-track').classList.contains('active')).toBe(false);
    $('#nav [data-view="clients"]').click();
    expect($('#view-clients').classList.contains('active')).toBe(true);
    expect($('#view-settings').classList.contains('active')).toBe(false);
    expect($('#nav [data-view="clients"]').classList.contains('active')).toBe(true);

    // 2. Settings
    $('#setRate').value = '65';
    $('#taxCountry').value = 'Canada';
    change($('#taxCountry'));
    expect($('#taxProvinceField').hidden).toBe(false);
    $('#taxProvince').value = 'Ontario';
    change($('#taxProvince'));
    $('#setBizName').value = 'Jordan Lee Design';
    $('#saveSettingsBtn').click();
    await expectToast('Settings saved.', 'success');
    await vi.waitFor(() => expect($('#setupBanner').hidden).toBe(true), WAIT);
    expect($('#taxPreview').textContent).toBe('Applied to invoices: HST 13%');

    // 3. Client
    $('#clientName').value = 'Acme';
    submit($('#clientForm'));
    await expectToast('Client added.', 'success');
    for (const sel of ['#timerClient', '#manClient', '#expClient', '#invClient']) {
      const names = Array.from($(sel).options).map((o) => o.textContent);
      expect(names).toContain('Acme');
    }
    expect($('#clientsEmpty').hidden).toBe(true);

    // 4. Timer
    $('#startTimerBtn').click();
    await vi.waitFor(() => expect($('#timerActive').hidden).toBe(false), WAIT);
    expect($('#railTimer').hidden).toBe(false);
    expect($('#timerIdle').hidden).toBe(true);
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 1000000);
    $('#pauseTimerBtn').click();
    await vi.waitFor(() => expect($('#resumeTimerBtn')).not.toBeNull(), WAIT);
    expect($('#resumeTimerBtn').textContent).toContain('Resume');
    $('#stopTimerBtn').click();
    await vi.waitFor(() => expect($('#saveTimerBtn')).not.toBeNull(), WAIT);
    $('#saveTimerBtn').click();
    await expectToast('Saved 0.28 hours to Acme.', 'success');
    nowSpy.mockRestore();
    await vi.waitFor(() => expect($('#timerActive').hidden).toBe(true), WAIT);
    expect($('#timerIdle').hidden).toBe(false);
    expect($('#railTimer').hidden).toBe(true);
    expect($('#entriesBody').querySelectorAll('tr').length).toBe(1);

    // 5. Manual entry and expense
    $('#manHours').value = '1';
    submit($('#manualForm'));
    await expectToast('Entry added.', 'success');
    await vi.waitFor(() => expect($('#entriesBody').querySelectorAll('tr').length).toBe(2), WAIT);
    $('#expTitle').value = 'Paper';
    $('#expAmount').value = '12.50';
    submit($('#expenseForm'));
    await expectToast('Expense added.', 'success');
    await vi.waitFor(() => expect($('#expensesBody').querySelectorAll('tr').length).toBe(1), WAIT);
    expect($('#expSubmitBtn').disabled).toBe(false);
    expect($('#expSubmitBtn').textContent).toBe('Add Expense');

    // 6. Preview
    const acmeId = Array.from($('#invClient').options).find((o) => o.textContent === 'Acme').value;
    $('#invClient').value = acmeId;
    $('#invPreviewBtn').click();
    await vi.waitFor(() => expect($('#invPreviewBody').querySelectorAll('tr').length).toBe(3), WAIT);
    expect($('#invPreviewWrap').hidden).toBe(false);
    const foot = $('#invTotalsFoot').textContent;
    for (const s of ['1.28 hrs', '$95.70', 'HST (13%)', '$12.44', '$108.14']) expect(foot).toContain(s);
    expect($('#invTaxJurisdiction').hidden).toBe(false);
    expect($('#invTaxJurisdiction').textContent).toBe('Tax jurisdiction: Ontario, Canada');

    // 7. Generate
    $('#invGenerateBtn').click();
    await expectToast('Invoice #1 saved.', 'success');
    await vi.waitFor(() => expect($('#invoicesBody').querySelectorAll('tr').length).toBe(1), WAIT);
    await vi.waitFor(() => expect($('#setNextInv').value).toBe('2'), WAIT);
    await vi.waitFor(() => {
      const rows = Array.from($('#entriesBody').querySelectorAll('tr'));
      expect(rows.length).toBe(2);
      rows.forEach((r) => expect(r.textContent).toContain('Invoiced'));
    }, WAIT);
    await vi.waitFor(() => expect($('#invGenerateBtn').textContent).toBe('Generate PDF Invoice'), WAIT);
    expect($('#invGenerateBtn').disabled).toBe(false);
    expect(blobs.length).toBe(1);
    expect(blobs[0].type).toBe('application/pdf');
    expect($('#invoicesEmpty').hidden).toBe(true);
    expect($('#invoicesBody').textContent).toContain('#0001');
    expect($('#invoicesBody').textContent).toContain('Acme');

    // 8. Re-download
    const before = URL.createObjectURL.mock.calls.length;
    $('#invoicesBody [data-redownload]').click();
    await vi.waitFor(() => expect(URL.createObjectURL.mock.calls.length).toBe(before + 1), WAIT);
    expect(blobs[blobs.length - 1].type).toBe('application/pdf');

    // 9. Edit entry
    const editBtn = $('#entriesBody [data-edit-entry]');
    editBtn.click();
    expect($('#editEntryModal').hidden).toBe(false);
    expect(parseFloat($('#editEntryHours').value)).toBeGreaterThan(0);
    $('#editEntryHours').value = '2';
    $('#editEntrySaveBtn').click();
    await expectToast('Entry updated.', 'success');
    expect($('#editEntryModal').hidden).toBe(true);

    // 10. Delete expense
    $('#expensesBody [data-del-exp]').click();
    expect($('#confirmModal').hidden).toBe(false);
    expect($('#confirmText').textContent).toBe('Delete this expense? This can\'t be undone.');
    $('#confirmOkBtn').click();
    await vi.waitFor(() => expect($('#expensesBody').querySelectorAll('tr').length).toBe(0), WAIT);
    expect($('#expensesEmpty').hidden).toBe(false);
    expect($('#confirmModal').hidden).toBe(true);

    // 11. No errors
    expect(errors).toEqual([]);
    expect(toasts.filter((t) => t.className.includes('error'))).toEqual([]);
    expect(lastToast()).toBeTypeOf('string');
  });
});
