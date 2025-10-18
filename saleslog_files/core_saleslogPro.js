/**
 * core_saleslogPro.js - Core Sales Log Pro Module
 * Performance-optimized Google Apps Script for sales logging and analytics.
 *
 * Features:
 * - Flexible salesperson name/code input via configurable alias system
 * - Daily sales processing with checkpoint system for reliability
 * - Automatic MONTHLY sheet updates with formatting preservation
 * - Non-delivered deal highlighting with trade column preservation
 * - Duplicate stock number and deposit detection via conditional formatting
 * - Font color preservation when copying from TODAY to MONTHLY
 * - MTD (Month-to-Date) calculations and leaderboard management
 * - Month rollover with archive creation and 3-month rolling averages
 * - Timeout protection (5-minute threshold) for long operations
 * - Auto-recovery system for incomplete operations
 */

// Import error logging utility
// Note: In Apps Script, all files are automatically available in global scope

/**
 * ============================================================================
 * SHEET VALIDATION PATTERN - BEST PRACTICES
 * ============================================================================
 *
 * All functions requiring sheet access should use the getSheets() function
 * as the first operation to ensure required sheets exist before attempting
 * any operations.
 *
 * STANDARD PATTERN (RECOMMENDED):
 *   const sheets = getSheets(); // Validates TODAY, MONTHLY, SALESPEOPLE exist
 *   sheets.today.getRange("A1").setValue("data");
 *   sheets.monthly.appendRow([1, 2, 3]);
 *
 * ALTERNATIVE PATTERN (for optional sheets only):
 *   const sheet = ss.getSheetByName('OPTIONAL_SHEET');
 *   if (!sheet) {
 *     Logger.log('Optional sheet not found - continuing with defaults');
 *     return defaultValue;
 *   }
 *
 * WHY THIS MATTERS:
 *   - Prevents cryptic "Cannot read property 'getRange' of null" errors
 *   - Provides clear, user-friendly error messages
 *   - Centralizes validation logic for consistency
 *   - Makes debugging easier by failing fast with context
 *
 * IMPORTANT: Do NOT directly access sheets without validation unless you
 * have a specific reason and understand the implications.
 *
 * See getSheets() function below for implementation details.
 * ============================================================================
 */

// Module-scope constants & caches
const CACHE = CacheService.getScriptCache();
const CACHE_KEY_NAME_MAP = "salespersonMaps"; // Updated cache key name
const CACHE_KEY_COLORS = "visualConfig"; // Cache key for color configuration
const sellingDaysCache = {};
// Cached global reference for SpreadsheetApp's active spreadsheet
const SS = SpreadsheetApp.getActive();
const RANGES = {
  dailyData: "A2:N51", // Range on TODAY sheet for daily input
  dailyClear: "B2:N51", // Range on TODAY sheet to clear after processing (excludes Col A)
  todayNewCarDataRange: "B2:G101", // For rules 1 & 3
  todayUsedCarDataRange: "I2:N101", // For rules 2 & 4

  // Dynamic ranges computed based on salesperson count
  get leaderboard() { return getDynamicLeaderboardRanges().leaderboard; },
  get mtd() { return getDynamicLeaderboardRanges().mtd; },
  get avg() { return getDynamicLeaderboardRanges().avg; }
};

// Default color constants (used as fallbacks if configuration not available)
const DEFAULT_COLORS = {
  nonDeliveredColor: "#FF0000",
  salespersonErrorColor: "#FFEBEE",
  duplicateStockFillColor: "#b4ff0c",
  duplicateStockTextColor: "#ff0000",
  leaderboardZeroMtdBgColor: "#F0F8FF",
  paceThresholds: {
    green: 10,
    yellow: 8,
    red: 0
  }
};

// Module-scope color configuration cache
let colorConfig = null;

/**
 * Loads visual configuration (colors and thresholds) from Properties Service
 * Uses caching for performance optimization
 *
 * @returns {Object} Visual configuration object with colors and pace thresholds
 */
function getVisualConfig() {
  // Return cached config if available
  if (colorConfig) {
    return colorConfig;
  }

  // Check script cache first
  const cached = CACHE.get(CACHE_KEY_COLORS);
  if (cached) {
    try {
      colorConfig = JSON.parse(cached);
      return colorConfig;
    } catch (e) {
      logError('getVisualConfig', e, { operation: 'parse_cache' });
    }
  }

  // Load from configuration service
  try {
    const config = getConfiguration();
    if (config && config.visual) {
      colorConfig = config.visual;
      // Cache for 5 minutes
      CACHE.put(CACHE_KEY_COLORS, JSON.stringify(colorConfig), 300);
      return colorConfig;
    }
  } catch (e) {
    logError('getVisualConfig', e, { operation: 'load_from_properties' });
  }

  // Fallback to defaults
  Logger.log('Using default color configuration');
  colorConfig = DEFAULT_COLORS;
  return colorConfig;
}

/**
 * Gets a specific color value with fallback to defaults
 *
 * @param {string} colorKey - Key for the color (e.g., 'nonDeliveredColor')
 * @returns {string} Hex color code
 */
function getColor(colorKey) {
  const config = getVisualConfig();
  return config[colorKey] || DEFAULT_COLORS[colorKey];
}

/**
 * Gets pace threshold values with fallback to defaults
 *
 * @returns {Object} Pace thresholds {green, yellow, red}
 */
function getPaceThresholds() {
  const config = getVisualConfig();
  return config.paceThresholds || DEFAULT_COLORS.paceThresholds;
}

/**
 * Invalidates the visual configuration cache
 * Should be called after configuration updates
 * @returns {void}
 */
function invalidateVisualConfigCache() {
  colorConfig = null;
  try {
    CACHE.remove(CACHE_KEY_COLORS);
  } catch (error) {
    logError('invalidateVisualConfigCache', error, {
      severity: 'MEDIUM',
      operation: 'cache_invalidation',
      cacheKey: CACHE_KEY_COLORS,
      impact: 'Stale visual config may be served until cache expires naturally (5 minutes)'
    });
    // Continue execution - cache invalidation failure is non-fatal
  }
}

/**
 * Retrieves and validates references to required sheets (TODAY, MONTHLY, SALESPEOPLE).
 *
 * This is the STANDARD PATTERN for sheet validation in Sales Log Pro.
 * All functions requiring sheet access should call this function first to ensure
 * sheets exist before attempting operations.
 *
 * **Validation Steps:**
 * 1. Verifies SpreadsheetApp.getActive() is available (script is bound)
 * 2. Checks that all three required sheets exist
 * 3. Returns validated sheet references or throws descriptive error
 *
 * **Error Handling:**
 * - Logs detailed error context to error_logger.js for debugging
 * - Throws user-friendly error messages that can be shown in alerts
 * - Provides sheet-specific information about what's missing
 *
 * @returns {{today: GoogleAppsScript.Spreadsheet.Sheet, monthly: GoogleAppsScript.Spreadsheet.Sheet, sales: GoogleAppsScript.Spreadsheet.Sheet}}
 *   Object mapping sheet keys to Sheet instances:
 *   - today: Reference to the TODAY sheet (daily data entry)
 *   - monthly: Reference to the MONTHLY sheet (historical records)
 *   - sales: Reference to the SALESPEOPLE sheet (salesperson configuration)
 *
 * @throws {Error} If SpreadsheetApp.getActive() returns null (script not bound to spreadsheet)
 * @throws {Error} If any required sheet (TODAY, MONTHLY, SALESPEOPLE) is missing
 *
 * @example
 * // Standard usage pattern - Always use try/catch for proper error handling
 * function mySheetOperation() {
 *   try {
 *     const sheets = getSheets(); // Validates all required sheets exist
 *     sheets.today.getRange("A1").setValue("data");
 *     sheets.monthly.appendRow([1, 2, 3]);
 *     sheets.sales.getRange("A2").getValue();
 *   } catch (error) {
 *     logError('mySheetOperation', error);
 *     alertError('Sheet operation failed: ' + error.message);
 *   }
 * }
 *
 * @example
 * // Used in critical operations throughout the codebase
 * function processDaily() {
 *   const sheets = getSheets(); // Standard validation pattern
 *   const dailyRange = sheets.today.getRange(RANGES.dailyData);
 *   // ... process daily operations
 * }
 */
function getSheets() {
  if (!SS) {
    logError('getSheets', 'SpreadsheetApp.getActive() returned null', { issue: 'script_not_bound' });
    throw new Error("SpreadsheetApp.getActive() returned null. Script might not be properly bound or accessed.");
  }
  const today = SS.getSheetByName("TODAY");
  const monthly = SS.getSheetByName("MONTHLY");
  const sales = SS.getSheetByName("SALESPEOPLE");
  if (!today || !monthly || !sales) {
    logError('getSheets', 'Required sheets missing', { today: !!today, monthly: !!monthly, sales: !!sales });
    throw new Error("Required sheets missing. Ensure 'TODAY', 'MONTHLY', and 'SALESPEOPLE' sheets exist.");
  }
  return { today, monthly, sales };
}

