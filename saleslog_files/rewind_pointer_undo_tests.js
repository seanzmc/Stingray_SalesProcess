/**
 * Automated tests for Rewind Pointer (Undo).
 *
 * Run `runAllTests_RewindPointerUndo()` from the Apps Script editor.
 *
 * Design goals:
 * - Lightweight, no external dependencies
 * - Uses dedicated temporary sheets + dependency injection so production sheets are untouched
 * - Verifies drift/idempotency/rollback semantics at the function boundary
 */

// -----------------------------------------------------------------------------
// Minimal assertion helpers (Apps Script style)
// -----------------------------------------------------------------------------

function assertTrue_(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed: expected condition to be true.');
}

function assertEquals_(expected, actual, message) {
  const exp = expected;
  const act = actual;
  if (exp === act) return;
  const msg =
    (message ? message + ' ' : '') +
    `Assertion failed: expected ${JSON.stringify(exp)} but got ${JSON.stringify(act)}.`;
  throw new Error(msg);
}

function assertContains_(haystack, needle, message) {
  const h = String(haystack || '');
  const n = String(needle || '');
  if (h.indexOf(n) !== -1) return;
  const msg =
    (message ? message + ' ' : '') +
    `Assertion failed: expected string to contain ${JSON.stringify(n)} but it did not.`;
  throw new Error(msg);
}

function assertNotContains_(haystack, needle, message) {
  const h = String(haystack || '');
  const n = String(needle || '');
  if (h.indexOf(n) === -1) return;
  const msg =
    (message ? message + ' ' : '') +
    `Assertion failed: expected string NOT to contain ${JSON.stringify(n)} but it did.`;
  throw new Error(msg);
}

function assertThrows_(fn, expectedMessageSubstring, message) {
  let threw = false;
  let errMessage = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    errMessage = e && e.message ? e.message : String(e);
  }

  if (!threw) {
    throw new Error(message || 'Assertion failed: expected function to throw.');
  }

  if (expectedMessageSubstring) {
    const expected = String(expectedMessageSubstring);
    if (errMessage.indexOf(expected) === -1) {
      throw new Error(
        (message ? message + ' ' : '') +
          `Assertion failed: expected thrown message to include ${JSON.stringify(expected)} but got ${JSON.stringify(
            errMessage
          )}.`
      );
    }
  }

  return errMessage;
}

// -----------------------------------------------------------------------------
// Test runner
// -----------------------------------------------------------------------------

/** Runs all Rewind Pointer Undo tests and returns a summary object. */
function runAllTests_RewindPointerUndo() {
  const tests = [
    { name: 'Dialog template contains required controls/text', fn: test_DialogTemplateContainsControls_ },
    { name: 'Server rejects invalid reason', fn: test_ServerRejectsInvalidReason_ },
    { name: 'Successful rewind writes pointer + audit + notes', fn: test_SuccessfulRewind_WritesAll_ },
    { name: 'Retry dedupe does not duplicate writes', fn: test_RetryDedupe_NoDuplicateWrites_ },
    { name: 'Rollback on failure leaves no partial state', fn: test_RollbackOnFailpoint_NoPartialState_ },
  ];

  const startedAt = new Date();
  Logger.log('=== Rewind Pointer Undo Tests ===');
  Logger.log('Start: ' + startedAt.toISOString());

  const failures = [];
  let passed = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const tStart = new Date();
    try {
      t.fn();
      passed++;
      Logger.log(`✓ ${t.name} (${new Date().getTime() - tStart.getTime()}ms)`);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      Logger.log(`✗ ${t.name}: ${msg}`);
      failures.push({ name: t.name, message: msg, stack: e && e.stack ? e.stack : null });
    }
  }

  const finishedAt = new Date();
  const summary = {
    ok: failures.length === 0,
    total: tests.length,
    passed: passed,
    failed: failures.length,
    failures: failures,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  Logger.log('--- Summary ---');
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

// -----------------------------------------------------------------------------
// Helpers for undo tests (isolated sheets + dependency injection)
// -----------------------------------------------------------------------------

function createTempSheet_(ss, baseName) {
  const suffix = Utilities.getUuid().slice(0, 8);
  const name = `${baseName}_${suffix}`;
  return ss.insertSheet(name);
}

function deleteSheetQuietly_(ss, sheet) {
  if (!sheet) return;
  try {
    ss.deleteSheet(sheet);
  } catch (e) {
    // Best-effort cleanup only.
    Logger.log('Cleanup warning (deleteSheetQuietly_): ' + (e && e.message ? e.message : e));
  }
}

function scanAuditForRequestId_Test_(auditSheet, requestId, maxRowsToScan) {
  const id = String(requestId || '').trim();
  if (!id) return { found: false, count: 0 };

  const lastRow = auditSheet.getLastRow();
  if (lastRow < 2) return { found: false, count: 0 };

  const scan = Math.max(1, Math.min(Number(maxRowsToScan) || 50, lastRow - 1));
  const startRow = Math.max(2, lastRow - scan + 1);
  const numRows = lastRow - startRow + 1;
  const values = auditSheet.getRange(startRow, 1, numRows, 5).getValues();

  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const details = String(values[i][4] || '');
    if (details.indexOf(id) !== -1) count++;
  }
  return { found: count > 0, count: count };
}

