// Saving a generated file, matching the shape the app expects:
// downloadsCap.save({ filename, data: Blob }) -> Promise<void>
//
// Desktop app (Electron): the preload exposes window.billableDesktop.saveFile,
// which shows a native save dialog in the main process. A canceled dialog
// rejects with code 'declined' so callers record nothing.
// Browser: a normal download through a temporary blob link (unchanged).

function declined() {
  return Object.assign(new Error('Download declined'), { code: 'declined' });
}

function blobToArrayBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function desktopBridge() {
  const bridge = typeof window !== 'undefined' ? window.billableDesktop : undefined;
  return bridge && typeof bridge.saveFile === 'function' ? bridge : null;
}

function saveWithBridge(bridge, { filename, data }) {
  return blobToArrayBuffer(data)
    .then((buffer) => bridge.saveFile({ filename, data: buffer }))
    .then((result) => {
      if (result && result.saved) return;
      if (result && result.canceled) throw declined();
      throw new Error('The file could not be saved.');
    });
}

function saveWithBrowser({ filename, data }) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser a moment to pick up the blob before revoking it.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    resolve();
  });
}

export function createDownloads() {
  return {
    save(request) {
      const bridge = desktopBridge();
      return bridge ? saveWithBridge(bridge, request) : saveWithBrowser(request);
    }
  };
}
