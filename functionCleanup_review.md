# Function Cleanup Review

**Read-only cleanup review complete. Here’s the structured report.**

## Executive Summary

* Entry points mapped: onOpen menus, doGet web app, installable triggers (handleFormSubmit, handleAppointmentEdit, handleRRStateEdit, handleRosterEdit, plus optional handleAppointmentStructureChange), and HTML google.script.run calls.
* HTML calls resolve to getDashboardData, createAppointmentFromSidebar, getAssignmentUsers, showReassignDialog, assignPhoneLead, undoLastPhoneUp, getCurrentSelectionInfo, processMenuReassignment, processReassignmentForRow, processMenuRewindPointer.
* Found 5 internal helpers with no in-project call sites and ~11 manual/trigger/test entry points that appear unused but may be invoked externally.
* Redundancy hotspots: split-sale parsing (tallyCounts vs analytics processNewSale/processUsedSale) and rolling-average logic (computeThreeMonthAverageMap vs rolloverMonth).
* Audit detail serialization is duplicated between logRoundRobinEvent and buildAuditDetailsString_; action names are duplicated between AUDIT_ACTIONS and getAuditActions_.
* Phone lead roster filtering duplicates getEligibleRoster_.
* Performance/reliability risks: extra full-sheet reads in recalcMtdFromMonthly, per-row range calls in handleAppointmentEdit, full-column clears in writeAnalyticsToMonthly, reliance on active sheet/range in selection helpers, and non-namespaced ScriptCache keys.

## Unused / Dead Code List

### Definitely unused

* advanceRoundRobinPointer_ — round_robin.js (line 1511); no call sites (only referenced in docs/comments); Risk: Low.
* skipPointer_ — round_robin.js (line 1467); no call sites; Risk: Low.
* validateUndoStateTokenOrThrow_ — round_robin.js (line 1036); no call sites; Risk: Low.
* logErrorSimple — error_logger.js (line 93); no call sites; Risk: Low.
* logInfo — error_logger.js (line 139); no call sites; Risk: Low.

### Possibly used externally

* handleAppointmentStructureChange — round_robin.js (line 476); intended for installable On change trigger but not referenced in menus/HTML/TRIGGERS.md; Risk: High.
* migrateAppointmentPointerToName — round_robin.js (line 1809); documented manual migration in TRIGGERS.md; Risk: High.
* normalizeAuditLogEntries — round_robin.js (line 1723); admin cleanup utility with no call sites; Risk: Med.
* getReassignmentReasons — round_robin.js (line 715); public API but no HTML references; Risk: Med.
* getNextPhoneUpMenu — PhoneUp.js (line 23); no menu entry; Risk: Med.
* getOperationCheckpoint — core_saleslogPro.js (line 1376); no call sites, likely for manual diagnostics; Risk: Med.
* recoverAnalyticsForCheckpoint — core_saleslogPro.js (line 1428); no call sites, manual recovery only; Risk: Med.
* refreshAnalyticsManually — sales_analytics.js (line 778); no menu wiring; Risk: Med.
* runAllTests_RewindPointerUndo — rewind_pointer_undo_tests.js (line 84); manual test runner only; Risk: Low.
* manualTest_RewindPointerDialog_GetContext — rewind_pointer_undo_manual_tests.js (line 9); manual test only; Risk: Low.
* manualTest_RewindPointerDialog_EvaluateTemplate — rewind_pointer_undo_manual_tests.js (line 17); manual test only; Risk: Low.
* manualTest_RewindPointerUndo_InvokeWithInvalidReason — rewind_pointer_undo_manual_tests.js (line 28); manual test only; Risk: Low.
* manualTest_RewindPointerUndo_SimulateFailure — rewind_pointer_undo_manual_tests.js (line 63); manual test only; Risk: Low.
* manualTest_RewindPointerUndo_SimulateRetry_NoDuplicate — rewind_pointer_undo_manual_tests.js (line 139); manual test only; Risk: Low.

## Redundancy / Consolidation Opportunities

