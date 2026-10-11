// Pure, injectable logic behind the `billable:save-file` IPC handler
// (no Electron imports, unit-tested with a fake dialog and fs).
//
// The renderer only sends { filename, data }. The filename is reduced to a
// safe base name; the folder always comes from the native save dialog shown
// by the main process, so the renderer can never choose where bytes land.

export const SAVE_FILE_CHANNEL = 'billable:save-file';
export const MAX_SAVE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_NAME_LENGTH = 120;
const FALLBACK_NAME = 'invoice.pdf';
// Windows device names that cannot be used as a file name (with any extension).
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A safe file base name for the save dialog's default path: no folders,
 * no characters Windows rejects, no control characters, not a reserved
 * device name, bounded length, and always ending in ".pdf".
 */
export function sanitizeFilename(name) {
  let s = typeof name === 'string' ? name : '';
  // Keep only the last path segment (both separators), then drop bad characters.
  s = s.split(/[\\/]/).pop();
  s = s.replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '-');
  s = s.replace(/\s+/g, ' ').trim();
  if (/\.pdf$/i.test(s)) s = s.slice(0, -4);
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (s.length > MAX_NAME_LENGTH) s = s.slice(0, MAX_NAME_LENGTH).replace(/[.\s]+$/, '');
  if (!s) return FALLBACK_NAME;
  if (RESERVED.test(s.split('.')[0].trim())) s = '_' + s;
  return s + '.pdf';
}

function invalid(reason) {
  return Object.assign(new Error('Invalid save request: ' + reason), { code: 'invalid' });
}

/** The payload bytes as a Uint8Array, or throws an `invalid` error. */
export function toBytes(data) {
  let bytes;
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') bytes = new Uint8Array(data);
  else if (data instanceof Uint8Array || Object.prototype.toString.call(data) === '[object Uint8Array]') bytes = data;
  else throw invalid('data must be an ArrayBuffer or Uint8Array');
  if (bytes.byteLength === 0) throw invalid('data is empty');
  if (bytes.byteLength > MAX_SAVE_BYTES) throw invalid('data is larger than ' + MAX_SAVE_BYTES / (1024 * 1024) + ' MB');
  return bytes;
}

/** Validates the renderer's request; returns { filename, bytes } or throws an `invalid` error. */
export function validateSaveRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw invalid('expected { filename, data }');
  if (typeof request.filename !== 'string' || !request.filename.trim()) throw invalid('filename must be a non-empty string');
  if (request.filename.length > 1000) throw invalid('filename is too long');
  return { filename: sanitizeFilename(request.filename), bytes: toBytes(request.data) };
}

/**
 * Builds the IPC handler. Dependencies:
 *  dialog.showSaveDialog(parentWindowOrNull, options) -> { canceled, filePath }
 *  fs.writeFile(path, bytes) -> Promise
 *  joinPath(dir, name) -> string
 *  getDownloadsPath() -> string
 *  getWindow(event) -> parent window or null
 *  isTrustedSender(event) -> boolean (the request comes from the app's own page)
 * The handler resolves { saved: true, path } or { canceled: true }, and rejects on
 * invalid input, an untrusted sender, or a write error.
 */
export function createSaveFileHandler(deps) {
  const { dialog, fs, joinPath, getDownloadsPath, getWindow = () => null, isTrustedSender = () => true } = deps;
  return async function handleSaveFile(event, request) {
    if (!isTrustedSender(event)) throw Object.assign(new Error('Save request from an untrusted page was refused'), { code: 'untrusted' });
    const { filename, bytes } = validateSaveRequest(request);
    const options = {
      title: 'Save invoice',
      defaultPath: joinPath(getDownloadsPath(), filename),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    };
    const parent = getWindow(event);
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (!result || result.canceled || typeof result.filePath !== 'string' || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, bytes);
    return { saved: true, path: result.filePath };
  };
}
