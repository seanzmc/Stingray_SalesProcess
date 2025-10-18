/**
 * Lock Utilities Module for Sales Log Pro
 * Provides robust lock acquisition with exponential backoff retry logic
 * 
 * This module implements a production-grade lock acquisition strategy to handle
 * concurrent operations and transient lock contention scenarios. The exponential
 * backoff algorithm provides fair resource access while preventing thundering herd
 * problems.
 * 
 * @module utilities_locks
 * @author Sales Log Pro Development Team
 * @version 1.0.0
 */

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Default configuration for lock acquisition retry logic.
 * These values are tuned for Google Apps Script's execution environment
 * and typical lock contention patterns.
 */
const LOCK_RETRY_CONFIG = {
  /**
   * Maximum number of retry attempts before giving up
   * Total maximum time = initialDelayMs * (2^maxRetries - 1)
   * With defaults: 100ms * 31 = 3.1 seconds maximum
   */
  MAX_RETRIES: 5,
  
  /**
   * Initial retry delay in milliseconds
   * First retry waits 100ms, subsequent retries double this value
   */
  INITIAL_DELAY_MS: 100,
  
  /**
   * Backoff multiplier for exponential delay growth
   * Each retry waits (previousDelay * multiplier) milliseconds
   */
  BACKOFF_MULTIPLIER: 2,
  
  /**
   * Lock timeout per attempt in milliseconds
   * Each tryLock() attempt will wait up to this duration
   */
  LOCK_TIMEOUT_MS: 30000
};

// ============================================================================
// CORE LOCK ACQUISITION FUNCTION
// ============================================================================

/**
 * Acquires a script lock with exponential backoff retry logic.
 * 
 * This function implements a robust lock acquisition strategy that automatically
 * retries on failure with exponentially increasing delays. This approach prevents
 * lock contention issues and provides graceful degradation under high concurrency.
 * 
 * **Algorithm:**
 * 1. Attempt to acquire lock with tryLock(timeout)
 * 2. If successful, return lock and success status
 * 3. If failed, wait for (initialDelay * backoffMultiplier^attempt) milliseconds
 * 4. Retry up to maxRetries times
 * 5. If all retries exhausted, return failure status
 * 
 * **Retry Schedule (with defaults):**
 * - Attempt 1: Immediate (0ms delay)
 * - Attempt 2: 100ms delay
 * - Attempt 3: 200ms delay
 * - Attempt 4: 400ms delay
 * - Attempt 5: 800ms delay
 * - Attempt 6: 1600ms delay
 * Total max time: ~3.1 seconds across all retries
 * 
 * **Logging Strategy:**
 * - Individual retry attempts logged at INFO level to avoid alert spam
 * - Final failure logged at ERROR level for critical visibility
 * - Includes detailed context (attempts, timing, lock type) for debugging
 * 
 * **Usage Patterns:**
 * 
 * Basic usage with defaults:
 * ```javascript
 * const result = acquireScriptLockWithRetry();
 * if (result.success) {
 *   try {
 *     // Perform critical operations
 *   } finally {
 *     result.lock.releaseLock();
 *   }
 * } else {
 *   Logger.log('Failed to acquire lock: ' + result.error);
 * }
 * ```
 * 
 * Custom retry configuration:
 * ```javascript
 * const result = acquireScriptLockWithRetry(3, 200, 2, 15000);
 * // 3 retries, 200ms initial delay, 2x multiplier, 15s timeout
 * ```
 * 
 * @param {number} [maxRetries=5] - Maximum number of retry attempts.
 *                                   Must be >= 0. 0 means single attempt with no retries.
 *                                   Higher values increase resilience but also maximum wait time.
 * 
 * @param {number} [initialDelayMs=100] - Initial retry delay in milliseconds.
 *                                         Must be > 0. Sets the base for exponential backoff.
 *                                         Smaller values = faster retries, larger = more spacing.
 * 
 * @param {number} [backoffMultiplier=2] - Exponential backoff multiplier.
 *                                          Must be >= 1. Each retry delay = previous * multiplier.
 *                                          2 = standard exponential, 1 = linear, >2 = aggressive.
 * 
 * @param {number} [timeoutMs=30000] - Lock acquisition timeout per attempt in milliseconds.
 *                                     Must be > 0. How long to wait for lock on each try.
 *                                     Google Apps Script typical: 30000ms (30 seconds).
 * 
 * @returns {Object} Result object with detailed acquisition status:
 *   @returns {boolean} result.success - True if lock acquired, false otherwise
 *   @returns {GoogleAppsScript.Lock.Lock|null} result.lock - Lock object if acquired, null if failed
 *   @returns {number} result.attempts - Total number of attempts made (1-based)
 *   @returns {number} result.totalTime - Total time spent in milliseconds across all attempts
 *   @returns {string} [result.error] - Error message if acquisition failed (only present on failure)
 *   @returns {Array<Object>} [result.attemptDetails] - Detailed log of each attempt for debugging:
 *     @returns {number} attemptDetails[].attemptNumber - Attempt number (1-based)
 *     @returns {number} attemptDetails[].delayMs - Delay before this attempt (0 for first)
 *     @returns {boolean} attemptDetails[].acquired - Whether lock was acquired on this attempt
 *     @returns {number} attemptDetails[].durationMs - Time spent on this attempt
 * 
 * @throws {Error} Does not throw. All errors are caught and returned in result.error.
 *                 Callers should check result.success before proceeding.
 * 
 * @example
 * // Example 1: Successful acquisition on first attempt
 * const result = acquireScriptLockWithRetry();
 * // Returns: {
 * //   success: true,
 * //   lock: <Lock object>,
 * //   attempts: 1,
 * //   totalTime: 5
 * // }
 * 
 * @example
 * // Example 2: Successful acquisition after 2 retries
 * const result = acquireScriptLockWithRetry();
 * // Returns: {
 * //   success: true,
 * //   lock: <Lock object>,
 * //   attempts: 3,
 * //   totalTime: 305  // ~100ms + 200ms delays + acquisition time
 * // }
 * 
 * @example
 * // Example 3: Failure after all retries exhausted
 * const result = acquireScriptLockWithRetry();
 * // Returns: {
 * //   success: false,
 * //   lock: null,
 * //   attempts: 6,
 * //   totalTime: 3100,
 * //   error: 'Failed to acquire lock after 6 attempts (3100ms total)'
 * // }
 * 
 * @example
 * // Example 4: Complete usage pattern with error handling
 * function updateWithLock() {
 *   const lockResult = acquireScriptLockWithRetry();
 *   
 *   if (!lockResult.success) {
 *     Logger.log('Lock acquisition failed: ' + lockResult.error);
 *     Logger.log('Total attempts: ' + lockResult.attempts);
 *     Logger.log('Total time: ' + lockResult.totalTime + 'ms');
 *     return {
 *       success: false,
 *       error: 'Could not acquire lock. Please try again later.'
 *     };
 *   }
 *   
 *   try {
 *     // Perform critical section operations
 *     const config = getConfiguration();
 *     // ... modify config ...
 *     return { success: true };
 *   } finally {
 *     // CRITICAL: Always release lock, even if operation fails
 *     lockResult.lock.releaseLock();
 *     Logger.log('Lock released after ' + lockResult.attempts + ' attempt(s)');
 *   }
 * }
 * 
 * @see {@link https://developers.google.com/apps-script/reference/lock/lock-service|Google Apps Script LockService}
 * @see {@link https://en.wikipedia.org/wiki/Exponential_backoff|Exponential Backoff Algorithm}
 */
