function showNewAppointmentSidebar() {
  const html = HtmlService.createHtmlOutputFromFile(
    'NewAppointmentSidebar'
  ).setTitle('New Appointment');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Called by the sidebar to create + auto-assign an appointment.
 * payload = { apptIso: string, customerName: string, phone: string, notes?: string, assignedByName: string }
 */
function createAppointmentFromSidebar(payload) {
  // Use robust lock with retry
  const lockResult = acquireScriptLockWithRetry();

  if (!lockResult.success) {
    logError('createAppointmentFromSidebar', 'Lock timeout', { payload });
    return {
      ok: false,
      message:
        'System is busy (lock timeout). Please try again in a few seconds.',
    };
  }

  try {
    // Basic validation
    const apptIso = (payload.apptIso || '').trim();
    const customerName = (payload.customerName || '').trim();
    const phone = (payload.phone || '').trim().replace(/\s+/g, '');
    const notes = (payload.notes || '').trim();
    const assignedByNameRaw = (payload.assignedByName || '').trim();

    if (!assignedByNameRaw) {
      throw new Error('Please select "Assigned By".');
    }

    // Strict allowlist validation (RR_USERS, Active == true)
    const allowedUsers = getAssignmentUsers_();
    const allowedMap = allowedUsers.reduce((acc, name) => {
      acc[String(name).trim().toLowerCase()] = String(name).trim();
      return acc;
    }, {});
    const assignedByName = allowedMap[assignedByNameRaw.toLowerCase()];
    if (!assignedByName) {
      throw new Error('Invalid "Assigned By". Please select a valid user from the list.');
    }

    if (!apptIso || !customerName || !phone) {
      throw new Error('Missing required fields (Date, Name, or Phone).');
    }

    const appts = getSheetOrThrow_('APPOINTMENTS');

    // Parse appt date/time from ISO-ish input (from datetime-local)
    const apptDt = new Date(apptIso);
    if (isNaN(apptDt.getTime()))
      throw new Error('Invalid appointment date/time.');

    // Check for eligible roster (function from round_robin.js)
    const roster = getEligibleRoster_();
    if (roster.length === 0) {
      logRoundRobinAction_(AUDIT_ACTIONS.ASSIGNMENT_FAILED, {
        reason: 'No Eligible Reps',
        customer: customerName,
        creator: assignedByName,
      });
      throw new Error('No eligible salespeople found in RR_ROSTER.');
    }

    // --- CENTRALIZED LOGIC CALL ---
    // This handles finding the assignee, advancing variable, and LOGGING TO AUDIT
    const result = advanceRoundRobinPointerByName_(roster, {
      actionType: AUDIT_ACTIONS.NEW_APPOINTMENT,
      details: {
        appt: apptIso,
        customer: customerName,
        creator: assignedByName,
        source: 'Sidebar',
      },
    });

    const assignee = result.assignee;
    const nextUp = result.nextUp;

    // Write row to APPOINTMENTS
    const now = new Date();

    const newRow = appts.getLastRow() + 1;

    // Columns: A=Created, B=ApptDt, C=Customer, D=Phone, E=Assigned, F=Mode, G=AssignedBy, H=Notes
    // Ensure we are setting exactly 8 columns
    const rowValues = [
      [
        now, // A
        apptDt, // B
        customerName, // C
        phone, // D
        assignee, // E
        'Auto', // F
        assignedByName, // G
        notes, // H
      ],
    ];

    appts.getRange(newRow, 1, 1, 8).setValues(rowValues);

    // PERSISTENCE: Save "Assigned By" for next time
    try {
      PropertiesService.getUserProperties().setProperty(
        'LAST_ASSIGNED_BY',
        assignedByName
      );
    } catch (e) {
      // Ignore persistence errors
    }

    // Success response (include row for sidebar reassign override)
    return {
      ok: true,
      assignedTo: assignee,
      nextUp,
      row: newRow,
    };
  } catch (err) {
    // Log server-side before returning
    logError('createAppointmentFromSidebar', err, { payload });

    // Return error to client so it can be shown in the sidebar
    return {
      ok: false,
      message: err.message || String(err),
    };
  } finally {
    lockResult.lock.releaseLock();
  }
}

// Re-export getAssignmentUsers for the client-side loader
function getAssignmentUsers() {
  const users = getAssignmentUsers_();
  let lastSelected = '';
  try {
    lastSelected =
      PropertiesService.getUserProperties().getProperty('LAST_ASSIGNED_BY') ||
      '';
  } catch (e) {
    // ignore
  }

  return {
    users: users,
    lastSelected: lastSelected,
  };
}

function getAssignmentUsers_() {
  const sheet = getSheetOrNull_('RR_USERS');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // A: name, B: active
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return data
    .filter((r) => r[0] && r[1] === true)
    .map((r) => String(r[0]).trim());
}
