/**
 * Error Logger Utility
 * Provides standardized error logging across the Sales Log Pro application
 * 
 * Usage:
 *   const { message, fullLog } = logError('functionName', error, { additionalData });
 *   // Use 'message' for user display, 'fullLog' contains complete technical details
 */

/**
 * Logs an error with consistent formatting and comprehensive details
 * 
 * @param {string} context - Context information (function name, operation description)
 * @param {Error|string} error - Error object or error message string
 * @param {Object} additionalData - Optional additional data to log (e.g., {row: 5, file: 'data.csv'})
 * @returns {Object} Object containing:
 *   - message: {string} User-friendly error message
 *   - fullLog: {string} Complete technical log entry
 */
function logError(context, error, additionalData) {
  // Build the log entry components
  const timestamp = new Date().toISOString();
  const contextStr = context ? `[${context}]` : '[Unknown Context]';
  
  // Extract error details
  let errorMessage = '';
  let stackTrace = '';
  
  if (error) {
    if (typeof error === 'string') {
      errorMessage = error;
    } else if (error instanceof Error) {
      errorMessage = error.message || error.toString();
      stackTrace = error.stack || '';
    } else if (error.toString) {
      errorMessage = error.toString();
    } else {
      errorMessage = String(error);
    }
  } else {
    errorMessage = 'Unknown error';
  }
  
  // Format additional data if provided
  let additionalDataStr = '';
  if (additionalData && typeof additionalData === 'object') {
    try {
      const dataEntries = Object.entries(additionalData)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
      if (dataEntries) {
        additionalDataStr = `\nAdditional Data: {${dataEntries}}`;
      }
    } catch (e) {
      additionalDataStr = '\nAdditional Data: [Could not serialize]';
    }
  }
  
  // Build complete log entry
  const logParts = [
    `${timestamp} ${contextStr}`,
    `Error: ${errorMessage}`
  ];
  
  if (stackTrace) {
    logParts.push(`Stack Trace:\n${stackTrace}`);
  }
  
  if (additionalDataStr) {
    logParts.push(additionalDataStr.trim());
  }
  
  const fullLog = logParts.join('\n');
  
  // Log to Apps Script logger
  Logger.log(fullLog);
  
  // Return both user-friendly message and full technical log
  return {
    message: errorMessage,
    fullLog: fullLog,
    timestamp: timestamp,
    context: context
  };
}

/**
 * Logs an error and returns only the user-friendly message
 * Convenience wrapper for when you only need the message
 * 
 * @param {string} context - Context information
 * @param {Error|string} error - Error object or message
 * @param {Object} additionalData - Optional additional data
 * @returns {string} User-friendly error message
 */
function logErrorSimple(context, error, additionalData) {
  const result = logError(context, error, additionalData);
  return result.message;
}

/**
 * Logs a warning (non-critical issue) with consistent formatting
 * 
 * @param {string} context - Context information
 * @param {string} message - Warning message
 * @param {Object} additionalData - Optional additional data
 * @returns {string} The warning message
 */
function logWarning(context, message, additionalData) {
  const timestamp = new Date().toISOString();
  const contextStr = context ? `[${context}]` : '[Unknown Context]';
  
  let additionalDataStr = '';
  if (additionalData && typeof additionalData === 'object') {
    try {
      const dataEntries = Object.entries(additionalData)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
      if (dataEntries) {
        additionalDataStr = ` | Data: {${dataEntries}}`;
      }
    } catch (e) {
      additionalDataStr = ' | Data: [Could not serialize]';
    }
  }
  
  const logEntry = `${timestamp} ${contextStr} WARNING: ${message}${additionalDataStr}`;
  Logger.log(logEntry);
  
  return message;
}

/**
 * Logs informational message with consistent formatting
 * Use for non-error tracking (e.g., successful operations, milestones)
 *
 * @param {string} context - Context information
 * @param {string} message - Info message
 * @param {Object} additionalData - Optional additional data
 * @returns {void}
 */
function logInfo(context, message, additionalData) {
  const timestamp = new Date().toISOString();
  const contextStr = context ? `[${context}]` : '[Unknown Context]';
  
  let additionalDataStr = '';
  if (additionalData && typeof additionalData === 'object') {
    try {
      const dataEntries = Object.entries(additionalData)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
      if (dataEntries) {
        additionalDataStr = ` | Data: {${dataEntries}}`;
      }
    } catch (e) {
      additionalDataStr = ' | Data: [Could not serialize]';
    }
  }
  
  const logEntry = `${timestamp} ${contextStr} INFO: ${message}${additionalDataStr}`;
  Logger.log(logEntry);
}