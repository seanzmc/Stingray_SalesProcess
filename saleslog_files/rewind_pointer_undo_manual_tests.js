/**
 * Manual test helpers for Rewind Pointer (Undo).
 *
 * Run these functions from the Apps Script editor.
 * They are not used by production flows and are intended for operator validation.
 */

/** Returns a fresh dialog context (best-effort). */
function manualTest_RewindPointerDialog_GetContext() {
  return buildRewindPointerDialogContext_();
}

/**
 * Attempts to evaluate the dialog HTML template server-side.
 * Note: This does not execute client JS, but it does confirm the template loads and renders.
 */
function manualTest_RewindPointerDialog_EvaluateTemplate() {
  const t = HtmlService.createTemplateFromFile('RewindPointerDialog');
  t.reasons = REWIND_POINTER_REASONS;
  t.context = buildRewindPointerDialogContext_();
  const html = t.evaluate();
  return {
    ok: true,
    contentLength: typeof html.getContent === 'function' ? html.getContent().length : null,
  };
}

function manualTest_RewindPointerUndo_InvokeWithInvalidReason() {
  const ctx = buildRewindPointerDialogContext_();
  if (!ctx || !ctx.ok) throw new Error(ctx && ctx.error ? ctx.error : 'Context not OK');

  // Intentionally invalid reason
  return rewindPointerUndoWithReason_('INVALID_REASON', ctx.token, {
    now: new Date(),
  });
}

