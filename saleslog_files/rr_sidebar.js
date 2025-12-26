function showNewAppointmentSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('NewAppointmentSidebar')
    .setTitle('New Appointment');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Called by the sidebar to create + auto-assign an appointment.
 * payload = { apptIso: string, customerName: string, phone: string, notes?: string }
 */
function createAppointmentFromSidebar(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);

  try {
    // Basic validation
    const apptIso = (payload.apptIso || '').trim();
    const customerName = (payload.customerName || '').trim();
    const phone = (payload.phone || '').trim().replace(/\s+/g, '');
    const notes = (payload.notes || '').trim();
    const assignedByName = (payload.assignedByName || '').trim();

    if (!assignedByName) {
      throw new Error('Please select Assigned By.');
    }

    if (!apptIso || !customerName || !phone) {
      throw new Error('Missing required fields.');
    }

    const ss = SpreadsheetApp.getActive();
    const appts = ss.getSheetByName('APPOINTMENTS');
    if (!appts) throw new Error('APPOINTMENTS sheet not found.');

    // Parse appt date/time from ISO-ish input (from datetime-local)
    // datetime-local returns "YYYY-MM-DDTHH:MM"
    const apptDt = new Date(apptIso);
    if (isNaN(apptDt.getTime())) throw new Error('Invalid appointment date/time.');

    const roster = getEligibleRoster_();
    if (roster.length === 0) throw new Error('No eligible salespeople in RR_ROSTER.');

    // Pointer -> assignee
    let pointer = getPointer_();
    pointer = normalizePointer_(pointer, roster.length);
    const assignee = roster[pointer];

    // Write row
    const now = new Date();
    const assignedBy = assignedByName; // assignedByName select dropdown name of user who created the appointment

    const newRow = appts.getLastRow() + 1;
    appts.getRange(newRow, 1, 1, 8).setValues([[
      now,          // A Created Timestamp
      apptDt,       // B Appt Date/Time
      customerName, // C Customer Name
      phone,        // D Phone
      assignee,     // E Assigned Salesperson
      'Auto',       // F Assignment Mode
      assignedBy,   // G Assigned By
      notes         // H Notes
    ]]);

    // Advance pointer
    pointer = (pointer + 1) % roster.length;
    setPointer_(pointer);

    // Optional: return confirmation (and next up) to show in sidebar UI
    const nextUp = roster[pointer] || '';
    return {
      ok: true,
      assignedTo: assignee,
      nextUp
    };

  } finally {
    lock.releaseLock();
  }
}

/*** Helpers (reuse your existing ones if already present) ***/
function getEligibleRoster_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('RR_ROSTER');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // A: name, B: active, C: eligible
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  return data
    .filter(r => r[0] && r[1] === true && r[2] === true)
    .map(r => String(r[0]).trim());
}

function getPointer_() {
  const ss = SpreadsheetApp.getActive();
  const state = ss.getSheetByName('RR_STATE');
  if (!state) throw new Error('RR_STATE sheet not found.');

  const v = state.getRange('B2').getValue();
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function setPointer_(n) {
    const ss = SpreadsheetApp.getActive();
    const state = ss.getSheetByName('RR_STATE');
    if (!state) throw new Error('RR_STATE sheet not found.');

    state.getRange('B2').setValue(n);
}

function normalizePointer_(pointer, len) {
    if (!Number.isFinite(pointer) || pointer < 0) return 0;
    if (len <= 0) return 0;
    return pointer % len;
}

// Better than getActiveUser(); still may be blank on consumer accounts.
function safeUserEmail_() {
  try {
    return Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

function getAssignmentUsers_() {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName('RR_USERS');
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    // A: name, B: active
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return data
    .filter(r => r[0] && r[1] === true)
    .map(r => String(r[0]).trim());
}

// Exposed to HTML
function getAssignmentUsers() {
  return getAssignmentUsers_();
}

