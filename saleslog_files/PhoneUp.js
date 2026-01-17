/**
 * Phone Lead Round Robin System
 *
 * REFACTORED CONFIGURATION:
 * 1. Roster Source: "RR_ROSTER" (Cols A=Name, B=Active, C=Eligible)
 *    - Same logic as round_robin.js (Must be Active AND Eligible)
 * 2. State Tracking: "RR_STATE" Cell C2
 *    - Stores "Last Assigned Name" for Phone Ups
 * 3. Logging: "RR_AUDIT"
 *    - Centralized audit log
 */

// Configuration
// Note: SHEET_ROSTER, SHEET_STATE, SHEET_AUDIT are defined in round_robin.js ('RR_ROSTER', 'RR_STATE', 'RR_AUDIT')
// and are available globally in the project.

const CELL_LAST_ASSIGNED_PHONE = "C2"; // Phone Up Pointer

/**
 * Menu trigger function.
 * Wraps the logic with UI alerts/toasts for the manual menu item.
 */
function getNextPhoneUpMenu() {
  try {
    const assignedName = assignPhoneLead();
    SpreadsheetApp.getActiveSpreadsheet().toast(`Assigned to: ${assignedName}`, "Phone Up");
    Browser.msgBox(`Phone Lead Assigned To:\\n\\n${assignedName}`);
  } catch (e) {
    Logger.log(e);
    Browser.msgBox("Error: " + e.message);
  }
}

/**
 * Core Logic Function.
 * Returns the assigned name (string) or throws error.
 * Can be called by sidebar (google.script.run) or menu.
 */
function assignPhoneLead() {
  // Use robust lock acquisition
  const lockResult = acquireScriptLockWithRetry();

  if (!lockResult.success) {
    throw new Error('System busy (Lock Timeout). Please try again.');
  }

  try {
    return executePhoneUpAssignment_();
  } finally {
    lockResult.lock.releaseLock();
  }
}

/**
 * Undo the last Phone Up assignment (Rewind Rotation).
 * Called by Sidebar.
 */
function undoLastPhoneUp() {
  const lockResult = acquireScriptLockWithRetry();

  if (!lockResult.success) {
    throw new Error('System busy (Lock Timeout). Please try again.');
  }

  try {
    const rosterSheet = getSheetOrThrow_(SHEET_ROSTER);
    const stateSheet = getSheetOrThrow_(SHEET_STATE);

    // 1. Read Inputs (Eligible Roster)
    const lastRow = rosterSheet.getLastRow();
    if (lastRow < 2) throw new Error("No salespeople configured in RR_ROSTER.");

    const activeUsers = getEligibleRoster_();
    if (activeUsers.length === 0) {
      throw new Error("No active and eligible salespeople found.");
    }

    // 2. Read Current State
    const currentName = stateSheet.getRange(CELL_LAST_ASSIGNED_PHONE).getValue();
    let currentIndex = 0;

    // Find index of current assignee
    if (currentName) {
      const idx = activeUsers.indexOf(String(currentName).trim());
      if (idx !== -1) {
        currentIndex = idx;
      }
    }

    // 3. Rewind Logic
    // Use the shared helper from round_robin.js
    const newIndex = calculateRewoundIndex_(currentIndex, activeUsers.length);
    const newName = activeUsers[newIndex];

    // 4. Update State
    stateSheet.getRange(CELL_LAST_ASSIGNED_PHONE).setValue(newName);

    // 5. Log
    logRoundRobinEvent(AUDIT_ACTIONS.UNDO, {
      user: Session.getActiveUser().getEmail(),
      assigneeBefore: currentName,
      assigneeAfter: newName,
      reason: 'User Sidebar Undo',
      target: AUDIT_ACTIONS.PHONE_LEAD
    });

    return `Rotation rewound. Last Assigned is now ${newName}`;

  } catch (e) {
    logError('undoLastPhoneUp', e);
    throw e;
  } finally {
    lockResult.lock.releaseLock();
  }
}

/**
 * Internal worker function for assignment logic.
 * Assumes lock is already acquired.
 */
function executePhoneUpAssignment_() {
  const rosterSheet = getSheetOrThrow_(SHEET_ROSTER);
  const stateSheet = getSheetOrThrow_(SHEET_STATE);

  // 1. Read Inputs (Eligible Roster)
  const lastRow = rosterSheet.getLastRow();
  if (lastRow < 2) throw new Error("No salespeople configured in RR_ROSTER.");

  const activeUsers = getEligibleRoster_();
  if (activeUsers.length === 0) {
    throw new Error("No active and eligible salespeople found.");
  }

  // Read Last Assigned Name from RR_STATE!C2
  const lastAssignedName = stateSheet.getRange(CELL_LAST_ASSIGNED_PHONE).getValue();

  // 2. Logic: Find next person
  let nextIndex = 0;

  if (lastAssignedName) {
    const lastIndex = activeUsers.indexOf(String(lastAssignedName).trim());
    if (lastIndex !== -1) {
      // Found in current active list, move to next
      nextIndex = (lastIndex + 1) % activeUsers.length;
    } else {
      // Last person no longer active or found, start at 0
      nextIndex = 0;
    }
  }

  const assignedName = activeUsers[nextIndex];

  // 3. Updates

  // A. Local State (RR_STATE!C2)
  stateSheet.getRange(CELL_LAST_ASSIGNED_PHONE).setValue(assignedName);

  // B. Unified Logging (RR_AUDIT)
  logRoundRobinEvent(AUDIT_ACTIONS.PHONE_LEAD, {
    assignee: assignedName,
    method: "System Rotation"
  });

  return assignedName;
}
