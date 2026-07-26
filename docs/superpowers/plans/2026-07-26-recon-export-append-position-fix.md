# Recon Export Append-Position Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `appendTradesToRecon_()` from choosing an unsafe/wrong append row in the external Recon spreadsheet, which today can overwrite existing rows once real data exists past row 3,000.

**Architecture:** Replace the hardcoded `scanEndRow = Math.min(maxRows, 3000)` cap with a scan bounded by the sheet's actual `lastRow` (already read at the top of the function), floor the fallback append row at `headerRow + 1` instead of the hardcoded `2`, and wrap the read-detect-write critical section in the existing `withScriptLock()` helper so a second concurrent export can't compute a stale append row. No new files, no schema changes, no changes to the caller's public signature.

**Tech Stack:** Google Apps Script (V8 runtime), `SpreadsheetApp` service, existing `withScriptLock()` / `acquireScriptLockWithRetry()` locking helpers in this same file.

## Global Constraints

- V8 syntax only. `const` by default, `let` only when reassigning, never `var`.
- Never call `getValue()`/`setValue()`/`appendRow()` in a loop — bulk `getValues()`/`setValues()` only.
- Never leave a `catch` block empty — log via `logError`/`logWarning`/`logInfo` from `error_logger.js`.
- Do not modify files outside `saleslog_files/`.
- No test runner exists for this project — verification is done by reasoning through the mock scenario described in the audit (`lastRow=4000` causing row-2 selection) and by re-reading the diff, not by running `npm test`.

## Audit Revalidation (done before writing this plan)

Re-read `saleslog_files/core_saleslogPro.js` directly (current lines, not the audit's original line numbers, since two commits have landed since the last audit pass):

- `appendTradesToRecon_()` starts at line 1475 (was 1475 in audit — unchanged).
- The unsafe cap is now at **line 1566**: `const scanEndRow = Math.min(maxRows, 3000);` (audit cited 1565-1579 — still present, same logic, minor line drift only).
- The write is at **lines 1644-1647** — unchanged from audit.
- Confirmed via `grep` that `appendTradesToRecon_()` / `exportTradesToReconLog()` (lines 1681-1765) are **not** wrapped in `withScriptLock()` anywhere in the call chain (`menuExportTradesToReconLog` at line 681 calls `exportTradesToReconLog` directly, no lock). The only `withScriptLock()` call sites in the file are at lines 2354, 2909, 3119 — none of them cover Recon export. This confirms audit finding 3's overlap with finding 1 (the fix folds in "revalidate immediately before writing while holding a lock" from the audit's finding-1 fix list, which requires touching the same lock).
- `lastRow` (sheet's true last row, from `reconSheet.getLastRow()`) is already computed at line 1494 and used for the SourceKey scan at lines 1557-1558 — it is the correct bound to reuse for the Stock-column scan instead of the artificial `maxRows`/3000 cap.
- `headerRow` is computed at line 1498 via `findReconHeaderRow_()`.

Finding is **confirmed unchanged in scope and location**. Proceeding with implementation.

**Standing guideline for whoever specs the next finding (finding 2 onward):** before writing that finding's plan, re-run this same revalidation step — `grep -n` for the specific function/line anchors the audit cites, `Read` the current surrounding code, and confirm the line numbers, call graph, and lock coverage still match what the audit describes. Note any drift (line shifts, renamed functions, functions now covered by a lock that weren't before, etc.) in an "Audit Revalidation" section at the top of that finding's plan before specifying the fix, the same way this section does for finding 1. If the finding no longer reproduces or the described code no longer exists, stop and report that instead of writing a plan against stale evidence.

---

### Task 1: Bound the Stock-column scan by the sheet's real last row instead of a hardcoded 3,000 cap

**Files:**
- Modify: `saleslog_files/core_saleslogPro.js:1565-1579` (the `scanEndRow`/`lastDataRow` block inside `appendTradesToRecon_()`)

**Interfaces:**
- Consumes: `reconSheet` (Sheet object), `lastRow` (number, already computed at line 1494 via `reconSheet.getLastRow()`), `stockCol` (number, already computed at line 1545), `headerRow` (number, already computed at line 1498) — all already in scope inside `appendTradesToRecon_()`.
- Produces: `appendRow` (number) — consumed unchanged by the write at line 1646 (`reconSheet.getRange(appendRow, 1, rowsToAppend.length, lastCol)`). No other function calls this scan logic, so no downstream signature changes.

- [ ] **Step 1: Read the current block to confirm exact text before editing**

Current code (lines 1565-1579):