function withUndoTestEnv_(fn) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stateSheet = createTempSheet_(ss, 'ZZ_TEST_RR_STATE');
  const apptsSheet = createTempSheet_(ss, 'ZZ_TEST_APPOINTMENTS');
  const auditSheet = createTempSheet_(ss, 'ZZ_TEST_RR_AUDIT');

  // Keep the test state consistent with the pointer semantics:
  // - RR_STATE!B2 is the "next-up index"
  // - RR_STATE!D2 is the "last assigned name"
  const roster = ['Rep A', 'Rep B', 'Rep C'];
  const pointerBefore = 2; // next-up is Rep C
  const lastAssignedNameBefore = roster[1]; // previous assignee
  const apptRow = 2;
  const requestId = Utilities.getUuid();

  // Initialize RR_STATE
  stateSheet.getRange(CELL_POINTER).setValue(pointerBefore);
  stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).setValue(lastAssignedNameBefore);

  // Initialize APPOINTMENTS
  apptsSheet
    .getRange(1, 1, 1, COL_NOTES)
    .setValues([['Created', 'Appt Dt', 'Customer', 'Phone', 'Assigned', 'Mode', 'Assigned By', 'Notes']]);
  apptsSheet
    .getRange(apptRow, 1, 1, COL_NOTES)
    .setValues([[new Date('2026-01-01T12:00:00Z'), new Date('2026-01-02T14:30:00Z'), 'Test Customer', '555-0000', lastAssignedNameBefore, 'Auto', 'Test Creator', '']]);

  // Initialize RR_AUDIT
  auditSheet
    .getRange(1, 1, 1, 5)
    .setValues([['Timestamp', 'User', 'Action', 'Reference', 'Details']]);

  const env = {
    ss: ss,
    roster: roster,
    stateSheet: stateSheet,
    apptsSheet: apptsSheet,
    auditSheet: auditSheet,
    apptRow: apptRow,
    pointerBefore: pointerBefore,
    lastAssignedNameBefore: lastAssignedNameBefore,
    token: {
      pointerBefore: pointerBefore,
      lastAssignedNameBefore: lastAssignedNameBefore,
      apptRow: apptRow,
      requestId: requestId,
    },
  };

  try {
    return fn(env);
  } finally {
    // Always cleanup temp sheets so test runs don't accumulate artifacts.
    deleteSheetQuietly_(ss, stateSheet);
    deleteSheetQuietly_(ss, apptsSheet);
    deleteSheetQuietly_(ss, auditSheet);
  }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

function test_DialogTemplateContainsControls_() {
  const t = HtmlService.createTemplateFromFile('RewindPointerDialog');
  t.reasons = REWIND_POINTER_REASONS;
  t.context = {
    ok: true,
    token: {
      pointerBefore: 0,
      lastAssignedNameBefore: 'Rep A',
      apptRow: 2,
      requestId: 'TEST_REQUEST_ID',
    },
    pointer: {
      rosterCount: 3,
      nextUpIndexBefore: 0,
      nextUpNameBefore: 'Rep A',
      nextUpIndexAfter: 2,
      nextUpNameAfter: 'Rep C',
      lastAssignedNameBefore: 'Rep C',
      lastAssignedNameAfter: 'Rep B',
    },
    appointment: {
      row: 2,
      createdTs: '2026-01-01 09:00',
      apptDt: '2026-01-02 10:00',
      customer: 'Test Customer',
      phone: '555-0000',
      assigned: 'Rep C',
      assignedBy: 'Tester',
    },
  };

  const html = t.evaluate().getContent();
  assertContains_(html, 'id="reason"', 'Reason select missing.');
  assertContains_(html, 'Confirm Undo', 'Confirm button text missing.');
  assertContains_(html, 'Cancel', 'Cancel button text missing.');
  assertContains_(
    html,
    'The appointment record will remain on the sheet',
    'Dialog context copy missing (appointment remains).'
  );
  assertContains_(html, 'id="createdTs"', 'Created timestamp field missing.');
}

