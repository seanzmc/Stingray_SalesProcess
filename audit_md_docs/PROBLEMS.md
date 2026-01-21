# PROBLEMS

## Audit Log User Capture Issue - Analysis

**Yes, there is a critical bug**: The Audit Log is **NOT reliably capturing the current active user** for "Manual Edit" and "Manual Override" actions.

### Root Cause

The [`getEventUserEmail_(e)`](saleslog_files/round_robin.js:1083-1092) function has a fundamental flaw when used with **installable triggers**:

```javascript
function getEventUserEmail_(e) {
  if (e && e.user && e.user.email) return e.user.email;  // ❌ Rarely populated
  try {
    const active = Session.getActiveUser().getEmail();   // ❌ Often empty/wrong
    if (active) return active;
  } catch (_) {}
  return safeUserEmail_();  // ❌ Returns script owner, not editor
}
```

**Google Apps Script Limitation**: Installable "On edit" triggers do NOT reliably provide the editing user's email in `e.user`, and `Session.getActiveUser()` often returns empty or incorrect values in trigger context. The fallback `Session.getEffectiveUser()` returns the **script owner/service account**, not the actual editor.

### Affected Locations

1. **Manual Edit** - Line 237 in [`handleAppointmentEdit`](saleslog_files/round_robin.js:237):
   - Logs every edit with incorrect user

2. **Manual Override** - Line 302-308 in [`handleAppointmentEdit`](saleslog_files/round_robin.js:302-308):
   - Logs assignment changes with incorrect user

3. **Roster Changes** - Line 409 in [`handleRosterEdit`](saleslog_files/round_robin.js:409)

4. **Pointer Edits** - Line 363 in [`handleRRStateEdit`](saleslog_files/round_robin.js:363)

### Why Other Actions Work

Actions like "New Appointment", "Reassignment", and "Phone Lead" capture users correctly because they:

- Run from **custom menus** or **sidebars** (not installable triggers)
- Use [`safeUserEmail_()`](saleslog_files/round_robin.js:1074) in contexts where `Session.getEffectiveUser()` returns the actual logged-in user
- Have the audit user explicitly passed via `opts.auditUser` parameter

### Recommended Solution

This is a **known Google Apps Script platform limitation** with no perfect solution. Options:

1. **Document the limitation** - Add a note that manual sheet edits may show the script owner's email
2. **Add a warning marker** - Modify `safeUserEmail_()` to return `"[System/Owner]"` when used in trigger context
3. **Require UI-based edits** - Force users to use custom dialogs/sidebars that can capture user identity before writing to sheets
4. **Track last known user** - Cache the last authenticated user in UserProperties (imperfect but better than nothing)

The audit log IS working as designed within Apps Script constraints, but the platform itself prevents accurate user identification for direct sheet edits via installable triggers.

## Roster Change breaks Round Robin because of index-based pointer

The current index-based pointer in advanceRoundRobinPointer_() can point to incorrect people after roster changes because:

- Pointer stores numeric index (0-9)
- When roster shrinks, modulo wraps pointer to different position
- When person removed from middle, all subsequent indices shift
- No memory of "who was last assigned"

### Fix: Name-Based Tracking (Recommended)

**Approach**: Store last assigned person's name instead of index, mirroring Phone Up logic

Pros:

- Most robust - proven working in Phone Up system
- Handles removals gracefully (resets to start if person not found)
- Immune to roster reordering
- Clear audit trail (name is human-readable)

Cons:

- Requires state migration from index to name
- Slightly more computation (indexOf search)

### Implementation

1. Change RR_STATE!B2 to store name instead of index
2. Modify advanceRoundRobinPointer_() to use Phone Up pattern
3. Update getPointer_() to return name string
4. Update setPointer_() to accept name string

*Rationale*: It's proven, simple, and aligns with Phone Up's successful pattern. Consistency across both systems reduces maintenance burden.

- **Phase 1: Add New Name Storage (Non-Breaking)**

1. Add new state cell RR_STATE!D2 for "Last Assigned Name (Appointments)"
2. Modify advanceRoundRobinPointer_():

- After assignment, write assignee name to D2
- Keep existing pointer logic working

1. Test: Verify names are being captured correctly

- **Phase 2: Implement Name-Based Logic**

1. Create new function advanceRoundRobinPointerByName_():

```javascript
function advanceRoundRobinPointerByName_(roster, auditInfo) {
  const stateSheet = getStateSheet_();
  const lastAssignedName = stateSheet.getRange('D2').getValue();

  let nextIndex = 0;
  if (lastAssignedName) {
    const lastIndex = roster.indexOf(String(lastAssignedName).trim());
    if (lastIndex !== -1) {
      nextIndex = (lastIndex + 1) % roster.length;
    }
  }

  const assignee = roster[nextIndex];
  stateSheet.getRange('D2').setValue(assignee);

  // Keep numeric pointer in sync for transition period
  stateSheet.getRange(CELL_POINTER).setValue(nextIndex);

  logRoundRobinEvent(auditInfo.actionType, {
    assignee: assignee,
    nextUp: roster[(nextIndex + 1) % roster.length],
    rosterCount: roster.length,
    ...auditInfo.details
  });

  return { assignee, nextIndex };
}
```

1. Update assignRowAuto_():

- Replace advanceRoundRobinPointer_() call with advanceRoundRobinPointerByName_()

