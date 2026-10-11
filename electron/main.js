// Electron main process for the Billable desktop app.
// The renderer is the existing Vite build (dist/index.html), loaded with
// loadFile. It gets no Node access: contextIsolation + sandbox, and the
// preload exposes only window.billableDesktop.saveFile (see preload.cjs).
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, session, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCsp } from './csp.js';
import { SAVE_FILE_CHANNEL, createSaveFileHandler } from './fileSave.js';
import { classifyNavigation, classifyWindowOpen, isAppUrl } from './navigation.js';
import { resolveSmokeUserData } from './smokeGuard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.env.BILLABLE_SMOKE === '1';
const SMOKE_TIMEOUT_MS = 60_000;
// Smoke exit codes: 0 ok, 1 a check failed, 2 hard timeout, 3 page failed to load / crashed,
// 4 BILLABLE_USER_DATA_DIR refused (not inside the temp folder).
const EXIT = { ok: 0, failed: 1, timeout: 2, load: 3, userData: 4 };

// Dev server URL (electron:dev only, never in a packaged app): http(s) only.
function devUrlFromEnv() {
  const raw = process.env.BILLABLE_DEV_URL;
  if (!raw || app.isPackaged) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
const DEV_URL = devUrlFromEnv();
const INDEX_HTML = path.join(app.getAppPath(), 'dist', 'index.html');
const APP_URL = DEV_URL || pathToFileURL(INDEX_HTML).href;

// The smoke run must never touch real app data: its userData folder is a fresh
// temp folder, or BILLABLE_USER_DATA_DIR only when that is inside the temp folder.
// Anything else stops here (exit 4) before a window opens or any file is written.
let smokeOutDir = null;
let smokeRefused = false;
if (SMOKE) {
  const res = resolveSmokeUserData({
    envDir: process.env.BILLABLE_USER_DATA_DIR,
    tmpdir: os.tmpdir(),
    realpath: fs.realpathSync.native,
    mkdtemp: fs.mkdtempSync
  });
  if (!res.ok) {
    smokeRefused = true;
    console.error(res.error);
    app.exit(EXIT.userData);
  } else {
    app.setPath('userData', res.dir);
    smokeOutDir = path.join(res.dir, 'smoke-out');
    fs.mkdirSync(smokeOutDir, { recursive: true });
    setTimeout(() => smokeExit(EXIT.timeout, 'SMOKE FAIL: hard timeout after ' + SMOKE_TIMEOUT_MS / 1000 + ' s'), SMOKE_TIMEOUT_MS).unref();
  }
}

function smokeExit(code, message) {
  (code === EXIT.ok ? console.log : console.error)(message);
  app.exit(code);
}

let mainWindow = null;

// Single instance (per userData folder, so a smoke run never collides with the real app).
if (smokeRefused) {
  // app.exit() above already ends the process; never take the lock or open a window.
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

app.on('window-all-closed', () => app.quit());

// Every web contents (including any the page might try to create): no webviews,
// navigation limited to the app page, http(s) links go to the system browser.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  const guard = (e, url) => {
    const decision = classifyNavigation(url, APP_URL);
    if (decision === 'allow') return;
    e.preventDefault();
    if (decision === 'external') shell.openExternal(url).catch(() => {});
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => {
    if (classifyWindowOpen(url, APP_URL) === 'external') shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
});

function isTrustedSender(event) {
  const frame = event.senderFrame;
  return !!frame && frame === event.sender.mainFrame && isAppUrl(frame.url, APP_URL);
}

function smokeDialog() {
  // Stand-in for the native dialog during the smoke run: "saves" into the temp folder.
  return {
    async showSaveDialog(_parentOrOptions, maybeOptions) {
      const options = maybeOptions || _parentOrOptions;
      return { canceled: false, filePath: path.join(smokeOutDir, path.basename(options.defaultPath)) };
    }
  };
}

function registerIpc() {
  ipcMain.handle(SAVE_FILE_CHANNEL, createSaveFileHandler({
    dialog: SMOKE ? smokeDialog() : dialog,
    fs: fs.promises,
    joinPath: path.join,
    getDownloadsPath: () => app.getPath('downloads'),
    getWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    isTrustedSender
  }));
}

function buildMenu() {
  const viewItems = [
    { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    { type: 'separator' }, { role: 'togglefullscreen' }
  ];
  if (!app.isPackaged) viewItems.unshift({ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' });
  return Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: viewItems },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{
        label: 'About Billable',
        click: () => dialog.showMessageBox(mainWindow, {
          type: 'info', title: 'About Billable', message: 'Billable ' + app.getVersion(),
          detail: 'Time tracking and invoicing. Your data stays on this computer.'
        })
      }]
    }
  ]);
}

function applySessionPolicy() {
  const ses = session.defaultSession;
  const csp = buildCsp({ devUrl: DEV_URL });
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  // The app needs no device or browser permissions.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

function createWindow() {
  const problems = [];
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Billable',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12141A' : '#F3F4F7',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  if (SMOKE) {
    const wc = mainWindow.webContents;
    // Electron >= 35: one event object with level ('info'|'warning'|'error'|'debug') and message.
    wc.on('console-message', (e) => {
      const lvl = e.level;
      const msg = e.message;
      if (isProblemMessage(lvl, msg)) problems.push('[' + lvl + '] ' + msg);
      else if (/Refused to|Content Security Policy/.test(String(msg))) console.log('smoke: expected CSP report: ' + String(msg).slice(0, 140));
    });
    wc.on('did-fail-load', (_e, code, desc, url) => smokeExit(EXIT.load, 'SMOKE FAIL: did-fail-load ' + code + ' ' + desc + ' ' + url));
    wc.on('render-process-gone', (_e, details) => smokeExit(EXIT.load, 'SMOKE FAIL: renderer gone (' + details.reason + ')'));
    wc.on('preload-error', (_e, p, err) => smokeExit(EXIT.load, 'SMOKE FAIL: preload error ' + p + ': ' + err.message));
    wc.once('did-finish-load', () => {
      runSmoke({ win: mainWindow, outDir: smokeOutDir, problems })
        .then((passed) => smokeExit(EXIT.ok, 'checks: ' + passed.join(', ') + '\nSMOKE OK'))
        .catch((err) => smokeExit(EXIT.failed, 'SMOKE FAIL: ' + (err && err.message ? err.message : err)));
    });
  }

  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(INDEX_HTML);
}

let runSmoke = null;
let isProblemMessage = null;

async function start() {
  if (SMOKE) ({ runSmoke, isProblemMessage } = await import('./smoke.js'));
  Menu.setApplicationMenu(buildMenu());
  applySessionPolicy();
  registerIpc();
  createWindow();
}
