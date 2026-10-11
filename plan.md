# Plan: bring android-version fixes and behavior into the web app (branch desktop-version)

Status: IMPLEMENTED on branch desktop-version (steps 0-12, one commit per step, nothing pushed). Where this plan and the code differ, see "Implementation notes" at the end.

## Background
- The web app (master / desktop-version) already has every feature in the Android README: timer (start/pause/stop/save), expenses with receipts, regional tax, PDF invoices with receipt pages, invoice snapshots and re-download.
- Three comparison agents read the Android Kotlin code against `src/main.js`; an Opus reviewer then verified each claim against the code and ran PDF tests with the installed jsPDF 2.5.2 / jspdf-autotable 3.8.4.
- Result: no missing features, but several real bugs and validation/ordering gaps in the web app.
- Out of scope (Android-only): foreground timer service, notification, home-screen widget, share sheet, FileProvider.

## Files touched
`src/main.js` (most items), `src/lib/localDb.js` (C2 and the store seam), `index.html` (C5, D1, D2). Phase 0 splits `main.js` into modules (see Future-proofing).

## Future-proofing for cloud sync + login + Android (design only; NO cloud code now)
Confirmed with you: a later Android app will use cloud save and login to sync across devices. Not now, but every change below must leave room for it.

Principles
- **One data seam.** All persistence goes through a single repository interface (the Firestore-shaped `localDb.js` API already is that seam). UI code never touches IndexedDB directly. Later, a cloud adapter implements the same interface (`LocalStore` now, `CloudStore` or a `SyncStore` wrapper later).
- **Sync-ready records.** Every record keeps a stable string `id` (already random `id_...`, good for merging across devices), `createdAt`, and gains `updatedAt` (ISO UTC) and `schemaVersion`. Deletes will become soft deletes (`deletedAt`) when sync arrives; until then the code calls a `remove()` method so the change stays inside the data layer.
- **Per-user ownership.** Collections are addressed through one place (`store.collection(name)`), so a `users/{uid}/...` path prefix can be added later without touching screens.
- **Receipts as blobs.** Receipt images are kept behind a small `receipts` interface (get/put/remove by id). Today it stores the data URL on the expense, as now. Later it can point at cloud storage. D1/D2 and the invoice snapshot must go through this interface, not read `receiptData` directly.
- **Portable formats.** Dates stay ISO strings, money stays numbers rounded to cents, tax rates stay fractions. Android's SQLite uses integer ids and file-path receipts, so a versioned JSON export/import (`schemaVersion`, all collections, receipts inline) is the agreed interchange format when the two apps meet. Not built now.
- **Pure logic, separate from UI.** Totals, tax, rounding, date helpers and ordering live in plain modules with no DOM access, so they can be unit-tested and reused by a desktop shell or a future shared package.
- **Timer state is per device.** The running timer (`state/timer`) stays local to each device and is not synced; only the saved entry is.
- **Auth-free today.** No login UI, no network calls, no keys. A single `getCurrentUser()` stub returning a local user keeps the call sites ready.

Planned module layout (`src/`)
- `lib/store/` : `localStore.js` (current `localDb.js`), `index.js` exports `createStore()`; later `cloudStore.js`, `syncStore.js`
- `lib/receipts.js` : receipt blob interface
- `lib/schema.js` : collection names, `schemaVersion`, record normalizers (add `updatedAt`, defaults)
- `domain/` : `money.js`, `tax.js` (tables + `getEffectiveTaxLines`), `invoiceTotals.js` (single `computeInvoiceTotals`, used by preview and PDF, fixes B1), `timer.js` (state machine), `dates.js` (local date helpers, fixes C1)
- `services/` : `invoicePdf.js` (`buildPdfDoc`), `invoices.js` (generate, snapshot, mark invoiced), `exportImport.js` (later)
- `ui/` : one file per screen (`track.js`, `clients.js`, `invoices.js`, `settings.js`), plus `ui/dialogs.js`, `ui/toast.js`
- `main.js` : boot only (create store, wire screens)

