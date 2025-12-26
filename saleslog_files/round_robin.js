/***** CONFIG *****/
const SHEET_APPTS = 'APPOINTMENTS';
const SHEET_ROSTER = 'RR_ROSTER';
const SHEET_STATE = 'RR_STATE';

// APPOINTMENTS column indexes (1-based)
const COL_CREATED_TS = 1;   // A
const COL_APPT_DT    = 2;   // B
const COL_CUST_NAME  = 3;   // C
const COL_PHONE      = 4;   // D
const COL_ASSIGNED   = 5;   // E
const COL_MODE       = 6;   // F
const COL_ASSIGNED_BY= 7;   // G

// RR_STATE cells
const CELL_POINTER = 'B2';

// Where to optionally display "Next Up" on APPOINTMENTS
const NEXT_UP_DISPLAY_CELL = 'J2'; // tweak or ignore

const SHEET_AUDIT = 'RR_AUDIT';

/***** TRIGGERS *****/
// If using Google Form → install an "On form submit" trigger for this.
function onFormSubmit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_APPTS) return;

  const row = e.range.getRow();
  assignRowAuto_(row);
}

// If allowing direct entry into APPOINTMENTS → install an "On edit" trigger for this.
function onEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_APPTS) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();

  // Only react when user edits the input columns B/C/D
  if (![COL_APPT_DT, COL_CUST_NAME, COL_PHONE].includes(col)) return;

  const appts = getApptsSheet_();
  const values = appts.getRange(row, 1, 1, COL_ASSIGNED_BY).getValues()[0];

  const apptDt = values[COL_APPT_DT - 1];
  const name   = values[COL_CUST_NAME - 1];
  const phone  = values[COL_PHONE - 1];
  const assigned = values[COL_ASSIGNED - 1];

  // If already assigned, do nothing (allows manual override)
  if (assigned) return;

  // If required fields present, auto-assign
  if (apptDt && name && phone) {
    assignRowAuto_(row);
  }
}

/***** MENU ACTIONS *****/
function menuAssignSelectedRow() {
  const row = getActiveRow_();
  if (!row) return;
  assignRowAuto_(row);
}

function menuSkipAndReassignSelectedRow() {
  const row = getActiveRow_();
  if (!row) return;

  // Skip first
  skipPointer_();

  // Then reassign (force)
  assignRowAuto_(row, { forceReassign: true });
}

function menuMarkSelectedRowManual() {
  const row = getActiveRow_();
  if (!row) return;
  const appts = getApptsSheet_();

  appts.getRange(row, COL_MODE).setValue('Manual');

  const user = safeUserEmail_();
  logRoundRobinAction_('Mark Manual', { row: row, user: user });
}

function menuResetPointer() {
  // Optional: restrict by email/domain if you want.
  const oldPointer = getPointer_();
  setPointer_(0);

  logRoundRobinAction_('Reset Pointer', {
      pointerBefore: oldPointer,
      pointerAfter: 0,
      reason: 'Admin Reset'
  });

  refreshNextUp_();
}

function refreshNextUp_() {
  const appts = getApptsSheet_();
  const next = peekNextAssignee_();
  appts.getRange(NEXT_UP_DISPLAY_CELL).setValue(next || '(no eligible reps)');
}

/***** CORE LOGIC *****/

/**
 * Main entry point for auto-assigning a row.
 * Uses centralized advanceRoundRobinPointer_ for logic & auditing.
 */
function assignRowAuto_(row, opts = {}) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);

  try {
    const appts = getApptsSheet_();

    // Read row data
    const rowRange = appts.getRange(row, 1, 1, COL_ASSIGNED_BY);
    const vals = rowRange.getValues()[0];

    const apptDt = vals[COL_APPT_DT - 1];
    const name   = vals[COL_CUST_NAME - 1];
    const phone  = vals[COL_PHONE - 1];

    // Must have the minimal appointment info
    if (!apptDt || !name || !phone) return;

    // Check existing assignment
    const alreadyAssigned = vals[COL_ASSIGNED - 1];
    if (alreadyAssigned && !opts.forceReassign) return;

    // Get roster & advance pointer
    const roster = getEligibleRoster_(); // array of names
    if (roster.length === 0) {
      appts.getRange(row, COL_MODE).setValue('No Eligible Reps');
      return;
    }

    // --- CENTRALIZED LOGIC CALL ---
    const result = advanceRoundRobinPointer_(roster, {
        actionType: 'Assignment',
        details: {
            row: row,
            customer: name,
            notes: opts.forceReassign ? 'Reassignment (Force)' : 'New Assignment'
        }
    });

    const assignee = result.assignee;

    // Write assignment fields
    const now = new Date();
    const user = safeUserEmail_();

    appts.getRange(row, COL_CREATED_TS).setValue(now);
    appts.getRange(row, COL_ASSIGNED).setValue(assignee);
    appts.getRange(row, COL_MODE).setValue('Auto');
    appts.getRange(row, COL_ASSIGNED_BY).setValue(user);

    // Update Next Up display (optional)
    const next = result.nextUp || '';
    appts.getRange(NEXT_UP_DISPLAY_CELL).setValue(next || '(no eligible reps)');

  } finally {
    lock.releaseLock();
  }
}

function peekNextAssignee_() {
  const roster = getEligibleRoster_();
  if (roster.length === 0) return '';
  let pointer = normalizePointer_(getPointer_(), roster.length);
  return roster[pointer];
}

function skipPointer_() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);

  try {
    const roster = getEligibleRoster_();
    if (roster.length === 0) return;

    // Advance without assigning
    advanceRoundRobinPointer_(roster, {
        actionType: 'Skip',
        details: { reason: 'User requested skip' }
    });

    refreshNextUp_();

  } finally {
    lock.releaseLock();
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
        ...auditInfo.details
    });

    return {
        assignee,
        pointerBefore,
        pointerAfter,
        nextUp
    };
}

/***** AUDITING *****/
function logRoundRobinAction_(action, detailsObj) {
    try {
        const ss = SpreadsheetApp.getActive();
        let auditSheet = ss.getSheetByName(SHEET_AUDIT);
        if (!auditSheet) {
            auditSheet = ss.insertSheet(SHEET_AUDIT);
            auditSheet.appendRow(['Timestamp', 'User', 'Action', 'Reference', 'Details']);
            auditSheet.setFrozenRows(1);
        }

        const now = new Date();

        // Use provided user override (e.g. from sidebar) or fallback to system user
        let user = safeUserEmail_();
        if (detailsObj && detailsObj.user) {
            user = detailsObj.user;
            delete detailsObj.user; // Don't duplicate in details string
        } else if (detailsObj && detailsObj.creator) {
             user = detailsObj.creator; // Handle sidebar 'creator' field
             delete detailsObj.creator;
        }

        // Format details as Key: Value string instead of JSON
        let detailsStr = '';
        if (detailsObj) {
            // Filter out row as it's in Reference
            const { row, ...rest } = detailsObj;

            detailsStr = Object.entries(rest)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' | ');
        }

        const reference = detailsObj.row ? `Row ${detailsObj.row}` : '';

        auditSheet.appendRow([now, user, action, reference, detailsStr]);

    } catch(e) {
        console.error('Audit Log Failed', e);
        // Don't block main flow if audit fails
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
    .filter(r => r[0] && r[1] === true && r[2] === true)
    .map(r => String(r[0]).trim());
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
