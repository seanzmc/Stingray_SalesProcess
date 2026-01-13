/**
 * Round Robin Logic for Sales Log Pro
 *
 * REQUIRED INSTALLABLE TRIGGERS:
 * 1. "On form submit" -> handleFormSubmit (for APPOINTMENTS sheet)
 * 2. "On edit"        -> handleAppointmentEdit (for APPOINTMENTS sheet manual edits)
 * 3. "On edit"        -> handleRRStateEdit (for RR_STATE sheet - Audit Pointer Edits)
 * 4. "On edit"        -> handleRosterEdit (for RR_ROSTER sheet - Audit Roster Changes)
 *
 * NOTE ON LISTS:
 * - RR_ROSTER = Salespeople who RECEIVE appointments (Active + Eligible)
 * - RR_USERS  = BDC/Desk staff who CREATE appointments ("Assigned By")
 * These lists are distinct and should not be consolidated.
 */

/***** CONFIG *****/
const SHEET_APPTS = 'APPOINTMENTS';
const SHEET_ROSTER = 'RR_ROSTER';
const SHEET_STATE = 'RR_STATE';

// APPOINTMENTS column indexes (1-based)
const COL_CREATED_TS = 1; // A
const COL_APPT_DT = 2; // B
const COL_CUST_NAME = 3; // C
const COL_PHONE = 4; // D
const COL_ASSIGNED = 5; // E
const COL_MODE = 6; // F
const COL_ASSIGNED_BY = 7; // G

// RR_STATE cells
// B2: Numeric next-up index (legacy pointer; still maintained for compatibility/UI).
const CELL_POINTER = 'B2';
// D2: Appointments "last assigned name" (name-based pointer; resilient to roster changes).
const CELL_APPT_LAST_ASSIGNED_NAME = 'D2';

const SHEET_AUDIT = 'RR_AUDIT';

const REASSIGNMENT_REASONS = [
  "Employee Unavailable",
  "User Request",
  "Incorrect Assignment",
  "System Rotation Skip",
  "Manager Override"
];

const AUDIT_ACTIONS = {
  NEW_APPOINTMENT: 'New Appointment',
  PHONE_LEAD: 'Phone Lead',
  REASSIGNMENT: 'Reassignment',
  UNDO: 'Undo',
  POINTER_RESET: 'Pointer Reset',
  POINTER_MANUAL_EDIT: 'Pointer Manual Edit',
  MANUAL_OVERRIDE: 'Manual Override',
  MANUAL_EDIT: 'Manual Edit',
  ROSTER_ACTIVE_CHANGE: 'Roster Active Change',
  ROSTER_ELIGIBLE_CHANGE: 'Roster Eligible Change',
  ROW_INSERTED: 'Row Inserted',
  ROW_DELETED: 'Row Deleted',
  ASSIGNMENT_FAILED: 'Assignment Failed',
  SKIP: 'Skip',
  ADVANCE: 'Advance',
};

const AUDIT_LOG_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
let auditLogNameCache_ = null;
let auditLogNameCacheTs_ = 0;

/***** UTIL: SHEET ACCESS + SANITIZATION *****/
/** Returns required sheet or throws a descriptive error. */
function getSheetOrThrow_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    const ssId = ss && typeof ss.getId === 'function' ? ss.getId() : 'unknown';
    const ssName = ss && typeof ss.getName === 'function' ? ss.getName() : 'unknown';
    throw new Error(
      `Required sheet "${name}" not found in spreadsheet "${ssName}" (${ssId}). Please restore it.`
    );
  }
  return sheet;
}

/** Returns sheet or null (for optional sheets). */
function getSheetOrNull_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name);
}

function getAuditLogNameMap_() {
  const nowMs = new Date().getTime();
  if (auditLogNameCache_ && nowMs - auditLogNameCacheTs_ < AUDIT_LOG_NAME_CACHE_TTL_MS) {
    return auditLogNameCache_;
  }

  const sheet = getSheetOrNull_('RR_USERS');
  if (!sheet) {
    auditLogNameCache_ = {};
    auditLogNameCacheTs_ = nowMs;
    return auditLogNameCache_;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    auditLogNameCache_ = {};
    auditLogNameCacheTs_ = nowMs;
    return auditLogNameCache_;
  }

  const data = sheet.getRange(2, 4, lastRow - 1, 2).getValues(); // D=Email, E=Audit Log Name
  const map = {};
  for (let i = 0; i < data.length; i++) {
    const email = String(data[i][0] || '').trim().toLowerCase();
    const logName = String(data[i][1] || '').trim();
    if (email && logName) {
      map[email] = logName;
    }
  }

  auditLogNameCache_ = map;
  auditLogNameCacheTs_ = nowMs;
  return map;
}