* Pointer advance logic; Functions: advanceRoundRobinPointer_, advanceRoundRobinPointerByName_ in round_robin.js; Approach: remove legacy pointer or make it a thin wrapper around name-based pointer; Benefit: avoids drift and simplifies pointer logic.
* Audit detail serialization; Functions: logRoundRobinEvent, buildAuditDetailsString_ in round_robin.js, parseDetailsString_ in Code.js; Approach: extract formatAuditDetails_(detailsObj, {excludeKeys}) used by both logging paths; Benefit: consistent audit format and easier future changes.
* Roster filtering; Functions: getEligibleRoster_ in round_robin.js, executePhoneUpAssignment_/undoLastPhoneUp in PhoneUp.js; Approach: reuse getEligibleRoster_ in Phone Lead flows; Benefit: single source of eligibility rules.
* Split-sale parsing; Functions: tallyCounts in core_saleslogPro.js, processNewSale/processUsedSale in sales_analytics.js; Approach: extract parseSplitSalespersonInput_(input) or applySplitSale_(input, aliasMap, onResolved, onUnknown) and make new/used helpers thin wrappers; Benefit: consistent split-credit behavior.
* Leaderboard updates; Functions: processDaily, recalcMtdFromMonthly in core_saleslogPro.js; Approach: shared updateLeaderboardFromCounts_(todaySheet, counts, ranges) for sorting + formats + CF; Benefit: reduces duplicate sheet I/O and logic drift.
* Rolling averages; Functions: computeThreeMonthAverageMap and rolloverMonth in core_saleslogPro.js; Approach: use computeThreeMonthAverageMap inside rolloverMonth instead of per-person archive scans; Benefit: fewer reads and consistent averaging.
* Dialog client utilities; Functions: decodeWebSafeBase64_, setError, setText in ReassignDialog.html and RewindPointerDialog.html; Approach: shared DialogUtils.html include; Benefit: reduce duplicated JS and keep dialogs in sync.
* Audit action constants; Functions/constants: AUDIT_ACTIONS in round_robin.js, getAuditActions_ in Code.js; Approach: read AUDIT_ACTIONS directly with fallback, or centralize in a shared file; Benefit: prevent action-name drift.

## Performance & Apps Script-specific Improvements

* Issue: per-row getRange().setValue() in manual-override loop; Where: round_robin.js (line 271); Recommendation: batch Mode updates via getRange(rowStart, COL_MODE, rowCount, 1) and setValues.
* Issue: multiple full-sheet reads (monthlyValues + allMonthlyContent) and getMergedRanges(); Where: core_saleslogPro.js (line 2031); Recommendation: single read (A:N) and derive headers/data in one pass; limit reads with findLastRowInCols.
* Issue: repeated SpreadsheetApp.flush() and many formatting calls; Where: core_saleslogPro.js (line 1479); Recommendation: minimize flushes (ideally once at end) and group formatting with fewer range calls.
* Issue: full-column clear across maxRows each analytics refresh; Where: sales_analytics.js (line 138); Recommendation: clear only used rows via getLastRow() and prefer clearContent() if formatting is reapplied.
* Issue: getDataRange() read of entire RR_USERS; Where: Code.js (line 268); Recommendation: use getLastRow() + targeted range to reduce read size.
* Issue: reliance on active sheet/range in UI helpers; Where: round_robin.js (line 576), round_robin.js (line 1986); Recommendation: pass explicit row/sheet from UI or guard for null to avoid non-UI failures.
* Issue: On change trigger uses e.source.getActiveSheet(); Where: round_robin.js (line 476); Recommendation: treat as best-effort or gate with explicit sheet checks to avoid logging wrong sheet.
* Issue: ScriptCache keys not spreadsheet-specific; Where: core_saleslogPro.js (line 57), sales_analytics.js (line 18); Recommendation: prefix cache keys with spreadsheet ID (like getDashboardCacheKey_ does).

## If You Want Me To Implement These Changes Next

* Phase 1: add shared helpers (audit detail formatter, split-sale parser), keep old functions as wrappers, and switch Phone Lead roster reads to getEligibleRoster_.
* Phase 2: consolidate leaderboard update flow and rolling-average logic; keep behavior identical with wrapper functions.
* Phase 3: confirm external triggers/menus/tests, then remove confirmed dead code and update TRIGGERS.md.
* Tests not run (analysis only).