## Execution protocol (authoritative; plan.md is the only blueprint)
Decisions confirmed by you: Phase 0 runs first; Phase 5 polish is included as the last step; the receipt choice is per invoice (D1); only expenses are editable from the preview (D2). For B7 the plan pins the en-US date format (matches Android) and pins `money()` too so screen and PDF agree.

Test harness (already set up): vitest + jsdom + fake-indexeddb, `npm test`, files under `tests/unit/` and `tests/integration/`, `tests/setup.js` gives each run an in-memory IndexedDB.

Roles
- **Architect (Opus):** reads only plan.md, assigns one step at a time, reviews each step against the plan, runs the full suite, and approves or sends it back. It does not write feature code.
- **Implementers (Sonnet; Opus for Phase 0, D2, B4):** one step each, run one after another, never in parallel (they share files).

Per-step gate (every step, in order)
1. Implement only that step's items; follow the module layout and sync-readiness rules above.
2. Add unit tests for the step in `tests/unit/` (pure logic) and, where the step touches the store or screens, a test in `tests/integration/` using fake-indexeddb and jsdom. A bug fix needs a test that fails before the fix and passes after.
3. `npm test` and `npm run build` must pass.
4. Cumulative integration: from step 2 onward, `tests/integration/` holds one test file per finished step, and the whole suite is re-run, so step N is always tested together with steps 1..N-1. A failure in an earlier step's test blocks the new step.
5. Architect review of the diff against this plan; fix loop until approved.
6. Commit locally on `desktop-version` (one commit per step, message names the plan ids). No push.

Steps in order
0 Phase 0 restructure | 1 C1 | 2 A1 | 3 C7 | 4 B1 | 5 B2 | 6 C2+M1 | 7 B3 | 8 D1 | 9 D2 | 10 Phase 3 (A3, C4, C6, C5, C3, A2, C8; one test each) | 11 Phase 4 (B6, B5, B4) | 12 Phase 5 (B7, B9, C9)
After step 12: a final full-suite run, build, and a browser click-through of every screen, then a summary to you. Stuck items are reported, not skipped silently.

## Phase 0 (new, first): restructure, no behavior change
0a. Split `main.js` into the modules above and route all data access through the store seam. Add `updatedAt` stamping inside the store on every add/update (invisible to the UI).
0b. Gate: `npm run build` passes and a click-through of every screen behaves as before (timer, clients, entries, expenses, receipt view, preview, generate, re-download). Commit as its own commit on `desktop-version`.
0c. Then Phases 1-5 land inside the new modules. File and line references in this plan point at the current `main.js`; after Phase 0 they map to the module that owns that function.
Why first: B1, C1, C2 and D1/D2 all touch totals, dates, ordering and the preview; doing them in the right modules once is cheaper than fixing them in a 820-line file and moving them later. Risk: a pure refactor can slip in regressions, so it is a separate, reviewable commit. If you would rather not restructure yet, say so and I will do Phases 1-5 in place and keep the seam rules above only for new code.

## Phase 1: data-correctness bugs (do in this order)
1. **C1** Timer-saved entry date uses the UTC date (`main.js:292`), so an evening session west of UTC is saved under the next day and can land in the wrong invoice month. Add `localDateStr(d)`; `todayStr` reuses it; `saveTimerEntry` uses the local date of `startedAt`.
   Verify: node check with `TZ=America/Los_Angeles` on `2026-10-10T03:00:00Z` gives `2026-10-09`.
2. **A1** Editing a client un-archives it (`main.js:192-194`). Send `archived:false` only on add.
   Verify: archive a client, edit it, it stays archived.
3. **C7 (+M2)** Expense edit modal: pick a new receipt, then Remove, still saves the new file (`main.js:442-453`). Remove also clears `#editExpenseReceiptFile`.
4. **B1** PDF totals are rounded once on summed hours (`main.js:621-631`) while the preview and the line rows round per entry, so the PDF subtotal, tax and total can differ by cents. `generateInvoicePdf` will use `computeInvoiceTotals()`. Already-saved invoices are untouched.
   Verify: 3 entries of 1000 s at 65/h: preview 54.60 / 0.84 h; PDF must match.
