// @vitest-environment node
// Step 15: the main-process save handler (electron/fileSave.js) with an
// injected dialog and fs: saves, cancel, filename sanitising, bad input, size cap.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { createSaveFileHandler, sanitizeFilename, validateSaveRequest, MAX_SAVE_BYTES, SAVE_FILE_CHANNEL } from '../../electron/fileSave.js';

const DOWNLOADS = 'C:\\Users\\me\\Downloads';
const bytes = (n = 8) => new Uint8Array(n).fill(65).buffer;

function makeHandler({ dialogResult = { canceled: false, filePath: 'C:\\Users\\me\\Documents\\chosen.pdf' }, trusted = true, win = { id: 1 } } = {}) {
  const dialog = { showSaveDialog: vi.fn(async () => dialogResult) };
  const fs = { writeFile: vi.fn(async () => {}) };
  const handler = createSaveFileHandler({
    dialog, fs,
    joinPath: path.win32.join,
    getDownloadsPath: () => DOWNLOADS,
    getWindow: () => win,
    isTrustedSender: () => trusted
  });
  return { handler, dialog, fs };
}

describe('step 15: save-file handler', () => {
  it('uses the agreed IPC channel name', () => {
    expect(SAVE_FILE_CHANNEL).toBe('billable:save-file');
  });

  it('saves: dialog defaults to Downloads + filename with a PDF filter, writes the bytes, returns the path', async () => {
    const { handler, dialog, fs } = makeHandler();
    const res = await handler({}, { filename: 'Invoice-0001-Acme-2026-10.pdf', data: bytes(10) });
    expect(res).toEqual({ saved: true, path: 'C:\\Users\\me\\Documents\\chosen.pdf' });
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1);
    const [parent, opts] = dialog.showSaveDialog.mock.calls[0];
    expect(parent).toEqual({ id: 1 });
    expect(opts.defaultPath).toBe('C:\\Users\\me\\Downloads\\Invoice-0001-Acme-2026-10.pdf');
    expect(opts.filters).toEqual([{ name: 'PDF document', extensions: ['pdf'] }]);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, written] = fs.writeFile.mock.calls[0];
    expect(writtenPath).toBe('C:\\Users\\me\\Documents\\chosen.pdf');
    expect(written).toBeInstanceOf(Uint8Array);
    expect(written.byteLength).toBe(10);
  });

  it('accepts a Uint8Array as well as an ArrayBuffer', async () => {
    const { handler, fs } = makeHandler();
    await expect(handler({}, { filename: 'a.pdf', data: new Uint8Array([1, 2, 3]) })).resolves.toMatchObject({ saved: true });
    expect(Array.from(fs.writeFile.mock.calls[0][1])).toEqual([1, 2, 3]);
  });

  it('works without a parent window', async () => {
    const { handler, dialog } = makeHandler({ win: null });
    await handler({}, { filename: 'a.pdf', data: bytes() });
    expect(dialog.showSaveDialog.mock.calls[0]).toHaveLength(1);
    expect(dialog.showSaveDialog.mock.calls[0][0].defaultPath).toBe('C:\\Users\\me\\Downloads\\a.pdf');
  });

  it('cancel returns { canceled: true } and writes nothing (also for an empty path)', async () => {
    for (const dialogResult of [{ canceled: true, filePath: '' }, { canceled: false, filePath: '' }, { canceled: false }, null]) {
      const { handler, fs } = makeHandler({ dialogResult });
      await expect(handler({}, { filename: 'a.pdf', data: bytes() })).resolves.toEqual({ canceled: true });
      expect(fs.writeFile).not.toHaveBeenCalled();
    }
  });

  it('a write error rejects (not reported as canceled)', async () => {
    const { handler, fs } = makeHandler();
    fs.writeFile.mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));
    await expect(handler({}, { filename: 'a.pdf', data: bytes() })).rejects.toThrow('EACCES');
  });

  it('rejects bad input before showing a dialog', async () => {
    const bad = [
      undefined, null, 'a.pdf', 42, [], { filename: 'a.pdf' },
      { filename: 'a.pdf', data: 'JVBERi0=' },
      { filename: 'a.pdf', data: [37, 80] },
      { filename: 'a.pdf', data: { byteLength: 4 } },
      { filename: 'a.pdf', data: new Uint16Array(4) },
      { filename: 'a.pdf', data: new ArrayBuffer(0) },
      { filename: '', data: bytes() },
      { filename: '   ', data: bytes() },
      { filename: 7, data: bytes() },
      { filename: 'x'.repeat(1001), data: bytes() }
    ];
    for (const req of bad) {
      const { handler, dialog, fs } = makeHandler();
      const err = await handler({}, req).catch((e) => e);
      expect(err, JSON.stringify(req)).toBeInstanceOf(Error);
      expect(err.code).toBe('invalid');
      expect(err.message).toMatch(/^Invalid save request: /);
      expect(dialog.showSaveDialog).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    }
  });

  it('rejects data over the 50 MB cap and accepts exactly the cap', async () => {
    expect(MAX_SAVE_BYTES).toBe(50 * 1024 * 1024);
    const { handler, dialog } = makeHandler();
    const err = await handler({}, { filename: 'a.pdf', data: new ArrayBuffer(MAX_SAVE_BYTES + 1) }).catch((e) => e);
    expect(err.code).toBe('invalid');
    expect(err.message).toContain('50 MB');
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    await expect(handler({}, { filename: 'a.pdf', data: new ArrayBuffer(MAX_SAVE_BYTES) })).resolves.toMatchObject({ saved: true });
  });

  it('refuses requests from an untrusted sender', async () => {
    const { handler, dialog } = makeHandler({ trusted: false });
    const err = await handler({}, { filename: 'a.pdf', data: bytes() }).catch((e) => e);
    expect(err.code).toBe('untrusted');
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it('never lets the renderer choose the folder', async () => {
    const { handler, dialog } = makeHandler();
    await handler({}, { filename: 'C:\\Windows\\System32\\evil.pdf', data: bytes() });
    await handler({}, { filename: '../../../../etc/passwd', data: bytes() });
    await handler({}, { filename: '\\\\server\\share\\x.pdf', data: bytes() });
    const defaults = dialog.showSaveDialog.mock.calls.map((c) => c[1].defaultPath);
    expect(defaults).toEqual([
      'C:\\Users\\me\\Downloads\\evil.pdf',
      'C:\\Users\\me\\Downloads\\passwd.pdf',
      'C:\\Users\\me\\Downloads\\x.pdf'
    ]);
  });
});

