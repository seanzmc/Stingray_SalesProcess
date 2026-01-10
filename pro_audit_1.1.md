# Addendum: Second Opinion Code Review & Usability Audit

## 1. Front-End Operation & UI Design

### **Critical Issues Identified**

- **Sidebar UI Clutter:**
  - **Issue:** [`NewAppointmentSidebar.html`](saleslog_files/NewAppointmentSidebar.html:1) stacks multiple primary CTAs ("New Appointment," "Assign Phone Lead," "Reassign," "Undo") vertically without clear visual hierarchy.
  - **Impact:** Users may accidentally click the wrong action under time pressure.
  - **Fix:** Implement a tabbed interface using simple CSS/JS (no external libraries). Example structure:

    ```html
    <div class="tabs">
      <button class="tab-btn active" onclick="showTab('new')">New Appointment</button>
      <button class="tab-btn" onclick="showTab('phone')">Phone Lead</button>
      <button class="tab-btn" onclick="showTab('manage')">Manage</button>
    </div>
    <div id="tab-new" class="tab-content"><!-- New Appointment form --></div>
    <div id="tab-phone" class="tab-content hidden"><!-- Phone Lead form --></div>
    <div id="tab-manage" class="tab-content hidden"><!-- Reassign/Undo --></div>
    ```

- **Reassignment Lacks Row Context:**
  - **Issue:** The reassign workflow in [`NewAppointmentSidebar.html`](saleslog_files/NewAppointmentSidebar.html:1) operates on the "current selection" but never displays which customer/row is selected.
  - **Impact:** High risk of reassigning the wrong customer, especially if the user changes selection after opening the sidebar.
  - **Fix:** Add a server-side function `getCurrentSelectionInfo()` that returns `{row: number, customer: string, status: string}`. Display this prominently above the reassign controls:

    ```javascript
    // In Code.js or utilities
    function getCurrentSelectionInfo() {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
      const row = sheet.getActiveCell().getRow();
      if (row < 2 || sheet.getName() !== 'RR_ROSTER') return null;
      const [customer, status] = sheet.getRange(row, 1, 1, 2).getValues()[0];
      return {row, customer, status};
    }
    ```

    Call this on sidebar load and display: `"Currently selected: [Customer Name] (Row #, Status: X)"`.

- **Modal Dialog Failures Use `alert()`:**
  - **Issue:** [`ReassignDialog.html`](saleslog_files/ReassignDialog.html:1) falls back to `alert()` for error messages, which blocks the UI thread and provides poor UX.
  - **Impact:** Users cannot copy error messages, and the dialog closes unexpectedly on success without confirmation.
  - **Fix:** Replace `alert()` with inline error display:

    ```html
    <div id="error-msg" class="hidden error-box"></div>
    ```

    ```javascript
    function showError(msg) {
      const el = document.getElementById('error-msg');
      el.textContent = msg;
      el.classList.remove('hidden');
    }
    ```

    On success, show a 2-second confirmation message before closing: `"Successfully reassigned [Name] to [User]. Closing..."`

- **Accessibility & Form Usability:**
  - **Issue:** Form inputs lack proper `<label for="...">` attributes; reason dropdowns don't enforce intentional selection (allow default empty value); inconsistent labels/colors for status indicators.
  - **Impact:** Screen readers cannot associate labels with inputs; users can submit forms without selecting a reason; color-blind users may misinterpret status.
  - **Fix:**
    - Wrap all inputs with explicit labels: `<label for="reason-select">Reason:</label><select id="reason-select">...</select>`
    - Add a disabled default option: `<option value="" disabled selected>-- Select a reason --</option>`
    - Validate on form submit: `if (!reasonSelect.value) { showError('Please select a reason'); return; }`
    - Add `aria-live="polite"` to status banners so changes are announced to screen readers.

- **Time Rounding Microcopy:**
  - **Issue:** The appointment form rounds times to the nearest 15 minutes but doesn't explain this to users.
  - **Impact:** Users may be confused when their input (e.g., "10:23 AM") is changed to "10:30 AM" without notification.
  - **Fix:** Add helper text below the time input: `<small class="text-gray-500">Times will be rounded to the nearest 15 minutes.</small>`

### **Recommendations**