1. Update sidebar in rr_sidebar.js:

- Replace advanceRoundRobinPointer_() call with new function

- **Phase 3: Update Rewind/Reset Functions**

1. Modify menuRewindPointer():

- Search for current name in roster
- Calculate previous person
- Update both name cell and numeric pointer

1. Modify menuResetPointer():

- Clear name cell or set to first person in roster
- Set numeric pointer to 0

- **Phase 4: Migration & Cleanup**

1. Create migration function:

```javascript
function migratePointerToName() {
  const roster = getEligibleRoster_();
  const currentPointer = getPointer_();
  const normalizedIndex = normalizePointer_(currentPointer, roster.length);
  const currentAssignee = roster[normalizedIndex];

  getStateSheet_().getRange('D2').setValue(currentAssignee);
  logRoundRobinEvent('System Migration', {
    from: 'Index-Based',
    to: 'Name-Based',
    currentPointer: currentPointer,
    currentAssignee: currentAssignee
  });
}
```

1. Run migration on production (one-time, manual execution)

2. Deprecate old functions (after observation period):

- Keep CELL_POINTER as read-only for reports/debugging
- Remove normalization logic from assignment path
- Update documentation

- **Testing Checklist**

- **Unit Tests**
  - Name-based assignment advances correctly
  - Reset to index 0 when last assigned person not found
  - Handles empty roster gracefully
  - Handles single-person roster
  - Rewind finds correct previous person

- **Integration Tests**
  - New appointment assignment works
  - Sidebar appointment creation works
  - Reassignment maintains rotation
  - Rewind pointer menu function works
  - Reset pointer menu function works

- **Roster Change Scenarios**
  - Remove person from middle → rotation continues cleanly
  - Remove last assigned person → resets to start
  - Re-add previously removed person → picks up correctly
  - Toggle person's Eligible status off/on → handles gracefully
  - Reorder roster → no impact on rotation

- **Audit Trail Verification**
  - All assignments logged with correct assignee
  - Roster changes captured in audit log
  - Migration event logged
  - Legacy pointer edits still logged

- **Rollback Strategy**
  - Keep numeric pointer updated during transition period
  - If issues arise, revert to calling original advanceRoundRobinPointer_()
  - Preserve audit logs - no data loss
  - Document state: Both D2 (name) and B2 (index) available for recovery

- **Documentation Updates**
  - Update round_robin_tutorial.md with new logic
  - Add roster change handling section
  - Update trigger documentation
  - Add migration notes for future maintainers

- **Timeline Estimate**
  - Phase 1: 1-2 hours (add name tracking, non-breaking)
  - Phase 2: 2-3 hours (implement name-based logic)
  - Phase 3: 1-2 hours (update rewind/reset)
  - Phase 4: 1 hour (migration + cleanup)
  - Testing: 2-3 hours (comprehensive testing)

## "Rewind Pointer" (Undo) leaves the appointment record intact without context

To address the edge case where "Rewind Pointer" (Undo) leaves the appointment record intact without context, I will create a new dialog interface for the rewind action and update the backend logic to log the reason to both the audit log and the last appointment's notes.

Here are the changes:

1. **`saleslog_files/round_robin.js`**:
   - Added `COL_NOTES` constant.
   - Defined `REWIND_REASONS`.
   - Updated `menuRewindPointer` to launch a new modal dialog instead of executing immediately.
   - Added `processMenuRewind(reason)` to handle the logic: rewinding the pointer, logging the specific reason to `RR_AUDIT`, and appending the reason to the `Notes` column of the last row in `APPOINTMENTS`.

2. **`saleslog_files/RewindDialog.html`**:

- Created a new HTML file (based on the style of `ReassignDialog.html`) to capture the "Reason for Rewind".

### 1. `saleslog_files/round_robin.js`

### 2. `saleslog_files/RewindDialog.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top" />
    <style>
      body {
        font-family: sans-serif;
        padding: 10px;
      }
      select,
      button {
        width: 100%;
        padding: 8px;
        margin-top: 10px;
        box-sizing: border-box;
      }
      button {
        background-color: #FF5252;
        color: white;
        border: none;
        cursor: pointer;
      }
      button:hover {
        background-color: #d32f2f;
      }
      button.cancel {
        background-color: #ccc;
        color: black;
        margin-top: 5px;
      }
    </style>
  </head>
  <body>
    <div>
      <h3 style="margin-top: 0; color: #333;">Confirm Rewind</h3>
      <p style="font-size: 13px; color: #666;">This will move the rotation pointer back one step.</p>

      <label for="reason">Select Reason:</label>
      <select id="reason">
        <? for (var i = 0; i < reasons.length; i++) { ?>
        <option value="<?= reasons[i] ?>"><?= reasons[i] ?></option>
        <? } ?>
      </select>

      <button onclick="submit()">Confirm Rewind</button>
      <button class="cancel" onclick="google.script.host.close()">
        Cancel
      </button>
    </div>
    <script>
      function submit() {
        var reason = document.getElementById('reason').value;
        var btn = document.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Processing...';

        google.script.run
          .withSuccessHandler(function () {
            google.script.host.close();
          })
          .withFailureHandler(function (err) {
            alert('Error: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Confirm Rewind';
          })
          .processMenuRewind(reason);
      }
    </script>
  </body>
</html>

```
