// A real browser download, matching the shape the app expects:
// downloadsCap.save({ filename, data: Blob }) -> Promise<void>

export function createDownloads() {
  return {
    save({ filename, data }) {
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
  };
}
