# Function and System Review: Sales Log & Round Robin

**Date:** 2025-12-29
**Scope:** `saleslog_files` directory (`core_saleslogPro.js`, `round_robin.js`, `rr_sidebar.js`, `utilities_locks.js`, `error_logger.js`, `sales_analytics.js`)
**Objective:** holistic review focusing on maintainability, correctness, transparency, and trust.

---

## 1. Redundant or Unused Functions

The following functions were identified as candidates for removal or consolidation to clean up the global namespace and reduce confusion.

| Function Name | File | Finding & Justification | Recommendation |
| :--- | :--- | :--- | :--- |
| `addRoundRobinMenuItems_` | `core_saleslogPro.js` | **Unused / Deprecated**. The function body is empty or commented out, and the menu construction has been moved directly into `onOpen` in `core_saleslogPro.js`. | **REMOVE**. It serves no purpose and clutters the file. |
| `getAssignmentUsers_` (in `rr_sidebar.js`) | `rr_sidebar.js` | **Potential Duplication**. This reads from `RR_USERS`. `round_robin.js` uses `getEligibleRoster_` reading from `RR_ROSTER`. If "Users who assign" (BDC) and "Reps who receive" (Sales) are the same list, these should be consolidated. If they are distinct, this is valid but should be explicitly documented. | **KEEP**, but verify intent. If `RR_USERS` and `RR_ROSTER` are meant to be the same, consolidate to `RR_ROSTER`. |
| `menuSkipAndReassignSelectedRow` | `round_robin.js` | **Active Menu Item**. Used in "Round Robin" menu. | **KEEP**. |
| `manualRefreshLeaderboard` | `core_saleslogPro.js` | **Active Menu Item**. Wrapper for `syncLeaderboardWithSalespeople`. | **KEEP**. |

---

## 2. Error Handling & Logging Review

The codebase currently has a split personality regarding error handling: `core_saleslogPro.js` uses a robust `error_logger.js` module, while the critical `round_robin.js` and `rr_sidebar.js` use basic `console.log/error` or throw raw errors.

### Findings
*   **Inconsistent logging**: `round_robin.js` writes to Console (Stackdriver) but does not use the standardized `logError` utility. This makes centralized debugging difficult.
*   **Sidebar Logging**: Errors in `createAppointmentFromSidebar` are returned to the client (good for UX) but are not logged persistently on the server side (bad for admin debugging).
*   **Silent Failures**: `logRoundRobinAction_` in `round_robin.js` catches errors and prints to console (Line 301), but does not alert anyone. If the Audit log fails (e.g., sheet is full or protected), the action continues but the "paper trail" is lost silently.

### Recommendations
1.  **Adopt `error_logger.js` globally**: Update `round_robin.js` and `rr_sidebar.js` to import and use `logError` from `error_logger.js` instead of `console.error`.
2.  **Server-Side Logging for Sidebar**: In `rr_sidebar.js` > `createAppointmentFromSidebar`, inside the `catch` block, call `logError()` *before* returning the error object to the client.
3.  **Critical Failure Alerting**: In `assignRowAuto_`, if `logRoundRobinAction_` fails, it currently swallows the error. While we don't want to stop the assignment, we should use `logError` (which logs to Stackdriver) so admins can see that Auditing is broken.

---

## 3. RR_AUDIT Coverage Analysis

The `RR_AUDIT` sheet is the source of truth. Trust depends on it capturing *all* state changes.

### Coverage Gaps

| Action | Currently Logged? | Risk Level | Recommendation |
| :--- | :--- | :--- | :--- |
| **Manual Cell Edit (Pointer)** | **NO** | **HIGH**. A user can manually change `RR_STATE!B2` (the pointer). This bypasses the Round Robin logic and is invisible to the audit log. | Implement an `onEditInstallable` trigger logic for `RR_STATE` to detect and log manual changes to cell B2. |
| **Manual Cell Edit (Assignments)** | **YES** | **Low**. `onEditInstallable` in `round_robin.js` catches changes to Column E (`COL_ASSIGNED`) and logs "Manual Override". | Maintain. Ensure the installable trigger is actually set up. |
| **Roster Eligibility Changes** | **NO** | **Medium**. If a manager unchecks "Active" for a rep, it changes assignment distribution. | Add an `onEdit` listener for `RR_ROSTER` to log when a rep is marked Inactive/Active. |
| **Sidebar Assignment** | **YES** | **Low**. Logs as "Sidebar Appointment". | Maintain. |
| **Menu Rewind/Reset** | **YES** | **Low**. Logs "Rewind" or "Reset Pointer". | Maintain. |

