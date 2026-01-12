# Sales Log Pro Code Audit Report

## 🔴 Critical Risks

### Concurrency & Locks

* **Mixed Lock Implementation Strategy**: `PhoneUp.js` uses a mixed locking strategy. It attempts to use `withScriptLock` (from `core_saleslogPro.js`) but falls back to a raw `LockService.getScriptLock()` with a hardcoded `tryLock(10000)` if the helper is missing. This fallback lacks the exponential backoff protection found in `utilities_locks.js`, potentially leading to lock starvation under high load.
* **Race Conditions**: No critical race conditions were found in `round_robin.js` or `core_saleslogPro.js`. `assignRowAuto_` (the critical path for assignment) correctly acquires a lock before reading and writing, ensuring the read-modify-write cycle is atomic.

### Trigger Ambiguity

* **Trigger Definition**: No explicit conflicts found. However, `round_robin.js` relies on "Installable Triggers" which must be manually set up. The code handles event objects (`e`) correctly and doesn't appear to be called manually without them in a way that would cause `undefined` errors.
* **"God Functions"**: `processDaily` in `core_saleslogPro.js` is a monolithic function handling too many responsibilities (data processing, checkpointing, formatting, analytics, alerting). This increases the risk of side-effects and makes testing difficult.

## 🟡 Performance Wins

### API Quota Efficiency ("The 6-Minute Rule")

* **Inefficient Write Operations**: In `round_robin.js`, the `assignRowAuto_` function makes 4 separate `setValue()` calls to update a single row (CreatedTS, Assigned, Mode, AssignedBy).

    ```javascript
    appts.getRange(row, COL_CREATED_TS).setValue(now);
    appts.getRange(row, COL_ASSIGNED).setValue(assignee);
    appts.getRange(row, COL_MODE).setValue(opts.mode || 'Auto');
    appts.getRange(row, COL_ASSIGNED_BY).setValue(user);
    ```

    *Recommendation*: Batch these updates into fewer calls using `setValues()`, even if it requires reading the intermediate columns first.

* **Optimized Operations**: `core_saleslogPro.js` generally uses efficient batch operations (reading/writing ranges in bulk) in `processDaily`, `recalcMtdFromMonthly`, and `sales_analytics.js`.

### Caching Opportunities

* **Roster & State**: `round_robin.js` reads the roster and state sheets on every assignment. While `getEligibleRoster_` reads in one batch, high-frequency form submissions could benefit from short-term caching (e.g., `CacheService`) for the roster, though strict consistency is preferred for the pointer.

## 🔵 Cleanup

### Dead Code

The following functions/variables appear to be unused and should be removed:

* `filterTrafficLightRules` in `core_saleslogPro.js` (Defined but never called).
* `validateLockResult` in `utilities_locks.js` (Exported but not used internally or in other scanned files).
* `getLockResultSummary` in `utilities_locks.js` (Exported but not used).
* `getMonthlyAnalyticsSummary` in `sales_analytics.js` (Exported but not used by core logic).

### Cleanup Opportunities

* **`processDaily` Refactoring**: This function (~200 lines) should be broken down into smaller, testable services (e.g., `DailyLogService`, `MonthlyArchiver`).
* **`PhoneUp.js` Standardization**: Should import or strictly rely on `utilities_locks.js` instead of implementing its own fallback logic.

---

## Refactoring Plan: Step-by-Step Modernization

### Phase 1: Immediate Stabilization (Safe Fixes)

1. **Standardize Locking**: Update `PhoneUp.js` to strictly use `acquireScriptLockWithRetry` from `utilities_locks.js`. Remove the fallback manual lock logic to ensure consistent backoff behavior across the app.
2. **Optimize `assignRowAuto_`**: Refactor the write operations in `round_robin.js` to use a single `setValues()` call (or two if columns are non-contiguous) to reduce API overhead.
3. **Remove Dead Code**: Delete the unused functions identified above (`filterTrafficLightRules`, etc.) to declutter the codebase.

### Phase 2: Modularization (Risk Reduction)

1. **Extract `processDaily` Logic**: Break down `processDaily` into a `DailyProcessor` class or module.
    * Extract "Today to Monthly" logic into `transferDailyLogs()`.
    * Extract "Checkpoint" logic into a dedicated `CheckpointService`.
    * Extract "Formatting" logic into `SheetFormatter`.
2. **Decouple Analytics**: Ensure `sales_analytics.js` is loosely coupled. The current `processDaily` calls it directly; consider an event-based approach or a clear service coordinator.

### Phase 3: Performance & Scalability

1. **Implement Roster Caching**: Add a short-lived cache (e.g., 60 seconds) for `getEligibleRoster_` in `round_robin.js` to reduce read quotas during high traffic, invalidating it only when `RR_ROSTER` is edited (using the existing `handleRosterEdit` trigger).
2. **Unit Testing**: Introduce local unit tests for the newly extracted modules (e.g., testing the round-robin pointer logic in isolation from the SpreadsheetApp).