5. **B2** After a successful generate the preview stays, so a second click creates a duplicate invoice (`main.js:655-672`). Clear preview state on success only (not on a declined download).
6. **C2 + M1** Same-day ordering is random after reload (IndexedDB key order is random `id_...` strings), and invoice line order has the same problem.
   - `localDb.js`: allow chained `.orderBy()`.
   - `main.js:324,394`: `orderBy('date','desc').orderBy('createdAt','desc')`.
   - `main.js:484`: comparator by date asc, then time before expense, then `createdAt` asc, returning 0 on ties.
   Verify: 3 entries on one day, reload several times, order is stable (newest first in lists).
   Risk: every list goes through `queryRef`; regression-check clients, entries, expenses and invoices.

## Phase 2: invoice-flow guard
7. **B3** Changing month, client or the "include already invoiced" box leaves a stale preview on screen. Add one `clearInvoicePreview()` (shared with B2) and call it on `change` of `#invMonth`, `#invClient`, `#invIncludeBilled`. (Do not port Android's behavior of invoicing the spinner's current client.)

### New requests (from you): per-expense receipt choice and editing expenses from the invoice preview
7a. **D1** Per-expense "attach receipt" choice in the invoice preview.
   - In the preview table (`renderInvoicePreview`, `main.js:503-529`; header in `index.html` ~:161-176) each expense row that has a receipt gets a checkbox, default ticked (today's behavior). Expenses without a receipt show no checkbox.
   - Add a "Select all / none" toggle for the receipts column.
   - The choices live in the preview state (`invPreviewRows[i].attachReceipt`). `generateInvoicePdf` (`main.js:632-634`) includes only the ticked receipts; unticked ones add no PDF page. Totals are unchanged.
   - The saved invoice stores only the attached receipts, so Re-download reproduces the same PDF and the record is smaller.
   - Choices reset when the preview is cleared or regenerated (B2/B3). They are not saved on the expense itself. Tell me if you want the choice remembered on each expense.
7b. **D2** Edit expenses from the Invoices tab, before generating.
   - Each expense row in the preview gets an Edit (✎) button that opens the existing edit-expense window (`openEditExpense`, `main.js:432`): date, amount, title, replace/remove receipt.
   - After saving, the preview reloads from the database with the same client, month and checkbox state, so totals, tax and the PDF reflect the edit. Receipt ticks already chosen are kept for unchanged rows.
   - If the edit moves the expense's date outside the selected month, the row drops out of the preview and a toast says so.
   - Needs a small refactor: split the preview's data load (`main.js:471-489`) into a reusable `loadInvoicePreview()` that the Preview button, D2 and B3 all call.
   - Interpretation to confirm: "when creating" means while building the invoice on the Invoices tab. I am not adding a receipt-attach option to the Log-an-expense form on the Track tab.
   - Open question: should time entries also be editable from the preview (hours, description, date)? The plan covers expenses only, as you asked.
   - Verify: tick/untick receipts and generate (pages present or absent, totals equal); edit an expense amount in the preview and confirm the subtotal, tax and PDF change; edit the date out of the month and confirm the row disappears; re-download an invoice and confirm it matches.
   - Order: after B2/B3 and M1 (they touch the same preview code), before Phase 3. Edit modals share the C6/C7 fixes, so do C6/C7 first.

## Phase 3: validation and input parity
8. **A3** Whitespace-only client name: toast "Enter a client name."
9. **C4** Expense add accepts a whitespace-only title: require trimmed title, toast "Enter a title and a valid amount."
10. **C6** Edit modals can save an empty date (`main.js:362,450`): reject with a toast.
11. **C5** `index.html:112` (and `:265`): `step="any" min="0.01"` so 0.33 and 0.01 hours are accepted.
12. **C3** Replace silent returns at `main.js:314,374` with Android's toast wording ("Enter a valid number of hours.").
13. **A2** Client list is case-sensitive; sort `clients` with `localeCompare(..., {sensitivity:'base'})` in the snapshot callback (no localDb change).
14. **C8** Start timer: return unless `timerState.status==='idle'`.

Verify phase: `npm run build`, then click each form with blank, whitespace, 0.33 and 0.01 values.

## Phase 4: PDF layout (one edit to `buildPdfDoc`, order B6, B5, B4)
15. **B6** `billY = Math.max(140, y + 20)` so a long business address cannot overlap BILL TO.
16. **B5** Foot rows use `{content: label, colSpan: 3, styles:{halign:'right'}}`; tax labels such as "QST (9.975%)" currently wrap in the 60 pt Hours column (tested).
17. **B4** `showFoot:'lastPage'` (default repeats totals on every page, tested with 60 rows); add a page-overflow guard before the "Rate / Total hours" line and the notes (tested: with 18 rows the notes fall past the 792 pt page).
Verify: scratchpad `pdftest.mjs` / `pdftest2.mjs` adapted to the new options, then a 40-row invoice in the browser.

## Phase 5: optional polish (ask before doing)
- **B7** Pin en-US date format and 22 pt title to match Android (decide if the desktop app should follow the OS locale instead; if pinned, pin `money()` too).
- **B9** Invoice history limit 100 to 200.
- **C9** "No description" label, "h" suffix in lists, timer in `document.title`.

## Deliberately NOT doing
- B8 (receipts embedded in the invoice record): the web snapshot is more robust than Android, which loses receipts when a file is deleted.
- A4 (negative rate): Android behaves the same.
- A5 (banner wording / tab label): cosmetic.
- Row striping: already applied by the default autotable theme.
- Android bugs not to port: history showing the pre-tax amount, invoicing the spinner's client instead of the previewed one, 46-character description truncation, edit dialogs closing on invalid input.

## Order and conflict notes
- B1 before B2 (both in `generateInvoicePdf`); M1 with C2 before B3; the PDF edits as one change; C7 before the other expense-handler validation edits; C5 with C3.
- Run `npm run build` after each phase; commit per phase on `desktop-version`; no push unless asked.

## Overall order
Phase 0 (restructure), then C1, A1, C7, B1, B2, C2+M1, B3, D1+D2, Phase 3, Phase 4, Phase 5 (if approved).

## Implementation notes (added after implementation)
- D2 tick rule (your decision, step 9b): an expense's "Attach receipt" tick is kept by expense id in every case, including after the receipt is replaced; it defaults to ticked only when there is no previous tick (new row, or a receipt added to an expense that had none). This supersedes the earlier wording "kept for unchanged rows".
- Added beyond this plan: M2 "Clear selected file" control in the expense edit window; preview cleared when the previewed client is deleted; PDF totals amounts right-aligned; notes block starts under the table if it cannot fit even on a fresh page; toast text "Enter a valid date." for C6.
- Known limits: B2 if recording fails partway the preview stays and a second click could duplicate; C2 records missing an orderBy field sort first (a cloud store must backfill createdAt); after renaming a client the preview keeps the old name until Preview is clicked again.
- Open follow-ups: money format in the PDF and invoice history still uses toFixed(2) (no thousands separator) while on-screen money() uses en-US grouping; sync-readiness items not built yet (schemaVersion stamping, getCurrentUser stub, soft deletes, export/import, cloud/sync store).

# Phase 6: Electron desktop app and Windows installer (added by your request)

Goal: ship the web app on `desktop-version` as a Windows desktop app with an installer, keeping the web build working. Same process as before: one step at a time, per-step gate (tests, cumulative suite, build, architect review, one local commit, no push). Steps continue numbering: 13-16.

Decisions (made by the planner; change only if the user says so)
- Electron (not Tauri): no Rust needed; Windows x64 only for now; NSIS installer via electron-builder, per-user install (no admin rights), user can choose the install folder, desktop and Start-menu shortcuts. Output `release/Billable-Setup-<version>.exe`.
- Renderer = the existing Vite build in `dist/` loaded with `loadFile` (Vite `base:'./'` already set). The web build and tests keep working unchanged.
- Data stays in the renderer's IndexedDB (stored in the app's userData folder). It is separate from browser data; no migration.
- No code signing and no auto-update in this phase (Windows SmartScreen will warn on an unsigned installer; document it).
- Security defaults: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, preload exposes only a tiny bridge, navigation and new windows blocked (http/https links open in the system browser via `shell.openExternal`, nothing else), single-instance lock, application menu trimmed (keep Edit/View/Window/Help basics; DevTools only when not packaged).
- Sync-readiness (see Future-proofing): the desktop bridge is a platform seam. UI code never calls Electron APIs directly; it uses `src/lib/downloads.js` (already the seam). Nothing network-related is added.
- Placeholder app icon is generated in the repo (flagged as a placeholder for the user to replace with a real logo).