function test_ServerRejectsInvalidReason_() {
  withUndoTestEnv_((env) => {
    const beforePointer = Number(env.stateSheet.getRange(CELL_POINTER).getValue());
    const beforeLastAssigned = String(
      env.stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue() || ''
    );
    const beforeNotes = String(env.apptsSheet.getRange(env.apptRow, COL_NOTES).getValue() || '');
    const beforeAuditLastRow = env.auditSheet.getLastRow();

    assertThrows_(
      () =>
        rewindPointerUndoWithReason_('INVALID_REASON', env.token, {
          roster: env.roster,
          stateSheet: env.stateSheet,
          apptsSheet: env.apptsSheet,
          auditSheet: env.auditSheet,
          withDocumentLock: (fn) => fn(),
        }),
      'Invalid reason'
    );

    assertEquals_(beforePointer, Number(env.stateSheet.getRange(CELL_POINTER).getValue()));
    assertEquals_(
      beforeLastAssigned,
      String(env.stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue() || '')
    );
    assertEquals_(beforeNotes, String(env.apptsSheet.getRange(env.apptRow, COL_NOTES).getValue() || ''));
    assertEquals_(beforeAuditLastRow, env.auditSheet.getLastRow());
  });
}

function test_SuccessfulRewind_WritesAll_() {
  withUndoTestEnv_((env) => {
    const now = new Date('2026-01-14T20:00:00Z');
    const actorEmail = 'test.actor@example.com';
    const actorName = 'Test Actor';
    const reason = REWIND_POINTER_REASONS[0];

    const pointerAfterExpected = calculateRewoundIndex_(env.pointerBefore, env.roster.length);
    const lastAssignedAfterExpected =
      env.roster[(pointerAfterExpected - 1 + env.roster.length) % env.roster.length];

    const res = rewindPointerUndoWithReason_(reason, env.token, {
      now: now,
      roster: env.roster,
      stateSheet: env.stateSheet,
      apptsSheet: env.apptsSheet,
      auditSheet: env.auditSheet,
      withDocumentLock: (fn) => fn(),
      userEmail: actorEmail,
      actorName: actorName,
    });

    assertTrue_(!!(res && res.ok), 'Expected ok result.');
    assertTrue_(!res.alreadyApplied, 'Expected first call to not be alreadyApplied.');

    // Pointer state
    assertEquals_(pointerAfterExpected, Number(env.stateSheet.getRange(CELL_POINTER).getValue()));
    assertEquals_(
      lastAssignedAfterExpected,
      String(env.stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue() || '')
    );

    // Notes append
    const notesAfter = String(env.apptsSheet.getRange(env.apptRow, COL_NOTES).getValue() || '');
    const marker = `[[RR_UNDO:${env.token.requestId}]]`;
    const ts = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    assertContains_(notesAfter, marker, 'Expected notes to include marker.');
    assertContains_(
      notesAfter,
      `${ts} - REWIND POINTER (UNDO) by ${actorName}: ${reason}`,
      'Expected notes line to include timestamp + actor + reason.'
    );

    // Audit append
    assertEquals_(2, env.auditSheet.getLastRow(), 'Expected exactly one audit row.');
    const auditRow = env.auditSheet.getRange(2, 1, 1, 5).getValues()[0];
    assertEquals_(AUDIT_ACTIONS.UNDO, String(auditRow[2] || ''), 'Expected audit action Undo.');
    const detailsStr = String(auditRow[4] || '');
    assertContains_(detailsStr, `reason=${reason}`, 'Expected audit details to include reason.');
    assertContains_(detailsStr, `actorEmail=${actorEmail}`, 'Expected audit details to include actorEmail.');
    assertContains_(detailsStr, `requestId=${env.token.requestId}`, 'Expected audit details to include requestId.');
    assertNotContains_(detailsStr, 'user=', 'Expected audit details to strip user= key.');
  });
}

