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
const SPANISH_RR_NAME = 'Spanish Speaking Sales RR';
const SPANISH_RR_HEADER = 'SPANISH SPEAKER';
const SPANISH_RR_LAST_ASSIGNED_KEY = 'RR:SPANISH:LAST_ASSIGNED';
const SPANISH_RR_HISTORY_KEY = 'RR:SPANISH:HISTORY';
const SPANISH_RR_HISTORY_LIMIT = 200;

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

/**
 * Assign the next salesperson from the Spanish-only roster.
 * Uses isolated state in Script Properties (RR:SPANISH:*).
 */
function assignSpanishSpeaker() {
  const lockResult = acquireScriptLockWithRetry();

  if (!lockResult.success) {
    throw new Error('System busy (Lock Timeout). Please try again.');
  }

  try {
    return executeSpanishSpeakerAssignment_();
  } finally {
    lockResult.lock.releaseLock();
  }
}

/**
 * Undo/recall the most recent Spanish assignment.
 * Rewinds Spanish RR state to the previous assignee using Spanish-only history.
 */
function undoSpanishSpeakerAssignment() {
  const lockResult = acquireScriptLockWithRetry();

  if (!lockResult.success) {
    throw new Error('System busy (Lock Timeout). Please try again.');
  }

  try {
    const roster = getSpanishRoster_();
    if (!roster.length) {
      throw new Error('No Spanish speakers available in RR_ROSTER (SPANISH SPEAKER = "TRUE").');
    }

    const history = getSpanishAssignmentHistory_();
    if (!history.length) {
      return 'No Spanish assignment history available to undo.';
    }

    const recalledAssignee = history.pop();
    const previousAssignee = history.length ? history[history.length - 1] : '';
    setSpanishAssignmentState_(previousAssignee, history);

    logRoundRobinEvent(AUDIT_ACTIONS.UNDO, {
      target: SPANISH_RR_NAME,
      assigneeBefore: recalledAssignee,
      assigneeAfter: previousAssignee || '(none)',
      method: 'Spanish RR Undo',
    });

    if (previousAssignee) {
      return `Recalled ${recalledAssignee}. Last assigned is now ${previousAssignee}.`;
    }
    return `Recalled ${recalledAssignee}. Spanish rotation is now reset (no previous assignee).`;
  } catch (e) {
    logError('undoSpanishSpeakerAssignment', e);
    throw e;
  } finally {
    lockResult.lock.releaseLock();
  }
}

/**
 * Internal worker for Spanish assignment. Assumes lock is already acquired.
 * @return {string} Assigned salesperson name.
 */
function executeSpanishSpeakerAssignment_() {
  const roster = getSpanishRoster_();
  if (!roster.length) {
    throw new Error('No Spanish speakers available in RR_ROSTER (SPANISH SPEAKER = "TRUE").');
  }

  const lastAssignedName = getSpanishLastAssigned_();
  let nextIndex = 0;

  if (lastAssignedName) {
    const lastIndex = roster.indexOf(lastAssignedName);
    nextIndex = lastIndex !== -1 ? (lastIndex + 1) % roster.length : 0;
  }

  const assignedName = roster[nextIndex];
  const nextUp = roster[(nextIndex + 1) % roster.length];
  const history = getSpanishAssignmentHistory_();
  history.push(assignedName);
  setSpanishAssignmentState_(assignedName, history);

  logRoundRobinEvent(SPANISH_RR_NAME, {
    assignee: assignedName,
    nextUp: nextUp,
    method: 'System Rotation',
    rosterCount: roster.length,
  });

  return assignedName;
}

/**
 * Reads RR_ROSTER and returns names where column E (SPANISH SPEAKER) == "TRUE".
 * Uses a single batched sheet read.
 * @return {string[]}
 */
function getSpanishRoster_() {
  const sheet = getSheetOrThrow_(SHEET_ROSTER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Read A:E in one call: A=name ... E=SPANISH SPEAKER
  const values = sheet.getRange(1, 1, lastRow, 5).getValues();
  const header = String(values[0][4] || '').trim();
  if (header !== SPANISH_RR_HEADER) {
    throw new Error(`RR_ROSTER column E header must be exactly "${SPANISH_RR_HEADER}".`);
  }

  const roster = [];
  for (let i = 1; i < values.length; i++) {
    const name = String(values[i][0] || '').trim();
    const spanishFlag = String(values[i][4] || '').trim();
    if (name && spanishFlag === 'TRUE') {
      roster.push(name);
    }
  }
  return roster;
}

/**
 * Returns the Spanish RR last-assigned name.
 * @return {string}
 */
function getSpanishLastAssigned_() {
  return String(getSpanishScriptProperties_().getProperty(SPANISH_RR_LAST_ASSIGNED_KEY) || '').trim();
}

/**
 * Returns the Spanish RR assignment history stack.
 * @return {string[]}
 */
function getSpanishAssignmentHistory_() {
  const raw = getSpanishScriptProperties_().getProperty(SPANISH_RR_HISTORY_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((name) => String(name || '').trim())
      .filter((name) => name !== '');
  } catch (e) {
    logError('getSpanishAssignmentHistory_', e);
    return [];
  }
}

/**
 * Persists Spanish RR state keys in one write.
 * @param {string} lastAssigned
 * @param {string[]} history
 */
function setSpanishAssignmentState_(lastAssigned, history) {
  const safeHistory = Array.isArray(history)
    ? history.slice(-SPANISH_RR_HISTORY_LIMIT)
    : [];
  getSpanishScriptProperties_().setProperties({
    [SPANISH_RR_LAST_ASSIGNED_KEY]: String(lastAssigned || '').trim(),
    [SPANISH_RR_HISTORY_KEY]: JSON.stringify(safeHistory),
  });
}

/**
 * @return {GoogleAppsScript.Properties.Properties}
 */
function getSpanishScriptProperties_() {
  return PropertiesService.getScriptProperties();
}