describe('step 15: sanitizeFilename', () => {
  it.each([
    ['Invoice-0001-Acme-2026-10.pdf', 'Invoice-0001-Acme-2026-10.pdf'],
    ['Invoice 12', 'Invoice 12.pdf'],
    ['report.PDF', 'report.pdf'],
    ['a<b>c:d"e|f?g*h.pdf', 'a-b-c-d-e-f-g-h.pdf'],
    ['tab\there\nnew.pdf', 'tab-here-new.pdf'],
    ['  spaced   out  .pdf', 'spaced out.pdf'],
    ['ctrl\u0001char.pdf', 'ctrl-char.pdf'],
    ['dir/sub/file.pdf', 'file.pdf'],
    ['dir\\sub\\file.pdf', 'file.pdf'],
    ['..', 'invoice.pdf'],
    ['', 'invoice.pdf'],
    ['   ', 'invoice.pdf'],
    ['.pdf', 'invoice.pdf'],
    ['trailing dots...', 'trailing dots.pdf'],
    ['.hidden', 'hidden.pdf'],
    ['CON', '_CON.pdf'],
    ['nul.pdf', '_nul.pdf'],
    ['com1.txt', '_com1.txt.pdf'],
    ['lpt9', '_lpt9.pdf'],
    ['console', 'console.pdf'],
    [undefined, 'invoice.pdf'],
    [42, 'invoice.pdf']
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('bounds the length and still ends in .pdf', () => {
    const out = sanitizeFilename('a'.repeat(500) + '.pdf');
    expect(out.length).toBeLessThanOrEqual(124);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('validateSaveRequest returns the sanitised name and the bytes', () => {
    const { filename, bytes: b } = validateSaveRequest({ filename: 'x/y:z.pdf', data: new Uint8Array([9]).buffer });
    expect(filename).toBe('y-z.pdf');
    expect(Array.from(b)).toEqual([9]);
  });
});