// cacheOps
/**
 * Returns cached or newly computed selling days elapsed and total for a given month/year.
 * Respects user configuration for whether to count Sundays as selling days.
 *
 * @param {number} year Full year number (e.g., 2025).
 * @param {number} month Zero-based month index (0-11).
 * @returns {{daysElapsed: number, totalDays: number}} Selling days counts.
 */
function memoizedGetSellingDays(year, month) {
  // Get Sunday configuration
  const skipSundays = shouldSkipSundays();
  const key = `${year}-${month}-${skipSundays}`;
  if (sellingDaysCache[key]) return sellingDaysCache[key];

  const todayDate = new Date();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let elapsed = 0,
    total = 0;

  // Calculate elapsed selling days up to today within the month
  for (let d = new Date(first); d <= todayDate && d <= last; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    // Count day if: (1) skipSundays is false, OR (2) day is not Sunday
    if (!skipSundays || dayOfWeek !== 0) {
      elapsed++;
    }
  }
  elapsed = Math.max(elapsed, 1); // Ensure at least 1 day elapsed

  // Calculate total selling days in the month
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    // Count day if: (1) skipSundays is false, OR (2) day is not Sunday
    if (!skipSundays || dayOfWeek !== 0) {
      total++;
    }
  }
  sellingDaysCache[key] = { daysElapsed: elapsed, totalDays: total };
  return sellingDaysCache[key];
}

/**
 * Retrieves and builds maps for salesperson aliases and display codes.
 * Assumes 'SALESPEOPLE' sheet structure: Col A: Full Name, Col B: Aliases (comma-separated), Col C: Preferred Display Code.
 * Caches the result.
 *
 * @returns {{aliasMap: {[alias: string]: string}, displayCodeMap: {[fullName: string]: string}}}
 * - aliasMap: Maps standardized alias to Full Name.
 * - displayCodeMap: Maps Full Name to Display Code (or Full Name if Display Code is blank).
 */
function getSalespersonMaps() {
  const cached = CACHE.get(CACHE_KEY_NAME_MAP);
  if (cached) {
    try {
      const parsedCache = JSON.parse(cached);
      if (parsedCache && typeof parsedCache.aliasMap === "object" && typeof parsedCache.displayCodeMap === "object") {
        return parsedCache;
      } else {
        logWarning('getSalespersonMaps', 'Cached salesperson map has invalid structure. Rebuilding.');
      }
    } catch (e) {
      logError('getSalespersonMaps', e, { operation: 'parse_cache' });
    }
  }

  const sheets = getSheets();
  const salesSheet = sheets.sales;
  const lastRow = salesSheet.getLastRow();
  const range = salesSheet.getRange(2, 1, Math.max(0, lastRow - 1), 3);
  const values = range.getValues();
  const aliasMap = {};
  const displayCodeMap = {};

  values.forEach((row) => {
    const fullName = String(row[0] || "").trim();
    const aliasesStr = String(row[1] || "").trim();
    const displayCode = String(row[2] || "").trim();
    if (fullName) {
      const displayName = displayCode || fullName;
      displayCodeMap[fullName] = displayName;
      aliasMap[fullName.toUpperCase()] = fullName;
      if (displayName && displayName.toUpperCase() !== fullName.toUpperCase()) {
        aliasMap[displayName.toUpperCase()] = fullName;
      }
      if (aliasesStr) {
        aliasesStr.split(",").forEach((alias) => {
          const standardizedAlias = alias.trim().toUpperCase();
          if (standardizedAlias) {
            if (aliasMap[standardizedAlias] && aliasMap[standardizedAlias] !== fullName) {
              Logger.log(`Warning: Duplicate alias '${standardizedAlias}' mapped to '${aliasMap[standardizedAlias]}' and now also to '${fullName}'. Using mapping to '${fullName}'.`);
            }
            aliasMap[standardizedAlias] = fullName;
          }
        });
      }
    }
  });
  const mapsToCache = { aliasMap, displayCodeMap };
  CACHE.put(CACHE_KEY_NAME_MAP, JSON.stringify(mapsToCache), 300); // Cache for 5 minutes
  return mapsToCache;
}

/**
 * Gets the count of active salespeople from SALESPEOPLE sheet
 * @returns {number} Count of salespeople (0 if sheet empty/missing)
 */
function getActiveSalespersonCount() {
  try {
    const sheets = getSheets();
    const salesSheet = sheets.sales;
    const lastRow = salesSheet.getLastRow();
    const count = Math.max(0, lastRow - 1); // Header is row 1

    if (count > 200) {
      Logger.log(`Warning: Unusually high salesperson count: ${count}. Capping at 200.`);
      return 200; // Performance cap
    }

    return count;
  } catch (e) {
    logError('getActiveSalespersonCount', e);
    return 0;
  }
}

/**
 * Generates dynamic range objects based on current salesperson count
 * @returns {Object} Range definitions with A1 notation strings
 */
function getDynamicLeaderboardRanges() {
  const count = getActiveSalespersonCount();
  const rowCount = Math.min(Math.max(1, count), 200);
  const endRow = rowCount + 1; // +1 because start row is 2

  return {
    leaderboard: `P2:R${endRow}`,
    mtd: `Q2:Q${endRow}`,
    avg: `R2:R${endRow}`,
    leaderboardStartRow: 2,
    leaderboardEndRow: endRow,
    leaderboardRowCount: rowCount
  };
}

// Basic utilities
/**
 * Rounds a number to the nearest 0.5 (half unit)
 * Used for sales count calculations when deals are split between salespeople
 * @param {number} v - Value to round
 * @returns {number} Value rounded to nearest 0.5
 * @example roundHalf(3.7) returns 3.5, roundHalf(3.8) returns 4.0
 */
function roundHalf(v) {
  return Math.round((Number(v) || 0) * 2) / 2;
}

/**
 * Formats date for display headers, accounting for weekend logging rules
 * By default logs yesterday's date, but applies special rules:
 * - Monday logs Saturday (if mondayLogsSaturday config is true)
 * - Sunday always logs Friday
 * @param {number} offsetDays - Number of days to go back (default: 1)
 * @returns {string} Formatted date string as "M/D" (e.g., "5/15")
 */