function acquireScriptLockWithRetry(
  maxRetries = LOCK_RETRY_CONFIG.MAX_RETRIES,
  initialDelayMs = LOCK_RETRY_CONFIG.INITIAL_DELAY_MS,
  backoffMultiplier = LOCK_RETRY_CONFIG.BACKOFF_MULTIPLIER,
  timeoutMs = LOCK_RETRY_CONFIG.LOCK_TIMEOUT_MS
) {
  const startTime = Date.now();
  const attemptDetails = [];
  
  // Input validation
  if (maxRetries < 0) {
    Logger.log('[Lock] Invalid maxRetries (' + maxRetries + '), using 0');
    maxRetries = 0;
  }
  if (initialDelayMs <= 0) {
    Logger.log('[Lock] Invalid initialDelayMs (' + initialDelayMs + '), using 100');
    initialDelayMs = 100;
  }
  if (backoffMultiplier < 1) {
    Logger.log('[Lock] Invalid backoffMultiplier (' + backoffMultiplier + '), using 2');
    backoffMultiplier = 2;
  }
  if (timeoutMs <= 0) {
    Logger.log('[Lock] Invalid timeoutMs (' + timeoutMs + '), using 30000');
    timeoutMs = 30000;
  }
  
  // Get script lock instance
  const lock = LockService.getScriptLock();
  let currentDelay = 0;
  
  // Try to acquire lock with retries
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const attemptStart = Date.now();
    
    // Apply delay before retry (skip on first attempt)
    if (attempt > 1) {
      Logger.log('[Lock] Retry attempt ' + attempt + ' after ' + currentDelay + 'ms delay');
      Utilities.sleep(currentDelay);
      // Calculate next delay using exponential backoff
      currentDelay = currentDelay === 0 ? initialDelayMs : Math.floor(currentDelay * backoffMultiplier);
    }
    
    // Attempt lock acquisition
    try {
      const acquired = lock.tryLock(timeoutMs);
      const attemptDuration = Date.now() - attemptStart;
      
      // Log attempt details for debugging
      attemptDetails.push({
        attemptNumber: attempt,
        delayMs: attempt === 1 ? 0 : (attempt === 2 ? initialDelayMs : currentDelay / backoffMultiplier),
        acquired: acquired,
        durationMs: attemptDuration
      });
      
      if (acquired) {
        const totalTime = Date.now() - startTime;
        Logger.log('[Lock] ✓ Lock acquired on attempt ' + attempt + ' (' + totalTime + 'ms total)');
        
        return {
          success: true,
          lock: lock,
          attempts: attempt,
          totalTime: totalTime,
          attemptDetails: attemptDetails
        };
      } else {
        // Lock not acquired on this attempt
        Logger.log('[Lock] ✗ Lock not acquired on attempt ' + attempt + ' (waited ' + attemptDuration + 'ms)');
      }
    } catch (error) {
      // Log error but continue retrying
      Logger.log('[Lock] Error on attempt ' + attempt + ': ' + error.toString());
      attemptDetails.push({
        attemptNumber: attempt,
        delayMs: attempt === 1 ? 0 : currentDelay,
        acquired: false,
        durationMs: Date.now() - attemptStart,
        error: error.toString()
      });
    }
    
    // Prepare delay for next attempt (if not last attempt)
    if (attempt === 1) {
      currentDelay = initialDelayMs;
    }
  }
  
  // All attempts failed
  const totalTime = Date.now() - startTime;
  const totalAttempts = maxRetries + 1;
  const errorMessage = 'Failed to acquire lock after ' + totalAttempts + ' attempts (' + totalTime + 'ms total)';
  
  // Log final failure at ERROR level for visibility
  Logger.log('[Lock] ✗✗✗ LOCK ACQUISITION FAILED ✗✗✗');
  Logger.log('[Lock] Error: ' + errorMessage);
  Logger.log('[Lock] Retry configuration: maxRetries=' + maxRetries + 
             ', initialDelay=' + initialDelayMs + 'ms' +
             ', multiplier=' + backoffMultiplier +
             ', timeout=' + timeoutMs + 'ms');
  Logger.log('[Lock] Attempt history: ' + JSON.stringify(attemptDetails));
  
  return {
    success: false,
    lock: null,
    attempts: totalAttempts,
    totalTime: totalTime,
    error: errorMessage,
    attemptDetails: attemptDetails
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates lock result and provides standard error message
 * Helper function to reduce boilerplate in calling code
 * 
 * @param {Object} lockResult - Result from acquireScriptLockWithRetry()
 * @param {string} operation - Name of operation for error context
 * @returns {Object} {valid: boolean, error: string|null}
 * 
 * @example
 * const lockResult = acquireScriptLockWithRetry();
 * const validation = validateLockResult(lockResult, 'updateConfiguration');
 * if (!validation.valid) {
 *   return { success: false, error: validation.error };
 * }
 */
function validateLockResult(lockResult, operation) {
  if (!lockResult.success) {
    const errorMsg = 'Could not acquire lock for ' + operation + '. ' +
                     'Attempted ' + lockResult.attempts + ' times over ' + 
                     lockResult.totalTime + 'ms. ' +
                     'Please try again in a moment.';
    return {
      valid: false,
      error: errorMsg
    };
  }
  
  return {
    valid: true,
    error: null
  };
}

/**
 * Gets a human-readable summary of lock acquisition result
 * Useful for logging and user notifications
 * 
 * @param {Object} lockResult - Result from acquireScriptLockWithRetry()
 * @returns {string} Summary message
 * 
 * @example
 * const lockResult = acquireScriptLockWithRetry();
 * Logger.log(getLockResultSummary(lockResult));
 * // Output: "Lock acquired on attempt 2 (305ms total)"
 */
function getLockResultSummary(lockResult) {
  if (lockResult.success) {
    return 'Lock acquired on attempt ' + lockResult.attempts + 
           ' (' + lockResult.totalTime + 'ms total)';
  } else {
    return 'Lock acquisition failed after ' + lockResult.attempts + 
           ' attempts (' + lockResult.totalTime + 'ms total)';
  }
}

// ============================================================================
// MODULE EXPORTS (for documentation purposes)
// ============================================================================

/**
 * In Google Apps Script, all functions are automatically available globally.
 * This comment documents the intended public API of this module:
 * 
 * PUBLIC FUNCTIONS:
 * - acquireScriptLockWithRetry() - Main lock acquisition function
 * - validateLockResult() - Helper for validation
 * - getLockResultSummary() - Helper for logging/reporting
 * 
 * PUBLIC CONSTANTS:
 * - LOCK_RETRY_CONFIG - Default retry configuration values
 * 
 * All other symbols are internal implementation details.
 */