function toTitleCase_(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (!lower) return '';
  return lower.replace(/(^|[\s\-_'.])([a-z])/g, function (match, sep, ch) {
    return sep + ch.toUpperCase();
  });
}

function normalizeAuditLogName_(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';

  const hasUpper = /[A-Z]/.test(raw);
  const hasLower = /[a-z]/.test(raw);
  if (hasUpper && hasLower) return raw;

  return toTitleCase_(raw);
}

function getAuditLogNameFromEmail_(email) {
  const rawEmail = String(email || '').trim();
  if (!rawEmail) return '';

  const lowerEmail = rawEmail.toLowerCase();
  if (!lowerEmail.includes('@')) return normalizeAuditLogName_(rawEmail);

  const map = getAuditLogNameMap_();
  if (map[lowerEmail]) return normalizeAuditLogName_(map[lowerEmail]);
  return normalizeAuditLogName_(rawEmail.split('@')[0]);
}

/** Sanitizes a value before writing to a sheet cell to prevent formula injection. */
function sanitizeForSheetCell_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  const str = String(value);
  const leftTrimmed = str.replace(/^\s+/, '');
  if (leftTrimmed && /^[=+\-@]/.test(leftTrimmed)) {
    return str.startsWith("'") ? str : "'" + str;
  }
  return str;
}

/** Lock-protected, non-racey append (uses lastRow+setValues under DocumentLock). */
function appendAuditRowSafely_(auditSheet, rowValues) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return false;
  try {
    const targetRow = Math.max(2, auditSheet.getLastRow() + 1);
    auditSheet
      .getRange(targetRow, 1, 1, rowValues.length)
      .setValues([rowValues]);
    return true;
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      // ignore
    }
  }
}

/** Compatibility wrapper used by sidebar flows; must never throw. */
function logRoundRobinAction_(action, detailsObj) {
  try {
    logRoundRobinEvent(action, detailsObj || {});
  } catch (e) {
    try {
      logError('logRoundRobinAction_', e, { action: action });
    } catch (_) {
      Logger.log('logRoundRobinAction_ failed: ' + e);
    }
  }
}

/***** TRIGGERS *****/

/**
 * Handle form submission for new appointments.
 * Must be bound to an installable "On form submit" trigger.
 */
function handleFormSubmit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_APPTS) return;

    const row = e.range.getRow();
    assignRowAuto_(row);
  } catch (err) {
    logError('handleFormSubmit', err, {
      range: e ? e.range.getA1Notation() : 'unknown',
    });
  }
}

/**
 * Handle manual edits to the APPOINTMENTS sheet.
 * Must be bound to an installable "On edit" trigger.
 */
function handleAppointmentEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_APPTS) return;

    const range = e.range;
    const startRow = range.getRow();
    const startCol = range.getColumn();
    const numRows = range.getNumRows();
    const numCols = range.getNumColumns();
    const endRow = startRow + numRows - 1;
    const endCol = startCol + numCols - 1;

    if (endRow < 2) return; // Skip header row edits.

    const user = getEventUserEmail_(e);

    // --- GENERIC LOGGING START ---
    // Log EVERY edit to APPOINTMENTS, unless it's a phantom edit (no change)
    // Phantom edit check: both undefined/empty, or exactly equal
    if (numRows === 1 && numCols === 1) {
      const a1 = range.getA1Notation();
      const oldValue = e.oldValue;
      const value = e.value;

      // If both are empty (phantom) or identical, skip generic log
      // Note: OnEdit sometimes fires with undefined oldValue for new cells.
      // If it's a real edit, we want to log it.
      // If oldValue is undefined and value is "something", it's a new entry.
      // If oldValue is "something" and value is undefined (cleared), it's a delete.
      // Phantom is usually if user double clicks cell and hits enter without changing.
      const isPhantom =
        (oldValue === undefined && value === undefined) || oldValue === value;

      if (!isPhantom) {
        logRoundRobinEvent(AUDIT_ACTIONS.MANUAL_EDIT, {
          cell: a1,
          old: oldValue,
          new: value,
          user: user,
        });
      }
    } else {
      logRoundRobinEvent(AUDIT_ACTIONS.MANUAL_EDIT, {
        range: range.getA1Notation(),
        rows: numRows,
        cols: numCols,
        user: user,
      });
    }
    // --- GENERIC LOGGING END ---

    // Only react when user edits the input columns B/C/D OR the Assigned column E
    const touchesRelevantColumn = [COL_APPT_DT, COL_CUST_NAME, COL_PHONE, COL_ASSIGNED].some(
      (c) => c >= startCol && c <= endCol
    );
    if (!touchesRelevantColumn) return;

    const appts = getApptsSheet_();

    const dataRowStart = Math.max(startRow, 2);
    const dataRowEnd = endRow;
    const rowCount = dataRowEnd - dataRowStart + 1;
    if (rowCount <= 0) return;

    const values = appts.getRange(dataRowStart, 1, rowCount, COL_ASSIGNED_BY).getValues();
    const includesAssignedCol = COL_ASSIGNED >= startCol && COL_ASSIGNED <= endCol;
    const isSingleAssignedCell =
      numRows === 1 && numCols === 1 && startCol === COL_ASSIGNED;

    // CASE 1: MANUAL OVERRIDE (Column E changed)
    if (includesAssignedCol) {
      for (let i = 0; i < rowCount; i++) {
        const row = dataRowStart + i;
        const rowValues = values[i];
        const newAssignee = isSingleAssignedCell
          ? e.value
          : rowValues[COL_ASSIGNED - 1];
        const oldAssignee = isSingleAssignedCell ? e.oldValue : '(unknown)';

        logRoundRobinEvent(AUDIT_ACTIONS.MANUAL_OVERRIDE, {
          row: row,
          oldAssignee: oldAssignee || '(empty)',
          newAssignee: newAssignee || '(empty)',
          reason: numRows > 1 || numCols > 1 ? 'Bulk edit in sheet' : 'User manual edit in sheet',
          user: user,
        });

        // Update Mode to "Manual" if not already (idempotent, side-effect only)
        try {
          const modeRange = sheet.getRange(row, COL_MODE);
          if (modeRange.getValue() !== 'Manual') {
            modeRange.setValue('Manual');
          }
        } catch (modeErr) {
          // Log error but do not fail the function; this is a secondary action
          logError('handleAppointmentEdit_SetMode', modeErr, { row: row });
        }
      }
      return;
    }

    // CASE 2: NEW INPUT (Check B/C/D for auto-assign trigger)
    for (let i = 0; i < rowCount; i++) {
      const row = dataRowStart + i;
      const rowValues = values[i];
      const apptDt = rowValues[COL_APPT_DT - 1];
      const name = rowValues[COL_CUST_NAME - 1];
      const phone = rowValues[COL_PHONE - 1];
      const assigned = rowValues[COL_ASSIGNED - 1];

      // If already assigned, do nothing (allows manual override)
      if (assigned) continue;

      // If required fields present, auto-assign
      if (apptDt && name && phone) {
        assignRowAuto_(row, { auditUser: user });
      }
    }
  } catch (err) {
    logError('handleAppointmentEdit', err, { user: safeUserEmail_() });
  }
}

