// Preload (sandboxed, CommonJS). Exposes one tiny bridge to the page and
// nothing else: no ipcRenderer, no Node APIs. The main process validates
// every request again (electron/fileSave.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('billableDesktop', {
  /** saveFile({ filename, data: ArrayBuffer|Uint8Array }) -> { saved: true, path } | { canceled: true } */
  saveFile(request) {
    const req = request && typeof request === 'object'
      ? { filename: request.filename, data: request.data }
      : request;
    return ipcRenderer.invoke('billable:save-file', req);
  }
});
