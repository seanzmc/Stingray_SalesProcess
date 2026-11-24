/** Diagnostics and notifications for the daily entrypoint. */
function _createDailyTrace(startTime) {
  const runId = Utilities.getUuid();
  let stage = 'lock_wait';
  let stageStart = startTime;
  const context = () => ({ runId, stage, elapsedMs: Date.now() - startTime });
  const emit = (event) => console.info(JSON.stringify({
    context: 'processDaily', event, ...context(),
    stageMs: Date.now() - stageStart,
  }));
  emit('start');
  return {
    context,
    next(nextStage) {
      emit('stage_finished');
      stage = nextStage;
      stageStart = Date.now();
      emit('stage_started');
    },
    finish(status) { emit(status); },
  };
}

function _requireDailyAnalyticsRecovery(checkpoint) {
  if (!recoverAnalyticsForCheckpoint_(checkpoint)) {
    throw new Error('Analytics recovery failed. The checkpoint was retained for retry.');
  }
}

/** A modeless HTML notification does not suspend the Apps Script execution. */
function _showDailyResult(title, message) {
  try {
    const escaped = String(message).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    const html = HtmlService.createHtmlOutput(
      '<div style="font:14px Arial;white-space:pre-wrap">' + escaped + '</div>'
    ).setWidth(480).setHeight(420);
    SpreadsheetApp.getUi().showModelessDialog(html, title);
  } catch (error) {
    // A notification failure must not replace the original processing error.
    console.warn(JSON.stringify({context: 'processDaily', event: 'dialog_unavailable',
      message: 'Processing result is unchanged; trying a spreadsheet toast.',
      reason: String(error && error.message || error)}));
    try {
      SS.toast(message, title, 15);
      console.info('processDaily result shown as a spreadsheet toast');
    } catch (toastError) {
      console.warn('processDaily result notification unavailable; see processing outcome above');
    }
  }
}