/**
 * Handle manual edits to the RR_STATE sheet (Pointer protection & Phone Up Override).
 * Must be bound to an installable "On edit" trigger.
 */
function handleRRStateEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_STATE) return;

    const range = e.range;
    const row = range.getRow();
    const col = range.getColumn();

    // Check if B2 (Pointer) was edited
    if (row === 2 && col === 2) {
      const oldValue = e.oldValue;
      const newValue = e.value;
      const user = getEventUserEmail_(e);

      logRoundRobinEvent(AUDIT_ACTIONS.POINTER_MANUAL_EDIT, {
        pointerBefore: oldValue || '?',
        pointerAfter: newValue || '?',
        user: user,
        reason: 'Direct edit to RR_STATE',
      });
    }

    // Check if C2 (Phone Up Next Up) was edited
    if (row === 2 && col === 3) {
      const oldValue = e.oldValue === undefined ? '(blank)' : e.oldValue;
      const newValue = e.value === undefined ? '(blank)' : e.value;
      const user = getEventUserEmail_(e);

      logRoundRobinEvent(AUDIT_ACTIONS.MANUAL_OVERRIDE, {
        user: user,
        target: AUDIT_ACTIONS.PHONE_LEAD,
        details: `Changed from ${oldValue} to ${newValue}`,
      });
    }
  } catch (err) {
    logError('handleRRStateEdit', err);
  }
}

/**
 * Handle manual edits to the RR_ROSTER sheet (Audit eligibility changes).
 * Must be bound to an installable "On edit" trigger.
 */
function handleRosterEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_ROSTER) return;

    const row = e.range.getRow();
    const col = e.range.getColumn();

    if (row < 2) return; // Header

    // Col 2 = Active, Col 3 = Eligible (assuming A=Name, B=Active, C=Eligible)
    if (col === 2 || col === 3) {
      const repName = sheet.getRange(row, 1).getValue();
      const actionType =
        col === 2 ? AUDIT_ACTIONS.ROSTER_ACTIVE_CHANGE : AUDIT_ACTIONS.ROSTER_ELIGIBLE_CHANGE;
      const user = getEventUserEmail_(e);

      logRoundRobinEvent(actionType, {
        rep: repName,
        oldValue: e.oldValue,
        newValue: e.value,
        user: user,
      });
    }
  } catch (err) {
    logError('handleRosterEdit', err);
  }
}

/**
 * Handle structure changes (Insert/Delete Row) on APPOINTMENTS sheet.
 * Must be bound to an installable "On change" trigger.
 */
function handleAppointmentStructureChange(e) {
  try {
    // e.changeType can be: INSERT_ROW, REMOVE_ROW, INSERT_COLUMN, REMOVE_COLUMN, GRID, FORMAT, etc.
    // We only care about row structure changes on the APPOINTMENTS sheet.

    // Check if the change happened on the APPOINTMENTS sheet
    // e.source is the Spreadsheet. We need the active sheet.
    const sheet = e.source.getActiveSheet();
    if (sheet.getName() !== SHEET_APPTS) return;

    if (e.changeType === 'REMOVE_ROW') {
      logRoundRobinEvent(AUDIT_ACTIONS.ROW_DELETED, {
        type: 'Structure Change',
        changeType: e.changeType,
        user: Session.getActiveUser().getEmail()
      });
    } else if (e.changeType === 'INSERT_ROW') {
      logRoundRobinEvent(AUDIT_ACTIONS.ROW_INSERTED, {
        type: 'Structure Change',
        changeType: e.changeType
      });
    }

  } catch (err) {
    logError('handleAppointmentStructureChange', err, { changeType: e ? e.changeType : 'unknown' });
  }
}

/***** MENU ACTIONS *****/
function menuSkipAndReassignSelectedRow() {
  showReassignDialog();
}

