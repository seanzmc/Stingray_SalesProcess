/**
 * Phone Lead Round Robin System
 * 
 * SETUP INSTRUCTIONS:
 * 1. Sheet "PhoneUp_Settings":
 *    - C1: Stores "Last Assigned Name" (Visible to users).
 *    - Row 1 Headers: "Salesperson Name", "Status"
 *    - Column A (A2:A): Salesperson Name
 *    - Column B (B2:B): Status ("Active")
 * 
 * 2. Sheet "PhoneUp_Log":
 *    - Row 1 Headers: "Timestamp", "Salesperson Assigned"
 * 
 * 3. Sheet "RR_AUDIT" (Optional/Secondary):
 *    - Used for dual logging if available.
 */

// Configuration
const SHEET_PHONE_SETTINGS = "PhoneUp_Settings";
const SHEET_PHONE_LOG = "PhoneUp_Log";
const CELL_LAST_ASSIGNED = "C1"; // Visible storage for transparency

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
  // Use existing lock utility if available, otherwise direct usage
  // core_saleslogPro.js defines withScriptLock, so we can use that for safety
  // or use the internal logic here if we want absolute isolation as originally requested.
  // User asked to "Reuse... utilities_locks.js".

  if (typeof withScriptLock === 'function') {
    return withScriptLock(executePhoneUpAssignment_);
  } else {
    // Fallback if utility not found
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      throw new Error('System busy. Please try again.');
    }
    try {
      return executePhoneUpAssignment_();
    } finally {
      lock.releaseLock();
    }
  }
}

/**
 * Internal worker function for assignment logic.
 * Assumes lock is already acquired.
 */
function executePhoneUpAssignment_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName(SHEET_PHONE_SETTINGS);
  const logSheet = ss.getSheetByName(SHEET_PHONE_LOG);

  if (!settingsSheet || !logSheet) {
    throw new Error(`Missing sheets '${SHEET_PHONE_SETTINGS}' or '${SHEET_PHONE_LOG}'.`);
  }

  // 1. Read Inputs (Active List & Last Assigned)
  const lastRow = settingsSheet.getLastRow();
  if (lastRow < 2) throw new Error("No salespeople configured.");

  // Read names and statuses (A2:B)
  const rosterValues = settingsSheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const activeUsers = rosterValues
    .map(r => ({ name: r[0], status: r[1] }))
    .filter(u => u.name && String(u.status).trim().toLowerCase() === "active")
    .map(u => u.name);

  if (activeUsers.length === 0) {
    throw new Error("No active salespeople found.");
  }

  // Read Last Assigned Name from C1
  const lastAssignedName = settingsSheet.getRange(CELL_LAST_ASSIGNED).getValue();

  // 2. Logic: Find next person
  let nextIndex = 0;

  if (lastAssignedName) {
    const lastIndex = activeUsers.indexOf(lastAssignedName);
    if (lastIndex !== -1) {
      // Found in current active list, move to next
      nextIndex = (lastIndex + 1) % activeUsers.length;
    } else {
      // Last person no longer active or found, start at 0 (or could try to find closest... keeping simpple: 0)
      nextIndex = 0;
    }
  }

  const assignedName = activeUsers[nextIndex];

  // 3. Updates

  // A. Local State (C1)
  settingsSheet.getRange(CELL_LAST_ASSIGNED).setValue(assignedName);

  // B. Primary Log (Critical)
  try {
    logSheet.appendRow([new Date(), assignedName]);
  } catch (e) {
    console.error("Critical: Failed to write to PhoneUp_Log", e);
    throw new Error("Failed to write to primary log. Assignment aborted.");
  }

  // C. Secondary/Audit Log (Non-Critical)
  // Reusing logToGlobalAudit_ pattern if flexible, or implementing inline to match user request
  try {
    // Check if logRoundRobinAction_ exists (from round_robin.js) and is global
    if (typeof logRoundRobinAction_ === 'function') {
      logRoundRobinAction_('Phone Up Assignment', {
        assignee: assignedName,
        method: 'PhoneUp Script'
      });
    } else {
      // Manual append to RR_AUDIT if helper not found but sheet might exist.
      const auditSheet = ss.getSheetByName('RR_AUDIT');
      if (auditSheet) {
        auditSheet.appendRow([new Date(), Session.getEffectiveUser().getEmail(), 'Phone Up Assignment', '', `Assignee=${assignedName}`]);
      }
    }
  } catch (e) {
    console.warn("Non-critical: Failed to write to global audit_log", e);
    // Do not throw
  }

  return assignedName;
}