## Step 13: money formatting consistency (follow-up from the earlier review)
- The PDF (`src/services/invoicePdf.js`: line items, foot rows incl. tax and total, rate line) and the invoice history rows (`src/ui/invoices.js`) must format amounts with the same en-US grouped format as `money()` ("$1,234.50"), using the invoice's own stored `currency` symbol (an invoice snapshot must not depend on current settings). `money(n, currency)` already exists.
- Tests: unit test on `buildPdfDoc` text draws with amounts >= 1000 (both line items and totals) and a history-row integration test; earlier tests (step 11 layout tests) must still pass; update only numeric expectations that legitimately change and list each.

## Step 14: offline fonts
- The page loads Fraunces, IBM Plex Sans and IBM Plex Mono from Google Fonts (`index.html` link). A local-first desktop app must not need the network or leak requests. Replace the link with locally bundled font files (npm `@fontsource` packages or `@fontsource-variable` where available, imported from `src/main.js`/`style.css`; only the weights/subsets actually used: latin). Remove the Google Fonts `<link>` and any `preconnect`s. Keep the same font-family names so `style.css` is unchanged apart from imports.
- Tests: a build test (`npm run build` output contains font files, `dist/index.html` has no `fonts.googleapis.com` / `fonts.gstatic.com`), a jsdom test that `index.html` has no external stylesheet/script URL. Gate: build green, suite green.

