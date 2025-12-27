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
  // Wait longer for lock to avoid contention issues
  lock.waitLock(15000);

  try {
    // Basic validation
    const apptIso = (payload.apptIso || '').trim();
    const customerName = (payload.customerName || '').trim();
    const phone = (payload.phone || '').trim().replace(/\s+/g, '');
    const notes = (payload.notes || '').trim();
    const assignedByName = (payload.assignedByName || '').trim();

    if (!assignedByName) {
      throw new Error('Please select "Assigned By".');
    }

    if (!apptIso || !customerName || !phone) {
      throw new Error('Missing required fields (Date, Name, or Phone).');
    }

    const ss = SpreadsheetApp.getActive();
    // Use string literal to avoid scope issues
    const appts = ss.getSheetByName('APPOINTMENTS');
    if (!appts) throw new Error('Sheet "APPOINTMENTS" not found.');

    // Parse appt date/time from ISO-ish input (from datetime-local)
    const apptDt = new Date(apptIso);
    if (isNaN(apptDt.getTime())) throw new Error('Invalid appointment date/time.');

    // Check for eligible roster (function from round_robin.js)
    const roster = getEligibleRoster_();
    if (roster.length === 0) throw new Error('No eligible salespeople found in RR_ROSTER.');

    // --- CENTRALIZED LOGIC CALL ---
    // This handles finding the assignee, advancing variable, and LOGGING TO AUDIT
    const result = advanceRoundRobinPointer_(roster, {
        actionType: 'Sidebar Appointment',
        details: {
            appt: apptIso,
            customer: customerName,
            creator: assignedByName
        }
    });

    const assignee = result.assignee;
    const nextUp = result.nextUp;

    // Write row to APPOINTMENTS
    const now = new Date();

    // We already checked appts exists.
    // Append to bottom or empty row? Use getLastRow() + 1
    const newRow = appts.getLastRow() + 1;

    // Columns: A=Created, B=ApptDt, C=Customer, D=Phone, E=Assigned, F=Mode, G=AssignedBy, H=Notes
    // Ensure we are setting exactly 8 columns
    const rowValues = [[
      now,          // A
      apptDt,       // B
      customerName, // C
      phone,        // D
      assignee,     // E
      'Auto',       // F
      assignedByName, // G
      notes         // H
    ]];

    appts.getRange(newRow, 1, 1, 8).setValues(rowValues);

    // Success response
    return {
      ok: true,
      assignedTo: assignee,
      nextUp
    };

  } catch (err) {
    // Return error to client so it can be shown in the sidebar
    return {
      ok: false,
      message: err.message || String(err)
    };
  } finally {
    lock.releaseLock();
  }
}

// Re-export getAssignmentUsers for the client-side loader
function getAssignmentUsers() {
  // Use the internal helper (which we keep locally or define in round_robin.js?)
  // The original file had getAssignmentUsers_ duplicated.
  // Let's check if round_robin.js has `getAssignmentUsers_`.
  // Checking previous file view... round_robin.js does NOT have getAssignmentUsers_.
  // So we MUST keep getAssignmentUsers_ HERE, or move it to round_robin.js.
  // The plan said "Remove... getAssignmentUsers_", implying it was a duplicate.
  // Let me double check round_robin.js content from Step 8.
  // Step 8 content for round_robin.js shows: getEligibleRoster_, getPointer_, setPointer_, normalizePointer_, getActiveRow_, safeUserEmail_, getApptsSheet_, getStateSheet_.
  // It does NOT show getAssignmentUsers_.
  // So I must KEEP getAssignmentUsers_ here or moving it to round_robin.js.
  // I'll keep it here for now to avoid breaking the "Assigned By" dropdown,
  // but I will rename it or keep it as is.
  // Actually, to be safe and clean, I will keep it here but remove the other duplicates.
  return getAssignmentUsers_();
}

function getAssignmentUsers_() {
    const ss = SpreadsheetApp.getActive();
    // We can use a constant if we want, or just literal string 'RR_USERS'
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