function showReassignDialog() {
  try {
    const htmlTemplate = HtmlService.createTemplateFromFile('ReassignDialog');
    htmlTemplate.reasons = REASSIGNMENT_REASONS;
    const html = htmlTemplate.evaluate()
      .setWidth(400)
      .setHeight(250);
    SpreadsheetApp.getUi().showModalDialog(html, 'Reassign Opportunity');
  } catch (err) {
    logError('showReassignDialog', err);
    SpreadsheetApp.getUi().alert('Error opening dialog: ' + err.message);
  }
}

/**
 * Public endpoint called by the Modal Dialog (ReassignDialog.html)
 */
function processMenuReassignment(reason) {
  try {
    const row = getActiveRow_();
    if (!row) throw new Error("No row selected.");
    processReassignment_(row, reason);
    SpreadsheetApp.getActiveSpreadsheet().toast("Reassignment Complete");
  } catch (err) {
    logError('processMenuReassignment', err);
    throw err; // Re-throw to show in client
  }
}

/**
 * Public endpoint for Sidebar or Client to get reasons
 */
function getReassignmentReasons() {
  return REASSIGNMENT_REASONS;
}

function menuRewindPointer() {
  const lockResult = acquireScriptLockWithRetry();
  if (!lockResult.success) {
    SpreadsheetApp.getUi().alert('System busy. Please try again.');
    logError('menuRewindPointer', 'Lock acquisition failed', {
      attempts: lockResult.attempts,
    });
    return;
  }

  try {
    const roster = getEligibleRoster_();
    if (roster.length === 0) return;

    let current = 0;
    let newPointer = 0;
    let lastAssignedNameAfter = '';
    withDocumentLock_(() => {
      // Normalize in case the roster has changed since B2 was last updated.
      current = normalizePointer_(getPointer_(), roster.length);
      newPointer = calculateRewoundIndex_(current, roster.length);
      setPointer_(newPointer);

      // Keep appointments name-based pointer (RR_STATE!D2) consistent with numeric next-up pointer.
      lastAssignedNameAfter = roster[(newPointer - 1 + roster.length) % roster.length];
      getStateSheet_().getRange(CELL_APPT_LAST_ASSIGNED_NAME).setValue(lastAssignedNameAfter);
    });

    logRoundRobinEvent(AUDIT_ACTIONS.UNDO, {
      pointerBefore: current,
      pointerAfter: newPointer,
      lastAssignedNameAfter: lastAssignedNameAfter,
      target: 'Pointer',
      reason: 'User requested rewind',
    });

    SpreadsheetApp.getActive().toast(
      `Pointer rewound to ${newPointer} (${roster[newPointer]})`
    );
  } catch (err) {
    logError('menuRewindPointer', err);
    SpreadsheetApp.getUi().alert('Error: ' + err.message);
  } finally {
    lockResult.lock.releaseLock();
  }
}

function calculateRewoundIndex_(currentIndex, totalCount) {
  if (totalCount <= 0) return 0;
  let newIndex = currentIndex - 1;
  if (newIndex < 0) {
    newIndex = totalCount - 1;
  }
  return newIndex;
}

function menuResetPointer() {
  try {
    let oldPointer = 0;
    withDocumentLock_(() => {
      oldPointer = getPointer_();
      setPointer_(0);

      // Clear appointments name-based pointer so next assignment starts at roster[0].
      getStateSheet_().getRange(CELL_APPT_LAST_ASSIGNED_NAME).clearContent();
    });

    logRoundRobinEvent(AUDIT_ACTIONS.POINTER_RESET, {
      pointerBefore: oldPointer,
      pointerAfter: 0,
      reason: 'Admin Reset',
    });
    SpreadsheetApp.getActive().toast('Pointer reset to 0 (Spreadsheet Top)');
  } catch (err) {
    logError('menuResetPointer', err);
    SpreadsheetApp.getUi().alert('Error: ' + err.message);
  }
}

/**
 * Reassign a selected row from the sidebar with a specific reason.
 *
 * @param {string} reason - The reason for reassignment
 * @return {object} { ok: boolean, message: string, newAssignee: string }
 */
function reassignSelectedRow(reason) {
  try {
    const row = getActiveRow_();
    if (!row) {
      return { ok: false, message: 'Please select a row in APPOINTMENTS first.' };
    }

    processReassignment_(row, reason);

    // Get the new assignee from the sheet to confirm
    const appts = getApptsSheet_();
    const newAssignee = appts.getRange(row, COL_ASSIGNED).getValue();

    return { ok: true, newAssignee: newAssignee };

  } catch (e) {
    logError('reassignSelectedRow', e);
    return { ok: false, message: e.message };
  }
}

/**
 * Unified Service Function for Reassignments
 */
function processReassignment_(row, reason) {
  // Validate Reason against Allowlist (optional but good for strictness,
  // though sidebar/modal restrictions are primary)
  if (!REASSIGNMENT_REASONS.includes(reason)) {
    // If reason is not in list (e.g. old code calling it), append [Non-Standard]
    // or just allow it. Let's allow but log it as is.
  }

  assignRowAuto_(row, {
    forceReassign: true,
    mode: 'Manual Reassign',
    details: { reason: reason }
  });
}

/***** CORE LOGIC *****/

/**
 * Main entry point for auto-assigning a row.
 * Uses centralized advanceRoundRobinPointerByName_ for logic & auditing.
 */
