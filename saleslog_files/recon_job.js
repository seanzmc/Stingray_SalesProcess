/** Recon destination writes use a different lock from daily sales writes. */
function _withReconLock(fn) {
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(1000)) throw new Error('Recon export is already running; retry later.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Morning is defined in the spreadsheet's configured time zone. */
function _reconClock() {
  const now = new Date();
  const zone = Session.getScriptTimeZone();
  return {day: Utilities.formatDate(now, zone, 'yyyy-MM-dd'),
    morning: Number(Utilities.formatDate(now, zone, 'H')) < 12};
}

/** Called only after a successful daily sales/analytics operation. */
function _queueReconAfterDaily() {
  try {
    withScriptLock(() => {
      const clock = _reconClock();
      const props = PropertiesService.getScriptProperties();
      const pending = JSON.parse(props.getProperty('RECON:pending') || 'null');
      if (!clock.morning || props.getProperty('RECON:lastAttemptDay') === clock.day ||
          (pending && pending.day === clock.day)) return;
      const trigger = ScriptApp.newTrigger('processRecon').timeBased().after(60000).create();
      props.setProperty('RECON:pending', JSON.stringify({day: clock.day, id: trigger.getUniqueId()}));
      console.info('Recon queued once after daily sales; separate morning execution.');
    }, {suppressAlert: true});
  } catch (error) {
    logError('queueReconAfterDaily', error);
    // Scheduling must never change the successful sales outcome.
  }
}

/** Only a queued, same-morning trigger may claim the daily Recon attempt. */
function processRecon(event) {
  const runId = Utilities.getUuid();
  const started = Date.now();
  try {
    const claimed = withScriptLock(() => {
      const props = PropertiesService.getScriptProperties();
      const pending = JSON.parse(props.getProperty('RECON:pending') || 'null');
      const clock = _reconClock();
      if (!pending || !event || String(event.triggerUid) !== pending.id) return false;
      props.deleteProperty('RECON:pending');
      if (!clock.morning || pending.day !== clock.day ||
          props.getProperty('RECON:lastAttemptDay') === clock.day) return false;
      // Claim before any destination work, including failures or hard timeouts.
      props.setProperty('RECON:lastAttemptDay', clock.day);
      return true;
    }, {suppressAlert: true});
    if (!claimed) {
      console.info('Recon skipped: no eligible queued morning attempt.');
      return;
    }
    const result = exportTradesToReconLog({scanMonthly: true, dryRun: false});
    console.info(JSON.stringify({context: 'processRecon', runId, event: 'completed',
      elapsedMs: Date.now() - started, appended: result.appended,
      skippedDuplicates: result.skippedDuplicates}));
    return result;
  } catch (error) {
    logError('processRecon', error, {runId, elapsedMs: Date.now() - started});
    throw error;
  }
}

/** Remove the old repeating schedule; daily processing creates one-shot jobs. */
function setupReconAutomation() {
  return withScriptLock(() => {
    const existing = ScriptApp.getProjectTriggers().filter(
      trigger => trigger.getHandlerFunction() === 'processRecon'
    );
    existing.forEach(trigger => ScriptApp.deleteTrigger(trigger));
    PropertiesService.getScriptProperties().deleteProperty('RECON:pending');
    console.info('Recon repeating triggers removed: ' + existing.length +
      '. Recon now runs only after successful morning daily processing, at most once per day.');
  }, {suppressAlert: true});
}
