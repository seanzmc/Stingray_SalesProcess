# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Google Apps Script (GAS) project bound to a Google Sheet ("Sales Log Pro"). All source lives in
[saleslog_files/](saleslog_files/), managed locally with `clasp` and pushed to the Apps Script project
(`scriptId` in [.clasp.json](.clasp.json)). There is no build step, no package manager, and no test runner —
this is plain V8-runtime GAS code edited locally and synced with clasp.

Do not modify files outside `saleslog_files/` — that's the clasp `rootDir` and the only directory that gets
pushed to the live script.

## Commands

- `clasp push` — push local `saleslog_files/*.js` to the bound Apps Script project.
- `clasp pull` — pull the latest from Apps Script (do this before editing if the sheet's script may have
  been edited in the browser editor).
- `clasp open` — open the project in the Apps Script web editor.
- No lint/test/build commands exist. Verify changes by pushing and exercising the relevant menu item /
  trigger from the Sheet's UI (`SalesLog Tools` menu, created by `onOpen()`).

## File layout (saleslog_files/)

- `core_saleslogPro.js` — the bulk of the app: sheet validation (`getSheets()`), daily sales processing
  pipeline (`processDaily()`), MONTHLY sheet sync, leaderboard/MTD calculations, month rollover
  (`rolloverMonth()`), conditional-formatting rules, trade export to an external "Recon" spreadsheet
  (`exportTradesToReconLog()`), and the `onOpen()` menu setup. This file is large (~3300 lines) — use
  `grep -n "^function "` to locate a function before reading the whole thing.
- `sales_analytics.js` — monthly analytics aggregation/formatting written into a dedicated block of columns
  on the MONTHLY sheet (`calculateMonthlyAnalytics()`, `writeAnalyticsToMonthly()`).
- `utilities_locks.js` — `acquireScriptLockWithRetry()` and retry/backoff config used to serialize writes
  from concurrent script executions.
- `error_logger.js` — `logError` / `logWarning` / `logInfo` structured logging helpers; use these instead of
  bare `console.log`/`Logger.log` in new code so errors carry context (`context`, `additionalData`).

## Architecture notes

- **Sheet validation pattern**: functions that touch sheets should call `getSheets()` first (validates
  TODAY/MONTHLY/SALESPEOPLE exist) rather than calling `getSheetByName()` directly — see the block comment
  above it in core_saleslogPro.js for the rationale (fail fast with a clear error instead of a null-ref).
- **Checkpoint/recovery system**: long-running operations (`processDaily()`) persist progress via
  `createOperationCheckpoint()` / `updateCheckpoint()` / `getOperationCheckpoint()` (backed by
  `PropertiesService`, key `DAILY_OPERATION_CHECKPOINT`) so a 5-minute execution timeout can be recovered
  from on the next run instead of leaving data half-processed. `createTimeoutManager()` implements the
  5-minute threshold check used inside these long loops.
- **Caching**: module-scope `CACHE` (`CacheService.getScriptCache()`) caches salesperson name/alias maps and
  color/visual config (`CACHE_KEY_NAME_MAP`, `CACHE_KEY_COLORS`); analytics results are cached separately in
  `sales_analytics.js` (`CACHE_KEY_ANALYTICS`, 5 min TTL). Any function that mutates the underlying data must
  call the matching `invalidate*Cache()` function.
- **Locking**: any function that mutates shared sheet state should wrap its critical section with
  `withScriptLock()` (core_saleslogPro.js) or `acquireScriptLockWithRetry()` (utilities_locks.js) — don't
  write to TODAY/MONTHLY/leaderboard ranges without a lock.
- **Ranges are centralized**: the `RANGES` object in core_saleslogPro.js is the single source of truth for
  fixed sheet ranges (TODAY input/clear ranges) and computes salesperson-count-dependent ranges
  (leaderboard/MTD/avg) dynamically via `getDynamicLeaderboardRanges()`. Add new fixed ranges here rather
  than inlining A1 strings elsewhere.
- **Recon export**: `exportTradesToReconLog()` and friends write into a *separate* external spreadsheet
  (`RECON_SPREADSHEET_ID`), not the bound one — it does idempotent appends keyed by a computed `SourceKey`
  (see `detectSourceKeyCol_`, `normalizeSourceKey_`) so re-running an export doesn't duplicate rows. Dry-run
  entry point (`menuExportTradesToReconLogDryRun`) exists for verifying export behavior without writing.
- **Menu is the primary entry surface**: `onOpen()` builds the `SalesLog Tools` menu (Sales Tools submenu:
  processDaily / recalcMtdFromMonthly / rolloverMonth / manualRefreshLeaderboard; Service Tools submenu:
  Recon auth/export/dry-run). When adding a new user-triggered operation, wire it in here.
- `audit_md_docs/` contains historical planning/audit notes from earlier iterations of this project
  (including a round-robin lead-assignment system that has since been removed from the codebase — see
  `round_robin_tutorial.md` and `TRIGGERS.md` for context that no longer matches current files). Treat these
  as historical reference, not a description of current behavior; verify against actual code before relying
  on them.

## GAS coding rules (from agents.md / .agent/rules/gas.md / .roo/rules)

These constraints are enforced by existing repo conventions — follow them for any new/modified code:

- V8 syntax only. `const` by default, `let` only when reassigning, **never `var`**.
- Never call `getValue()`/`setValue()`/`appendRow()` etc. in a loop. Read once with `getValues()`, transform
  in memory, write once with `setValues()`.
- No hardcoded secrets/IDs beyond what's already in the codebase as named constants; use
  `PropertiesService.getScriptProperties()` for anything sensitive or environment-specific.
- Prefer header-based column lookup (`getHeaderMap_()` / `normalizeHeader_()` pattern already in
  core_saleslogPro.js) over hardcoded column indices/A1 notation when processing dynamic data.
- Never leave a `catch` block empty — log via `logError`/`logWarning`/`logInfo` from `error_logger.js`.
- Wrap entrypoints invoked by triggers/menus in `try/catch`, log failures with context, and prefer
  `onOpen` be limited to menu creation, `onEdit`/`onChange` handlers be lightweight, and heavy work run
  through installable time-driven triggers (see `audit_md_docs/TRIGGERS.md` for the trigger list, keeping in
  mind it may reference functions no longer present).
- Keep OAuth scopes in `saleslog_files/appsscript.json` minimal — currently just `spreadsheets` and
  `script.container.ui`.
