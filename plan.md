# Plan: bring android-version fixes and behavior into the web app (branch desktop-version)

Status: PLAN ONLY. No code has been changed. Implementation starts after approval.

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
