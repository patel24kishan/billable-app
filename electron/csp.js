// Content-Security-Policy for the desktop window (pure, unit-tested).
//
// The packaged app needs only its own files ('self'), inline styles (the UI
// sets style="" attributes), data:/blob: images (receipts are data URLs) and
// self/data fonts. No network origins are allowed: the desktop app is
// local-first; the fonts are bundled with the app (plan step 14), so nothing
// is fetched from the network.
import { createHash } from 'node:crypto';

/**
 * Inline event-handler attributes that index.html still uses. CSP 'unsafe-hashes'
 * allows exactly these handler bodies and nothing else (a unit test checks that
 * every on*="" attribute in index.html is listed here).
 */
export const INLINE_HANDLERS = ["goToView('settings')"];

export function sha256Source(code) {
  return "'sha256-" + createHash('sha256').update(code, 'utf8').digest('base64') + "'";
}

/**
 * Builds the policy string. `devUrl` (http://host:port of the Vite dev server,
 * only for `electron:dev`) adds that origin for scripts and its HMR websocket.
 */
export function buildCsp({ devUrl } = {}) {
  const scriptSrc = ["'self'", "'unsafe-hashes'", ...INLINE_HANDLERS.map(sha256Source)];
  const connectSrc = ["'self'"];
  if (devUrl) {
    const origin = new URL(devUrl).origin;
    const ws = origin.replace(/^http/, 'ws');
    scriptSrc.push(origin);
    connectSrc.push(origin, ws);
  }
  const directives = {
    'default-src': ["'none'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connectSrc,
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"]
  };
  return Object.entries(directives).map(([k, v]) => k + ' ' + v.join(' ')).join('; ');
}
