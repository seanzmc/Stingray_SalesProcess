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
 * Internal worker function for assignment logic.
 * Assumes lock is already acquired.
 */
function executePhoneUpAssignment_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rosterSheet = ss.getSheetByName(SHEET_ROSTER);
  const stateSheet = ss.getSheetByName(SHEET_STATE);

  if (!rosterSheet || !stateSheet) {
    throw new Error(`Missing sheets '${SHEET_ROSTER}' or '${SHEET_STATE}'.`);
  }

  // 1. Read Inputs (Eligible Roster)
  const lastRow = rosterSheet.getLastRow();
  if (lastRow < 2) throw new Error("No salespeople configured in RR_ROSTER.");

  // Read names (A), Active (B), Eligible (C) from RR_ROSTER
  // Assuming standard layout: Col 1=Name, Col 2=Active, Col 3=Eligible
  const rosterValues = rosterSheet.getRange(2, 1, lastRow - 1, 3).getValues();

  // Filter: Must be Active (Col 2 === true) AND Eligible (Col 3 === true)
  const activeUsers = rosterValues
    .filter(r => r[0] && r[1] === true && r[2] === true)
    .map(r => String(r[0]).trim());

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
  logPhoneUpAction_(ss, "Phone Up Assigned", assignedName, "System Rotation");

  return assignedName;
}

/**
 * Helper to append to RR_AUDIT
 */
function logPhoneUpAction_(ss, action, assignedName, details) {
  try {
    let auditSheet = ss.getSheetByName(SHEET_AUDIT);
    if (!auditSheet) {
      // If audit sheet missing, try to create or fail gracefully? 
      // User requirement implies it exists or we should ensure it. 
      // round_robin.js creates it if missing, we can do same or skip.
      // Let's assume it exists or fail safely to log.
      auditSheet = ss.insertSheet(SHEET_AUDIT);
      auditSheet.appendRow(['Timestamp', 'User', 'Action', 'Reference', 'Details']);
    }

    const now = new Date();
    const user = Session.getEffectiveUser().getEmail();

    // Header format: [Timestamp, User, Action, Reference, Details]
    // Action = "Phone Up Assigned"
    // Reference = assignedName
    // Details = details ("System Rotation")

    auditSheet.appendRow([
      now,
      user,
      action,
      assignedName, // Using Reference col for the assigned person name as per request format?
      // User Request: [Timestamp, "Phone Up Assigned", Assigned_Name, "System Rotation"]
      // My proposed headers: [Timestamp, User, Action, Reference, Details]
      // Mapping: 
      // Timestamp -> Timestamp
      // User -> User (implicit in request? request said [Timestamp, "Phone Up Assigned", Assigned_Name, "System Rotation"])
      // Wait, user request for Phone Up Action was specific: 
      // `[Timestamp, "Phone Up Assigned", Assigned_Name, "System Rotation"]`
      // But round_robin.js uses 5 columns: Timestamp, User, Action, Reference, Details.
      // I will stick to the 5-column standard of the existing system I saw in round_robin.js to be truly "Unified",
      // but I will ensure the content matches the intent.

      details
    ]);

  } catch (e) {
    console.error("Failed to write to RR_AUDIT", e);
    // Don't block main flow
  }
}

