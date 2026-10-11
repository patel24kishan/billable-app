// Pure URL policy for the desktop shell (no Electron imports, unit-tested).
//
// The window may only show the app itself: its own index.html (file://) or,
// in `electron:dev` with BILLABLE_DEV_URL, pages from that dev server origin.
// http(s) links elsewhere open in the system browser; everything else
// (javascript:, data:, other file:// paths, custom schemes ...) is denied.

/** The URL without query string and hash, or null when it cannot be parsed. */
function parse(url) {
  try {
    return new URL(String(url));
  } catch {
    return null;
  }
}

/**
 * True when `url` is the app's own page.
 * - file app: same file path as `appUrl` (query and hash ignored).
 * - dev server app: same origin as `appUrl` (http/https only).
 */
export function isAppUrl(url, appUrl) {
  const u = parse(url);
  const app = parse(appUrl);
  if (!u || !app) return false;
  if (app.protocol === 'file:') {
    return u.protocol === 'file:' && u.host === app.host && decodeURIComponent(u.pathname) === decodeURIComponent(app.pathname);
  }
  if (app.protocol === 'http:' || app.protocol === 'https:') {
    return u.origin === app.origin;
  }
  return false;
}

/** True for plain web links the user may open in the system browser. */
export function isExternalWebUrl(url) {
  const u = parse(url);
  return !!u && (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
}

/**
 * Decision for a navigation or window-open request:
 *  'allow'    - stays in the window (only the app's own page),
 *  'external' - open with shell.openExternal, never inside the app,
 *  'deny'     - drop it.
 */
export function classifyNavigation(url, appUrl) {
  if (isAppUrl(url, appUrl)) return 'allow';
  if (isExternalWebUrl(url)) return 'external';
  return 'deny';
}

/** Decision for window.open / target=_blank: never a new app window. */
export function classifyWindowOpen(url, appUrl) {
  // A second window showing the app itself is not wanted either.
  return classifyNavigation(url, appUrl) === 'external' ? 'external' : 'deny';
}