function formatDateOffset(offsetDays = 1) {
  const d = new Date();
  const dayOfWeek = d.getDay();
  let daysToSubtract = offsetDays;

  // Get Monday logs Saturday configuration
  const mondayLogsSaturday = shouldMondayLogSaturday();

  if (mondayLogsSaturday && dayOfWeek === 1 && offsetDays === 1) {
    daysToSubtract = 2; // Monday, log Saturday
  } else if (dayOfWeek === 0 && offsetDays === 1) {
    daysToSubtract = 2; // Sunday, log Friday (always applies)
  }

  d.setDate(d.getDate() - daysToSubtract);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// cfOps - Conditional Formatting Operations
/**
 * Filters out old script-managed custom formula rules for replacement
 * Keeps non-custom-formula rules (like built-in date, text, or number conditions)
 * @param {GoogleAppsScript.Spreadsheet.ConditionalFormatRule[]} rules - Array of existing rules
 * @returns {GoogleAppsScript.Spreadsheet.ConditionalFormatRule[]} Filtered rules
 */
function filterTrafficLightRules(rules) {
  // This function is intended to filter out old script-managed custom formula rules
  // so they can be replaced. It should NOT filter out non-custom-formula rules.
  return rules.filter((r) => {
    const bc = r.getBooleanCondition();
    // Keep if it's not a boolean condition or if it is, it's not a custom formula.
    return !bc || bc.getCriteriaType() !== SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA;
  });
}

/**
 * Applies conditional formatting rules to a sheet
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {GoogleAppsScript.Spreadsheet.ConditionalFormatRule[]} rules - Rules to apply
 * @returns {void}
 */
function setCFRulesSheet(sheet, rules) {
  sheet.setConditionalFormatRules(rules);
}

// lockOps
/**
 * Executes a function with script lock protection using exponential backoff retry
 * Prevents concurrent executions and ensures operation atomicity
 * Automatically releases lock after function completes or throws error
 * @param {Function} fn - Function to execute with lock protection
 * @returns {*} Return value from the executed function
 * @throws {Error} If lock cannot be acquired after maximum retries
 */
function withScriptLock(fn) {
  // Acquire lock with exponential backoff retry logic
  const lockResult = acquireScriptLockWithRetry();

  // Check if lock acquisition was successful
  if (!lockResult.success) {
    const msg = "Could not acquire script lock after " + lockResult.attempts +
                " attempts (" + lockResult.totalTime + "ms). " +
                "Another operation may be running. Please try again.";
    Logger.log(msg);
    try {
      SpreadsheetApp.getUi()?.alert(msg);
    } catch (e) {
      Logger.log("UI alert failed for lock: " + e);
    }
    throw new Error(msg);
  }

  try {
    Logger.log('Script lock acquired on attempt ' + lockResult.attempts + ' for operation');
    return fn();
  } finally {
    // Always release lock, even if operation failed
    lockResult.lock.releaseLock();
  }
}

// alertOps
function toastInfo(msg, title) {
  if (SS) SS.toast(msg, title || "Info");
  else Logger.log(`Toast (SS not avail): ${title ? title + ": " : ""}${msg}`);
}
function showCustomAlert(title, msg) {
  try {
    SpreadsheetApp.getUi().alert(title, msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    logWarning('showCustomAlert', 'UI not available for alert', { title, message: msg });
  }
}
function alertError(msg, title = "Error") {
  showCustomAlert(title, msg);
}

// Data transforms
function tallyCounts(rows, aliasMap, sides) {
  const counts = {};
  const unknownInputs = [];
  rows.forEach((row) => {
    sides.forEach(({ fiIdx, saleIdx }) => {
      if (fiIdx >= row.length || saleIdx >= row.length) return;
      const fiFlag = String(row[fiIdx] || "")
        .trim()
        .toUpperCase();
      if (!/^[A-Z]$/.test(fiFlag)) return; // Only delivered
      const salespersonInput = String(row[saleIdx] || "").trim();
      if (!salespersonInput) return;
      const parts = salespersonInput.split("/").map((s) => s.trim().toUpperCase());
      const inc = parts.length > 1 ? 0.5 : 1;
      parts.forEach((part) => {
        if (!part) return;
        const fullName = aliasMap[part];
        if (fullName) counts[fullName] = (counts[fullName] || 0) + inc;
        else if (!unknownInputs.includes(salespersonInput.split("/").find((p) => p.trim().toUpperCase() === part) || part)) {
          unknownInputs.push(salespersonInput.split("/").find((p) => p.trim().toUpperCase() === part) || part);
        }
      });
    });
  });
  return { counts, unknownInputs };
}

function summarizeRows(rows) {
  let newCount = 0,
    usedCount = 0,
    tradeCount = 0;
  rows.forEach((row) => {
    const newFi =
      row.length > 2
        ? String(row[2] || "")
          .trim()
          .toUpperCase()
        : "";
    const usedFi =
      row.length > 9
        ? String(row[9] || "")
          .trim()
          .toUpperCase()
        : "";
    const newHasContent = row.length > 1 && row.slice(1, Math.min(7, row.length)).some((val) => val && String(val).trim() !== "");
    const usedHasContent = row.length > 8 && row.slice(8, Math.min(14, row.length)).some((val) => val && String(val).trim() !== "");
    let newDelivered = /^[A-Z]$/.test(newFi) && newHasContent;
    let usedDelivered = /^[A-Z]$/.test(usedFi) && usedHasContent;
    if (newDelivered) {
      newCount++;
      const tradeNew =
        row.length > 5
          ? String(row[5] || "")
            .trim()
            .toUpperCase()
          : "";
      if (tradeNew && tradeNew !== "NT") tradeCount++;
    }
    if (usedDelivered) {
      usedCount++;
      const tradeUsed =
        row.length > 12
          ? String(row[12] || "")
            .trim()
            .toUpperCase()
          : "";
      if (tradeUsed && tradeUsed !== "NT") tradeCount++;
    }
  });
  return { newCount, usedCount, tradeCount };
}

/**
 * Processes a single car section (New or Used) and applies appropriate formatting.
 * Helper function to reduce nesting complexity in applyMonthlyRowFormatting().
 *
 * @param {any[]} rowData The row data array
 * @param {string[]} originalBackgroundRow The original background colors for this section
 * @param {number} fiIndex Column index for FI flag (e.g., 2 for New, 9 for Used)
 * @param {number} salespersonIndex Column index for salesperson (e.g., 6 for New, 13 for Used)
 * @param {number} dataStartIndex Start index for section data slice (e.g., 1 for New, 8 for Used)
 * @param {number} dataEndIndex End index for section data slice (e.g., 7 for New, 14 for Used)
 * @param {{[alias: string]: string}} aliasMap Maps standardized alias to Full Name
 * @param {string} nonDeliveredColor Color for non-delivered deals
 * @param {string} nonDeliveredColorUpper Uppercase version for comparison
 * @param {string} salespersonErrorColor Color for salesperson errors
 * @param {string} salespersonErrorColorUpper Uppercase version for comparison
 * @returns {{backgroundRow: string[], hasSalespersonError: boolean}}
 */
function processCarSection(
  rowData,
  originalBackgroundRow,
  fiIndex,
  salespersonIndex,
  dataStartIndex,
  dataEndIndex,
  aliasMap,
  nonDeliveredColor,
  nonDeliveredColorUpper,
  salespersonErrorColor,
  salespersonErrorColorUpper
) {
  const sectionBgRow = [...originalBackgroundRow];
  let hasSalespersonError = false;

  // Extract section data
  const fiFlag = rowData.length > fiIndex ? String(rowData[fiIndex] || "").trim().toUpperCase() : "";
  const salespersonInput = rowData.length > salespersonIndex ? String(rowData[salespersonIndex] || "").trim() : "";
  const isDelivered = /^[A-Z]$/.test(fiFlag);
  const hasData = rowData.length > dataStartIndex &&
                  rowData.slice(dataStartIndex, dataEndIndex).some((cell) => cell && String(cell).trim() !== "");

  if (hasData && !isDelivered) {
    // Non-delivered deal with data: highlight entire section (except trade column at index 4)
    applyNonDeliveredHighlight(sectionBgRow, nonDeliveredColor);
  } else if (isDelivered) {
    // Delivered deal: clear non-delivered highlights and check salesperson
    clearNonDeliveredHighlight(sectionBgRow, originalBackgroundRow, nonDeliveredColorUpper);
    hasSalespersonError = checkSalespersonError(
      salespersonInput,
      sectionBgRow,
      originalBackgroundRow,
      aliasMap,
      salespersonErrorColor,
      salespersonErrorColorUpper
    );
  } else {
    // No data or empty: clear all formatting
    clearAllHighlights(sectionBgRow, originalBackgroundRow, nonDeliveredColorUpper, salespersonErrorColorUpper);
  }

  return { backgroundRow: sectionBgRow, hasSalespersonError };
}

/**
 * Applies non-delivered deal highlighting to a section (excluding trade column).
 *
 * @param {string[]} sectionBgRow Background row to modify
 * @param {string} nonDeliveredColor Color to apply
 */
function applyNonDeliveredHighlight(sectionBgRow, nonDeliveredColor) {
  for (let k = 0; k < 6; k++) {
    if (k !== 4) { // Skip trade column (index 4)
      sectionBgRow[k] = nonDeliveredColor;
    }
  }
}

/**
 * Clears non-delivered highlights from a section (excluding trade column).
 *
 * @param {string[]} sectionBgRow Background row to modify
 * @param {string[]} originalBackgroundRow Original backgrounds for comparison
 * @param {string} nonDeliveredColorUpper Uppercase color for comparison
 */
function clearNonDeliveredHighlight(sectionBgRow, originalBackgroundRow, nonDeliveredColorUpper) {
  for (let k = 0; k < 6; k++) {
    if (k !== 4 && originalBackgroundRow[k] && originalBackgroundRow[k].toUpperCase() === nonDeliveredColorUpper) {
      sectionBgRow[k] = null;
    }
  }
}

/**
 * Checks for salesperson errors and applies appropriate formatting.
 *
 * @param {string} salespersonInput Salesperson name/code from cell
 * @param {string[]} sectionBgRow Background row to modify
 * @param {string[]} originalBackgroundRow Original backgrounds for comparison
 * @param {{[alias: string]: string}} aliasMap Alias to full name mapping
 * @param {string} salespersonErrorColor Color for errors
 * @param {string} salespersonErrorColorUpper Uppercase version for comparison
 * @returns {boolean} True if salesperson error found
 */
function checkSalespersonError(
  salespersonInput,
  sectionBgRow,
  originalBackgroundRow,
  aliasMap,
  salespersonErrorColor,
  salespersonErrorColorUpper
) {
  if (!salespersonInput) {
    return false;
  }

  const salespersonParts = salespersonInput.split("/").map((s) => s.trim().toUpperCase());
  const hasError = salespersonParts.some((part) => part && !aliasMap[part]);

  if (hasError) {
    sectionBgRow[5] = salespersonErrorColor; // Salesperson column is at index 5
    return true;
  } else if (originalBackgroundRow[5] && originalBackgroundRow[5].toUpperCase() === salespersonErrorColorUpper) {
    sectionBgRow[5] = null; // Clear previous error highlight
  }

  return false;
}

/**
 * Clears all formatting highlights from a section.
 *
 * @param {string[]} sectionBgRow Background row to modify
 * @param {string[]} originalBackgroundRow Original backgrounds for comparison
 * @param {string} nonDeliveredColorUpper Uppercase color for comparison
 * @param {string} salespersonErrorColorUpper Uppercase color for comparison
 */
function clearAllHighlights(sectionBgRow, originalBackgroundRow, nonDeliveredColorUpper, salespersonErrorColorUpper) {
  for (let k = 0; k < 6; k++) {
    if (k !== 4 && originalBackgroundRow[k] && originalBackgroundRow[k].toUpperCase() === nonDeliveredColorUpper) {
      sectionBgRow[k] = null;
    }
  }

  if (originalBackgroundRow[5] && originalBackgroundRow[5].toUpperCase() === salespersonErrorColorUpper) {
    sectionBgRow[5] = null;
  }
}

/**
 * Applies formatting to rows in the 'MONTHLY' sheet.
 * Highlights non-delivered deals and salesperson code errors.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The 'MONTHLY' sheet object.
 * @param {any[][]} rowsData The 2D array of row data to process.
 * @param {number} startSheetRow The 1-indexed sheet row number corresponding to the first row in rowsData.
 * @param {{[alias: string]: string}} aliasMap Maps standardized alias to Full Name.
 * @returns {number[]} Array of 1-indexed sheet row numbers where salesperson code errors were found.
 */
function applyMonthlyRowFormatting(sheet, rowsData, startSheetRow, aliasMap) {
  if (!rowsData || rowsData.length === 0) {
    return []; // No data to process
  }

  // Get configured colors
  const NON_DELIVERED_COLOR = getColor('nonDeliveredColor');
  const NON_DELIVERED_COLOR_UPPER = NON_DELIVERED_COLOR.toUpperCase();
  const SALESPERSON_ERROR_COLOR = getColor('salespersonErrorColor');
  const SALESPERSON_ERROR_COLOR_UPPER = SALESPERSON_ERROR_COLOR.toUpperCase();

  const salespersonErrorSheetRows = [];
  const numRows = rowsData.length;

  const originalBackgroundsNew = sheet.getRange(startSheetRow, 2, numRows, 6).getBackgrounds(); // B:G
  const originalBackgroundsUsed = sheet.getRange(startSheetRow, 9, numRows, 6).getBackgrounds(); // I:N

  const backgroundsNewSection = [];
  const backgroundsUsedSection = [];

  for (let i = 0; i < numRows; i++) {
    const rowData = rowsData[i];
    const currentRowInSheet = startSheetRow + i;

    // Process New Car Section (columns B-G, indices 1-6)
    const newResult = processCarSection(
      rowData,
      originalBackgroundsNew[i],
      2,  // FI column index
      6,  // Salesperson column index
      1,  // Data start index
      7,  // Data end index
      aliasMap,
      NON_DELIVERED_COLOR,
      NON_DELIVERED_COLOR_UPPER,
      SALESPERSON_ERROR_COLOR,
      SALESPERSON_ERROR_COLOR_UPPER
    );
    backgroundsNewSection.push(newResult.backgroundRow);
    if (newResult.hasSalespersonError && !salespersonErrorSheetRows.includes(currentRowInSheet)) {
      salespersonErrorSheetRows.push(currentRowInSheet);
    }

    // Process Used Car Section (columns I-N, indices 8-13)
    const usedResult = processCarSection(
      rowData,
      originalBackgroundsUsed[i],
      9,  // FI column index
      13, // Salesperson column index
      8,  // Data start index
      14, // Data end index
      aliasMap,
      NON_DELIVERED_COLOR,
      NON_DELIVERED_COLOR_UPPER,
      SALESPERSON_ERROR_COLOR,
      SALESPERSON_ERROR_COLOR_UPPER
    );
    backgroundsUsedSection.push(usedResult.backgroundRow);
    if (usedResult.hasSalespersonError && !salespersonErrorSheetRows.includes(currentRowInSheet)) {
      salespersonErrorSheetRows.push(currentRowInSheet);
    }
  }

  // Apply all backgrounds at once
  if (numRows > 0) {
    sheet.getRange(startSheetRow, 2, numRows, 6).setBackgrounds(backgroundsNewSection); // Columns B:G
    sheet.getRange(startSheetRow, 9, numRows, 6).setBackgrounds(backgroundsUsedSection); // Columns I:N
  }
  return salespersonErrorSheetRows.sort((a, b) => a - b);
}

// NEW FUNCTION: To accurately find the last row within a specific range of columns.
/**
 * Finds the last row containing data within a specific range of columns, ignoring content outside this range.
 * Uses a memory-efficient chunked approach to avoid loading all rows into memory.
 * This is more reliable than getLastRow() when extraneous data exists in other columns.
 *
 * OPTIMIZATION: Reads data in chunks from bottom-up instead of loading all rows at once.
 * This prevents memory exhaustion on sheets with thousands of empty rows.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to inspect.
 * @param {number} startCol The 1-based index of the starting column for the check (e.g., 1 for A).
 * @param {number} endCol The 1-based index of the ending column for the check (e.g., 14 for N).
 * @returns {number} The row number of the last row with data in the specified columns. Returns 0 if the sheet is empty.
 */
function findLastRowInCols(sheet, startCol, endCol) {
  // Use getLastRow() as upper bound instead of getMaxRows() to avoid reading 10,000+ empty rows
  const lastRowHint = sheet.getLastRow();

  // If sheet appears empty, return 0 immediately
  if (lastRowHint === 0) {
    return 0;
  }

  // Read data in chunks from bottom to top for memory efficiency
  const CHUNK_SIZE = 100; // Process 100 rows at a time
  const numCols = endCol - startCol + 1;

  // Start from the last row and work backwards in chunks
  let currentRow = lastRowHint;

  while (currentRow > 0) {
    // Calculate chunk boundaries
    const chunkStart = Math.max(1, currentRow - CHUNK_SIZE + 1);
    const chunkSize = currentRow - chunkStart + 1;

    // Read only this chunk of data
    const chunkValues = sheet.getRange(chunkStart, startCol, chunkSize, numCols).getValues();

    // Search backwards through the chunk for data
    for (let i = chunkValues.length - 1; i >= 0; i--) {
      // Check if any cell in the current row has content
      if (chunkValues[i].some(cell => cell !== '' && cell !== null && cell !== undefined)) {
        // Found data! Return the 1-based row number
        return chunkStart + i;
      }
    }

    // Move to the next chunk (going backwards)
    currentRow = chunkStart - 1;
  }

  // No data found in the specified columns
  return 0;
}


/**
 * Creates a timeout manager for tracking execution time
 * @param {number} thresholdMinutes - Threshold in minutes (default: 5.0)
 * @returns {Object} Manager with checkTime() and getElapsed() methods
 */
function createTimeoutManager(thresholdMinutes = 5.0) {
  const startTime = Date.now();
  const thresholdMs = thresholdMinutes * 60 * 1000;

  return {
    /**
     * Checks if threshold has been exceeded
     * @param {string} operation - Description of current operation for logging
     * @returns {boolean} true if OK to continue, false if threshold exceeded
     */
    checkTime: function(operation) {
      const elapsed = Date.now() - startTime;
      if (elapsed > thresholdMs) {
        Logger.log(`⏱️ Timeout threshold (${thresholdMinutes}m) exceeded after ${(elapsed/1000).toFixed(1)}s during: ${operation}`);
        return false;
      }
      Logger.log(`✓ Time check OK: ${(elapsed/1000).toFixed(1)}s elapsed at: ${operation}`);
      return true;
    },

    /**
     * Gets elapsed time in seconds
     * @returns {number} Seconds elapsed since creation
     */
    getElapsed: function() {
      return (Date.now() - startTime) / 1000;
    }
  };
}

// ============================================================================
// CHECKPOINT & RECOVERY SYSTEM
// ============================================================================

/**
 * Checkpoint system for atomic operations in processDaily()
 * Stores operation state to enable recovery if analytics fail
 */

const CHECKPOINT_KEY = 'DAILY_OPERATION_CHECKPOINT';
const CHECKPOINT_RETENTION_HOURS = 24; // Keep checkpoints for 24 hours

/**
 * Creates a checkpoint before modifying MONTHLY sheet
 * @param {Object} operationData - Data about the operation being performed
 */
function createOperationCheckpoint(operationData) {
  try {
    const checkpoint = {
      timestamp: new Date().toISOString(),
      dateProcessed: operationData.dateStr,
      rowCount: operationData.rowCount,
      status: 'STARTED',
      phase: 'PRE_MONTHLY_WRITE',
      dataHash: generateDataHash(operationData.rows)
    };

    PropertiesService.getScriptProperties().setProperty(
      CHECKPOINT_KEY,
      JSON.stringify(checkpoint)
    );

    Logger.log(`✓ Checkpoint created for ${operationData.dateStr} (${operationData.rowCount} rows)`);
    return true;
  } catch (e) {
    Logger.log(`⚠️ Failed to create checkpoint: ${e.toString()}`);
    return false; // Non-fatal - operation can continue
  }
}

/**
 * Updates checkpoint status as operation progresses
 * @param {string} phase - Current phase (MONTHLY_WRITTEN, ANALYTICS_PENDING, COMPLETE, ANALYTICS_FAILED)
 * @param {Object} additionalData - Optional additional data to store
 */
function updateCheckpoint(phase, additionalData = {}) {
  try {
    const props = PropertiesService.getScriptProperties();
    const checkpointStr = props.getProperty(CHECKPOINT_KEY);

    if (!checkpointStr) {
      Logger.log('⚠️ No checkpoint found to update');
      return false;
    }

    const checkpoint = JSON.parse(checkpointStr);
    checkpoint.phase = phase;
    checkpoint.lastUpdate = new Date().toISOString();

    // Merge additional data
    Object.assign(checkpoint, additionalData);

    props.setProperty(CHECKPOINT_KEY, JSON.stringify(checkpoint));
    Logger.log(`✓ Checkpoint updated: ${phase}`);
    return true;
  } catch (e) {
    Logger.log(`⚠️ Failed to update checkpoint: ${e.toString()}`);
    return false;
  }
}

/**
 * Marks operation as complete and clears checkpoint
 */
function clearOperationCheckpoint() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(CHECKPOINT_KEY);
    Logger.log('✓ Checkpoint cleared - operation complete');
    return true;
  } catch (e) {
    Logger.log(`⚠️ Failed to clear checkpoint: ${e.toString()}`);
    return false;
  }
}

