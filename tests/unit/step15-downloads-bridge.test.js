// Step 15: src/lib/downloads.js uses the desktop bridge when present
// (window.billableDesktop.saveFile) and keeps the browser download otherwise.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createDownloads } from '../../src/lib/downloads.js';

const pdfBlob = () => new Blob([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 51])], { type: 'application/pdf' }); // "%PDF-1.3"

afterEach(() => {
  delete window.billableDesktop;
  vi.restoreAllMocks();
});

describe('step 15: downloads.js with the desktop bridge', () => {
  it('sends the filename and the Blob bytes as an ArrayBuffer and resolves when saved', async () => {
    const saveFile = vi.fn(async () => ({ saved: true, path: 'C:\\Users\\me\\Downloads\\Invoice.pdf' }));
    window.billableDesktop = { saveFile };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await expect(createDownloads().save({ filename: 'Invoice-0001-Acme-2026-10.pdf', data: pdfBlob() })).resolves.toBeUndefined();
    expect(saveFile).toHaveBeenCalledTimes(1);
    const arg = saveFile.mock.calls[0][0];
    expect(arg.filename).toBe('Invoice-0001-Acme-2026-10.pdf');
    expect(Object.prototype.toString.call(arg.data)).toBe('[object ArrayBuffer]');
    expect(Array.from(new Uint8Array(arg.data))).toEqual([37, 80, 68, 70, 45, 49, 46, 51]);
    expect(Object.keys(arg).sort()).toEqual(['data', 'filename']);
    expect(click).not.toHaveBeenCalled(); // no browser download in the desktop app
  });

  it('a canceled dialog rejects with code "declined"', async () => {
    window.billableDesktop = { saveFile: vi.fn(async () => ({ canceled: true })) };
    const err = await createDownloads().save({ filename: 'a.pdf', data: pdfBlob() }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('declined');
    expect(err.message).toBe('Download declined');
  });

  it('an unexpected bridge result or an IPC error rejects without the declined code', async () => {
    window.billableDesktop = { saveFile: vi.fn(async () => ({})) };
    const odd = await createDownloads().save({ filename: 'a.pdf', data: pdfBlob() }).catch((e) => e);
    expect(odd).toBeInstanceOf(Error);
    expect(odd.code).not.toBe('declined');

    window.billableDesktop = { saveFile: vi.fn(async () => { throw new Error('EACCES: permission denied'); }) };
    const failed = await createDownloads().save({ filename: 'a.pdf', data: pdfBlob() }).catch((e) => e);
    expect(failed.message).toContain('EACCES');
    expect(failed.code).not.toBe('declined');
  });

  it('the bridge is looked up at save time (a downloads object made earlier still uses it)', async () => {
    const downloads = createDownloads();
    const saveFile = vi.fn(async () => ({ saved: true, path: 'x' }));
    window.billableDesktop = { saveFile };
    await downloads.save({ filename: 'a.pdf', data: pdfBlob() });
    expect(saveFile).toHaveBeenCalledTimes(1);
  });
});

describe('step 15: downloads.js without the bridge (browser, unchanged)', () => {
  it('clicks a temporary blob link with the filename and revokes the URL later', async () => {
    vi.useFakeTimers();
    try {
      const created = [];
      URL.createObjectURL = vi.fn(() => 'blob:test/1');
      URL.revokeObjectURL = vi.fn();
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { created.push({ href: this.href, download: this.download, inDoc: document.body.contains(this) }); });
      await createDownloads().save({ filename: 'Invoice-0002.pdf', data: pdfBlob() });
      expect(click).toHaveBeenCalledTimes(1);
      expect(created[0]).toEqual({ href: 'blob:test/1', download: 'Invoice-0002.pdf', inDoc: true });
      expect(document.querySelectorAll('a[download]').length).toBe(0);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4000);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a billableDesktop object without a saveFile function', async () => {
    window.billableDesktop = {};
    URL.createObjectURL = vi.fn(() => 'blob:test/2');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await createDownloads().save({ filename: 'b.pdf', data: pdfBlob() });
    expect(click).toHaveBeenCalledTimes(1);
  });
});