function assignRowAuto_(row, opts = {}) {
  const lockResult = acquireScriptLockWithRetry();
  if (!lockResult.success) {
    // If we can't lock, we can't assign safely. Log it.
    logError('assignRowAuto_', 'Lock acquisition failed - row not assigned', {
      row: row,
    });
    return;
  }

  try {
    const appts = getApptsSheet_();

    // Read row data
    const rowRange = appts.getRange(row, 1, 1, COL_ASSIGNED_BY);
    const vals = rowRange.getValues()[0];

    const name = vals[COL_CUST_NAME - 1];
    const phone = vals[COL_PHONE - 1];

    // Must have the minimal appointment info - reuse logic or stricter?
    // Check existing assignment
    const alreadyAssigned = vals[COL_ASSIGNED - 1];
    if (alreadyAssigned && !opts.forceReassign) return;

    // Get roster & advance pointer
    const roster = getEligibleRoster_(); // array of names
    if (roster.length === 0) {
      appts.getRange(row, COL_MODE).setValue('No Eligible Reps');

      logRoundRobinEvent(AUDIT_ACTIONS.ASSIGNMENT_FAILED, {
        row: row,
        reason: 'No Eligible Reps',
        customer: name,
        ...(opts.auditUser ? { user: opts.auditUser } : {}),
      });
      return;
    }

    // --- CENTRALIZED LOGIC CALL ---
    const actionType = opts.forceReassign
      ? AUDIT_ACTIONS.REASSIGNMENT
      : AUDIT_ACTIONS.NEW_APPOINTMENT;
    const result = advanceRoundRobinPointerByName_(roster, {
      actionType: actionType,
      details: {
        row: row,
        customer: name,
        notes: opts.forceReassign ? 'Reassignment (Force)' : 'New Assignment',
        ...(opts.details || {}), // Merge custom details like 'reason'
        ...(opts.auditUser ? { user: opts.auditUser } : {})
      },
    });

    const assignee = result.assignee;

    // Write assignment fields (Batch Update)
    const now = new Date();
    const userEmail = opts.auditUser ? opts.auditUser : safeUserEmail_();
    const user = getAuditLogNameFromEmail_(userEmail);

    // Update the values array in memory (0-based indices)
    if (!vals[COL_CREATED_TS - 1]) {
      vals[COL_CREATED_TS - 1] = now;
    }
    vals[COL_ASSIGNED - 1] = assignee;
    vals[COL_MODE - 1] = opts.mode || 'Auto';
    vals[COL_ASSIGNED_BY - 1] = user;

    // Write back entire row in one call
    rowRange.setValues([vals]);

    // Note: Logging was done in advanceRoundRobinPointerByName_ but we might want to ensure 'reason' is passed through.
    // I passed `...auditInfo.details` in advanceRoundRobinPointer_
    // And in this function call I see:
    // details: {
    //    row: row,
    //    customer: name,
    //    notes: opts.forceReassign ? 'Reassignment (Force)' : 'New Assignment',
    //    ...(opts.details || {})  <-- I need to add this spread to include 'reason' passed in opts.details
    // }

  } catch (err) {
    logError('assignRowAuto_', err, { row: row, opts: opts });
  } finally {
    lockResult.lock.releaseLock();
  }
}

function skipPointer_() {
  const lockResult = acquireScriptLockWithRetry();
  if (!lockResult.success) {
    logError('skipPointer_', 'Lock acquisition failed');
    return;
  }

  try {
    const roster = getEligibleRoster_();
    if (roster.length === 0) return;

    // Advance without assigning
    advanceRoundRobinPointerByName_(roster, {
      actionType: AUDIT_ACTIONS.SKIP,
      details: { reason: 'User requested skip' },
    });
  } catch (err) {
    logError('skipPointer_', err);
  } finally {
    lockResult.lock.releaseLock();
  }
}

/** Runs a function with DocumentLock protection (bounded wait). */
function withDocumentLock_(fn) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    throw new Error('System busy. Please try again.');
  }
  try {
    return fn();
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      // ignore
    }
  }
}

/**
 * Centralized function to get pointer, determine assignee, advance pointer, and log audit.
 * returns { assignee, pointerBefore, pointerAfter, nextUp }
 */
function advanceRoundRobinPointer_(roster, auditInfo) {
  if (!roster || roster.length === 0) throw new Error('Roster empty');

  // Concurrency-safe pointer mutation (RR_STATE!B2)
  let pointerBefore = 0;
  let pointerAfter = 0;
  let assignee = '';
  withDocumentLock_(() => {
    pointerBefore = normalizePointer_(getPointer_(), roster.length);
    assignee = roster[pointerBefore];
    pointerAfter = (pointerBefore + 1) % roster.length;
    setPointer_(pointerAfter);

    // Phase 1: store last assigned name (RR_STATE!D2) while preserving numeric pointer behavior.
    getStateSheet_().getRange(CELL_APPT_LAST_ASSIGNED_NAME).setValue(assignee);
  });

  // Log it
  const nextUp = roster[pointerAfter];

  logRoundRobinEvent(auditInfo.actionType || AUDIT_ACTIONS.ADVANCE, {
    pointerBefore: pointerBefore,
    pointerAfter: pointerAfter,
    assignee: assignee,
    nextUp: nextUp,
    rosterCount: roster.length,
    ...auditInfo.details,
  });

  return {
    assignee,
    pointerBefore,
    pointerAfter,
    nextUp,
  };
}

