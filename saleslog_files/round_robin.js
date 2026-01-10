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
const CELL_POINTER = 'B2';

const SHEET_AUDIT = 'RR_AUDIT';

const REASSIGNMENT_REASONS = [
  "Employee Unavailable",
  "User Request",
  "Incorrect Assignment",
  "System Rotation Skip",
  "Manager Override"
];

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

    const row = e.range.getRow();
    const col = e.range.getColumn();
    const a1 = e.range.getA1Notation();
    const oldValue = e.oldValue;
    const value = e.value;

    // --- GENERIC LOGGING START ---
    // Log EVERY edit to APPOINTMENTS, unless it's a phantom edit (no change)
    // Phantom edit check: both undefined/empty, or exactly equal
    const oldStr = oldValue === undefined ? "" : String(oldValue);
    const newStr = value === undefined ? "" : String(value);

    // If both are empty (phantom) or identical, skip generic log
    // Note: OnEdit sometimes fires with undefined oldValue for new cells.
    // If it's a real edit, we want to log it.
    // If oldValue is undefined and value is "something", it's a new entry.
    // If oldValue is "something" and value is undefined (cleared), it's a delete.
    // Phantom is usually if user double clicks cell and hits enter without changing.
    const isPhantom = (oldValue === undefined && value === undefined) || (oldValue === value);

    if (!isPhantom) {
      logRoundRobinEvent('Manual Edit', {
        cell: a1,
        old: oldValue,
        new: value
      });
    }
    // --- GENERIC LOGGING END ---

    // Only react when user edits the input columns B/C/D OR the Assigned column E
    if (![COL_APPT_DT, COL_CUST_NAME, COL_PHONE, COL_ASSIGNED].includes(col))
      return;

    const appts = getApptsSheet_();

    // CASE 1: MANUAL OVERRIDE (Column E changed)
    if (col === COL_ASSIGNED) {
      const newValue = e.value;
      const oldValue = e.oldValue;

      // Only log if it actually changed
      logRoundRobinEvent('Manual Override', {
        row: row,
        oldAssignee: oldValue || '(empty)',
        newAssignee: newValue || '(empty)',
        reason: 'User manual edit in sheet',
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

      return;
    }

    // CASE 2: NEW INPUT (Check B/C/D for auto-assign trigger)
    const values = appts.getRange(row, 1, 1, COL_ASSIGNED_BY).getValues()[0];

    const apptDt = values[COL_APPT_DT - 1];
    const name = values[COL_CUST_NAME - 1];
    const phone = values[COL_PHONE - 1];
    const assigned = values[COL_ASSIGNED - 1];

    // If already assigned, do nothing (allows manual override)
    if (assigned) return;

    // If required fields present, auto-assign
    if (apptDt && name && phone) {
      assignRowAuto_(row);
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
      const user = safeUserEmail_();

      logRoundRobinEvent('POINTER_MANUAL_EDIT', {
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

      // Determine user: try e.user.email first, then ActiveUser
      let user = '';
      if (e.user && e.user.email) {
        user = e.user.email;
      } else {
        user = Session.getActiveUser().getEmail();
      }

      logRoundRobinEvent('Manual Override - Phone Up', {
        user: user,
        Details: `Changed from ${oldValue} to ${newValue}`
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
        col === 2 ? 'ROSTER_ACTIVE_CHANGE' : 'ROSTER_ELIGIBLE_CHANGE';
      const user = safeUserEmail_();

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
      logRoundRobinEvent('Row Deleted', {
        type: 'Structure Change',
        changeType: e.changeType,
        user: Session.getActiveUser().getEmail()
      });
    } else if (e.changeType === 'INSERT_ROW') {
      logRoundRobinEvent('Row Inserted', {
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
    withDocumentLock_(() => {
      current = getPointer_();
      newPointer = calculateRewoundIndex_(current, roster.length);
      setPointer_(newPointer);
    });

    logRoundRobinEvent('Rewind', {
      pointerBefore: current,
      pointerAfter: newPointer,
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
    });

    logRoundRobinEvent('Reset Pointer', {
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
 * Uses centralized advanceRoundRobinPointer_ for logic & auditing.
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

      logRoundRobinEvent('Assignment Failed', {
        row: row,
        reason: 'No Eligible Reps',
        customer: name,
      });
      return;
    }

    // --- CENTRALIZED LOGIC CALL ---
    const result = advanceRoundRobinPointer_(roster, {
      actionType: 'Assignment',
      details: {
        row: row,
        customer: name,
        notes: opts.forceReassign ? 'Reassignment (Force)' : 'New Assignment',
        ...(opts.details || {}) // Merge custom details like 'reason'
      },
    });

    const assignee = result.assignee;

    // Write assignment fields (Batch Update)
    const now = new Date();
    const user = safeUserEmail_();

    // Update the values array in memory (0-based indices)
    vals[COL_CREATED_TS - 1] = now;
    vals[COL_ASSIGNED - 1] = assignee;
    vals[COL_MODE - 1] = opts.mode || 'Auto';
    vals[COL_ASSIGNED_BY - 1] = user;

    // Write back entire row in one call
    rowRange.setValues([vals]);

    // Note: Logging was done in advanceRoundRobinPointer_ but we might want to ensure 'reason' is passed through.
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
    advanceRoundRobinPointer_(roster, {
      actionType: 'Skip',
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
  withDocumentLock_(() => {
    pointerBefore = normalizePointer_(getPointer_(), roster.length);
    pointerAfter = (pointerBefore + 1) % roster.length;
    setPointer_(pointerAfter);
  });

  const assignee = roster[pointerBefore];

  // Log it
  const nextUp = roster[pointerAfter];

  logRoundRobinEvent(auditInfo.actionType || 'Advance', {
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
    const user = detailsObj && detailsObj.user ? detailsObj.user : safeUserEmail_();

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

/***** PROTECTION *****/
/**
 * Idempotently applies protection to RR_STATE!B2 to prevent manual pointer edits.
 * Default is warning-only (least disruptive). Set Script Property
 * RR_STATE_POINTER_EDITORS to a comma-separated list of emails to enforce strict protection.
 */
function ensureRRStatePointerProtection_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheetOrThrow_(SHEET_STATE);
    const range = sheet.getRange(CELL_POINTER);

    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    let protection = protections.find((p) => {
      try {
        const r = p.getRange();
        return (
          r.getSheet().getName() === sheet.getName() &&
          r.getRow() === range.getRow() &&
          r.getColumn() === range.getColumn() &&
          r.getNumRows() === 1 &&
          r.getNumColumns() === 1
        );
      } catch (_) {
        return false;
      }
    });

    if (!protection) {
      protection = range.protect();
    }

    protection.setDescription('Round Robin Pointer (RR_STATE!B2) - Do Not Edit');
    try {
      protection.setDomainEdit(false);
    } catch (_) {
      // ignore for consumer accounts
    }

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
      protection.setWarningOnly(false);
      const editorSet = new Set(configuredEditors);
      try {
        const ownerEmail = ss.getOwner && ss.getOwner() ? ss.getOwner().getEmail() : '';
        if (ownerEmail) editorSet.add(ownerEmail);
      } catch (_) {
        // ignore
      }

      try {
        const current = protection.getEditors();
        if (current && current.length) {
          protection.removeEditors(current);
        }
      } catch (_) {
        // ignore
      }

      protection.addEditors(Array.from(editorSet));
    } else {
      // Least-disruptive default: warn on edits, but do not block script/user flows.
      protection.setWarningOnly(true);
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