```javascript
  const maxRows = reconSheet.getMaxRows();
  const scanEndRow = Math.min(maxRows, 3000);
  let lastDataRow = 0;
  if (scanEndRow >= 2) {
    const stockValues = reconSheet
      .getRange(2, stockCol, scanEndRow - 1, 1)
      .getDisplayValues();
    for (let i = stockValues.length - 1; i >= 0; i--) {
      if (String(stockValues[i][0]).trim()) {
        lastDataRow = i + 2;
        break;
      }
    }
  }
  const appendRow = lastDataRow ? lastDataRow + 1 : 2;
```

- [ ] **Step 2: Replace the cap with the sheet's real last row, and floor the fallback at `headerRow + 1`**

```javascript
  // Scan the full used range of the Stock column (bounded by the sheet's actual
  // last row, not an arbitrary cap) so real data past row 3,000 is never
  // mistaken for an empty sheet and overwritten.
  let lastDataRow = 0;
  if (lastRow >= 2) {
    const stockValues = reconSheet
      .getRange(2, stockCol, lastRow - 1, 1)
      .getDisplayValues();
    for (let i = stockValues.length - 1; i >= 0; i--) {
      if (String(stockValues[i][0]).trim()) {
        lastDataRow = i + 2;
        break;
      }
    }
  }
  const appendRow = lastDataRow ? lastDataRow + 1 : headerRow + 1;
```