## Step 15: Electron shell
Files: `electron/main.js`, `electron/preload.cjs` (preload must be CommonJS for sandbox), `electron/fileSave.js` (pure, injectable logic), `electron/navigation.js` (pure URL policy), package.json changes (`"main": "electron/main.js"`, devDependency `electron`, scripts `electron:dev` (vite build then electron .) and `electron:start`), `.gitignore` adds `release/`. Note the package has `"type":"module"`, so main-process files are ES modules (`.js`) and the preload is `.cjs`.
- Main process: single-instance lock; BrowserWindow with the security defaults above, sensible min size (900x600), title "Billable", background color matching the dark theme, `show` after `ready-to-show`; loads `dist/index.html` (packaged: `app.getAppPath()`-relative); in `electron:dev` it may load the Vite dev URL when `BILLABLE_DEV_URL` is set; block `will-navigate` and `setWindowOpenHandler` per the policy; Content-Security-Policy that allows only `self`, inline styles, `data:`/`blob:` images and self fonts (the app uses data URLs for receipts and blob for PDFs; verify jsPDF blob output and image rendering still work).
- Save bridge (`window.billableDesktop.saveFile({filename, data})` through `ipcMain.handle('billable:save-file')`, preload via `contextBridge`): the main process shows a native save dialog (`dialog.showSaveDialog`, default path = Downloads + sanitized filename, PDF filter) and writes the bytes with `fs.promises.writeFile`; returns `{saved:true, path}` or `{canceled:true}`. Validate input in main (string filename, ArrayBuffer/Uint8Array, size cap e.g. 50 MB), never trust renderer paths. `src/lib/downloads.js` uses the bridge when present (converting the Blob to an ArrayBuffer) and rejects with `Object.assign(new Error('Download declined'), {code:'declined'})` on cancel, which the existing generate flow already handles ("nothing was recorded"); without the bridge it keeps the current browser download.
- Tests: unit tests for `fileSave.js` (injected dialog/fs: saves, cancel, filename sanitising, bad data type, oversize) and `navigation.js` (allow the app's own `file://` URL, `http(s)` opens externally, everything else denied); jsdom test of `downloads.js` with a fake bridge (saved, canceled -> `declined`) and without a bridge (existing behavior); keep all earlier tests green.
- Smoke test (not vitest): `npm run smoke` builds, launches Electron with `BILLABLE_SMOKE=1`; main loads the window, runs a renderer script that checks the nav exists, IndexedDB opens, adds a client through the UI form and reads it back, checks `window.billableDesktop` exists and `document.title === 'Billable'`, prints `SMOKE OK` and exits 0 (non-zero and a message on any failure, hard timeout 60 s). The smoke run must use a temporary userData directory (`--user-data-dir` or `app.setPath`) so it never touches real app data. Must pass on the dev layout.

## Step 16: installer
- Add `electron-builder` (devDependency) and a `build` block in package.json: `appId` `com.billable.desktop`, `productName` `Billable`, `directories.output` `release`, `files` limited to `dist/**`, `electron/**`, `package.json`; `win.target` NSIS x64; `nsis` `oneClick:false`, `perMachine:false`, `allowToChangeInstallationDirectory:true`, `createDesktopShortcut`, `createStartMenuShortcut`; `artifactName` `Billable-Setup-${version}.exe`; icon `build/icon.png` (>=512x512, placeholder generated by a committed node script `scripts/make-icon.mjs`, written to `build/`), `npm run dist` = vite build + electron-builder.
- Run `npm run dist` and verify: `release/Billable-Setup-1.0.0.exe` exists with a plausible size, `release/win-unpacked/Billable.exe` exists, the asar contains `dist/index.html` and `electron/main.js`, no dev files (`tests`, `plan.md`, `node_modules/vitest`, source maps if avoidable) inside. Run the smoke test against the UNPACKED app (`release/win-unpacked/Billable.exe` with `BILLABLE_SMOKE=1`) and confirm `SMOKE OK`. Do NOT run the installer itself and do not install anything on the machine; the user will install it.
- README: add a "Desktop app" section (build, install, SmartScreen note for unsigned installers, data location in `%APPDATA%\Billable`, how to uninstall, what happens to data on uninstall, placeholder icon).
- Tests: a unit test that validates the package.json build config (appId, target, artifactName, files, main path exists); the smoke result is part of the gate. Network note: electron and electron-builder download binaries from GitHub on install/build; if blocked, report it rather than working around it.

## Execution notes for Phase 6
Roles and gate are unchanged (architect Opus reviews and commits; implementers Sonnet, Opus for steps 15-16). The final gate adds: `npm test` 10x, `npm run build`, `npm run smoke`, `npm run dist`, and a list of produced artifacts with sizes. Commit messages "Step N (...)" with the Co-Authored-By line. No push.

## Step 13b: UI requests from the user (executed right after Step 13, before Step 14)
Requested by the user while reviewing the app. Four parts, each with its own tests; implement as ONE step but verify each part (the architect reviews all four together).

13b-1. Edit button on EVERY invoice preview line (reverses the earlier "time rows are out of scope" decision of D2).
- Add a dedicated narrow actions column at the right of the invoice preview table (after Amount) holding the Edit (pencil) button for every row, so the buttons line up in one column. Time rows open the existing edit-entry modal (`openEditEntry(id)` in src/ui/dialogs.js; like `openEditExpense` it must fall back to a direct store read when the entry is not in `state.entries`' 200-row window); expense rows keep opening the edit-expense modal. The expense row's old inline pencil in the description cell moves to the new column (the D1 "Attach receipt" checkbox stays in the description cell).
- After a successful entry save the preview reloads exactly like the expense path (`loadInvoicePreview({keepAttach:true})` via a new `onEntrySaved(cb)` hook in dialogs.js registered by invoices.bind; dialogs must not import ui/invoices). If the edited entry leaves the invoice period (date moved out of the month) the row disappears and a neutral toast says "Entry moved out of this invoice period." Edits made while no preview is showing must not touch or throw.
- Keep B1 totals, B2/B3 clearing, C2/M1 ordering, D1 tick behavior, C6 empty-date check unchanged.
- Accessible labels: aria-label "Edit time entry <date>" / "Edit expense <title>".

13b-2. Column alignment in the invoice preview table.
- The numeric columns (Hours, Amount) have right-aligned values but left-aligned headers, so headers and numbers do not line up, and the footer's "32.00 hrs" overflows the Hours column. Right-align the `Hours` and `Amount` headers with their values (use the existing numeric cell class), make the footer Subtotal hours cell fit inside the Hours column without clipping or overflow (e.g. widen the column or use a compact "32.00 h" only if it cannot fit; prefer keeping "hrs"), keep the footer rows' amounts aligned in the Amount column, and add an empty header cell for the new actions column. Same treatment for any other table in the app whose numeric headers are misaligned with their values (check the Recent entries, Recent expenses and Invoice history tables; fix only misalignment, no other restyling). Verify visually in the browser pane at desktop and at narrow width.

13b-3. Track Time layout: move the "Log time by hand" card above the "Log an expense" card. If each form has its own "Recent" list below it, the list moves with its form, so the order becomes: timer, log time by hand, recent entries, log an expense, recent expenses (inspect index.html first and keep each form with its own list; if the lists are in one shared card, move only the two form cards). Markup move only, no id changes, tab order and labels unchanged.

13b-4. Month filter for Recent entries.
- Above the Recent entries table add a month picker (`input type="month"`, labelled "Month") and an "All months" button. Default = all months, i.e. today's behavior (newest 200). When a month is chosen, the list shows only that month's entries (date >= first day and <= last day, using `monthRange`), still ordered newest first with the C2 ordering, and a muted summary shows "<Month Year> · <total hours>h" (sum of the filtered entries' hours, rounded like elsewhere). "All months" clears the filter and the summary.
- The filter persists across add/edit/delete of entries and timer saves (the list subscription re-queries with the active filter); it is a view filter only: it does not affect the invoice preview, the timer or stored data. Use the store's `where` + chained `orderBy` (no new store features) so the future cloud store can implement the same query. The filter state lives in the track UI module (not in `state.js`); it resets on reload (no persistence needed).
- Empty-month message: "No time logged in <Month Year>." (distinct from the existing empty state).
- Expenses list: not changed (the user asked only for time entries); mention it in the final report as an offer.

Tests for 13b (each must fail on the old code; prove with `git stash push -- src index.html` / `git stash pop`):
- 13b-1 integration: Edit buttons on every row (time and expense) in one column; clicking a time row's edit opens the entry modal; changing hours/description updates the row, footer subtotal/tax/total and the stored entry; moving the date to another month removes the row and shows the toast; a tick unticked on an expense survives a time-entry edit; edit with no preview showing does nothing; store fallback for an entry outside the first 200.
- 13b-2: a unit/jsdom test that header and body cells of numeric columns share the same alignment class/style (assert computed or class equality), the footer hours cell contains the full "<n> hrs" text, the actions header exists; plus a visual check in the browser pane (report what you saw).
- 13b-3: a jsdom test of document order of the two form cards (and lists) in `index.html`; ids unchanged.
- 13b-4 integration: entries across several months, filter October -> only October rows + total hours, filter another month, empty month message, "All months" restores, adding an entry in another month while filtered does not show it but adding one in the filtered month does, editing keeps the filter, the invoice preview is unaffected by the filter.
- Every async test waits for settle points; full suite 10 runs with 0 unhandled errors; `npm run build` green.
