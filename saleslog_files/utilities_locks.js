/**
 * Lock Utilities Module for Sales Log Pro.
 * Provides fail-closed script-lock acquisition with one bounded wait.
 *
 * @module utilities_locks
 */

/**
 * Maximum time one execution may wait for another script-locked operation.
 * A caller that cannot acquire the lock within this window fails without
 * entering its critical section and can be retried by the user or trigger.
 */
const LOCK_ACQUISITION_TIMEOUT_MS = 10000;

/**
 * Acquires the project script lock within one overall deadline.
 *
 * The legacy function name is retained for existing callers, but acquisition
 * intentionally uses one tryLock() call rather than repeated blocking attempts.
 * This caps the default worst-case wait at 10 seconds instead of 183.1 seconds.
 *
 * @returns {Object} Lock acquisition result.
 */
function acquireScriptLockWithRetry() {
  const startTime = Date.now();

  try {
    const lock = LockService.getScriptLock();
    const acquired = lock.tryLock(LOCK_ACQUISITION_TIMEOUT_MS);
    const totalTime = Date.now() - startTime;

    if (acquired) {
      Logger.log(`[Lock] Lock acquired (${totalTime}ms total)`);
      return {
        success: true,
        lock: lock,
        attempts: 1,
        totalTime: totalTime,
      };
    }

    const errorMessage =
      'Failed to acquire script lock within ' +
      LOCK_ACQUISITION_TIMEOUT_MS +
      'ms (' +
      totalTime +
      'ms elapsed)';
    Logger.log('[Lock] ' + errorMessage);
    return {
      success: false,
      lock: null,
      attempts: 1,
      totalTime: totalTime,
      error: errorMessage,
    };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage =
      'Script lock acquisition failed: ' +
      (error && error.message ? error.message : String(error));
    Logger.log('[Lock] ' + errorMessage);
    return {
      success: false,
      lock: null,
      attempts: 1,
      totalTime: totalTime,
      error: errorMessage,
    };
  }
}