### Audit Format Recommendation
The current "Details" column uses a pipe-delimited string (e.g., `appt: ... | customer: ...`).
*   **Improvement**: Ensure the format is consistent. Consider adding a "Mode" column to the Audit sheet (Auto, Manual, Sidebar) to make filtering easier, rather than burying it in the Details string.

---

## 4. Trigger & Execution Safety Review

### Trigger Overlap
*   `onEditInstallable` in `round_robin.js` is designed to be an **Installable Trigger**.
*   **Risk**: If a user *also* creates a simple `onEdit` function in another file (or `core_saleslogPro.js`), both might run. Currently, `core_saleslogPro.js` has `onOpen` but no `onEdit`.
*   **Recommendation**: Rename `onFormSubmit` (Line 22 `round_robin.js`) to `handleFormSubmit` and `onEditInstallable` to `handleAppointmentEdit` to avoid confusion with reserved function names (`onEdit`, `onFormSubmit`) which effectively act as simple triggers. Explicitly bind them to installable triggers in the GAS console.

### Lock Safety
*   **Critical Finding**: `round_robin.js` (`assignRowAuto_`, `skipPointer_`) and `rr_sidebar.js` (`createAppointmentFromSidebar`) use raw `LockService.getDocumentLock().waitLock(15000)`.
*   **Risk**: They do **not** use the robust `utilities_locks.js` (`acquireScriptLockWithRetry`) which implements exponential backoff. The raw `waitLock` is prone to failing hard under contention.
*   **Recommendation**: **Refactor all Round Robin lock usage to use `utilities_locks.js:acquireScriptLockWithRetry()`**. This file already exists and is much safer.

---

## 5. Quality-of-Life (QoL) Improvements

1.  **Sidebar "Assigned By" Persistence**:
    *   *Current*: User must select "Assigned By" every time.
    *   *Improvement*: Store the last selected "Assigned By" name in `PropertiesService.getUserProperties()` (or `LocalStorage` on client) and auto-select it next time. This saves clicks for BDC reps who create many appointments.

2.  **Date/Time Picker Default**:
    *   *Current*: `datetime-local` input starts empty.
    *   *Improvement*: Default the picker to "Now" or "Nearest Hour" to speed up entry.

3.  **Visual Feedback on Lock Contention**:
    *   *Current*: If lock waits for 15s, the UI just hangs.
    *   *Improvement*: Using `acquireScriptLockWithRetry`, we can provide better feedback. If it takes >2 seconds, show a "Applying assignment... please wait" toast or message.

4.  **Admin Menu Organization**:
    *   *Current*: "SalesLog Tools (admin)" contains mix of daily logging and config.
    *   *Improvement*: The menu structure in `onOpen` (lines 2457+) looks good ("BDC Appts" top level). Ensure the "SalesLog Tools" submenu is restricted or clearly marked if it contains destructive actions like "Start New Month".

5.  **Validation Feedback**:
    *   *Current*: Sidebar validation happens on client (good) and server (good).
    *   *Improvement*: Add a "Loading..." spinner to the Sidebar *immediately* upon click to prevent double-submissions (though the button is disabled, a visual spinner is better UX).

---

## Summary of Action Plan

1.  **Refactor Locking**: Switch `round_robin.js` to use `acquireScriptLockWithRetry`.
2.  **Standardize Logging**: Import `error_logger.js` into Round Robin files.
3.  **Close Audit Gaps**: Add logging for `RR_STATE` manual edits and Roster changes.
4.  **Rename Triggers**: Ensure trigger functions have distinct names to prevent accidental simple-trigger execution.
5.  **Clean Up**: Remove `addRoundRobinMenuItems_`.