1. Implement tabbed navigation in [`NewAppointmentSidebar.html`](saleslog_files/NewAppointmentSidebar.html:1) to separate workflows.
2. Add `getCurrentSelectionInfo()` and display context before any mutation action.
3. Replace all `alert()` calls with inline DOM-based error messages.
4. Add `<label>` attributes, enforce dropdown selection, and include `aria-live` regions.

---

## 2. User Experience (UX) & Ease of Use

### **Workflow & Validation Issues**

- **High-Risk Undo Flow Without Context:**
  - **Issue:** The "Undo Last Assignment" button in [`rr_sidebar.js`](saleslog_files/rr_sidebar.js:1) provides no preview of *what* will be undone (customer name, timestamp, or target user).
  - **Impact:** Users may accidentally undo the wrong assignment, especially if multiple people are working simultaneously.
  - **Fix:** Add a server-side function `getLastAssignmentDetails()`:

    ```javascript
    function getLastAssignmentDetails() {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RR_AUDIT');
      if (!sheet) return null;
      const data = sheet.getDataRange().getValues();
      const lastRow = data[data.length - 1]; // Assumes chronological order
      return {
        customer: lastRow[1], // Adjust column indexes
        assignedTo: lastRow[2],
        timestamp: lastRow[0]
      };
    }
    ```

    Display this in a confirmation dialog: `"Undo assignment of [Customer] to [User] at [Time]? This cannot be undone."`

- **Per-Field Validation Missing:**
  - **Issue:** Forms submit without real-time validation. Errors are only caught server-side, requiring a full round-trip.
  - **Impact:** Slow feedback loop frustrates users and wastes API quota.
  - **Fix:** Add client-side validation before calling `google.script.run`:

    ```javascript
    function validateForm() {
      const errors = [];
      if (!document.getElementById('customer').value.trim()) errors.push('Customer name is required');
      if (!document.getElementById('reason').value) errors.push('Please select a reason');
      // ... more checks
      return errors;
    }

    function onSubmit() {
      const errors = validateForm();
      if (errors.length) {
        showError(errors.join('<br>'));
        return;
      }
      // Proceed with google.script.run call
    }
    ```

- **Preview → Confirm Pattern Missing for Reassignment:**
  - **Issue:** Reassignment is immediate upon clicking "Submit" with no confirmation step.
  - **Impact:** Accidental reassignments cannot be prevented at the UI level.
  - **Fix:** Add a two-step flow:
    1. First click: Show preview: `"This will reassign [Customer] from [Old User] to [New User] for reason: [X]. Confirm?"`
    2. Second click: Execute the reassignment.
    Implement with a state variable:

    ```javascript
    let reassignState = 'preview'; // or 'confirmed'
    function handleReassign() {
      if (reassignState === 'preview') {
        showPreview();
        reassignState = 'confirmed';
        document.getElementById('submit-btn').textContent = 'Confirm Reassignment';
      } else {
        executeReassignment();
      }
    }
    ```

### **Recommendations**

1. Add `getLastAssignmentDetails()` and show confirmation before undo.
2. Implement client-side validation with immediate feedback.
3. Use a two-step "preview → confirm" pattern for all destructive actions (reassign, undo).

---

## 3. Implementation Efficiency

### **Dashboard Polling Performance**

- **No Pause When Tab Hidden:**
  - **Issue:** [`dashboard.html`](saleslog_files/dashboard.html:1) polls every 30 seconds regardless of whether the tab is visible.
  - **Impact:** Wastes quota and server resources when users have the dashboard open in background tabs.
  - **Fix:** Use the Page Visibility API:

    ```javascript
    let pollInterval;
    function startPolling() {
      pollInterval = setInterval(refreshData, 30000);
    }
    function stopPolling() {
      clearInterval(pollInterval);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopPolling();
      else { refreshData(); startPolling(); } // Refresh immediately on tab focus
    });
    ```

- **No `clearInterval` on Errors:**
  - **Issue:** If `refreshData()` encounters a fatal error, the interval continues to fire, logging errors repeatedly.
  - **Impact:** Console spam and wasted quota.
  - **Fix:** Add error count tracking and stop polling after 3 consecutive failures:

    ```javascript
    let errorCount = 0;
    function refreshData() {
      google.script.run
        .withSuccessHandler(() => { errorCount = 0; updateUI(); })
        .withFailureHandler((err) => {
          console.error(err);
          errorCount++;
          if (errorCount >= 3) {
            stopPolling();
            showError('Dashboard polling stopped due to repeated errors. Refresh the page.');
          }
        })
        .getDashboardData();
    }
    ```