/**
 * Name-based appointment rotation using RR_STATE!D2 ("last assigned name").
 * Keeps numeric pointer (RR_STATE!B2) in sync as the next-up index.
 *
 * @param {string[]} roster Eligible roster (trimmed names).
 * @param {{actionType?: string, details?: Object}} auditInfo Audit metadata.
 * @return {{assignee: string, pointerBefore: number, pointerAfter: number, nextUp: string}}
 */
function advanceRoundRobinPointerByName_(roster, auditInfo) {
  if (!roster || roster.length === 0) throw new Error('Roster empty');

  const ai = auditInfo || {};
  const details = ai.details || {};

  let lastAssignedNameBefore = '';
  let pointerBefore = 0; // index assigned
  let pointerAfter = 0; // next-up index
  let assignee = '';
  let nextUp = '';

  withDocumentLock_(() => {
    const stateSheet = getStateSheet_();

    lastAssignedNameBefore = String(
      stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue() || ''
    ).trim();

    // Find next person based on last assigned name.
    let nextIndex = 0;
    if (lastAssignedNameBefore) {
      const lastIndex = roster.indexOf(String(lastAssignedNameBefore).trim());
      nextIndex = lastIndex !== -1 ? (lastIndex + 1) % roster.length : 0;
    }

    assignee = roster[nextIndex];
    pointerBefore = nextIndex;

    // Update name-based state (RR_STATE!D2)
    stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).setValue(assignee);

    // Keep numeric pointer in sync (RR_STATE!B2 represents "next-up index")
    pointerAfter = (nextIndex + 1) % roster.length;
    setPointer_(pointerAfter);
    nextUp = roster[pointerAfter];
  });

  logRoundRobinEvent(ai.actionType || AUDIT_ACTIONS.ADVANCE, {
    pointerBefore: pointerBefore,
    pointerAfter: pointerAfter,
    assignee: assignee,
    nextUp: nextUp,
    rosterCount: roster.length,
    lastAssignedNameBefore: lastAssignedNameBefore || '(blank)',
    ...details,
  });

  return {
    assignee,
    pointerBefore,
    pointerAfter,
    nextUp,
  };
}

/***** AUDITING *****/
/**
 * Central Logger for all Round Robin events.
 * Enforces key=value | key=value format and sanitizes inputs.
 */
function logRoundRobinEvent(action, detailsObj) {
  try {
    const ss = SpreadsheetApp.getActive();
    let auditSheet = ss.getSheetByName(SHEET_AUDIT);
    if (!auditSheet) {
      auditSheet = ss.insertSheet(SHEET_AUDIT);
      auditSheet
        .getRange(1, 1, 1, 5)
        .setValues([
          ['Timestamp', 'User', 'Action', 'Reference', 'Details'],
        ]);
      auditSheet.setFrozenRows(1);
    }

    const now = new Date();

    // Use system user unless specifically passed in details
    const userEmail = detailsObj && detailsObj.user ? detailsObj.user : safeUserEmail_();
    const user = getAuditLogNameFromEmail_(userEmail);

    // Format details
    let detailsStr = '';
    if (detailsObj) {
      const { row, user: _u, ...rest } = detailsObj;

      detailsStr = Object.entries(rest)
        .map(([k, v]) => {
          // Sanitize Value: replace | and = with -
          let valStr = String(v);
          valStr = valStr.replace(/[|=]/g, '-');
          // Prevent formula injection within the details cell (belt & suspenders)
          valStr = String(sanitizeForSheetCell_(valStr));
          return `${k}=${valStr}`;
        })
        .join(' | ');
    }

    const reference = detailsObj && detailsObj.row ? `Row ${detailsObj.row}` : '';

    const rowValues = [
      sanitizeForSheetCell_(now),
      sanitizeForSheetCell_(user),
      sanitizeForSheetCell_(action),
      sanitizeForSheetCell_(reference),
      sanitizeForSheetCell_(detailsStr),
    ];

    const ok = appendAuditRowSafely_(auditSheet, rowValues);
    if (!ok) {
      // If we can't safely log, do not throw.
      logError('logRoundRobinEvent', 'Audit lock timeout - log skipped', {
        action: action,
      });
    }
  } catch (e) {
    logError('logRoundRobinEvent', 'Audit Log Failed', {
      originalError: e.toString(),
      action: action,
    });
  }
}