function scanAuditForRequestId_(auditSheet, requestId, maxRowsToScan) {
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

/**
 * Simulates a failure at a specific failpoint and validates rollback.
 * Returns a structured result object.
 */
function manualTest_RewindPointerUndo_SimulateFailure(failpoint) {
  const lockResult = acquireScriptLockWithRetry();
  if (!lockResult.success) {
    throw new Error('System busy (lock timeout). Please try again.');
  }

  try {
    const ctx = buildRewindPointerDialogContext_();
    if (!ctx || !ctx.ok) throw new Error(ctx && ctx.error ? ctx.error : 'Context not OK');
    if (!ctx.appointment || !ctx.appointment.row) {
      throw new Error('No appointment context available for undo simulation.');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const stateSheet = getStateSheet_();
    const apptsSheet = getApptsSheet_();
    const auditSheet = getOrCreateAuditSheet_(ss);

    const apptRow = Number(ctx.appointment.row);
    const pointerBefore = stateSheet.getRange(CELL_POINTER).getValue();
    const lastAssignedBefore = stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue();
    const notesBefore = apptsSheet.getRange(apptRow, COL_NOTES).getValue();

    const requestId = ctx.token && ctx.token.requestId ? ctx.token.requestId : '';
    const marker = buildUndoNotesMarker_(requestId);

    let errorMessage = '';
    try {
      rewindPointerUndoWithReason_(REWIND_POINTER_REASONS[0], ctx.token, {
        now: new Date(),
        failpoint: String(failpoint || '').trim(),
      });
      return {
        ok: false,
        message: 'Expected failure but operation succeeded.',
      };
    } catch (e) {
      errorMessage = e && e.message ? e.message : String(e);
    }

    const pointerAfter = stateSheet.getRange(CELL_POINTER).getValue();
    const lastAssignedAfter = stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue();
    const notesAfter = apptsSheet.getRange(apptRow, COL_NOTES).getValue();

    const notesHasMarker = String(notesAfter || '').indexOf(marker) !== -1;
    const auditScan = scanAuditForRequestId_(auditSheet, requestId, 75);

    const result = {
      ok: false,
      failpoint: String(failpoint || ''),
      requestId: requestId,
      marker: marker,
      errorMessage: errorMessage,
      pointerUnchanged: String(pointerAfter) === String(pointerBefore),
      lastAssignedUnchanged: String(lastAssignedAfter || '') === String(lastAssignedBefore || ''),
      notesMarkerPresentAfterFailure: notesHasMarker,
      auditHasRequestIdAfterFailure: auditScan.found,
      auditRequestIdCount: auditScan.count,
    };

    result.ok =
      result.pointerUnchanged &&
      result.lastAssignedUnchanged &&
      !result.notesMarkerPresentAfterFailure &&
      !result.auditHasRequestIdAfterFailure;

    return result;
  } finally {
    lockResult.lock.releaseLock();
  }
}

/**
 * Simulates a duplicate retry (same requestId) and validates dedupe.
 * WARNING: This will temporarily modify pointer/audit/notes, then attempt cleanup.
 */
function manualTest_RewindPointerUndo_SimulateRetry_NoDuplicate() {
  const lockResult = acquireScriptLockWithRetry();
  if (!lockResult.success) {
    throw new Error('System busy (lock timeout). Please try again.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stateSheet = getStateSheet_();
  const apptsSheet = getApptsSheet_();
  const auditSheet = getOrCreateAuditSheet_(ss);

  try {
    const ctx = buildRewindPointerDialogContext_();
    if (!ctx || !ctx.ok) throw new Error(ctx && ctx.error ? ctx.error : 'Context not OK');
    if (!ctx.appointment || !ctx.appointment.row) {
      throw new Error('No appointment context available for retry simulation.');
    }

    const apptRow = Number(ctx.appointment.row);
    const requestId = ctx.token && ctx.token.requestId ? ctx.token.requestId : '';
    const marker = buildUndoNotesMarker_(requestId);

    // Snapshot state for cleanup.
    const pointerBefore = stateSheet.getRange(CELL_POINTER).getValue();
    const lastAssignedBefore = stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).getValue();
    const notesBefore = apptsSheet.getRange(apptRow, COL_NOTES).getValue();

    // Perform Undo once.
    const res1 = rewindPointerUndoWithReason_(REWIND_POINTER_REASONS[0], ctx.token, {
      now: new Date(),
    });

    // Retry with the same token (should dedupe / no-op success).
    const res2 = rewindPointerUndoWithReason_(REWIND_POINTER_REASONS[0], ctx.token, {
      now: new Date(),
    });

    const pointerAfter = stateSheet.getRange(CELL_POINTER).getValue();
    const notesAfter = apptsSheet.getRange(apptRow, COL_NOTES).getValue();
    const markerCount = (
      String(notesAfter || '').match(
        new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      ) || []
    ).length;
    const auditScan = scanAuditForRequestId_(auditSheet, requestId, 100);

    const result = {
      ok: false,
      requestId: requestId,
      marker: marker,
      res1: res1,
      res2: res2,
      markerCount: markerCount,
      auditRequestIdCount: auditScan.count,
      retryWasNoOp: !!(res2 && res2.alreadyApplied),
      // NOTE: Previous implementation compared a value to itself, always returning true.
      // This verifies that the second call did not rewind the pointer again.
      pointerChangedOnlyOnce: !!(res1 && String(pointerAfter) === String(res1.pointerAfter)),
      cleanup: { ok: false },
    };

    result.ok = markerCount === 1 && auditScan.count === 1 && result.retryWasNoOp;

    // Cleanup: restore pointer + lastAssigned + notes, and remove audit row with requestId.
    const cleanupErrors = [];
    try {
      withDocumentLock_(() => {
        try {
          stateSheet.getRange(CELL_POINTER).setValue(pointerBefore);
        } catch (e) {
          cleanupErrors.push('pointer');
        }
        try {
          stateSheet.getRange(CELL_APPT_LAST_ASSIGNED_NAME).setValue(lastAssignedBefore);
        } catch (e) {
          cleanupErrors.push('lastAssigned');
        }
        try {
          apptsSheet.getRange(apptRow, COL_NOTES).setValue(notesBefore);
        } catch (e) {
          cleanupErrors.push('notes');
        }

        try {
          // Find the audit row containing this requestId in the last 150 rows.
          const lastRow = auditSheet.getLastRow();
          const scan = Math.max(1, Math.min(150, lastRow - 1));
          const startRow = Math.max(2, lastRow - scan + 1);
          const numRows = lastRow - startRow + 1;
          const values = auditSheet.getRange(startRow, 1, numRows, 5).getValues();

          let foundRow = null;
          for (let i = values.length - 1; i >= 0; i--) {
            const details = String(values[i][4] || '');
            if (details.indexOf(requestId) !== -1) {
              foundRow = startRow + i;
              break;
            }
          }

          if (foundRow) {
            const lr = auditSheet.getLastRow();
            if (lr === foundRow) auditSheet.deleteRow(foundRow);
            else auditSheet.getRange(foundRow, 1, 1, 5).clearContent();
          }
        } catch (e) {
          cleanupErrors.push('audit');
        }
      });
    } catch (e) {
      cleanupErrors.push('documentLock');
    }

    result.cleanup = { ok: cleanupErrors.length === 0, errors: cleanupErrors };
    return result;
  } finally {
    lockResult.lock.releaseLock();
  }
}
