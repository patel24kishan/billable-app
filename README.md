# Billable — web app

A local-first freelance time-tracking and invoicing web app: track billable hours per client with a start/pause/stop/save timer, log expenses with attached receipt photos, and generate PDF invoices with itemized regional sales tax — all stored entirely in your browser (IndexedDB), no server, no account, no data leaving your device.

## Important: `npm install` has not been run here

This project was written in an environment with no access to the npm registry (the same network policy that blocked the Android project's Gradle/Maven build), so `npm install` / `npm run build` could not actually be executed or verified here. Every file was checked by hand instead — JS syntax validated with `node --check`, every DOM id referenced in `src/main.js` cross-checked against `index.html`, brace/paren balance confirmed — but that's not a substitute for a real install and build. Run `npm install && npm run build` yourself (below) and fix anything npm or Vite flags; given the scope, a version-range hiccup in `package.json` is plausible, there are no unknown architectural gaps.

This is the same app as the [Billable Android app](../BillableAndroid) — same features, same look, same local-only storage philosophy — built for the desktop/mobile web instead of native Android.

## Stack

- Vanilla JS (no framework) + [Vite](https://vitejs.dev) for dev server / bundling
- [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) for PDF invoice generation
- IndexedDB for local persistence (see `src/lib/localDb.js`) — a small Firestore-shaped client (`collection`/`doc`, `where`/`orderBy`/`limit`, `onSnapshot`, `get`/`set`/`update`/`delete`) backed by a single IndexedDB object store, so the app logic reads like it's talking to a real backend even though everything stays on-device.
- A real browser download (`src/lib/downloads.js`) for saving generated invoice PDFs.

## Getting started

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Data is stored in your browser's IndexedDB, scoped to whatever origin you're running on — so `localhost:5173` in dev and your deployed domain in production are separate stores. Clearing your browser's site data for that origin clears the app's data too.

## Building for production

```bash
npm run build
```

Outputs a static site to `dist/` — plain HTML/CSS/JS, deployable anywhere that serves static files (GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3, your own server). No build-time secrets, no server-side code, no environment variables required.

```bash
npm run preview
```

Serves the `dist/` build locally, to sanity-check the production bundle before deploying.

## First run

1. Open **Settings** first — enter your hourly rate, currency symbol, and business name/email/address (shown as the "from" on invoices).
2. If you charge sales tax, set it up in the same screen — pick Canada and your province for an auto-filled rate, or enter your own rate(s) for anywhere else.
3. Add at least one client under **Clients**.
4. Track time from **Track Time** (timer or manual entry) and log any expenses there too.
5. Generate a PDF from **Invoices** — pick a client and month, Preview, then Generate. It downloads straight to your browser's normal downloads location.

## Notes on scope

- **Tax rates**: the Canadian table (HST/GST+PST/GST+QST/GST-only by province) was checked against current rates as of September 2026, including Nova Scotia's HST cut from 15% to 14% (effective April 2025) — but tax rates change with every budget, so double-check before relying on it for a real filing. Everywhere outside Canada uses your own manually-entered rate(s), since no single table could stay accurate for every country's sales tax.
- **Data lives in this browser only** — there's no cloud sync or account. It survives page reloads and browser restarts (IndexedDB is durable local storage, not session-only), but it's tied to one browser on one device: it won't show up on your phone, and clearing that browser's site data or switching browsers/computers starts fresh. Back up anything important by generating and saving invoice PDFs as you go, or by exporting your browser's IndexedDB data if you need a raw backup.
- **No server, no account, no analytics.**

## Project structure

```
index.html            — page shell / markup for all four views (Track, Clients, Invoices, Settings)
src/main.js            — all app logic: timer, clients, expenses, entries, invoice generation, tax rules
src/style.css           — all styling (light/dark theme via CSS variables, follows system preference)
src/lib/localDb.js      — IndexedDB-backed local "database" client
src/lib/downloads.js    — browser file-download helper
```

## Desktop app (Windows)

The same app also ships as a Windows desktop app (Electron). It runs fully offline, keeps its data on your computer, and has no account, no sync and no auto-update.

### Run it in development

```bash
npm install
npm run electron:dev     # vite build, then opens the app window (electron .)
```

`npm run electron:start` opens the window on the existing `dist/` build without rebuilding.

### Build the installer

```bash
npm run dist             # vite build + electron-builder (NSIS, Windows x64)
```

Output in `release/`:

- `Billable-Setup-1.0.0.exe` — the installer (about 90 MB). This is the file to give to users.
- `win-unpacked/Billable.exe` — the unpacked app, for testing without installing.
- `Billable-Setup-1.0.0.exe.blockmap`, `builder-debug.yml` — build by-products; not needed for installing.

electron-builder downloads the Electron runtime and the NSIS tools from GitHub on the first build (cached in `%LOCALAPPDATA%\electron-builder\Cache`), so the first `npm run dist` needs network access. The packaged app contains only `dist/` (without source maps), `electron/` and `package.json`.

### Install

1. Run `Billable-Setup-1.0.0.exe`.
2. **Windows SmartScreen:** the installer is not code-signed, so Windows may show "Windows protected your PC". Click **More info**, then **Run anyway**. (Only do this for an installer you built yourself or got from a source you trust.)
3. Choose **Only for me** (the default; no administrator rights needed). "Anyone who uses this computer" is also offered but asks for administrator rights.
4. Pick the install folder (default for "Only for me": `%LOCALAPPDATA%\Programs\Billable`) and finish. The installer creates a desktop shortcut and a Start-menu entry named **Billable**.

### Where your data lives

The desktop app stores its data (IndexedDB) in Electron's user-data folder: **`%APPDATA%\billable`** (for example `C:\Users\<you>\AppData\Roaming\billable`). The folder is named after the package `name` (`billable`); Windows paths are not case-sensitive, so `%APPDATA%\Billable` is the same folder. This data is separate from the browser version's data; nothing is migrated between them. Saved invoice PDFs go wherever you choose in the save dialog (default: your Downloads folder).

### Uninstall

Open **Settings → Apps → Installed apps**, find **Billable**, and choose **Uninstall** (or run "Uninstall Billable.exe" in the install folder). The uninstaller removes the program files and the shortcuts but **keeps your data** in `%APPDATA%\billable` (`deleteAppDataOnUninstall` is deliberately off), so reinstalling brings your clients, entries and invoices back. To erase the data too, delete that folder by hand after uninstalling. Invoice PDFs you saved are never touched.

### Smoke test

```bash
npm run smoke                                              # dev layout: vite build, then electron . with BILLABLE_SMOKE=1
node scripts/smoke.mjs release/win-unpacked/Billable.exe   # the packaged app (after npm run dist)
```

The smoke run uses a fresh temporary user-data folder (the app refuses any folder outside the temp folder), adds a client, generates an invoice, saves the PDF into that temp folder, prints `SMOKE OK` and exits 0. Stack traces mentioning "Invalid save request" on stderr are expected (the smoke sends deliberately bad save requests).

### Notes

- **Placeholder icon:** `build/icon.png` (a blue tile with a white "B") is a placeholder made by `npm run icon` (`scripts/make-icon.mjs`, no dependencies). Replace it with a real logo (PNG, at least 512x512) before a public release; electron-builder converts it to the Windows `.ico`. Re-running the generator overwrites a replaced icon.
- **No auto-update:** publishing is disabled (`"publish": null`); to update, build a newer installer and run it over the old install (your data is kept).
- **Node 24 and the `electron` package:** on Node 24 the `electron` package's install step can finish without unpacking the runtime (`extract-zip` fails silently), and then `npm run electron:dev` / `npm run smoke` fail with "Electron failed to install correctly". Workaround: take the zip the install downloaded into `%LOCALAPPDATA%\electron\Cache`, check its SHA-256 against `node_modules/electron/checksums.json`, extract it into `node_modules/electron/dist`, and make sure `node_modules/electron/path.txt` contains `electron.exe`. `npm run dist` is not affected: electron-builder downloads and unpacks its own copy of Electron.

## License

MIT — see [LICENSE](./LICENSE).