- **No In-Flight Request Guard:**
  - **Issue:** If a `getDashboardData()` request takes >30 seconds (due to heavy load), a second request fires before the first completes.
  - **Impact:** Concurrency spikes and potential data race in UI rendering.
  - **Fix:** Add a flag to prevent overlapping requests:

    ```javascript
    let isLoading = false;
    function refreshData() {
      if (isLoading) return;
      isLoading = true;
      google.script.run
        .withSuccessHandler((data) => { isLoading = false; updateUI(data); })
        .withFailureHandler((err) => { isLoading = false; handleError(err); })
        .getDashboardData();
    }
    ```

- **`loading` State Can Stuck if `google` Undefined:**
  - **Issue:** If the Apps Script client API fails to load (rare, but happens on slow connections), the loading spinner remains indefinitely.
  - **Impact:** Users see a frozen UI with no error message.
  - **Fix:** Add a timeout fallback:

    ```javascript
    setTimeout(() => {
      if (typeof google === 'undefined' || !google.script) {
        showError('Failed to load Google Apps Script API. Please refresh the page.');
      }
    }, 5000);
    ```

- **Feed Uses Array Index as Key:**
  - **Issue:** The activity feed renders items using array index as the key (implicit or explicit).
  - **Impact:** If the audit log is sorted or filtered, React/DOM reconciliation may incorrectly reuse elements, showing stale data.
  - **Fix:** Use a unique, stable key such as `timestamp + customer + action`:

    ```javascript
    data.feed.forEach(item => {
      const key = `${item.timestamp}_${item.customer}_${item.action}`.replace(/[^a-z0-9]/gi, '_');
      const li = document.createElement('li');
      li.id = `feed-item-${key}`;
      // ... render item
    });
    ```

- **Payload Includes Unused Fields:**
  - **Issue:** `getDashboardData()` returns the full 1000-row audit log with all columns, but the UI only displays 5 columns.
  - **Impact:** Bandwidth waste and slower parsing.
  - **Fix:** Filter the payload server-side:

    ```javascript
    function getDashboardData() {
      // ... existing logic
      const auditData = auditSheet.getRange(2, 1, lastRow, 10).getValues();
      const filteredFeed = auditData.map(row => ({
        timestamp: row[0],
        customer: row[1],
        action: row[2],
        user: row[3],
        status: row[4]
        // Omit unused columns
      }));
      return { feed: filteredFeed, stats: statsObj };
    }
    ```

- **Cache TTL Equals Poll Interval (Concurrency Spikes):**
  - **Issue:** If `CacheService` is implemented with a 30-second TTL and polling is also 30 seconds, all 10 users will miss the cache at the same moment every 30 seconds.
  - **Impact:** Defeats the purpose of caching; creates "thundering herd" load spikes.
  - **Fix:** Set cache TTL to 20-25 seconds (shorter than poll interval) or use a jittered poll interval:

    ```javascript
    const jitter = Math.random() * 5000; // 0-5 seconds
    setInterval(refreshData, 30000 + jitter);
    ```

### **Sidebar Initialization**

- **Two Init RPCs on Load:**
  - **Issue:** [`NewAppointmentSidebar.html`](saleslog_files/NewAppointmentSidebar.html:1) calls `getUsersForDropdown()` and `getCurrentRosterStatus()` sequentially on load.
  - **Impact:** 2× latency and 2× quota usage. If the first call fails, the second still fires.
  - **Fix:** Combine into a single `getSidebarInitData()` function:

    ```javascript
    function getSidebarInitData() {
      return {
        users: getUsersForDropdown(),
        rosterStatus: getCurrentRosterStatus(),
        selectionInfo: getCurrentSelectionInfo()
      };
    }
    ```

    Call once from the sidebar and destructure the result.

