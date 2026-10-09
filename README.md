# Billable — Android source project

A native Android (Kotlin) time-tracking and invoicing app: track billable hours per client with a start/pause/stop/save timer (including a home-screen widget), log expenses with attached receipt photos, and generate PDF invoices with itemized sales tax — all stored locally on the device (SQLite, no server, no account).

## Important: this project has not been compiled

This project was written and reviewed in an environment with no access to the Android SDK, Gradle's plugin repository, or Maven Central (all blocked by network policy), so **it could not be built or run here**. Every file was checked by hand for consistency — matching Kotlin `binding.x` references against XML `android:id`s, balanced braces/parens, valid XML, and correct method signatures across files — but a hand review is not a substitute for an actual compile. Treat this as a strong first build, not a guaranteed-working APK: build it yourself in Android Studio (below) and fix anything the compiler flags. Given the scope of what's here, a small mismatch (an unused import, a typo Android Studio's IDE would normally catch as you type) is plausible; there are no unknown architectural gaps.

## What's in this version

1. **Local persistence & invoice regeneration** — everything (clients, time entries, expenses, invoices) lives in a local SQLite database. Each generated invoice stores its own snapshot of every line item, so it can be re-shared unchanged from Invoice history at any time, independent of later edits to rates or client info.
2. **Expense tracking with receipts** — log a title + amount for one-off costs (subscriptions, mileage, materials), optionally attaching a JPEG or PNG receipt photo. Expenses fold into the invoice total automatically, and attached receipts are appended as extra pages at the end of the generated invoice PDF.
3. **Timer: Start, Pause, Stop, Save** — the timer is a 4-state machine (idle → running ⇄ paused → stopped → save), matching the requested "Stop, Pause, Save" controls: Stop freezes a session for review, Save commits it as a time entry (or Resume un-freezes it without saving).
4. **Home-screen widget** — a 3-button widget (Start/Resume, Pause, Stop/Save) that drives the same foreground `TimerService` as the in-app timer, so widget, notification, and app always agree on the current state.
5. **Dynamic regional sales tax** — Settings has a tax section: picking Canada + a province auto-fills the correct rate(s) — harmonized (HST) for Ontario/Atlantic Canada, GST + a separate provincial tax for BC/Saskatchewan/Manitoba/Quebec, or GST-only for Alberta and the territories. Anywhere else (the U.S. included — there's no federal sales tax to look up, and it varies by state and city), enter up to two custom tax lines yourself. Tax is itemized as its own line(s) on the invoice PDF, above a "Total due" that includes it.
6. **PDF invoices** — built with Android's own `PdfDocument` API (no external library), so nothing here can fail to resolve at Gradle sync time.

## Requirements

- **Android Studio** (Iguana/2023.2 or newer recommended) — download from [developer.android.com/studio](https://developer.android.com/studio). It bundles the Android SDK and a compatible Gradle.
- A device or emulator running **Android 8.0 (API 26) or newer**.

## Building it

1. Unzip this project.
2. Open Android Studio → **File → Open...** → select the unzipped `BillableAndroid` folder.
3. Let Android Studio sync Gradle (first sync downloads dependencies and can take a few minutes — this needs network access to Google's and Maven Central's repositories, which is exactly what wasn't available in the environment this was written in).
4. If sync reports any error, it's almost always one of:
   - **A dependency version conflict** — Android Studio will usually offer a one-click "Upgrade" fix.
   - **A missing import or unresolved reference** — Studio's own "Alt+Enter" quick-fix will typically resolve it or point straight at the problem.
   - **Gradle wrapper files missing** — this project ships `gradle-wrapper.properties` but not the wrapper jar/scripts (`gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`), since generating those needs a working Gradle install. Android Studio regenerates them automatically on first open; if it doesn't, run `gradle wrapper` once with any local Gradle install.
5. **Build → Build Bundle(s) / APK(s) → Build APK(s)**. When it finishes, click "locate" in the notification to find `app/build/outputs/apk/debug/app-debug.apk`.
6. Install it:
   - **Directly from Studio**: plug in your device (with Developer Options → USB debugging enabled) or start an emulator, then hit the green ▶ Run button.
   - **Sideload the APK**: copy `app-debug.apk` to your phone and open it (you'll need to allow "install unknown apps" for whatever app you use to open it), or run `adb install app-debug.apk` from a terminal with the device connected.

## First run

1. Open **Settings** first — enter your hourly rate, currency symbol, and business name/email/address (shown as the "from" on invoices). This banner will otherwise nag you from the Track tab.
2. If you charge sales tax, set it up in the same screen — pick Canada and your province for an auto-filled rate, or enter your own rate(s) for anywhere else.
3. Add at least one client under **Clients**.
4. Track time from **Track Time** (timer or manual entry) and log any expenses there too.
5. Generate a PDF from **Invoices** — pick a client and month, Preview, then Generate. It opens Android's share sheet so you can send it directly (email, Drive, etc.) or save it.
6. Add the **Billable Timer** widget from your home screen's widget picker to control the timer without opening the app.

## Notes on scope

- **Tax rates**: the Canadian table (HST/GST+PST/GST+QST/GST-only by province) was checked against current rates as of September 2026, including Nova Scotia's HST cut from 15% to 14% (effective April 2025) — but tax rates change with every budget, so double-check before relying on it for a real filing. Everywhere outside Canada uses your own manually-entered rate(s), since no single table could stay accurate for every country's sales tax.
- **Data lives on-device only** — there's no cloud sync or backup built in. Uninstalling the app deletes its database and receipt photos, so back up anything important (e.g. by exporting/sharing invoices as you go) before uninstalling or switching phones.
- **No Room, no coroutines, no DI, no third-party PDF library** — this was a deliberate choice to keep the dependency graph small given the inability to test-compile here; it also just makes the codebase easier to read top-to-bottom.