Notes on this change:
- `maxRows`/`scanEndRow` are removed entirely — `lastRow` (already computed at line 1494 from `reconSheet.getLastRow()`) is the correct, uncapped bound. `getLastRow()` reflects the sheet's actual used range, so this removes the silent 3,000-row cap without introducing a new unbounded read risk (a Recon log sheet's used range is bounded by real data, not by `getMaxRows()`'s allocated-but-empty rows).
- The fallback when the Stock column is entirely blank changes from hardcoded `2` to `headerRow + 1`, so a header row that has moved (per `findReconHeaderRow_()`'s dynamic detection, already handled elsewhere in this function) doesn't cause a write directly on top of the header.

- [ ] **Step 3: Apply the edit**

Use the Edit tool to replace the Step 1 block with the Step 2 block in `saleslog_files/core_saleslogPro.js`.

- [ ] **Step 4: Manual verification via dry-run export (no automated test runner in this project)**

Run `clasp push`, then from the Sheet's `SalesLog Tools` menu run **Service Tools → Recon Export (Dry Run)** (`menuExportTradesToReconLogDryRun()`, line 699) against the real Recon spreadsheet. Confirm in the Apps Script execution log (`Logger.log` output at line ~1580, `appendTradesToRecon_: stockCol=... appendRow=... lastDataRow=... headerRow=...`) that `appendRow` equals the true next empty row (i.e. one past whatever the last populated Stock-column row actually is), not row 2, when the Recon sheet has data beyond row 3,000. If the live Recon sheet does not currently have 3,000+ rows, this can also be verified by temporarily pointing `RECON_SPREADSHEET_ID` (line 79) at a scratch copy seeded with a populated Stock cell at e.g. row 4000 — do this only in a disposable test spreadsheet, never the production `RECON_SPREADSHEET_ID`.

- [ ] **Step 5: Commit**

```bash
git add saleslog_files/core_saleslogPro.js
git commit -m "fix: bound Recon export append-row scan by actual last row, not 3000-row cap"
```

---

### Task 2: Wrap the read-detect-write critical section in `withScriptLock()` and revalidate `appendRow` after acquiring the lock

**Files:**
- Modify: `saleslog_files/core_saleslogPro.js` — `appendTradesToRecon_()` (currently lines 1475-1679; the critical section runs from the `lastRow`/`lastCol` reads at lines 1494-1495 through the `setValues()` write, now ending around line 1647 after Task 1's edit)

**Interfaces:**
- Consumes: `withScriptLock(fn)` — already defined at line 799, takes a zero-arg function, returns that function's return value, always releases the lock in `finally`. No signature change needed to consume it.
- Produces: `appendTradesToRecon_(candidates, options)` keeps its existing signature and return shape (`{appended, skippedDuplicates, invalidAppended, invalidSkippedDuplicates, totalCandidates}`) — callers (`exportTradesToReconLog()` at line 1737, and anything else calling `appendTradesToRecon_()` directly) require no changes.

Rationale: the audit's finding-1 fix list explicitly requires "revalidate immediately before writing while holding a lock" — a read of `lastRow`/`lastDataRow` taken outside a lock can go stale if a second export runs concurrently between the read and the write (finding 3's "some writers never acquire the lock" cites this exact function at line 681's call path). Folding the read-detect-write section into `withScriptLock()` closes both gaps with one change, since finding 3's full remediation (auditing every writer) is out of scope for this finding-1-only plan.

- [ ] **Step 1: Confirm dry-run behavior must NOT acquire the lock**

`appendTradesToRecon_()` is also called with `{dryRun: true}` from `menuExportTradesToReconLogDryRun()` (line 699) for previewing without writing. Acquiring a lock for a pure read is unnecessary overhead and would serialize dry-run previews behind real exports for no benefit. Only the mutating path (duplicate-key check → scan → write) needs the lock, and it needs to be re-checked *inside* the lock in case another export landed rows between the initial read and lock acquisition.

- [ ] **Step 2: Restructure the function so the existing-keys scan, stock-column scan, and write all happen inside one `withScriptLock()` call for non-dry-run executions**

Current structure (post-Task-1) reads `existingKeys` (lines 1553-1563) and `lastDataRow`/`appendRow` (Task 1's block) once, then writes later (line 1644 `if (rowsToAppend.length && !dryRun)`). Move the read of `existingKeys`, the read of `lastDataRow`/`appendRow`, and the write into a single lock-protected closure so nothing else can append between the scan and the write. Wrap only this section — not header detection or candidate-list building, which don't need lock protection and would otherwise hold the lock during expensive `candidates.forEach()` mapping.

```javascript
  const runMutatingSection = () => {
    const existingKeys = new Set();
    let keyValues = [];
    if (lastRow >= 2) {
      keyValues = reconSheet.getRange(2, sourceKeyCol, lastRow - 1, 1).getValues();
      keyValues.forEach((row) => {
        const key = normalizeSourceKey_(row[0]);
        if (key) existingKeys.add(key);
      });
    }

    let lastDataRow = 0;
    if (lastRow >= 2) {
      const stockValues = reconSheet
        .getRange(2, stockCol, lastRow - 1, 1)
        .getDisplayValues();
      for (let i = stockValues.length - 1; i >= 0; i--) {
        if (String(stockValues[i][0]).trim()) {
          lastDataRow = i + 2;
          break;
        }
      }
    }
    const appendRow = lastDataRow ? lastDataRow + 1 : headerRow + 1;
    Logger.log(
      'appendTradesToRecon_: stockCol=' + stockCol +
      ' appendRow=' + appendRow +
      ' lastDataRow=' + lastDataRow +
      ' headerRow=' + headerRow
    );

    const rowsToAppend = [];
    let skippedDuplicates = 0;
    let invalidSkippedDuplicates = 0;
    let invalidAppended = 0;
    const importedAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );
    candidates.forEach((candidate) => {
      const key = normalizeSourceKey_(candidate && candidate.key);
      const isInvalid = !!(candidate && candidate.isInvalid);
      if (!key || existingKeys.has(key)) {
        skippedDuplicates++;
        if (isInvalid) invalidSkippedDuplicates++;
        return;
      }
      existingKeys.add(key);
      if (isInvalid) invalidAppended++;

      const notes = candidate && candidate.notes ? String(candidate.notes) : '';
      const reconDateDisplay =
        formatReconDealDate_(candidate.dateDisplay, candidate.dateISO) ||
        candidate.dateISO ||
        '';

      const rowValues = new Array(lastCol).fill('');
      rowValues[sourceKeyCol - 1] = key;
      rowValues[dealDateCol - 1] = reconDateDisplay;
      rowValues[stockCol - 1] = candidate.stock || '';
      rowValues[salespersonCol - 1] = candidate.salesperson || '';
      rowValues[locationCol - 1] = 'Plant City';
      if (notesCol) rowValues[notesCol - 1] = notes;
      if (hasImportedAt) {
        const importedAtCol = headerMap[normalizeHeader_(RECON_IMPORTEDAT_HEADER)];
        if (importedAtCol) rowValues[importedAtCol - 1] = importedAt;
      }

      rowsToAppend.push(rowValues);
    });

    if (rowsToAppend.length) {
      reconSheet.getRange(appendRow, 1, rowsToAppend.length, lastCol).setValues(rowsToAppend);
      try {
        const sourceKeyColToHide = sourceKeyCol;
        const importedAtColToHide = headerMap[normalizeHeader_(RECON_IMPORTEDAT_HEADER)];
        if (sourceKeyColToHide && importedAtColToHide) {
          if (Math.abs(sourceKeyColToHide - importedAtColToHide) === 1) {
            reconSheet.hideColumns(Math.min(sourceKeyColToHide, importedAtColToHide), 2);
          } else {
            reconSheet.hideColumns(sourceKeyColToHide);
            reconSheet.hideColumns(importedAtColToHide);
          }
        } else if (sourceKeyColToHide) {
          reconSheet.hideColumns(sourceKeyColToHide);
        } else if (importedAtColToHide) {
          reconSheet.hideColumns(importedAtColToHide);
        }
      } catch (e) {
        logWarning('appendTradesToRecon_: column hide failed', {
          context: 'appendTradesToRecon_',
          additionalData: { error: String(e) },
        });
      }
    }

    return {
      appended: rowsToAppend.length,
      skippedDuplicates: skippedDuplicates,
      invalidAppended: invalidAppended,
      invalidSkippedDuplicates: invalidSkippedDuplicates,
      totalCandidates: candidates.length,
    };
  };

  if (dryRun) {
    return runMutatingSection.call(null); // NOTE: see Step 3 — dry run must not write; see caveat below
  }
  return withScriptLock(runMutatingSection);
```

**Caveat surfaced by writing this out (resolve in Step 3 below):** `runMutatingSection` as drafted always calls `setValues()` when `rowsToAppend.length` — it no longer checks `!dryRun` internally (that check moved to the outer `if`/`else`), but dry-run must still *compute* `rowsToAppend`/`appendRow` for the preview return value *without writing*. Step 3 fixes this properly rather than papering over it with a flag threaded through the closure.

- [ ] **Step 3: Fix the dry-run/write split cleanly — pass a `write` boolean into the closure instead of branching on which closure to call**

Replace the two-branch call at the bottom of Step 2 with a single lock-aware dispatch that only takes the lock when a write will actually happen:

```javascript
  const runSection = (shouldWrite) => {
    // ... identical body to Step 2's runMutatingSection ...
    // Change the write guard from `if (rowsToAppend.length)` to:
    if (rowsToAppend.length && shouldWrite) {
      reconSheet.getRange(appendRow, 1, rowsToAppend.length, lastCol).setValues(rowsToAppend);
      // ... hideColumns block unchanged ...
    }
    return { appended: rowsToAppend.length, skippedDuplicates, invalidAppended, invalidSkippedDuplicates, totalCandidates: candidates.length };
  };

  if (dryRun) {
    return runSection(false);
  }
  return withScriptLock(() => runSection(true));
```

This preserves current dry-run semantics exactly (compute and return counts, never write, never lock) while giving the real write path both the lock and a same-transaction re-read of `existingKeys`/`lastDataRow` immediately before `setValues()`.

- [ ] **Step 4: Apply the edit**

Use the Edit tool to restructure `appendTradesToRecon_()` in `saleslog_files/core_saleslogPro.js` per Step 3's final form (fold Step 2's body in with the `shouldWrite` parameter, keep everything above `existingKeys` — header detection, column resolution — outside the closure since it's read-only and needed for both dry-run and real runs).

- [ ] **Step 5: Manual verification**

1. `clasp push`.
2. Run **Service Tools → Recon Export (Dry Run)** — confirm the execution log still shows a summary with no rows written (check the Recon sheet's row count is unchanged after).
3. Run **Service Tools → Recon Export** (real) once — confirm rows append at the correct row and the execution log shows `Script lock acquired on attempt ...` (from `withScriptLock()` at line ~822) during the export.
4. If feasible, trigger two exports back-to-back (e.g. re-run the menu item twice quickly) and confirm the second either serializes behind the first (lock wait logged) rather than both computing the same `appendRow` and colliding.

- [ ] **Step 6: Commit**

```bash
git add saleslog_files/core_saleslogPro.js
git commit -m "fix: serialize Recon export writes under withScriptLock and revalidate append row inside the lock"
```

---

## Self-Review

**Spec coverage:** Audit finding 1's fix list has five bullets:
1. "Search through the actual used Stock column, preferably from the bottom" — Task 1 (scans from bottom, bounded by `lastRow`).
2. "Never silently cap the scan at the first 3,000 rows" — Task 1 (removes `scanEndRow`/3000 cap entirely).
3. "If a safety limit is required, fail closed instead of selecting an unsafe append row" — satisfied by removing the cap rather than keeping one; there is no longer a scenario where an artificial limit causes an unsafe row choice, so there's nothing left to "fail closed" on.
4. "Ensure the append row is at least headerRow + 1" — Task 1 (`headerRow + 1` fallback).
5. "Revalidate immediately before writing while holding a lock" — Task 2.

**Placeholder scan:** No TBD/TODO/"add appropriate" phrasing present; every step shows literal before/after code.

**Type consistency:** `appendTradesToRecon_(candidates, options)` signature and return shape (`{appended, skippedDuplicates, invalidAppended, invalidSkippedDuplicates, totalCandidates}`) are unchanged across both tasks — confirmed by re-reading Task 2's final `runSection` return matches the original function's return object at lines 1672-1678.