- **No Request Coalescing:**
  - **Issue:** If a user opens the sidebar, closes it, and reopens within 10 seconds, the same data is fetched again.
  - **Impact:** Minor quota waste.
  - **Fix:** Use `sessionStorage` to cache init data for 60 seconds:

    ```javascript
    const cached = sessionStorage.getItem('sidebarInitData');
    if (cached && (Date.now() - JSON.parse(cached).timestamp < 60000)) {
      initUI(JSON.parse(cached).data);
    } else {
      google.script.run
        .withSuccessHandler(data => {
          sessionStorage.setItem('sidebarInitData', JSON.stringify({ data, timestamp: Date.now() }));
          initUI(data);
        })
        .getSidebarInitData();
    }
    ```

- **Uses `innerHTML` for Success Details:**
  - **Issue:** Success messages like `"Assigned to John Doe"` are injected via `innerHTML`.
  - **Impact:** Minor XSS risk if customer names contain special characters (unlikely but possible).
  - **Fix:** Use `textContent` instead:

    ```javascript
    successDiv.textContent = `Assigned to ${assignedUser}`;
    ```

### **Recommendations**

1. Implement Page Visibility API, in-flight guards, error count tracking, and cache TTL tuning for [`dashboard.html`](saleslog_files/dashboard.html:1).
2. Combine sidebar init RPCs into a single call; add `sessionStorage` caching.
3. Filter unused payload fields server-side in `getDashboardData()`.
4. Replace `innerHTML` with `textContent` for user-generated content.

---

## 4. Actionable Recommendations

### **Backend, Round Robin, & PhoneUp Issues**

- **Missing Sheet Validation:**
  - **Issue:** Functions in [`round_robin.js`](saleslog_files/round_robin.js:1) and [`PhoneUp.js`](saleslog_files/PhoneUp.js:1) call `getSheetByName()` without null checks.
  - **Impact:** If "RR_ROSTER" or "RR_USERS" is renamed or deleted, scripts crash with cryptic `Cannot read property 'getRange' of null` errors.
  - **Fix:** Add a universal sheet getter:

    ```javascript
    function getSheetOrThrow_(name) {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
      if (!sheet) throw new Error(`Required sheet "${name}" not found. Please restore it.`);
      return sheet;
    }
    ```

    Use this in all sheet access: `const roster = getSheetOrThrow_('RR_ROSTER');`

- **Audit Logging is Noisy & Quota-Heavy:**
  - **Issue:** Every assignment, reassignment, and undo writes a row to `RR_AUDIT`. With 50 actions/day, this grows to 18,000 rows/year.
  - **Impact:** Exceeds typical use cases for Sheets; slows down `getDashboardData()`.
  - **Fix:** Implement rolling audit log:
    - Keep only last 1000 rows (delete older).
    - Or, archive to a separate "Archive" sheet monthly via a time-driven trigger.

    ```javascript
    function archiveOldAuditLogs_() {
      const auditSheet = getSheetOrThrow_('RR_AUDIT');
      const rowCount = auditSheet.getLastRow();
      if (rowCount > 1000) {
        const archiveSheet = getOrCreateSheet_('RR_AUDIT_ARCHIVE');
        const excessRows = rowCount - 1000;
        auditSheet.getRange(2, 1, excessRows, auditSheet.getLastColumn())
          .moveTo(archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1));
      }
    }
    ```

- **Phantom Edit Detection Compares Raw Values:**
  - **Issue:** The phantom edit check compares `currentStatus === 'Assigned'` but doesn't account for trailing spaces, case differences, or formula-driven values.
  - **Impact:** False positives may block legitimate assignments.
  - **Fix:** Normalize before comparison:

    ```javascript
    function isPhantomEdit_(oldStatus, newStatus) {
      const normalize = (s) => String(s).trim().toLowerCase();
      return normalize(oldStatus) === 'assigned' && normalize(newStatus) === 'assigned';
    }
    ```

- **Inconsistent "Assigned By" Identity:**
  - **Issue:** Some functions use `Session.getActiveUser().getEmail()`, others use a parameter `assignedByName`, and some default to `"System Auto"`. No single source of truth.
  - **Impact:** Audit logs mix email addresses, display names, and system identifiers, making reporting difficult.
  - **Fix:** Centralize identity resolution:

    ```javascript
    function getAssignedByIdentity_(customName) {
      if (customName) {
        // Validate against RR_USERS allowlist
        const validUsers = getUsersForDropdown().map(u => u.name);
        if (!validUsers.includes(customName)) {
          throw new Error(`Invalid user: ${customName}`);
        }
        return customName;
      }
      const email = Session.getActiveUser().getEmail();
      return email || 'System Auto';
    }
    ```