function normalizeAuditAction_(action) {
  const raw = String(action || '').trim();
  if (!raw) return '';

  const values = Object.values(AUDIT_ACTIONS);
  if (values.indexOf(raw) !== -1) return raw;

  const lower = raw.toLowerCase();
  const map = {
    'assignment': AUDIT_ACTIONS.NEW_APPOINTMENT,
    'assigned': AUDIT_ACTIONS.NEW_APPOINTMENT,
    'auto-assigned': AUDIT_ACTIONS.NEW_APPOINTMENT,
    'new appointment': AUDIT_ACTIONS.NEW_APPOINTMENT,
    'sidebar appointment': AUDIT_ACTIONS.NEW_APPOINTMENT,
    'reassigned': AUDIT_ACTIONS.REASSIGNMENT,
    'reassignment': AUDIT_ACTIONS.REASSIGNMENT,
    'undo assignment': AUDIT_ACTIONS.UNDO,
    'rewind': AUDIT_ACTIONS.UNDO,
    'phoneup': AUDIT_ACTIONS.PHONE_LEAD,
    'phone up': AUDIT_ACTIONS.PHONE_LEAD,
    'phone up assigned': AUDIT_ACTIONS.PHONE_LEAD,
    'phone lead': AUDIT_ACTIONS.PHONE_LEAD,
    'phone up undo': AUDIT_ACTIONS.UNDO,
    'pointer manual edit': AUDIT_ACTIONS.POINTER_MANUAL_EDIT,
    'pointer_manual_edit': AUDIT_ACTIONS.POINTER_MANUAL_EDIT,
    'reset pointer': AUDIT_ACTIONS.POINTER_RESET,
    'pointer reset': AUDIT_ACTIONS.POINTER_RESET,
    'manual override - phone up': AUDIT_ACTIONS.MANUAL_OVERRIDE,
    'manual override': AUDIT_ACTIONS.MANUAL_OVERRIDE,
    'manual edit': AUDIT_ACTIONS.MANUAL_EDIT,
    'roster active change': AUDIT_ACTIONS.ROSTER_ACTIVE_CHANGE,
    'roster_active_change': AUDIT_ACTIONS.ROSTER_ACTIVE_CHANGE,
    'roster eligible change': AUDIT_ACTIONS.ROSTER_ELIGIBLE_CHANGE,
    'roster_eligible_change': AUDIT_ACTIONS.ROSTER_ELIGIBLE_CHANGE,
    'row inserted': AUDIT_ACTIONS.ROW_INSERTED,
    'row deleted': AUDIT_ACTIONS.ROW_DELETED,
    'assignment failed': AUDIT_ACTIONS.ASSIGNMENT_FAILED,
    'skip': AUDIT_ACTIONS.SKIP,
    'advance': AUDIT_ACTIONS.ADVANCE,
  };

  return map[lower] || raw;
}

function normalizeAuditLogEntries() {
  const sheet = getSheetOrThrow_(SHEET_AUDIT);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('normalizeAuditLogEntries: no audit rows to normalize.');
    return { updatedRows: 0, totalRows: 0 };
  }

  const batchSize = 500;
  let updatedRows = 0;
  let totalRows = 0;

  for (let startRow = 2; startRow <= lastRow; startRow += batchSize) {
    const numRows = Math.min(batchSize, lastRow - startRow + 1);
    const range = sheet.getRange(startRow, 1, numRows, 5);
    const values = range.getValues();

    let hasChanges = false;
    const userActionValues = values.map((row) => {
      totalRows++;
      const currentUser = row[1];
      const currentAction = row[2];
      const normalizedUser = currentUser ? getAuditLogNameFromEmail_(currentUser) : '';
      const normalizedAction = normalizeAuditAction_(currentAction);

      if (normalizedUser !== currentUser || normalizedAction !== currentAction) {
        hasChanges = true;
        updatedRows++;
      }

      return [normalizedUser, normalizedAction];
    });

    if (hasChanges) {
      sheet.getRange(startRow, 2, numRows, 2).setValues(userActionValues);
    }
  }

  Logger.log(
    `normalizeAuditLogEntries: updated ${updatedRows} of ${totalRows} audit rows.`
  );
  return { updatedRows: updatedRows, totalRows: totalRows };
}

/***** DATA ACCESS *****/
function getApptsSheet_() {
  return getSheetOrThrow_(SHEET_APPTS);
}

function getStateSheet_() {
  return getSheetOrThrow_(SHEET_STATE);
}

function getEligibleRoster_() {
  const sheet = getSheetOrThrow_(SHEET_ROSTER);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // A: name, B: active, C: eligible
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return data
    .filter((r) => r[0] && r[1] === true && r[2] === true)
    .map((r) => String(r[0]).trim());
}

/***** POINTER STATE *****/
function getPointer_() {
  const state = getStateSheet_();
  const v = state.getRange(CELL_POINTER).getValue();
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function setPointer_(n) {
  const state = getStateSheet_();
  state.getRange(CELL_POINTER).setValue(n);
}

/**
 * One-time migration helper:
 * - Reads RR_STATE!B2 (numeric next-up index) and normalizes it to the current eligible roster.
 * - Writes RR_STATE!D2 as the *previous* assignee so the next assignment remains unchanged.
 * Idempotent: if RR_STATE!D2 already contains a valid name in the current roster, does nothing.
 *
 * @return {string} Status message for operator visibility.
 */
function migrateAppointmentPointerToName() {
  const lockResult = acquireScriptLockWithRetry();
  if (!lockResult.success) {
    throw new Error('System busy (Lock Timeout). Please try again.');
  }

  try {
    const roster = getEligibleRoster_();
    if (!roster || roster.length === 0) {
      throw new Error('Roster empty - cannot migrate appointment pointer.');
    }

    let existingLastAssignedName = '';
    let normalizedNextUp = 0;
    let lastAssignedName = '';
    let didMigrate = false;

    withDocumentLock_(() => {
      const stateSheet = getStateSheet_();

      existingLastAssignedName = String(
        stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue() || ''
      ).trim();

      // Idempotency: if D2 already contains a valid roster name, do nothing.
      if (existingLastAssignedName && roster.indexOf(existingLastAssignedName) !== -1) {
        didMigrate = false;
        return;
      }

      // B2 is "next-up index" (may be out of range); normalize to current roster.
      normalizedNextUp = normalizePointer_(getPointer_(), roster.length);
      const lastAssignedIndex = (normalizedNextUp - 1 + roster.length) % roster.length;
      lastAssignedName = roster[lastAssignedIndex];

      stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).setValue(lastAssignedName);
      didMigrate = true;
    });

    if (didMigrate) {
      logRoundRobinEvent('System Migration', {
        target: 'Appointments',
        pointerCell: CELL_POINTER,
        nameCell: CELL_APPT_LAST_ASSIGNED_NAME,
        normalizedNextUp: normalizedNextUp,
        lastAssignedName: lastAssignedName,
        rosterCount: roster.length,
        reason: 'Migrate appointment pointer from numeric next-up index to last-assigned name',
      });
      return `Migration complete: RR_STATE!${CELL_APPT_LAST_ASSIGNED_NAME}="${lastAssignedName}".`;
    }

    logRoundRobinEvent('System Migration', {
      target: 'Appointments',
      result: 'No-op',
      existingLastAssignedName: existingLastAssignedName,
      rosterCount: roster.length,
      reason: 'RR_STATE!D2 already contains a valid name in the current roster',
    });
    return 'No migration needed: RR_STATE!D2 already contains a valid name.';
  } catch (err) {
    logError('migrateAppointmentPointerToName', err);
    throw err;
  } finally {
    lockResult.lock.releaseLock();
  }
}