/**
 * Retrieves current checkpoint if it exists
 * @returns {Object|null} Checkpoint object or null
 */
function getOperationCheckpoint() {
  try {
    const checkpointStr = PropertiesService.getScriptProperties().getProperty(CHECKPOINT_KEY);
    if (!checkpointStr) return null;

    const checkpoint = JSON.parse(checkpointStr);

    // Check if checkpoint is too old
    const checkpointAge = Date.now() - new Date(checkpoint.timestamp).getTime();
    const maxAge = CHECKPOINT_RETENTION_HOURS * 60 * 60 * 1000;

    if (checkpointAge > maxAge) {
      Logger.log(`⚠️ Checkpoint is ${(checkpointAge / 3600000).toFixed(1)}h old - discarding`);
      clearOperationCheckpoint();
      return null;
    }

    return checkpoint;
  } catch (e) {
    Logger.log(`⚠️ Failed to retrieve checkpoint: ${e.toString()}`);
    return null;
  }
}

/**
 * Generates a simple hash of row data for verification
 * @param {Array} rows - Array of row data
 * @returns {string} Hash string
 */
function generateDataHash(rows) {
  try {
    // Simple hash: rowCount + first/last row checksums
    const rowCount = rows.length;
    const firstRow = rows[0] ? JSON.stringify(rows[0]).slice(0, 50) : '';
    const lastRow = rows[rows.length - 1] ? JSON.stringify(rows[rows.length - 1]).slice(0, 50) : '';
    return `${rowCount}|${firstRow}|${lastRow}`;
  } catch (e) {
    return 'hash_error';
  }
}