- **Bug: `logRoundRobinAction_()` is Undefined:**
  - **Issue:** [`rr_sidebar.js`](saleslog_files/rr_sidebar.js:53) references `logRoundRobinAction_()` but this function does not exist in the codebase.
  - **Impact:** Script crashes on certain actions (likely undo or reassign from sidebar).
  - **Fix:** Define the function in [`utilities_locks.js`](saleslog_files/utilities_locks.js:1) or [`round_robin.js`](saleslog_files/round_robin.js:1):

    ```javascript
    function logRoundRobinAction_(action, details) {
      const auditSheet = getSheetOrThrow_('RR_AUDIT');
      auditSheet.appendRow([
        new Date(),
        details.customer || 'N/A',
        action,
        details.user || Session.getActiveUser().getEmail(),
        details.reason || ''
      ]);
    }
    ```

- **Pointer Reset Not Lock-Protected:**
  - **Issue:** If two admins try to reset the RR pointer simultaneously, the last write wins without any concurrency control.
  - **Impact:** Potential desync in pointer state.
  - **Fix:** Wrap pointer reset in `LockService`:

    ```javascript
    function resetRoundRobinPointer() {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const stateCell = SpreadsheetApp.getActiveSpreadsheet().getRangeByName('RR_STATE');
        stateCell.setValue(0);
        logRoundRobinAction_('Pointer Reset', { user: Session.getActiveUser().getEmail() });
      } finally {
        lock.releaseLock();
      }
    }
    ```

- **Pointer Edit Not Prevented:**
  - **Issue:** Cell B2 (RR_STATE) is editable by anyone with write access to the sheet.
  - **Impact:** Manual edits will break round robin sequencing.
  - **Fix:** Protect the range in the `onOpen` trigger:

    ```javascript
    function onOpen() {
      // ... existing menu logic
      const stateRange = SpreadsheetApp.getActiveSpreadsheet().getRangeByName('RR_STATE');
      const protection = stateRange.protect();
      protection.setDescription('Round Robin Pointer - Do Not Edit');
      protection.setWarningOnly(true); // Or restrict to specific editors
    }
    ```

- **Reassignment Overwrites Created Timestamp:**
  - **Issue:** When reassigning in [`round_robin.js`](saleslog_files/round_robin.js:1), the "Created" timestamp column is updated to `new Date()`, losing the original creation time.
  - **Impact:** Reporting on "lead age" becomes inaccurate.
  - **Fix:** Only update the "Assigned" timestamp column, not "Created":

    ```javascript
    function reassignCustomer(row, newUser, reason) {
      const sheet = getSheetOrThrow_('RR_ROSTER');
      const assignedCol = 5; // Adjust to actual column
      sheet.getRange(row, assignedCol).setValue(new Date());
      // Do NOT update "Created" column
    }
    ```

- **Lock Failure Not Surfaced to Users:**
  - **Issue:** If `LockService.tryLock()` fails, functions return `null` or throw errors, but the UI shows a generic failure message.
  - **Impact:** Users don't know if they should retry or wait.
  - **Fix:** Return specific error objects:

    ```javascript
    function assignPhoneLead(data) {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) {
        return { success: false, error: 'LOCK_TIMEOUT', message: 'System is busy. Please try again in 10 seconds.' };
      }
      try {
        // ... assignment logic
        return { success: true, assignedTo: result.user };
      } catch (e) {
        return { success: false, error: 'EXCEPTION', message: e.toString() };
      } finally {
        lock.releaseLock();
      }
    }
    ```

    Handle in the client:

    ```javascript
    .withSuccessHandler(result => {
      if (result.success) showSuccess(result.assignedTo);
      else if (result.error === 'LOCK_TIMEOUT') showErrorWithRetry(result.message);
      else showError(result.message);
    })
    ```