function test_RetryDedupe_NoDuplicateWrites_() {
  withUndoTestEnv_((env) => {
    const now = new Date('2026-01-14T20:00:00Z');
    const actorEmail = 'test.actor@example.com';
    const actorName = 'Test Actor';
    const reason = REWIND_POINTER_REASONS[0];
    const options = {
      now: now,
      roster: env.roster,
      stateSheet: env.stateSheet,
      apptsSheet: env.apptsSheet,
      auditSheet: env.auditSheet,
      withDocumentLock: (fn) => fn(),
      userEmail: actorEmail,
      actorName: actorName,
    };

    const res1 = rewindPointerUndoWithReason_(reason, env.token, options);
    assertTrue_(!!(res1 && res1.ok), 'Expected first call ok.');

    const pointerAfterOnce = Number(env.stateSheet.getRange(CELL_POINTER).getValue());
    const notesAfterOnce = String(env.apptsSheet.getRange(env.apptRow, COL_NOTES).getValue() || '');
    const auditCountOnce = scanAuditForRequestId_Test_(env.auditSheet, env.token.requestId, 50).count;

    const res2 = rewindPointerUndoWithReason_(reason, env.token, options);
    assertTrue_(!!(res2 && res2.ok && res2.alreadyApplied), 'Expected retry to be alreadyApplied.');

    // Pointer should not change on retry.
    assertEquals_(pointerAfterOnce, Number(env.stateSheet.getRange(CELL_POINTER).getValue()));

    // Notes should not get duplicated.
    const marker = `[[RR_UNDO:${env.token.requestId}]]`;
    const notesAfterTwice = String(env.apptsSheet.getRange(env.apptRow, COL_NOTES).getValue() || '');
    const markerCount = (notesAfterTwice.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [])
      .length;
    assertEquals_(1, markerCount, 'Expected marker to appear once.');
    assertEquals_(notesAfterOnce, notesAfterTwice, 'Expected notes to remain unchanged on retry.');

    // Audit should not get duplicated.
    const auditCountTwice = scanAuditForRequestId_Test_(env.auditSheet, env.token.requestId, 50).count;
    assertEquals_(1, auditCountOnce, 'Expected one audit row after first call.');
    assertEquals_(1, auditCountTwice, 'Expected still one audit row after retry.');
  });
}

function test_RollbackOnFailpoint_NoPartialState_() {
  withUndoTestEnv_((env) => {
    const now = new Date('2026-01-14T20:00:00Z');
    const actorEmail = 'test.actor@example.com';
    const actorName = 'Test Actor';
    const reason = REWIND_POINTER_REASONS[0];

    const beforePointer = Number(env.stateSheet.getRange(CELL_POINTER).getValue());
    const beforeLastAssigned = String(
      env.stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue() || ''
    );
    const beforeNotes = String(env.apptsSheet.getRange(env.apptRow, COL_NOTES).getValue() || '');

    assertThrows_(
      () =>
        rewindPointerUndoWithReason_(reason, env.token, {
          now: now,
          roster: env.roster,
          stateSheet: env.stateSheet,
          apptsSheet: env.apptsSheet,
          auditSheet: env.auditSheet,
          withDocumentLock: (fn) => fn(),
          userEmail: actorEmail,
          actorName: actorName,
          failpoint: 'afterPointerWrite',
        }),
      'Simulated failure'
    );

    const marker = `[[RR_UNDO:${env.token.requestId}]]`;

    // Pointer should be rolled back.
    assertEquals_(beforePointer, Number(env.stateSheet.getRange(CELL_POINTER).getValue()));
    assertEquals_(
      beforeLastAssigned,
      String(env.stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue() || '')
    );

    // Notes/audit should be rolled back.
    const afterNotes = String(env.apptsSheet.getRange(env.apptRow, COL_NOTES).getValue() || '');
    assertEquals_(beforeNotes, afterNotes, 'Expected notes to be restored on rollback.');
    assertNotContains_(afterNotes, marker, 'Expected notes marker to be absent after rollback.');

    const auditScan = scanAuditForRequestId_Test_(env.auditSheet, env.token.requestId, 50);
    assertTrue_(!auditScan.found, 'Expected no audit entry containing requestId after rollback.');
  });
}