/**
 * Recovers analytics for a checkpoint operation
 * @param {Object} checkpoint - The checkpoint to recover from
 */
function recoverAnalyticsForCheckpoint(checkpoint) {
  try {
    toastInfo('Recovering analytics...', 'Recovery In Progress');
    Logger.log(`Starting analytics recovery for ${checkpoint.dateProcessed}`);

    const sheets = getSheets();
    invalidateAnalyticsCache();
    const analyticsData = calculateMonthlyAnalytics();

    if (analyticsData) {
      writeAnalyticsToMonthly(analyticsData, sheets.monthly);
      clearOperationCheckpoint();

      toastInfo(
        `Analytics successfully recovered for ${checkpoint.dateProcessed}`,
        'Recovery Complete'
      );
      Logger.log('✓ Analytics recovery successful');
      return true;
    } else {
      updateCheckpoint('ANALYTICS_FAILED', { recoveryAttempts: (checkpoint.recoveryAttempts || 0) + 1 });
      alertError(
        'Analytics recovery failed. You can try "Recalculate MTD & Check Formats" from the menu to retry.',
        'Recovery Failed'
      );
      Logger.log('✗ Analytics recovery failed - no data generated');
      return false;
    }
  } catch (e) {
    logError('recoverAnalyticsForCheckpoint', e, { dateProcessed: checkpoint.dateProcessed });
    updateCheckpoint('ANALYTICS_FAILED', {
      error: e.toString(),
      recoveryAttempts: (checkpoint.recoveryAttempts || 0) + 1
    });
    alertError('Error during analytics recovery: ' + e.toString(), 'Recovery Error');
    return false;
  }
}

// ============================================================================
// MAIN FLOWS
// ============================================================================

// Main flows
function processDaily() {
  withScriptLock(() => {
    const timer = createTimeoutManager(5.0); // 5-minute threshold, 1-min safety margin
    let analyticsSkipped = false;

    // Check if Sundays should be skipped based on configuration
    const today = new Date();
    const skipSundays = shouldSkipSundays();

    // In Google Apps Script, Sunday is 0, Monday is 1, ..., Saturday is 6
    if (skipSundays && today.getDay() === 0) {
      // 0 represents Sunday
      Logger.log("Today is Sunday and skipSundays is enabled. Skipping processDaily execution.");
      toastInfo("Sunday is configured as a non-sales day. No processing performed.", "Sunday Skip");
      return; // Exit the function if it's Sunday and skipSundays is true
    }

    toastInfo("Processing daily sales...", "Working");
    let errorSheetRows = [];
    let unknownInputs = [];
    let countsByFullName = {};

    try {
      const sheets = getSheets();
      const dailyRange = sheets.today.getRange(RANGES.dailyData); // A2:N51
      const allDailyData = dailyRange.getValues();
      const allDailyFontColors = dailyRange.getFontColors(); // *** NEW: Get font colors ***

      let rowsToLogToMonthly = [];
      let fontColorsToLogToMonthly = []; // *** NEW: Array for corresponding font colors ***

      allDailyData.forEach((row, index) => {
        const hasNewActivity = row.slice(1, 7).some((cell) => cell && String(cell).trim() !== "");
        const hasUsedActivity = row.slice(8, 14).some((cell) => cell && String(cell).trim() !== "");
        if (hasNewActivity || hasUsedActivity) {
          rowsToLogToMonthly.push([...row]); // Push a copy of the row
          fontColorsToLogToMonthly.push([...allDailyFontColors[index]]); // Push a copy of the font color row
        }
      });

      if (!rowsToLogToMonthly.length) {
        showCustomAlert("Process Complete", "No sales activity found on the TODAY sheet to log to monthly.");
        sheets.today.getRange(RANGES.dailyClear).setBackground(null).setFontColor(null); // Reset font color here too
        return;
      }

      // CHECKPOINT 1: Before MONTHLY operations (critical)
      if (!timer.checkTime("Before MONTHLY write")) {
        alertError(
          "Processing time too close to limit. Please retry when system load is lower.",
          "Timeout Prevention"
        );
        return; // Exit before any changes
      }

      // CREATE OPERATION CHECKPOINT before any modifications
      const dateStr = formatDateOffset(1);
      createOperationCheckpoint({
        dateStr: dateStr,
        rowCount: rowsToLogToMonthly.length,
        rows: rowsToLogToMonthly
      });

      // Modify Column A
      rowsToLogToMonthly = rowsToLogToMonthly.map((row, index) => {
        row[0] = index + 1;
        return row;
      });
      // Note: fontColorsToLogToMonthly does not need Column A modified, it's just colors.

      // MODIFIED: Use the new function to find the last row specifically within columns A:N
      const lastRowMonthly = findLastRowInCols(sheets.monthly, 1, 14);
      const headerInsertRow = lastRowMonthly + 1;
      const dataInsertRow = headerInsertRow + 1;

      sheets.monthly.insertRowBefore(headerInsertRow);
      sheets.monthly.getRange(headerInsertRow, 1, 1, 14).merge().setValue(dateStr).setHorizontalAlignment("center").setFontFamily("Calibri").setFontSize(10).setFontWeight("bold").setBackground("#FFFF00").setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

      const numRowsToInsert = rowsToLogToMonthly.length;
      const numColsToInsert = 14;

      const monthlyDataRange = sheets.monthly.getRange(dataInsertRow, 1, numRowsToInsert, numColsToInsert);
      monthlyDataRange.setValues(rowsToLogToMonthly);
      SpreadsheetApp.flush();

      // Apply general formatting (font family, size, borders) to B:N
      sheets.monthly.getRange(dataInsertRow, 2, numRowsToInsert, 13).setFontFamily("Calibri").setFontWeight("bold").setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle").setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);

      // Specific formatting for Column A on monthly
      sheets.monthly.getRange(dataInsertRow, 1, numRowsToInsert, 1).setNumberFormat("0").setFontFamily("Calibri").setFontWeight("bold").setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle").setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);

      sheets.monthly.getRange(dataInsertRow, 6, numRowsToInsert, 1).setFontSize(7); // Col F
      sheets.monthly.getRange(dataInsertRow, 13, numRowsToInsert, 1).setFontSize(7); // Col M

      // *** NEW: Apply font colors to the new rows on monthly sheet ***
      if (fontColorsToLogToMonthly.length > 0) {
        monthlyDataRange.setFontColors(fontColorsToLogToMonthly);
        SpreadsheetApp.flush(); // Ensure font colors are applied before next formatting
      }

      const { aliasMap, displayCodeMap } = getSalespersonMaps();

      errorSheetRows = applyMonthlyRowFormatting(sheets.monthly, rowsToLogToMonthly, dataInsertRow, aliasMap);

      // Update checkpoint: MONTHLY data written successfully
      updateCheckpoint('MONTHLY_WRITTEN', {
        monthlyInsertRow: dataInsertRow,
        rowsInserted: numRowsToInsert
      });

      const sidesToTally = [
        { fiIdx: 2, saleIdx: 6 },
        { fiIdx: 9, saleIdx: 13 },
      ];
      const tallyResult = tallyCounts(rowsToLogToMonthly, aliasMap, sidesToTally);
      countsByFullName = tallyResult.counts;
      unknownInputs = tallyResult.unknownInputs;

      const lbRange = sheets.today.getRange(RANGES.leaderboard);
      const lbValues = lbRange.getValues();
      lbValues.forEach((r) => {
        if (countsByFullName[r[0]]) r[1] = (Number(r[1]) || 0) + countsByFullName[r[0]];
      });
      lbValues.sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0) || (Number(b[2]) || 0) - (Number(a[2]) || 0));
      lbRange.setValues(lbValues);

      sheets.today.getRange(RANGES.mtd).setNumberFormat("0.#");
      sheets.today.getRange(RANGES.avg).setNumberFormat("0.#");
      reapplyCF();

      // --- Clean Up TODAY Sheet ---
      const dailyClearRange = sheets.today.getRange(RANGES.dailyClear);
      dailyClearRange.clearContent();
      dailyClearRange.setBackground(null);
      dailyClearRange.setFontColor(null); // *** NEW: Reset font color to default ***

      // Update checkpoint: Core operations complete, analytics pending
      updateCheckpoint('ANALYTICS_PENDING');

      // CHECKPOINT 2: Before optional analytics (after critical operations)
      if (!timer.checkTime("Before analytics calculation")) {
        Logger.log("⚠️ Skipping analytics due to time constraints");
        updateCheckpoint('ANALYTICS_FAILED', { reason: 'timeout_prevention' });
        analyticsSkipped = true;
      } else {
        // Try analytics
        try {
          Logger.log("Calculating monthly analytics...");
          invalidateAnalyticsCache();
          const analyticsData = calculateMonthlyAnalytics();
          if (analyticsData) {
            writeAnalyticsToMonthly(analyticsData, sheets.monthly);
            Logger.log("✓ Monthly analytics calculation successful");
            // Clear checkpoint - operation fully complete
            clearOperationCheckpoint();
          } else {
            updateCheckpoint('ANALYTICS_FAILED', { reason: 'no_data_generated' });
            analyticsSkipped = true;
          }
        } catch (analyticsError) {
          logWarning('processDaily', 'Analytics calculation failed (non-critical)', { error: analyticsError.toString() });
          updateCheckpoint('ANALYTICS_FAILED', {
            reason: 'exception',
            error: analyticsError.toString()
          });
          analyticsSkipped = true;
        }
      }

      // Log execution time
      const elapsed = timer.getElapsed();
      Logger.log(`✓ processDaily completed in ${elapsed.toFixed(1)}s`);

      // Construct summary message
      const { newCount, usedCount, tradeCount } = summarizeRows(rowsToLogToMonthly);
      const repLines = Object.entries(countsByFullName)
        .filter(([, c]) => c > 0)
        .map(([name, count]) => `  - ${displayCodeMap[name] || name}: ${count}`);

      let summaryTitle = `Daily Sales Logged: ${dateStr}`;
      let summaryMsg = `NEW DELIVERED SALES: ${newCount}\n` + `USED DELIVERED SALES: ${usedCount}\n` + `TOTAL DELIVERED UNITS: ${newCount + usedCount}\n` + `DELIVERED DEALS WITH TRADES: ${tradeCount}\n\n` + `SALESPERSON DELIVERED COUNTS:\n` + (repLines.length > 0 ? repLines.join("\n") : "  - No specific salesperson counts for delivered deals today.") + `\n\nSALESPERSON CODE ERRORS (on delivered deals): ${errorSheetRows.length}`;

      if (errorSheetRows.length > 0) {
        summaryMsg += `\n(Salesperson code errors for delivered deals are highlighted on 'MONTHLY' in rows ${dataInsertRow}-${dataInsertRow + numRowsToInsert - 1}.)`;
      }
      if (unknownInputs.length > 0) {
        summaryMsg += `\n\nUNKNOWN SALESPEOPLE INPUTS: ${[...new Set(unknownInputs)].join(", ")}\n(Check spelling or add to 'SALESPEOPLE' sheet.)`;
      }

      // Enhance summary message if analytics was skipped
      if (analyticsSkipped) {
        summaryMsg += "\n\n⚠️ Analytics calculation was skipped due to time constraints. " +
                      "Use 'Sales Tools > Recalculate MTD & Check Formats' and confirm analytics refresh when prompted.";
      }

      // NOW show the complete message to user
      showCustomAlert(summaryTitle, summaryMsg);

      Logger.log("Daily processing complete.");
    } catch (e) {
      logError('processDaily', e);
      alertError("Error during daily processing: " + e.toString(), "Processing Failed");
    }
  });
}