/***** PROTECTION *****/
/**
 * Idempotently applies protection to RR_STATE!B2 and RR_STATE!D2 to prevent manual edits.
 * Default is warning-only (least disruptive). Set Script Property
 * RR_STATE_POINTER_EDITORS to a comma-separated list of emails to enforce strict protection.
 */
function ensureRRStatePointerProtection_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheetOrThrow_(SHEET_STATE);
    const pointerRange = sheet.getRange(CELL_POINTER);
    const apptLastAssignedRange = sheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME);

    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    const getOrCreateSingleCellProtection_ = (targetRange) => {
      let protection = protections.find((p) => {
        try {
          const r = p.getRange();
          return (
            r.getSheet().getName() === sheet.getName() &&
            r.getRow() === targetRange.getRow() &&
            r.getColumn() === targetRange.getColumn() &&
            r.getNumRows() === 1 &&
            r.getNumColumns() === 1
          );
        } catch (_) {
          return false;
        }
      });

      if (!protection) {
        protection = targetRange.protect();
      }
      return protection;
    };

    const pointerProtection = getOrCreateSingleCellProtection_(pointerRange);
    const apptLastAssignedProtection =
      getOrCreateSingleCellProtection_(apptLastAssignedRange);

    pointerProtection.setDescription('Round Robin Pointer (RR_STATE!B2) - Do Not Edit');
    apptLastAssignedProtection.setDescription(
      'Appointments Last Assigned Name (RR_STATE!D2) - Do Not Edit'
    );

    [pointerProtection, apptLastAssignedProtection].forEach((p) => {
      try {
        p.setDomainEdit(false);
      } catch (_) {
        // ignore for consumer accounts
      }
    });

    const raw =
      PropertiesService.getScriptProperties().getProperty(
        'RR_STATE_POINTER_EDITORS'
      ) || '';
    const configuredEditors = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s.includes('@'));

    if (configuredEditors.length > 0) {
      // Strict mode: only configured editors (+ owner) can edit.
      pointerProtection.setWarningOnly(false);
      apptLastAssignedProtection.setWarningOnly(false);
      const editorSet = new Set(configuredEditors);
      try {
        const ownerEmail = ss.getOwner && ss.getOwner() ? ss.getOwner().getEmail() : '';
        if (ownerEmail) editorSet.add(ownerEmail);
      } catch (_) {
        // ignore
      }

      [pointerProtection, apptLastAssignedProtection].forEach((p) => {
        try {
          const current = p.getEditors();
          if (current && current.length) {
            p.removeEditors(current);
          }
        } catch (_) {
          // ignore
        }

        p.addEditors(Array.from(editorSet));
      });
    } else {
      // Least-disruptive default: warn on edits, but do not block script/user flows.
      pointerProtection.setWarningOnly(true);
      apptLastAssignedProtection.setWarningOnly(true);
    }

    return true;
  } catch (e) {
    // Clear error for insufficient authorization or missing permissions.
    throw new Error(
      'RR_STATE pointer protection setup failed (authorization may be required): ' +
      (e && e.message ? e.message : String(e))
    );
  }
}

function normalizePointer_(pointer, len) {
  if (!Number.isFinite(pointer) || pointer < 0) return 0;
  if (len <= 0) return 0;
  return pointer % len;
}

/***** UTIL *****/
function getActiveRow_() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== SHEET_APPTS) {
    SpreadsheetApp.getUi().alert(`Go to ${SHEET_APPTS} and select a row.`);
    return null;
  }
  const row = sheet.getActiveRange().getRow();
  if (row <= 1) return null; // header row
  return row;
}

function safeUserEmail_() {
  try {
    const e = Session.getEffectiveUser().getEmail();
    return e || '';
  } catch (err) {
    return '';
  }
}

function getEventUserEmail_(e) {
  if (e && e.user && e.user.email) return e.user.email;
  try {
    const active = Session.getActiveUser().getEmail();
    if (active) return active;
  } catch (_) {
    // ignore
  }
  return safeUserEmail_();
}
