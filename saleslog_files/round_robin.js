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

    // Only react when user edits the input columns B/C/D OR the Assigned column E
    if (![COL_APPT_DT, COL_CUST_NAME, COL_PHONE, COL_ASSIGNED].includes(col))
      return;

    const appts = getApptsSheet_();

    // CASE 1: MANUAL OVERRIDE (Column E changed)
    if (col === COL_ASSIGNED) {
      const newValue = e.value;
      const oldValue = e.oldValue;

      // Only log if it actually changed
      logRoundRobinAction_('Manual Override', {
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
 * Handle manual edits to the RR_STATE sheet (Pointer protection).
 * Must be bound to an installable "On edit" trigger.
 */
function handleRRStateEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_STATE) return;

    const range = e.range;
    const a1 = range.getA1Notation();

    // Check if B2 (Pointer) was edited
    if (
      a1 === CELL_POINTER ||
      (range.getRow() === 2 && range.getColumn() === 2)
    ) {
      const oldValue = e.oldValue;
      const newValue = e.value;
      const user = safeUserEmail_();

      logRoundRobinAction_('POINTER_MANUAL_EDIT', {
        pointerBefore: oldValue || '?',
        pointerAfter: newValue || '?',
        user: user,
        reason: 'Direct edit to RR_STATE',
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

      logRoundRobinAction_(actionType, {
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

/***** MENU ACTIONS *****/
function menuSkipAndReassignSelectedRow() {
  try {
    const row = getActiveRow_();
    if (!row) return;

    // Reassign (force) with 'Manual' mode
    assignRowAuto_(row, {
      forceReassign: true,
      mode: 'Manual',
      actionType: 'Reassign', // For audit log clarity
    });
  } catch (err) {
    logError('menuSkipAndReassignSelectedRow', err);
    SpreadsheetApp.getUi().alert('Error: ' + err.message);
  }
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

    const current = getPointer_();
    // Logic: (current - 1) but wrap around if negative
    let newPointer = current - 1;
    if (newPointer < 0) {
      newPointer = roster.length - 1;
    }

    setPointer_(newPointer);

    logRoundRobinAction_('Rewind', {
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

function menuResetPointer() {
  try {
    const oldPointer = getPointer_();
    setPointer_(0);

    logRoundRobinAction_('Reset Pointer', {
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
 * @param {string} reason - The reason for reassignment (e.g. "Employee Unavailable")
 * @return {object} { ok: boolean, message: string, newAssignee: string }
 */
function reassignSelectedRow(reason) {
  // Lock handled inside assignRowAuto_ but good to have high level safety or return values
  try {
    const row = getActiveRow_();
    if (!row) {
      return { ok: false, message: 'Please select a row in APPOINTMENTS first.' };
    }

    // We reuse assignRowAuto_ but we need to capture the name
    // assignRowAuto_ does not return the name easily, it writes to sheet.
    // Let's modify assignRowAuto_ or just read it back? 
    // Actually, assignRowAuto_ writes to sheet. We can read it back.

    // But wait, assignRowAuto_ is void. I should make it return info if possible or read the sheet.
    // Let's rely on reading the sheet after update or trust it works. 
    // Better: Allow assignRowAuto_ to return result or use a lower level call.
    // I'll stick to calling assignRowAuto_ and then returning success.

    assignRowAuto_(row, {
      forceReassign: true,
      mode: 'Manual Reassign',
      actionType: 'Reassignment',
      details: { reason: reason }
    });

    // Get the new assignee from the sheet to confirm
    const appts = getApptsSheet_();
    const newAssignee = appts.getRange(row, COL_ASSIGNED).getValue();

    return { ok: true, newAssignee: newAssignee };

  } catch (e) {
    logError('reassignSelectedRow', e);
    return { ok: false, message: e.message };
  }
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

      logRoundRobinAction_('Assignment Failed', {
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

    // Write assignment fields
    const now = new Date();
    const user = safeUserEmail_();

    appts.getRange(row, COL_CREATED_TS).setValue(now);
    appts.getRange(row, COL_ASSIGNED).setValue(assignee);
    appts.getRange(row, COL_MODE).setValue(opts.mode || 'Auto');
    appts.getRange(row, COL_ASSIGNED_BY).setValue(user);

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

/**
 * Centralized function to get pointer, determine assignee, advance pointer, and log audit.
 * returns { assignee, pointerBefore, pointerAfter, nextUp }
 */
function advanceRoundRobinPointer_(roster, auditInfo) {
  if (!roster || roster.length === 0) throw new Error('Roster empty');

  const pointerBefore = normalizePointer_(getPointer_(), roster.length);
  const assignee = roster[pointerBefore];

  // Calc new pointer
  const pointerAfter = (pointerBefore + 1) % roster.length;

  // Update state
  setPointer_(pointerAfter);

  // Log it
  const nextUp = roster[pointerAfter];

  logRoundRobinAction_(auditInfo.actionType || 'Advance', {
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
function logRoundRobinAction_(action, detailsObj) {
  try {
    const ss = SpreadsheetApp.getActive();
    let auditSheet = ss.getSheetByName(SHEET_AUDIT);
    if (!auditSheet) {
      auditSheet = ss.insertSheet(SHEET_AUDIT);
      auditSheet.appendRow([
        'Timestamp',
        'User',
        'Action',
        'Reference',
        'Details',
      ]);
      auditSheet.setFrozenRows(1);
    }

    const now = new Date();

    // Use system user unless specifically passed in details (e.g. from manual edit handler)
    const user = detailsObj.user || safeUserEmail_();

    // Format details as Key: Value string
    let detailsStr = '';
    if (detailsObj) {
      // Filter out row/user from details string if they are redundant,
      // but 'row' is often put in Reference.
      const { row, user: _u, ...rest } = detailsObj;

      detailsStr = Object.entries(rest)
        .map(([k, v]) => `${k}=${v}`) // Changed to k=v for tighter format
        .join(' | ');
    }

    const reference = detailsObj.row ? `Row ${detailsObj.row}` : '';

    auditSheet.appendRow([now, user, action, reference, detailsStr]);
  } catch (e) {
    // CRITCIAL: Log this failure so admins know Audit is broken.
    // Do NOT throw since we don't want to break the transaction if possible.
    logError('logRoundRobinAction_', 'Audit Log Failed', {
      originalError: e.toString(),
      action: action,
      details: detailsObj,
    });
  }
}

/***** DATA ACCESS *****/
function getApptsSheet_() {
  return SpreadsheetApp.getActive().getSheetByName(SHEET_APPTS);
}

function getStateSheet_() {
  return SpreadsheetApp.getActive().getSheetByName(SHEET_STATE);
}

function getEligibleRoster_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_ROSTER);
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