/**
 * Reapplies conditional formatting rules to the TODAY sheet.
 */
function reapplyCF() {
  try {
    // Get configured colors and thresholds
    const LEADERBOARD_ZERO_BG_COLOR = getColor('leaderboardZeroMtdBgColor');
    const LEADERBOARD_ZERO_BG_COLOR_UPPER = LEADERBOARD_ZERO_BG_COLOR.toUpperCase();
    const DUPLICATE_FILL_COLOR = getColor('duplicateStockFillColor');
    const DUPLICATE_TEXT_COLOR = getColor('duplicateStockTextColor');
    const paceThresholds = getPaceThresholds();

    const sheets = getSheets();
    const todaySheet = sheets.today;

    let existingRules = todaySheet.getConditionalFormatRules();
    let rulesToKeep = [];

    const now = new Date();
    const { daysElapsed, totalDays } = memoizedGetSellingDays(now.getFullYear(), now.getMonth());
    const paceBase = totalDays > 0 ? `($Q2/${daysElapsed}*${totalDays})` : null;

    const managedDataRulesSignatures = [ /* ... keep as is ... */ ];
    const managedLeaderboardBlueRuleSignature = {
      formula: "=1=1",
      rangeA1: RANGES.leaderboard,
      background: LEADERBOARD_ZERO_BG_COLOR_UPPER,
    };
    const PACE_COLORS_UPPER = ["#70AD47", "#FFEE32", "#C00000"].map((c) => c.toUpperCase());

    existingRules.forEach((rule) => {
      const bc = rule.getBooleanCondition();
      let isManagedByThisScript = false;
      if (bc && bc.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA) {
        const currentFormulaFull = bc.getCriteriaValues()[0].toString();
        const currentFormulaNormalized = currentFormulaFull.replace(/\s+/g, "");
        const ranges = rule.getRanges();
        if (ranges.length === 1) {
          const currentRangeA1 = ranges[0].getA1Notation();
          const ruleBg = bc.getBackground() ? bc.getBackground().toUpperCase() : null;
          for (const sig of managedDataRulesSignatures) {
            if (sig.formula.replace(/\s+/g, "") === currentFormulaNormalized && sig.rangeA1 === currentRangeA1) {
              isManagedByThisScript = true;
              break;
            }
          }
          if (!isManagedByThisScript && currentRangeA1 === RANGES.leaderboard) {
            if (currentFormulaNormalized === managedLeaderboardBlueRuleSignature.formula && ruleBg === managedLeaderboardBlueRuleSignature.background) { isManagedByThisScript = true; }
            if (!isManagedByThisScript && PACE_COLORS_UPPER.includes(ruleBg)) {
              if (currentFormulaNormalized.includes("$Q")) {
                isManagedByThisScript = true;
                Logger.log(`Identified old/current pace rule for removal on ${currentRangeA1} (color: ${ruleBg}, formula: ${currentFormulaFull})`);
              }
            }
          }
        }
      }
      if (!isManagedByThisScript) { rulesToKeep.push(rule.copy().build()); }
    });

    let newRules = [...rulesToKeep];

    let allMtdAreZero = true;
    try {
      if (RANGES.mtd && RANGES.mtd.match(/^[A-Z]+\d+:[A-Z]+\d+$/)) {
        const mtdRangeValues = todaySheet.getRange(RANGES.mtd).getValues();
        for (const row of mtdRangeValues) {
          const value = Number(row[0]);
          if (!isNaN(value) && value > 0) {
            allMtdAreZero = false;
            break;
          }
        }
      } else {
        Logger.log(`RANGES.mtd ("${RANGES.mtd}") is not defined or invalid. Defaulting to standard pace rules.`);
        allMtdAreZero = false;
      }
    } catch (e) {
      logWarning('reapplyCF', 'Error reading MTD values for CF logic. Defaulting to standard pace rules.', { error: e.toString() });
      allMtdAreZero = false;
    }

    const cfLeaderboardRange = todaySheet.getRange(RANGES.leaderboard);

    if (allMtdAreZero) {
      Logger.log("All MTD are zero. Applying configured background to leaderboard.");
      newRules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(managedLeaderboardBlueRuleSignature.formula).setBackground(LEADERBOARD_ZERO_BG_COLOR).setRanges([cfLeaderboardRange]).build());
    } else {
      Logger.log("MTD sales detected or error in MTD check. Applying standard pace conditional formatting.");
      if (totalDays > 0 && paceBase) {
        newRules.push(
          SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=${paceBase}>=${paceThresholds.green}`).setBackground(PACE_COLORS_UPPER[0]).setRanges([cfLeaderboardRange]).build(), // Green
          SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=AND(${paceBase}>=${paceThresholds.yellow},${paceBase}<${paceThresholds.green})`).setBackground(PACE_COLORS_UPPER[1]).setRanges([cfLeaderboardRange]).build(), // Yellow
          SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=${paceBase}<${paceThresholds.yellow}`).setBackground(PACE_COLORS_UPPER[2]).setRanges([cfLeaderboardRange]).build() // Red
        );
      } else {
        Logger.log("Cannot apply leaderboard pace CF: Total selling days is zero or paceBase is null.");
      }
    }

    const todayNewCarRange = todaySheet.getRange(RANGES.todayNewCarDataRange);
    const todayUsedCarRange = todaySheet.getRange(RANGES.todayUsedCarDataRange);

    newRules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=COUNTIF($E$2:$E$101,$E2)>1").setFontColor(DUPLICATE_TEXT_COLOR).setBackground(DUPLICATE_FILL_COLOR).setRanges([todayNewCarRange]).build());
    newRules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=COUNTIF($L$2:$L$101,$L2)>1").setFontColor(DUPLICATE_TEXT_COLOR).setBackground(DUPLICATE_FILL_COLOR).setRanges([todayUsedCarRange]).build());
    newRules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=COUNTIF(INDIRECT("DEPOSITS!G:G"),$E2)>0').setFontColor(DUPLICATE_TEXT_COLOR).setBackground(DUPLICATE_FILL_COLOR).setRanges([todayNewCarRange]).build());
    newRules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=COUNTIF(INDIRECT("DEPOSITS!G:G"),$L2)>0').setFontColor(DUPLICATE_TEXT_COLOR).setBackground(DUPLICATE_FILL_COLOR).setRanges([todayUsedCarRange]).build());

    setCFRulesSheet(todaySheet, newRules);
    toastInfo("Conditional formatting updated for Leaderboard and Data Entry.", "CF Updated");
  } catch (e) {
    logError('reapplyCF', e);
    alertError("Error reapplying CF: " + e.toString(), "CF Error");
  }
}

function recalcMtdFromMonthly() {
  withScriptLock(() => {
    toastInfo("Recalculating MTD & checking 'MONTHLY' sheet formats...", "Working");
    let totalSalespersonErrors = 0;

    try {
      const sheets = getSheets();
      const monthlySheet = sheets.monthly;
      const todaySheet = sheets.today;
      const lastRowMonthly = monthlySheet.getLastRow();
      const maxColsMonthly = monthlySheet.getMaxColumns();

      if (maxColsMonthly < 14) {
        alertError('"MONTHLY" sheet needs at least 14 columns (A:N).');
        return;
      }
      if (lastRowMonthly < 2) {
        todaySheet.getRange(RANGES.mtd).clearContent();
        reapplyCF();
        toastInfo("MTD Cleared. No data in 'MONTHLY' to recalculate.", "Recalc Info");
        return;
      }

      const { aliasMap } = getSalespersonMaps();
      const monthlyValues = monthlySheet.getRange(2, 1, lastRowMonthly - 1, maxColsMonthly).getValues();
      toastInfo("Reading MONTHLY sheet data...", "Working (1/6)");

      const salespersonErrorRowsFound = applyMonthlyRowFormatting(monthlySheet, monthlyValues, 2, aliasMap);
      totalSalespersonErrors = salespersonErrorRowsFound.length;
      toastInfo("Applying formatting and checking for errors...", "Working (2/6)");

      const allMonthlyContent = monthlySheet.getRange(1, 1, lastRowMonthly, maxColsMonthly).getValues();
      const mergedRanges = monthlySheet.getRange(1, 1, lastRowMonthly, 1).getMergedRanges();
      let actualDataRows = [];
      const dateHeaderRows = mergedRanges
        .filter((mr) => mr.getRow() > 0 && mr.getColumn() === 1 && mr.getWidth() >= 14)
        .map((mr) => mr.getRow())
        .sort((a, b) => a - b);
      toastInfo("Identifying date sections...", "Working (3/6)");

      if (dateHeaderRows.length > 0) {
        let startDataRowIdx = dateHeaderRows[0];
        for (let i = 1; i < dateHeaderRows.length; i++) {
          let endDataRowIdx = dateHeaderRows[i] - 1;
          if (startDataRowIdx < endDataRowIdx) {
            actualDataRows = actualDataRows.concat(allMonthlyContent.slice(startDataRowIdx, endDataRowIdx));
          }
          startDataRowIdx = dateHeaderRows[i];
        }
        if (startDataRowIdx < lastRowMonthly) {
          actualDataRows = actualDataRows.concat(allMonthlyContent.slice(startDataRowIdx));
        }
      } else {
        Logger.log("No distinct date headers found. Reading all rows from row 2 for MTD.");
        if (lastRowMonthly > 1) actualDataRows = monthlyValues;
      }

      toastInfo("Extracting sales data...", "Working (4/6)");
      if (!actualDataRows.length) {
        todaySheet.getRange(RANGES.mtd).clearContent();
        reapplyCF();
        toastInfo("MTD Cleared. No data rows found in 'MONTHLY' after filtering headers.", "Recalc Info");
        return;
      }

      const sidesToTally = [
        { fiIdx: 2, saleIdx: 6 },
        { fiIdx: 9, saleIdx: 13 },
      ];
      const { counts: countsByFullName } = tallyCounts(actualDataRows, aliasMap, sidesToTally);

      const lbRange = todaySheet.getRange(RANGES.leaderboard);
      const lbValues = lbRange.getValues();
      lbValues.forEach((r) => {
        r[1] = countsByFullName[r[0]] || 0;
      });
      lbValues.sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0) || (Number(b[2]) || 0) - (Number(a[2]) || 0));
      lbRange.setValues(lbValues);
      todaySheet.getRange(RANGES.mtd).setNumberFormat("0.#");
      toastInfo("Updating leaderboard counts...", "Working (5/6)");
      reapplyCF();
      toastInfo("Reapplying conditional formatting...", "Working (6/6)");

      toastInfo(`MTD recalculated. Found ${totalSalespersonErrors} salesperson code errors in 'MONTHLY'. Non-delivered deals also highlighted.`, "Recalc & Format Complete", 5);
      // === NEW: Analytics Prompt and Execution ===
      // Get UI reference
      const ui = SpreadsheetApp.getUi();
      
      // Prompt user to refresh analytics
      const analyticsResponse = ui.alert(
        "Update Monthly Analytics?",
        "MTD recalculation complete!\n\n" +
        "Would you like to refresh the monthly analytics now?\n\n" +
        "This will update the comprehensive sales metrics in columns S-X " +
        "of the MONTHLY sheet, including:\n" +
        "• Total delivered units (new/used breakdown)\n" +
        "• Per-salesperson sales counts\n" +
        "• Team performance metrics\n\n" +
        "This typically takes 5-10 seconds.",
        ui.ButtonSet.YES_NO
      );
      
      if (analyticsResponse === ui.Button.YES) {
        try {
          toastInfo("Refreshing analytics...", "Working", 5);
          
          // Call the internal analytics helper (imported from sales_analytics.js)
          const analyticsResult = refreshAnalyticsInternal(sheets);
          
          if (analyticsResult.success) {
            // Show summary dialog
            const analytics = analyticsResult.data;
            const topPerformer = analytics.salespersonMetrics[0] || { displayCode: "N/A", totalSales: 0 };
            
            ui.alert(
              "Update Complete",
              "MTD and Analytics have been updated successfully!\n\n" +
              "MTD Recalculation:\n" +
              `• Found ${totalSalespersonErrors} salesperson code errors in MONTHLY\n` +
              "• Non-delivered deals highlighted\n" +
              "• Leaderboard updated\n\n" +
              "Monthly Analytics:\n" +
              `• Total Delivered: ${analytics.totals.delivered || 0}\n` +
              `• New: ${analytics.totals.newDelivered || 0}\n` +
              `• Used: ${analytics.totals.usedDelivered || 0}\n` +
              `• Top Performer: ${topPerformer.displayCode} (${topPerformer.totalSales} units)`,
              ui.ButtonSet.OK
            );
            
            toastInfo("MTD and Analytics update complete!", "Complete", 5);
          } else {
            // Analytics failed but MTD succeeded
            alertError(
              "Analytics Update Failed\n\n" +
              "MTD recalculation completed successfully, but analytics " +
              "update encountered an error:\n\n" +
              (analyticsResult.error || "Unknown error") + "\n\n" +
              "Your MTD and formatting updates have been saved.\n\n" +
              "You can refresh analytics manually later via the menu."
            );
            toastInfo("MTD complete. Analytics update failed.", "Warning", 5);
          }
        } catch (analyticsError) {
          // Log but don't fail the whole operation since MTD succeeded
          Logger.log("Analytics refresh error after MTD: " + analyticsError);
          alertError(
            "Analytics update failed: " + analyticsError.message + "\n\n" +
            "MTD recalculation was successful."
          );
          toastInfo("MTD complete. Analytics update failed.", "Warning", 5);
        }
      } else {
        // User declined analytics refresh
        toastInfo("MTD recalculation complete. Analytics not updated.", "Complete", 5);
      }
      // === END NEW CODE ===

    } catch (e) {
      logError('recalcMtdFromMonthly', e);
      alertError("Error during MTD recalculation: " + e.toString(), "Recalc Failed");
    }
  });
}

function rolloverMonth() {
  withScriptLock(() => {
    const ui = SpreadsheetApp.getUi();
    const response = ui.alert("Confirm Month Rollover", "This will:\n" + '1. Archive the current "MONTHLY" sheet (e.g., as "5/25").\n' + "2. Copy the final leaderboard to the archive.\n" + '3. Clear the "MONTHLY" sheet for the new month.\n' + '4. Clear MTD sales (Column Q) on the "TODAY" sheet.\n' + '5. Recalculate 3-Month Rolling Averages (Column R) on "TODAY".\n\n' + "Are you sure you want to proceed?", ui.ButtonSet.YES_NO);
    if (response !== ui.Button.YES) {
      toastInfo("Rollover cancelled.", "Cancelled");
      return;
    }

    toastInfo("Starting month rollover...", "Working (1/5)");
    try {
      const sheets = getSheets();
      const currentDate = new Date();
      let archiveYear = currentDate.getFullYear();
      let archiveMonth = currentDate.getMonth() - 1;
      if (archiveMonth < 0) {
        archiveMonth = 11;
        archiveYear--;
      }
      const archiveSheetName = `${archiveMonth + 1}/${String(archiveYear % 100).padStart(2, "0")}`;

      if (SS.getSheetByName(archiveSheetName)) {
        alertError(`Archive "${archiveSheetName}" already exists. Rollover aborted.`);
        return;
      }

      // Recalculate final analytics before archiving for accuracy
      try {
        Logger.log("Recalculating final analytics for archive...");
        invalidateAnalyticsCache();
        const finalAnalytics = calculateMonthlyAnalytics();
        if (finalAnalytics) {
          writeAnalyticsToMonthly(finalAnalytics, sheets.monthly);
          SpreadsheetApp.flush(); // Ensure writes complete before copy
        }
      } catch (e) {
        Logger.log("Pre-rollover analytics refresh failed: " + e);
        // Continue with rollover even if analytics fail
      }

      const archiveSheet = sheets.monthly.copyTo(SS);
      try {
        archiveSheet.setName(archiveSheetName);
        archiveSheet.setTabColor(null);
        SpreadsheetApp.flush();
        toastInfo(`"MONTHLY" archived as "${archiveSheetName}".`, "Working (2/5)");
      } catch (e) {
        logError('rolloverMonth', e, { operation: 'rename_archive', archiveName: archiveSheetName });
        alertError(`Error renaming archive: ${e}. Try deleting partial archive.`);
        try {
          SS.deleteSheet(archiveSheet);
        } catch (delErr) {
          Logger.log(`Failed to delete partial: ${delErr}`);
        }
        return;
      }

      const lbRangeToday = sheets.today.getRange(RANGES.leaderboard);
      archiveSheet
        .getRange(RANGES.leaderboard)
        .setValues(lbRangeToday.getValues())
        .setBackgrounds(lbRangeToday.getBackgrounds())
        .setFontWeights(lbRangeToday.getFontWeights())
        .setFontSizes(lbRangeToday.getFontSizes())
        .setFontFamilies(lbRangeToday.getFontFamilies())
        .setFontColors(lbRangeToday.getFontColors());
      [16, 17, 18].forEach((col) => archiveSheet.autoResizeColumn(col));
      toastInfo("Leaderboard copied to archive.", "Working (3/5)");

      const lastRowMonthly = sheets.monthly.getLastRow();
      if (lastRowMonthly > 1) {
        sheets.monthly.getRange(2, 1, lastRowMonthly - 1, sheets.monthly.getMaxColumns()).clear();
        sheets.monthly.setRowHeights(2, lastRowMonthly - 1, 21);
      }
      sheets.monthly.getRange(1, 1, 51, 14).setBorder(null, null, null, null, null, null).setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);
      toastInfo(`"MONTHLY" sheet cleared.`, "Working (4/5)");

      sheets.today.getRange(RANGES.mtd).clearContent();
      const leaderboardData = sheets.today.getRange(RANGES.leaderboard).getValues();
      const avgValues = Array(leaderboardData.length).fill(null).map(() => [0]);
      let tempDate = new Date(currentDate);
      for (let i = 0; i < leaderboardData.length; i++) {
        const currentFullName = leaderboardData[i][0];
        let totalSales = 0, months = 0;
        let cursorDate = new Date(tempDate);
        for (let j = 0; j < 3; j++) {
          let loopYear = cursorDate.getFullYear();
          let loopM = cursorDate.getMonth() - 1;
          if (loopM < 0) {
            loopM = 11;
            loopYear--;
          }
          const prevArchiveName = `${loopM + 1}/${String(loopYear % 100).padStart(2, "0")}`;
          const prevSheet = SS.getSheetByName(prevArchiveName);
          if (prevSheet) {
            try {
              const archiveLastRow = prevSheet.getLastRow();
              const archiveEndRow = Math.max(2, archiveLastRow);
              const prevLbRange = `P2:R${archiveEndRow}`;
              const prevLbVals = prevSheet.getRange(prevLbRange).getValues();
              const personRow = prevLbVals.find((row) => row[0] === currentFullName);
              if (personRow && typeof personRow[1] === "number") {
                totalSales += personRow[1];
                months++;
              }
            } catch (e) {
              logWarning('rolloverMonth', 'Error reading archive for average calculation', { archiveName: prevArchiveName, error: e.toString() });
            }
          }
          cursorDate.setMonth(cursorDate.getMonth() - 1);
        }
        avgValues[i][0] = months > 0 ? roundHalf(totalSales / months) : 0;
      }
      sheets.today.getRange(RANGES.avg).setValues(avgValues).setNumberFormat("0.#");
      toastInfo("MTD cleared & Averages recalculated.", "Working (5/5)");
      reapplyCF();
      SpreadsheetApp.flush();
      ui.alert("Month Rollover Complete!", `"${archiveSheetName}" created. "MONTHLY" & MTD reset. Averages updated.`, ui.ButtonSet.OK);
    } catch (e) {
      logError('rolloverMonth', e);
      alertError("Error during month rollover: " + e.toString(), "Rollover Failed");
    }
  });
}

// ============================================================================
// CONFIGURATION UI FUNCTIONS
// ============================================================================

/**
 * Opens the configuration sidebar
 * Initializes migration if needed on first open
 */
function openConfigurationSidebar() {
  try {
    // Check if migration is needed (first time opening settings)
    const props = PropertiesService.getDocumentProperties();
    if (!props.getProperty('SALES_LOG_CONFIG')) {
      // Auto-migrate from hardcoded constants
      migrateToConfigUI();
    }

    // Create template from file (enables server-side scriptlet execution)
    const template = HtmlService.createTemplateFromFile('config_sidebar');
    const html = template.evaluate()
      .setTitle('Sales Log Settings')
      .setWidth(350);

    SpreadsheetApp.getUi().showSidebar(html);
  } catch (e) {
    logError('openConfigurationSidebar', e);
    alertError('Failed to open settings: ' + e.message, 'Configuration Error');
  }
}

// ============================================================================
// MENU & INITIALIZATION
// ============================================================================

// onOpen
function onOpen() {
  try {
    // Run migration check silently (safe to call multiple times)
    try {
      migrateToConfigUI();
    } catch (migrationError) {
      logWarning('onOpen', 'Migration check failed (non-critical)', { error: migrationError.toString() });
      // Continue with menu creation even if migration fails
    }

    // Check if all required sheets exist
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hasAllSheets = ss.getSheetByName("TODAY") &&
                         ss.getSheetByName("MONTHLY") &&
                         ss.getSheetByName("SALESPEOPLE") &&
                         ss.getSheetByName("DEPOSITS");

    // Create menu - conditionally show setup wizard only if sheets are missing
    const menu = SpreadsheetApp.getUi().createMenu("Sales Tools");

    // Only show setup wizard if any required sheets are missing
    if (!hasAllSheets) {
      menu.addItem("🚀 Run Setup Wizard", "runSetupWizard")
          .addSeparator();
    }

    menu.addItem("Log Yesterday's Sales", "processDaily")
        .addSeparator()
        .addItem("Recalculate MTD & Check Formats", "recalcMtdFromMonthly")
        .addSeparator()
        .addItem("Start New Month (Rollover)", "rolloverMonth")
        .addSeparator()
        .addItem("⚙️ Settings", "openConfigurationSidebar")
        .addToUi();
  } catch (e) {
    // Log error with full context for debugging
    logError('onOpen', e, { operation: 'create_menu' });

    // Notify user of menu creation failure
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Failed to create Sales Tools menu. Please refresh the page. If the problem persists, check the script logs or contact support.',
        'Menu Creation Error',
        10  // 10 seconds - important message
      );
    } catch (toastError) {
      // If even toast fails, log it but don't throw
      logWarning('onOpen', 'Could not display error toast', { error: toastError.toString() });
    }

  } finally {
    // Log completion for monitoring
    Logger.log('[onOpen] Trigger execution completed');
  }
}