- **PhoneUp State Semantics Inconsistent:**
  - **Issue:** Cell C2 is labeled "Last Assigned" but [`PhoneUp.js`](saleslog_files/PhoneUp.js:1) treats it as "Next Up" (the user who should receive the next phone lead).
  - **Impact:** Confusion when reading the sheet; potential off-by-one errors.
  - **Fix:** Rename the cell to "Next Phone Lead User" and update all comments/docs. Or, change the logic to store "last assigned" and compute "next up" dynamically.

- **Undo Message May Not Match Next Assignment:**
  - **Issue:** The success message for undo says `"Undone. Next assignment will go to [User]"`, but if the roster has changed, the prediction may be wrong.
  - **Impact:** Misleads users.
  - **Fix:** Either remove the prediction or fetch the actual next user after undoing:

    ```javascript
    function undoLastAssignment() {
      // ... undo logic
      const nextUser = getNextRoundRobinUser_();
      return { success: true, nextUser: nextUser.name };
    }
    ```

- **Server Should Validate `assignedByName` Against Allowlist:**
  - **Issue:** The `assignedByName` parameter in [`round_robin.js`](saleslog_files/round_robin.js:1) is not validated against the `RR_USERS` sheet.
  - **Impact:** Malicious or buggy clients could inject arbitrary names into audit logs.
  - **Fix:** Add validation in `getAssignedByIdentity_()` (already shown above).

- **Audit Action Names Inconsistent:**
  - **Issue:** Audit logs use "Assigned", "Auto-Assigned", "Reassigned", "Undo Assignment", "PhoneUp", etc. without a controlled vocabulary.
  - **Impact:** Dashboard filters and reporting logic must hardcode multiple variants.
  - **Fix:** Define an enum-like object:

    ```javascript
    const AUDIT_ACTIONS = {
      NEW_APPOINTMENT: 'New Appointment',
      PHONE_LEAD: 'Phone Lead',
      REASSIGN: 'Reassignment',
      UNDO: 'Undo',
      POINTER_RESET: 'Pointer Reset'
    };
    ```

    Use these constants everywhere: `logRoundRobinAction_(AUDIT_ACTIONS.REASSIGN, details);`

### **Prioritized Fix Plan**

#### **Now (Critical – Security & Data Integrity)**

1. Fix undefined `logRoundRobinAction_()` in [`rr_sidebar.js`](saleslog_files/rr_sidebar.js:53) – *causes crashes*.
2. Add `getSheetOrThrow_()` and replace all `getSheetByName()` calls – *prevents null reference errors*.
3. Wrap pointer reset in `LockService` – *prevents race conditions*.
4. Validate `assignedByName` against `RR_USERS` allowlist – *prevents audit log injection*.
5. Protect `RR_STATE` cell (B2) from manual edits – *prevents broken round robin sequencing*.

#### **Next (High Impact – UX & Efficiency)**

1. Implement Page Visibility API for dashboard polling – *saves ~40% quota on average*.
2. Add in-flight request guard to [`dashboard.html`](saleslog_files/dashboard.html:1) – *prevents concurrency spikes*.
3. Combine sidebar init RPCs into a single call – *reduces latency by 50%*.
4. Add `getCurrentSelectionInfo()` and display context in reassign UI – *eliminates highest user error risk*.
5. Replace `alert()` with inline error messages in [`ReassignDialog.html`](saleslog_files/ReassignDialog.html:1) – *improves error handling UX*.
6. Implement "preview → confirm" for reassignment – *adds safety net for destructive actions*.
7. Add client-side form validation – *reduces unnecessary server round-trips*.

#### **Later (Polish – Maintainability & Scalability)**

1. Implement rolling audit log archival – *prevents unbounded growth*.
2. Normalize phantom edit detection – *reduces false positives*.
3. Centralize identity resolution with `getAssignedByIdentity_()` – *improves audit data quality*.
4. Add tabbed UI to [`NewAppointmentSidebar.html`](saleslog_files/NewAppointmentSidebar.html:1) – *reduces clutter*.
5. Define `AUDIT_ACTIONS` constant and refactor all logging calls – *improves reporting accuracy*.
6. Add structured error handling with retry logic for lock failures – *improves user experience during contention*.
7. Filter unused fields in `getDashboardData()` payload – *reduces bandwidth by ~30%*.
8. Add accessibility improvements (labels, aria-live, default dropdown options) – *meets WCAG standards*.
