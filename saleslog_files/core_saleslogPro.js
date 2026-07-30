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
const CACHE_KEY_NAME_MAP = 'salespersonMaps'; // Updated cache key name
const CACHE_KEY_COLORS = 'visualConfig'; // Cache key for color configuration
const sellingDaysCache = {};
// Cached global reference for SpreadsheetApp's active spreadsheet
const SS = SpreadsheetApp.getActive();
const RANGES = {
  dailyData: 'A2:N51', // Range on TODAY sheet for daily input
  dailyClear: 'B2:N51', // Range on TODAY sheet to clear after processing (excludes Col A)
  todayNewCarDataRange: 'B2:G101', // For rules 1 & 3
  todayUsedCarDataRange: 'I2:N101', // For rules 2 & 4

  // Dynamic ranges computed based on salesperson count
  get leaderboard() {
    return getDynamicLeaderboardRanges().leaderboard;
  },
  get mtd() {
    return getDynamicLeaderboardRanges().mtd;
  },
  get avg() {
    return getDynamicLeaderboardRanges().avg;
  },
};
const RECON_SPREADSHEET_ID = '1REAs1ySLZFAHylXWrvoG8N3cvj_iLlNiPVWArT3EEvw';
const RECON_SHEET_NAME = 'RECON_IMPORT';
const RECON_SOURCEKEY_HEADER = 'SourceKey';
const RECON_IMPORTEDAT_HEADER = 'ImportedAt';
const RECON_SOURCEKEY_COL_CACHE_KEY = 'RECON_SOURCEKEY_COL_CACHE';

// Default color constants (used as fallbacks if configuration not available)
const DEFAULT_COLORS = {
  nonDeliveredColor: '#FF0000',
  salespersonErrorColor: '#FFEBEE',
  duplicateStockFillColor: '#b4ff0c',
  duplicateStockTextColor: '#ff0000',
  leaderboardZeroMtdBgColor: '#F0F8FF',
  paceThresholds: {
    green: 10,
    yellow: 8,
    red: 0,
  },
};

// Module-scope color configuration cache
/**
 * Gets a specific color value with fallback to defaults
 *
 * @param {string} colorKey - Key for the color (e.g., 'nonDeliveredColor')
 * @returns {string} Hex color code
 */
function getColor(colorKey) {
  return DEFAULT_COLORS[colorKey];
}

/**
 * Gets pace threshold values with fallback to defaults
 *
 * @returns {Object} Pace thresholds {green, yellow, red}
 */
function getPaceThresholds() {
  return DEFAULT_COLORS.paceThresholds;
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
    logError('getSheets', 'SpreadsheetApp.getActive() returned null', {
      issue: 'script_not_bound',
    });
    throw new Error(
      'SpreadsheetApp.getActive() returned null. Script might not be properly bound or accessed.'
    );
  }
  const today = SS.getSheetByName('TODAY');
  const monthly = SS.getSheetByName('MONTHLY');
  const sales = SS.getSheetByName('SALESPEOPLE');
  if (!today || !monthly || !sales) {
    logError('getSheets', 'Required sheets missing', {
      today: !!today,
      monthly: !!monthly,
      sales: !!sales,
    });
    throw new Error(
      "Required sheets missing. Ensure 'TODAY', 'MONTHLY', and 'SALESPEOPLE' sheets exist."
    );
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
  for (
    let d = new Date(first);
    d <= todayDate && d <= last;
    d.setDate(d.getDate() + 1)
  ) {
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
 * Checks if Sundays should be counted as selling days
 * @returns {boolean} True if Sundays should be skipped
 */
function shouldSkipSundays() {
  return true; // Default to skipping Sundays
}

/**
 * Checks if Monday should log Saturday's date
 * @returns {boolean} True if Monday should default to Saturday
 */
function shouldMondayLogSaturday() {
  return true; // Default to true
}

/**
 * Validates FI (Finance & Insurance) flag field
 * Accepts single uppercase letters (A-Z) or the special value "BD"
 * @param {string} fiFlag - FI flag to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidFIFlag(fiFlag) {
  if (!fiFlag || typeof fiFlag !== 'string') {
    return false;
  }

  const trimmed = fiFlag.trim().toUpperCase();

  // Accept single letters A-Z or special value "BD"
  return /^[A-Z]$/.test(trimmed) || trimmed === 'BD';
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
      if (
        parsedCache &&
        typeof parsedCache.aliasMap === 'object' &&
        typeof parsedCache.displayCodeMap === 'object'
      ) {
        return parsedCache;
      } else {
        logWarning(
          'getSalespersonMaps',
          'Cached salesperson map has invalid structure. Rebuilding.'
        );
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
    const fullName = String(row[0] || '').trim();
    const aliasesStr = String(row[1] || '').trim();
    const displayCode = String(row[2] || '').trim();
    if (fullName) {
      const displayName = displayCode || fullName;
      displayCodeMap[fullName] = displayName;
      aliasMap[fullName.toUpperCase()] = fullName;
      if (displayName && displayName.toUpperCase() !== fullName.toUpperCase()) {
        aliasMap[displayName.toUpperCase()] = fullName;
      }
      if (aliasesStr) {
        aliasesStr.split(',').forEach((alias) => {
          const standardizedAlias = alias.trim().toUpperCase();
          if (standardizedAlias) {
            if (
              aliasMap[standardizedAlias] &&
              aliasMap[standardizedAlias] !== fullName
            ) {
              Logger.log(
                `Warning: Duplicate alias '${standardizedAlias}' mapped to '${aliasMap[standardizedAlias]}' and now also to '${fullName}'. Using mapping to '${fullName}'.`
              );
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
      Logger.log(
        `Warning: Unusually high salesperson count: ${count}. Capping at 200.`
      );
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
    leaderboardRowCount: rowCount,
  };
}

/**
 * Removes cached salesperson alias/display maps to ensure new SALESPEOPLE data is picked up.
 */
function invalidateSalespersonMapCache() {
  try {
    CACHE.remove(CACHE_KEY_NAME_MAP);
  } catch (e) {
    logWarning(
      'invalidateSalespersonMapCache',
      'Failed to clear salesperson map cache',
      { error: e.toString() }
    );
  }
}

/**
 * Builds a map of salesperson names to their 3-month rolling average using archived leaderboard sheets.
 * @param {string[]} names - Salesperson full names to evaluate
 * @returns {Object} Map of fullName -> average (number)
 */
function computeThreeMonthAverageMap(names) {
  const uniqueNames = Array.from(
    new Set(
      (names || [])
        .map((name) => String(name || '').trim())
        .filter((name) => name)
    )
  );

  if (uniqueNames.length === 0) {
    return {};
  }

  const archiveCache = {};
  const averages = {};
  const currentDate = new Date();

  const loadArchiveMap = (sheetName) => {
    if (archiveCache[sheetName]) {
      return archiveCache[sheetName];
    }

    const sheet = SS.getSheetByName(sheetName);
    if (!sheet) {
      archiveCache[sheetName] = {};
      return archiveCache[sheetName];
    }

    try {
      const lastRow = sheet.getLastRow();
      const rowCount = Math.min(200, Math.max(0, lastRow - 1));
      if (rowCount <= 0) {
        archiveCache[sheetName] = {};
        return archiveCache[sheetName];
      }

      const values = sheet.getRange(2, 16, rowCount, 3).getValues();
      const map = {};
      values.forEach((row) => {
        const name = String(row[0] || '').trim();
        if (!name) {
          return;
        }
        let mtdValue = row[1];
        if (typeof mtdValue !== 'number') {
          const parsed = Number(mtdValue);
          mtdValue = isNaN(parsed) ? null : parsed;
        }
        if (typeof mtdValue === 'number' && !isNaN(mtdValue)) {
          map[name] = mtdValue;
        }
      });

      archiveCache[sheetName] = map;
      return archiveCache[sheetName];
    } catch (e) {
      logWarning(
        'computeThreeMonthAverageMap',
        'Error reading archive sheet for averages',
        {
          sheetName,
          error: e.toString(),
        }
      );
      archiveCache[sheetName] = {};
      return archiveCache[sheetName];
    }
  };

  uniqueNames.forEach((name) => {
    let total = 0;
    let months = 0;
    const cursorDate = new Date(currentDate);

    for (let i = 0; i < 3; i++) {
      let archiveYear = cursorDate.getFullYear();
      let archiveMonthIndex = cursorDate.getMonth() - 1;
      if (archiveMonthIndex < 0) {
        archiveMonthIndex = 11;
        archiveYear--;
      }
      const sheetName = `${archiveMonthIndex + 1}/${String(
        archiveYear % 100
      ).padStart(2, '0')}`;
      const archiveMap = loadArchiveMap(sheetName);
      const value = archiveMap[name];
      if (typeof value === 'number' && !isNaN(value)) {
        total += value;
        months++;
      }
      cursorDate.setMonth(cursorDate.getMonth() - 1);
    }

    averages[name] = months > 0 ? roundHalf(total / months) : 0;
  });

  return averages;
}

/**
 * Synchronizes the TODAY sheet leaderboard with the SALESPEOPLE roster.
 * - Expands or contracts the leaderboard range to match active salespeople
 * - Preserves existing MTD counts when names match
 * - Recalculates 3-month averages from archived leaderboards
 * - Reapplies conditional formatting for the updated range
 *
 * @param {Object} [options]
 * @param {boolean} [options.preserveMtd=true] - Preserve existing MTD values when possible
 * @param {boolean} [options.recalculateAverages=true] - Recompute 3-month averages
 * @returns {{success: boolean, count: number, message: string}}
 */
function syncLeaderboardWithSalespeople(options = {}) {
  const { preserveMtd = true, recalculateAverages = true } = options;

  try {
    const sheets = getSheets();
    const todaySheet = sheets.today;
    const salesSheet = sheets.sales;

    const lastRow = salesSheet.getLastRow();
    let salespeople = [];
    if (lastRow > 1) {
      const raw = salesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      salespeople = raw
        .map((row) => String(row[0] || '').trim())
        .filter((name) => name)
        .slice(0, 200);
    }

    const rowCount = Math.min(Math.max(1, salespeople.length), 200);
    const endRow = rowCount + 1;

    const availableRows = Math.max(0, todaySheet.getMaxRows() - 1);
    const rowsToRead = preserveMtd
      ? Math.min(
        Math.max(rowCount, Math.min(availableRows, 200)),
        availableRows
      )
      : 0;
    const existingDataMap = {};

    if (preserveMtd && rowsToRead > 0) {
      const existingValues = todaySheet
        .getRange(2, 16, rowsToRead, 3)
        .getValues();
      existingValues.forEach((row) => {
        const name = String(row[0] || '').trim();
        if (!name) {
          return;
        }
        const mtdValue =
          typeof row[1] === 'number' ? row[1] : Number(row[1]) || 0;
        const avgValue =
          typeof row[2] === 'number' ? row[2] : Number(row[2]) || 0;
        existingDataMap[name] = { mtd: mtdValue, avg: avgValue };
      });
    }

    const rowsToClear = Math.min(availableRows, 200);
    if (rowsToClear > 0) {
      // MODIFIED: Use clear() to remove content AND formatting (borders, colors)
      todaySheet.getRange(2, 16, rowsToClear, 3).clear();
    }

    if (todaySheet.getMaxRows() < endRow) {
      todaySheet.insertRowsAfter(
        todaySheet.getMaxRows(),
        endRow - todaySheet.getMaxRows()
      );
    }

    const averages = recalculateAverages
      ? computeThreeMonthAverageMap(salespeople)
      : {};

    const populatedRows = salespeople.map((name) => {
      const preserved = preserveMtd ? existingDataMap[name] : null;
      const mtd = preserved ? preserved.mtd : 0;
      const avg = recalculateAverages
        ? averages[name] ?? 0
        : preserved?.avg ?? 0;
      return [name, mtd, avg];
    });

    const blankRowsNeeded = rowCount - populatedRows.length;
    for (let i = 0; i < blankRowsNeeded; i++) {
      populatedRows.push(['', 0, 0]);
    }

    const rowsWithNames = populatedRows.filter((row) => row[0]);
    rowsWithNames.sort((a, b) => {
      const mtdDiff = (Number(b[1]) || 0) - (Number(a[1]) || 0);
      if (mtdDiff !== 0) return mtdDiff;
      const avgDiff = (Number(b[2]) || 0) - (Number(a[2]) || 0);
      if (avgDiff !== 0) return avgDiff;
      return a[0].localeCompare(b[0]);
    });

    const finalRows = [...rowsWithNames];
    while (finalRows.length < rowCount) {
      finalRows.push(['', 0, 0]);
    }

    if (finalRows.length === 0) {
      finalRows.push(['', 0, 0]);
    }

    const targetRange = todaySheet.getRange(`P2:R${endRow}`);
    targetRange.setValues(finalRows);

    // MODIFIED: Apply specific formatting to the active leaderboard range
    targetRange
      .setBorder(
        true,
        true,
        true,
        true,
        true,
        true,
        '#000000',
        SpreadsheetApp.BorderStyle.SOLID
      )
      .setFontFamily('Calibri')
      .setFontSize(14)
      .setFontWeight('bold');

    // Name column (P)
    todaySheet.getRange(`P2:P${endRow}`).setHorizontalAlignment('left');

    // Number columns (Q-R)
    todaySheet
      .getRange(`Q2:R${endRow}`)
      .setHorizontalAlignment('center')
      .setNumberFormat('0.#');

    reapplyCF();
    invalidateSalespersonMapCache();
    SpreadsheetApp.flush();

    return {
      success: true,
      count: salespeople.length,
      message:
        salespeople.length > 0
          ? `Leaderboard refreshed for ${salespeople.length} salespeople.`
          : 'No salespeople found in SALESPEOPLE; leaderboard cleared.',
    };
  } catch (e) {
    logError('syncLeaderboardWithSalespeople', e);
    throw new Error('Failed to synchronize leaderboard: ' + e.message);
  }
}

/**
 * Manual menu action to refresh the TODAY leaderboard from SALESPEOPLE data.
 * @returns {{success: boolean, count: number, message: string}}
 */
function manualRefreshLeaderboard() {
  try {
    const result = syncLeaderboardWithSalespeople();
    const toastTitle = result.success ? 'Leaderboard Updated' : 'Leaderboard';
    toastInfo(result.message, toastTitle);
    return result;
  } catch (e) {
    alertError(
      e.message || 'Unable to refresh leaderboard.',
      'Leaderboard Refresh Failed'
    );
    throw e;
  }
}

function menuExportTradesToReconLog() {
  try {
    const result = exportTradesToReconLog({ scanMonthly: true, dryRun: false });
    if (result) {
      toastInfo(
        `Trades exported: ${result.appended}. Duplicates skipped: ${result.skippedDuplicates}.`,
        'Recon Export'
      );
    }
  } catch (e) {
    logError('menuExportTradesToReconLog', e);
    alertError(
      'Trade export failed. Check logs for details.',
      'Recon Export Failed'
    );
  }
}

function menuExportTradesToReconLogDryRun() {
  try {
    const result = exportTradesToReconLog({ scanMonthly: true, dryRun: true });
    if (result) {
      const wouldAppend = Math.max(
        0,
        (result.candidateTrades || 0) - (result.skippedDuplicates || 0)
      );
      toastInfo(
        `Dry run: ${result.candidateTrades} candidates, ${result.skippedDuplicates} duplicates, ${wouldAppend} would append.`,
        'Recon Export'
      );
    }
  } catch (e) {
    logError('menuExportTradesToReconLogDryRun', e);
    alertError(
      'Trade export dry run failed. Check logs for details.',
      'Recon Export Failed'
    );
  }
}

function authorizeReconAccess() {
  const reconSS = SpreadsheetApp.openById(RECON_SPREADSHEET_ID);
  let reconSheet = getReconSheet_(reconSS);
  if (!reconSheet) {
    reconSheet = reconSS.insertSheet(RECON_SHEET_NAME);
  }
  const cell = reconSheet.getRange('A1');
  const currentValue = cell.getValue();
  cell.setValue(currentValue);
  Logger.log('authorizeReconAccess: Recon spreadsheet access confirmed.');
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
 * Executes a function with bounded script-lock protection.
 * Prevents concurrent executions and ensures operation atomicity
 * Automatically releases lock after function completes or throws error
 * @param {Function} fn - Function to execute with lock protection
 * @returns {*} Return value from the executed function
 * @throws {Error} If the lock cannot be acquired within the configured deadline
 */
function withScriptLock(fn) {
  // Fail closed if another operation still holds the lock after the deadline.
  const lockResult = acquireScriptLockWithRetry();

  // Check if lock acquisition was successful
  if (!lockResult.success) {
    const msg =
      'Could not acquire script lock after ' +
      lockResult.attempts +
      ' attempts (' +
      lockResult.totalTime +
      'ms). ' +
      'Another operation may be running. Please try again.';
    Logger.log(msg);
    try {
      SpreadsheetApp.getUi()?.alert(msg);
    } catch (e) {
      Logger.log('UI alert failed for lock: ' + e);
    }
    throw new Error(msg);
  }

  try {
    Logger.log(
      'Script lock acquired on attempt ' +
      lockResult.attempts +
      ' for operation'
    );
    return fn();
  } finally {
    // Always release lock, even if operation failed
    lockResult.lock.releaseLock();
  }
}

// alertOps
function toastInfo(msg, title) {
  if (SS) SS.toast(msg, title || 'Info');
  else Logger.log(`Toast (SS not avail): ${title ? title + ': ' : ''}${msg}`);
}
function showCustomAlert(title, msg) {
  try {
    SpreadsheetApp.getUi().alert(
      title,
      msg,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    logWarning('showCustomAlert', 'UI not available for alert', {
      title,
      message: msg,
    });
  }
}
function alertError(msg, title = 'Error') {
  showCustomAlert(title, msg);
}

// Data transforms
function applySplitSalespersonInput_(salespersonInput, aliasMap, onResolved, onUnknown) {
  const raw = String(salespersonInput || '');
  if (!raw) return;

  const rawParts = raw.split('/');
  const increment = rawParts.length > 1 ? 0.5 : 1;

  rawParts.forEach((rawPart) => {
    const part = String(rawPart || '').trim();
    if (!part) return;
    const key = part.toUpperCase();
    const fullName = aliasMap && aliasMap[key];
    if (fullName) {
      if (typeof onResolved === 'function') onResolved(fullName, increment);
      return;
    }
    if (typeof onUnknown === 'function') onUnknown(part, rawPart);
  });
}

function tallyCounts(rows, aliasMap, sides) {
  const counts = {};
  const unknownInputs = [];
  rows.forEach((row) => {
    sides.forEach(({ fiIdx, saleIdx }) => {
      if (fiIdx >= row.length || saleIdx >= row.length) return;
      const fiFlag = String(row[fiIdx] || '')
        .trim()
        .toUpperCase();
      if (!isValidFIFlag(fiFlag)) return; // Only delivered
      const salespersonInput = String(row[saleIdx] || '').trim();
      if (!salespersonInput) return;
      applySplitSalespersonInput_(
        salespersonInput,
        aliasMap,
        (fullName, increment) => {
          counts[fullName] = (counts[fullName] || 0) + increment;
        },
        (unknown, rawPart) => {
          const value = typeof rawPart === 'string' ? rawPart : unknown;
          if (!unknownInputs.includes(value)) unknownInputs.push(value);
        }
      );
    });
  });
  return { counts, unknownInputs };
}

function updateLeaderboardFromCounts_(leaderboardRange, countsByFullName, options) {
  const opts = options || {};
  const mode = opts.mode || 'add';
  const values = leaderboardRange.getValues();

  values.forEach((row) => {
    const name = row[0];
    const raw = countsByFullName && Object.prototype.hasOwnProperty.call(countsByFullName, name)
      ? countsByFullName[name]
      : 0;
    const count = Number(raw) || 0;

    if (mode === 'add') {
      if (count) row[1] = (Number(row[1]) || 0) + count;
    } else {
      row[1] = count;
    }
  });

  values.sort(
    (a, b) =>
      (Number(b[1]) || 0) - (Number(a[1]) || 0) ||
      (Number(b[2]) || 0) - (Number(a[2]) || 0)
  );

  leaderboardRange.setValues(values);
  return values;
}

function summarizeRows(rows) {
  let newCount = 0,
    usedCount = 0,
    tradeCount = 0;
  rows.forEach((row) => {
    const newFi =
      row.length > 2
        ? String(row[2] || '')
          .trim()
          .toUpperCase()
        : '';
    const usedFi =
      row.length > 9
        ? String(row[9] || '')
          .trim()
          .toUpperCase()
        : '';
    const newHasContent =
      row.length > 1 &&
      row
        .slice(1, Math.min(7, row.length))
        .some((val) => val && String(val).trim() !== '');
    const usedHasContent =
      row.length > 8 &&
      row
        .slice(8, Math.min(14, row.length))
        .some((val) => val && String(val).trim() !== '');
    let newDelivered = isValidFIFlag(newFi) && newHasContent;
    let usedDelivered = isValidFIFlag(usedFi) && usedHasContent;
    if (newDelivered) {
      newCount++;
      const tradeNew =
        row.length > 5
          ? String(row[5] || '')
            .trim()
            .toUpperCase()
          : '';
      if (tradeNew && tradeNew !== 'NT') tradeCount++;
    }
    if (usedDelivered) {
      usedCount++;
      const tradeUsed =
        row.length > 12
          ? String(row[12] || '')
            .trim()
            .toUpperCase()
          : '';
      if (tradeUsed && tradeUsed !== 'NT') tradeCount++;
    }
  });
  return { newCount, usedCount, tradeCount };
}

function parseTradeStocksDetailed(cellValue) {
  const raw = String(cellValue == null ? '' : cellValue).trim();
  if (!raw) return { valid: [], invalid: [] };

  const upper = raw.toUpperCase();
  if (upper === 'NT') return { valid: [], invalid: [] };

  // Convert any non-alphanumeric separators to spaces, then extract tokens.
  // This handles commas, slashes, ampersands, newlines, and plain spaces.
  const cleaned = upper.replace(/[^A-Z0-9]+/g, ' ');
  const tokens = cleaned.match(/[A-Z0-9]+/g) || [];

  const validSet = new Set();
  const invalidSet = new Set();

  tokens.forEach((token) => {
    const t = String(token || '').trim();
    if (!t) return;
    if (t.length === 8) {
      validSet.add(t);
      return;
    }
    // If it looks like an attempted stock number, track it as invalid so we can flag it.
    if (t.length >= 4 && t.length <= 12) {
      invalidSet.add(t);
    }
  });

  return {
    valid: Array.from(validSet),
    invalid: Array.from(invalidSet),
  };
}

function parseTradeStocks(cellValue) {
  return parseTradeStocksDetailed(cellValue).valid;
}

function normalizeDealDateIso_(dealDateDisplay) {
  if (!dealDateDisplay) return '';
  if (dealDateDisplay instanceof Date && !isNaN(dealDateDisplay.getTime())) {
    return Utilities.formatDate(
      dealDateDisplay,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  const raw = String(dealDateDisplay || '').trim();
  if (!raw) return '';

  let year;
  let month;
  let day;
  let match = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
    if (match) {
      month = Number(match[1]);
      day = Number(match[2]);
      if (match[3]) {
        year = Number(match[3]);
        if (year < 100) year += 2000;
      } else {
        const now = new Date();
        year = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        if (month > currentMonth) year -= 1;
      }
    }
  }

  if (year && month && day) {
    const parsed = new Date(year, month - 1, day);
    if (!isNaN(parsed.getTime())) {
      return Utilities.formatDate(
        parsed,
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
    }
  }

  const fallback = new Date(raw);
  if (!isNaN(fallback.getTime())) {
    return Utilities.formatDate(
      fallback,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  return '';
}

function formatReconDealDate_(dealDateDisplay, dateISO) {
  const normalizedIso = dateISO || normalizeDealDateIso_(dealDateDisplay);
  if (!normalizedIso) return '';
  const parts = normalizedIso.split('-');
  if (parts.length !== 3) return '';
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return '';
  const dateObj = new Date(year, month - 1, day);
  if (isNaN(dateObj.getTime())) return '';
  return Utilities.formatDate(
    dateObj,
    Session.getScriptTimeZone(),
    'EEE MMM dd yyyy'
  );
}

function normalizeHeader_(header) {
  return _normalizeHeaderImpl_(header);
}

function _normalizeHeaderImpl_(header) {
  return String(header == null ? '' : header)
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getHeaderMap_(sheet, headerRow) {
  const rowIndex = headerRow || 1;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};

  const headerValues =
    sheet.getRange(rowIndex, 1, 1, lastCol).getDisplayValues()[0] || [];

  const headerMap = {};

  // Deterministic mapping: normalized header -> 1-based column index.
  // We intentionally overwrite on duplicates so the *last* occurrence wins.
  for (let i = 0; i < headerValues.length; i++) {
    const normalized = _normalizeHeaderImpl_(headerValues[i]);
    if (!normalized) continue;
    const col = i + 1;
    headerMap[normalized] = col;
  }

  // Final sanity: remove any impossible values (should never happen, but keeps callers safe).
  Object.keys(headerMap).forEach((k) => {
    const v = Number(headerMap[k]);
    if (!v || v < 1) delete headerMap[k];
    else headerMap[k] = v;
  });

  return headerMap;
}

function findReconHeaderRow_(sheet, requiredHeaders) {
  const required = (requiredHeaders || []).map((h) => normalizeHeader_(h)).filter(Boolean);
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return 1;

  // Scan first few rows to find the row that contains the most required headers.
  const maxScanRows = Math.min(10, sheet.getLastRow() || 10);
  let bestRow = 1;
  let bestScore = -1;

  for (let r = 1; r <= maxScanRows; r++) {
    const rowValues = sheet.getRange(r, 1, 1, lastCol).getDisplayValues()[0] || [];
    const rowSet = new Set(rowValues.map((v) => normalizeHeader_(v)).filter(Boolean));
    let score = 0;
    required.forEach((h) => {
      if (rowSet.has(h)) score++;
    });
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
      if (bestScore === required.length) break; // perfect match
    }
  }

  return bestRow;
}

function getRequiredCol_(headerMap, headerName) {
  if (!headerMap || typeof headerMap !== 'object') {
    throw new Error(`Missing required column: ${headerName}. Header map not available.`);
  }

  const normalized = _normalizeHeaderImpl_(headerName);
  const compact = normalized.replace(/[^a-z0-9]/g, '');

  // 1) Fast path: direct key lookup.
  if (Object.prototype.hasOwnProperty.call(headerMap, normalized)) {
    const direct = Number(headerMap[normalized]);
    if (direct && direct >= 1) return direct;
  }

  // 2) Robust path: iterate keys and compare normalized forms.
  // This defends against hidden/unusual whitespace or unicode edge cases.
  let matchedKey = null;
  const keys = Object.keys(headerMap);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!k) continue;
    const kn = _normalizeHeaderImpl_(k);
    if (kn === normalized) {
      matchedKey = k;
      break;
    }
  }

  // 3) Fallback: compact comparison (ignores spaces/punctuation).
  if (!matchedKey) {
    matchedKey = keys.find((k) => {
      const kn = _normalizeHeaderImpl_(k);
      return kn && kn.replace(/[^a-z0-9]/g, '') === compact;
    });
  }

  const colIndex = matchedKey ? Number(headerMap[matchedKey]) : 0;
  if (!colIndex || colIndex < 1) {
    const keysPreview = keys.slice(0, 50).join(', ');
    const message = `Missing required column: ${headerName}. Available normalized headers: ${keysPreview}`;
    logWarning('getRequiredCol_', message, {
      headerName,
      normalized,
      compact,
      matchedKey: matchedKey || null,
    });
    throw new Error(message);
  }

  return colIndex;
}

function normalizeSourceKey_(value) {
  return String(value == null ? '' : value)
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

function detectSourceKeyCol_(sheet, lastRow, lastCol, headerMap) {
  const headerMappedCol = headerMap[normalizeHeader_(RECON_SOURCEKEY_HEADER)] || 0;
  const sheetId = sheet.getSheetId();
  const props = PropertiesService.getScriptProperties();
  const keyPattern = /^\d{4}-\d{2}-\d{2}\|[A-Z0-9]{8}$/;
  const sampleLimit = Math.min(lastRow, 200);
  const scanLimit = Math.min(lastRow, 250);
  const sampleRowCount = Math.max(0, sampleLimit - 1);
  const scanRowCount = Math.max(0, scanLimit - 1);

  const matchesSampleThreshold_ = (matchCount, nonEmptyCount) => {
    if (matchCount >= 10) return true;
    return nonEmptyCount > 0 && matchCount / nonEmptyCount >= 0.2;
  };

  const sampleColumn_ = (colIndex) => {
    if (!colIndex || colIndex < 1 || colIndex > lastCol || sampleRowCount < 1) {
      return { matches: 0, nonEmpty: 0 };
    }
    const values = sheet
      .getRange(2, colIndex, sampleRowCount, 1)
      .getDisplayValues();
    let matches = 0;
    let nonEmpty = 0;
    for (let i = 0; i < values.length; i++) {
      const raw = String(values[i][0] == null ? '' : values[i][0]).trim();
      if (raw) nonEmpty++;
      const normalized = normalizeSourceKey_(raw);
      if (normalized && keyPattern.test(normalized)) matches++;
    }
    return { matches: matches, nonEmpty: nonEmpty };
  };

  if (lastRow < 2) {
    if (headerMappedCol) return headerMappedCol;
    throw new Error(
      `Unable to detect SourceKey column: ${sheet.getName()} has no data rows.`
    );
  }

  const cachedStr = props.getProperty(RECON_SOURCEKEY_COL_CACHE_KEY);
  if (cachedStr) {
    try {
      const cached = JSON.parse(cachedStr);
      if (cached && cached.sheetId === sheetId) {
        const cachedCol = Number(cached.col);
        const cachedSample = sampleColumn_(cachedCol);
        if (matchesSampleThreshold_(cachedSample.matches, cachedSample.nonEmpty)) {
          Logger.log(
            `Detected SourceKey column = ${cachedCol} (matches=${cachedSample.matches}, headerMapped=${headerMappedCol}).`
          );
          return cachedCol;
        }
      }
    } catch (e) {
      Logger.log('detectSourceKeyCol_: cache parse failed: ' + e);
    }
  }

  if (headerMappedCol) {
    const headerSample = sampleColumn_(headerMappedCol);
    if (matchesSampleThreshold_(headerSample.matches, headerSample.nonEmpty)) {
      props.setProperty(
        RECON_SOURCEKEY_COL_CACHE_KEY,
        JSON.stringify({ col: headerMappedCol, sheetId: sheetId, ts: Date.now() })
      );
      Logger.log(
        `Detected SourceKey column = ${headerMappedCol} (matches=${headerSample.matches}, headerMapped=${headerMappedCol}).`
      );
      return headerMappedCol;
    }
  }

  if (scanRowCount < 1 || lastCol < 1) {
    throw new Error(
      `Unable to detect SourceKey column: ${sheet.getName()} has no scannable data.`
    );
  }

  const allValues = sheet.getRange(2, 1, scanRowCount, lastCol).getDisplayValues();
  let bestCol = 0;
  let bestMatches = 0;
  for (let c = 0; c < lastCol; c++) {
    let matches = 0;
    for (let r = 0; r < scanRowCount; r++) {
      const raw = String(allValues[r][c] == null ? '' : allValues[r][c]).trim();
      if (!raw) continue;
      const normalized = normalizeSourceKey_(raw);
      if (normalized && keyPattern.test(normalized)) matches++;
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestCol = c + 1;
    }
  }

  if (!bestCol || bestMatches <= 0) {
    throw new Error(
      `Unable to detect SourceKey column in ${sheet.getName()}: no matching keys found.`
    );
  }

  props.setProperty(
    RECON_SOURCEKEY_COL_CACHE_KEY,
    JSON.stringify({ col: bestCol, sheetId: sheetId, ts: Date.now() })
  );
  Logger.log(
    `Detected SourceKey column = ${bestCol} (matches=${bestMatches}, headerMapped=${headerMappedCol}).`
  );
  return bestCol;
}

function getReconSheet_(spreadsheet) {
  const direct = spreadsheet.getSheetByName(RECON_SHEET_NAME);
  if (direct) return direct;
  const targetName = normalizeHeader_(RECON_SHEET_NAME);
  return spreadsheet
    .getSheets()
    .find((sheet) => normalizeHeader_(sheet.getName()) === targetName);
}

function buildTradeExportCandidatesFromRow_(row, dealDateDisplay, side) {
  const result = [];
  const fiFlag =
    row.length > side.fiIdx
      ? String(row[side.fiIdx] || '')
        .trim()
        .toUpperCase()
      : '';
  if (!isValidFIFlag(fiFlag)) return result;

  const tradeCell = row.length > side.tradeIdx ? row[side.tradeIdx] : '';
  const tradeRaw = String(tradeCell || '').trim();
  if (!tradeRaw || tradeRaw.toUpperCase() === 'NT') return result;

  const parsedStocks = parseTradeStocksDetailed(tradeRaw);
  if (!parsedStocks.valid.length && !parsedStocks.invalid.length) return result;

  const dateISO = normalizeDealDateIso_(dealDateDisplay);
  if (!dateISO) return result;

  const salesperson =
    row.length > side.salesIdx ? String(row[side.salesIdx] || '').trim() : '';
  const dateDisplay = String(dealDateDisplay || '').trim();
  parsedStocks.valid.forEach((stock) => {
    result.push({
      dateISO: dateISO,
      dateDisplay: dateDisplay,
      stock: stock,
      salesperson: salesperson,
      key: `${dateISO}|${stock}`,
    });
  });
  parsedStocks.invalid.forEach((token) => {
    result.push({
      dateISO: dateISO,
      dateDisplay: dateDisplay,
      stock: token,
      salesperson: salesperson,
      notes: `INVALID STOCK LENGTH: ${token}`,
      key: `${dateISO}|INVALID|${token}`,
      isInvalid: true,
    });
  });
  return result;
}

function rowHasSalesActivity_(row) {
  if (!row || !row.length) return false;
  const hasNewActivity =
    row.length > 1 &&
    row
      .slice(1, Math.min(7, row.length))
      .some((val) => val && String(val).trim() !== '');
  const hasUsedActivity =
    row.length > 8 &&
    row
      .slice(8, Math.min(14, row.length))
      .some((val) => val && String(val).trim() !== '');
  return hasNewActivity || hasUsedActivity;
}

function sideHasActivity_(row, side) {
  if (!row || !row.length) return false;
  const endIdx = Math.min(side.dataEndIdx, row.length);
  if (endIdx <= side.dataStartIdx) return false;
  return row
    .slice(side.dataStartIdx, endIdx)
    .some((val) => val && String(val).trim() !== '');
}

function collectMonthlyRowsWithDates_(monthlySheet) {
  const lastRowMonthly = monthlySheet.getLastRow();
  const maxColsMonthly = monthlySheet.getMaxColumns();
  if (lastRowMonthly < 2) return [];

  const allMonthlyContent = monthlySheet
    .getRange(1, 1, lastRowMonthly, maxColsMonthly)
    .getValues();
  const mergedRanges = monthlySheet
    .getRange(1, 1, lastRowMonthly, 1)
    .getMergedRanges();
  const dateHeaderRows = mergedRanges
    .filter(
      (mr) => mr.getRow() > 0 && mr.getColumn() === 1 && mr.getWidth() >= 14
    )
    .map((mr) => mr.getRow())
    .sort((a, b) => a - b);

  const rowsWithDates = [];
  if (!dateHeaderRows.length) {
    Logger.log(
      'exportTradesToReconLog: No distinct date headers found in MONTHLY.'
    );
    return rowsWithDates;
  }

  for (let i = 0; i < dateHeaderRows.length; i++) {
    const headerRow = dateHeaderRows[i];
    const headerValue = allMonthlyContent[headerRow - 1]
      ? allMonthlyContent[headerRow - 1][0]
      : '';
    const dateDisplay = String(headerValue || '').trim();
    const startRow = headerRow + 1;
    const endRow =
      i + 1 < dateHeaderRows.length
        ? dateHeaderRows[i + 1] - 1
        : lastRowMonthly;

    for (let rowNum = startRow; rowNum <= endRow; rowNum++) {
      const rowValues = allMonthlyContent[rowNum - 1];
      if (!rowHasSalesActivity_(rowValues)) continue;
      rowsWithDates.push({ row: rowValues, dateDisplay: dateDisplay });
    }
  }

  return rowsWithDates;
}

const RECON_LOCK_CAPABILITY = Object.freeze({});

function appendTradesToRecon_(candidates, options, lockCapability) {
  const opts = options || {};
  const dryRun = !!opts.dryRun;
  if (!candidates || !candidates.length) {
    return {
      appended: 0,
      skippedDuplicates: 0,
      invalidAppended: 0,
      invalidSkippedDuplicates: 0,
      totalCandidates: 0,
    };
  }

  const reconSS = SpreadsheetApp.openById(RECON_SPREADSHEET_ID);
  const reconSheet = getReconSheet_(reconSS);
  if (!reconSheet) {
    throw new Error(`Missing destination sheet: ${RECON_SHEET_NAME}`);
  }

  const lastRow = reconSheet.getLastRow();
  const lastCol = reconSheet.getLastColumn();

  // Header row can move (service may insert rows / rename sections). Detect it dynamically.
  const headerRow = findReconHeaderRow_(reconSheet, [
    'Deal Date',
    'Stock #',
    'Salesperson',
    'Location',
    RECON_SOURCEKEY_HEADER,
  ]);
  const headers = reconSheet
    .getRange(headerRow, 1, 1, lastCol)
    .getDisplayValues()[0] || [];
  const headerMap = getHeaderMap_(reconSheet, headerRow);

  const sourceKeyCol = detectSourceKeyCol_(
    reconSheet,
    lastRow,
    lastCol,
    headerMap
  );
  // ImportedAt is optional; do not warn if the destination sheet doesn't use it.
  const hasImportedAt = !!headerMap[normalizeHeader_(RECON_IMPORTEDAT_HEADER)];

  // Debug log: print the detected header row and visible headers in that row.
  try {
    Logger.log('appendTradesToRecon_: detected headerRow=' + headerRow + ' headers=' + JSON.stringify(headers));
  } catch (e) {
    Logger.log('appendTradesToRecon_: header preview failed: ' + e);
  }


  // Resolve required destination columns by header name (robust to column moves).
  function findHeaderCol_(headers, label) {
    const target = String(label).trim().toLowerCase();
    for (let i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim().toLowerCase() === target) {
        return i + 1; // 1-based
      }
    }
    return 0;
  }

  function requireHeaderCol_(headers, label) {
    const col = findHeaderCol_(headers, label);
    if (!col) throw new Error(`Missing required column: ${label}`);
    return col;
  }

  const dealDateCol     = requireHeaderCol_(headers, 'Deal Date');
  const stockCol        = findHeaderCol_(headers, 'Stock #');
  const salespersonCol  = requireHeaderCol_(headers, 'Salesperson');
  const locationCol     = requireHeaderCol_(headers, 'Location');
  const notesCol        = 0;
  if (!stockCol) throw new Error('Missing required column: Stock #');

  // If headerMap says SourceKey is a different column than our detected sourceKeyCol, prefer detection.
  // (Detection is based on actual key pattern in the data.)
  const runSection = (shouldWrite) => {
    // Re-read under the lock (or at call time for dry runs) so rows appended by a
    // concurrent export during setup are visible to both scans below.
    const lockedLastRow = reconSheet.getLastRow();
    const existingKeys = new Set();

    // Read SourceKey column as the primary source of truth.
    let keyValues = [];
    if (lockedLastRow >= 2) {
      keyValues = reconSheet.getRange(2, sourceKeyCol, lockedLastRow - 1, 1).getValues();
      keyValues.forEach((row) => {
        const key = normalizeSourceKey_(row[0]);
        if (key) existingKeys.add(key);
      });
    }

    // Scan the full used range of the Stock column (bounded by the sheet's actual
    // last row, not an arbitrary cap) so real data past row 3,000 is never
    // mistaken for an empty sheet and overwritten.
    let lastDataRow = 0;
    if (lockedLastRow >= 2) {
      const stockValues = reconSheet
        .getRange(2, stockCol, lockedLastRow - 1, 1)
        .getDisplayValues();
      for (let i = stockValues.length - 1; i >= 0; i--) {
        if (String(stockValues[i][0]).trim()) {
          lastDataRow = i + 2;
          break;
        }
      }
    }
    const appendRow = lastDataRow ? lastDataRow + 1 : headerRow + 1;
    Logger.log(
      'appendTradesToRecon_: stockCol=' +
        stockCol +
        ' appendRow=' +
        appendRow +
        ' lastDataRow=' +
        lastDataRow +
        ' headerRow=' +
        headerRow
    );

    const rowsToAppend = [];
    let skippedDuplicates = 0;
    let invalidSkippedDuplicates = 0;
    let invalidAppended = 0;
    const importedAt = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );
    candidates.forEach((candidate) => {
      const key = normalizeSourceKey_(candidate && candidate.key);
      const isInvalid = !!(candidate && candidate.isInvalid);
      if (!key || existingKeys.has(key)) {
        skippedDuplicates++;
        if (isInvalid) invalidSkippedDuplicates++;
        return;
      }
      existingKeys.add(key);
      if (isInvalid) invalidAppended++;

      const notes = candidate && candidate.notes ? String(candidate.notes) : '';

      // Deal date formatting for recon sheet (no time / timezone).
      const reconDateDisplay =
        formatReconDealDate_(candidate.dateDisplay, candidate.dateISO) ||
        candidate.dateISO ||
        '';

      const rowValues = new Array(lastCol).fill('');

      // Always write SourceKey to the detected SourceKey column.
      rowValues[sourceKeyCol - 1] = key;

      // Write required fields by resolved header columns.
      rowValues[dealDateCol - 1] = reconDateDisplay;
      rowValues[stockCol - 1] = candidate.stock || '';
      rowValues[salespersonCol - 1] = candidate.salesperson || '';

      // Default location for all imported rows.
      rowValues[locationCol - 1] = 'Plant City';

      // Notes is optional.
      if (notesCol) rowValues[notesCol - 1] = notes;

      // ImportedAt is optional.
      if (hasImportedAt) {
        const importedAtCol = headerMap[normalizeHeader_(RECON_IMPORTEDAT_HEADER)];
        if (importedAtCol) rowValues[importedAtCol - 1] = importedAt;
      }

      rowsToAppend.push(rowValues);
    });

    if (rowsToAppend.length && shouldWrite) {
      reconSheet
        .getRange(appendRow, 1, rowsToAppend.length, lastCol)
        .setValues(rowsToAppend);
      try {
        const sourceKeyColToHide = sourceKeyCol;
        const importedAtColToHide =
          headerMap[normalizeHeader_(RECON_IMPORTEDAT_HEADER)];
        if (sourceKeyColToHide && importedAtColToHide) {
          if (Math.abs(sourceKeyColToHide - importedAtColToHide) === 1) {
            reconSheet.hideColumns(
              Math.min(sourceKeyColToHide, importedAtColToHide),
              2
            );
          } else {
            reconSheet.hideColumns(sourceKeyColToHide);
            reconSheet.hideColumns(importedAtColToHide);
          }
        } else if (sourceKeyColToHide) {
          reconSheet.hideColumns(sourceKeyColToHide);
        } else if (importedAtColToHide) {
          reconSheet.hideColumns(importedAtColToHide);
        }
      } catch (e) {
        logWarning('appendTradesToRecon_', 'Column hide failed; continuing.', {
          error: String(e),
        });
      }
    }

    return {
      appended: rowsToAppend.length,
      skippedDuplicates: skippedDuplicates,
      invalidAppended: invalidAppended,
      invalidSkippedDuplicates: invalidSkippedDuplicates,
      totalCandidates: candidates.length,
    };
  };

  if (dryRun) {
    return runSection(false);
  }
  if (lockCapability === RECON_LOCK_CAPABILITY) {
    return runSection(true);
  }
  return withScriptLock(() => runSection(true));
}

function exportTradesToReconLog(options) {
  return exportTradesToReconLog_(options);
}

function exportTradesToReconLog_(options, lockCapability) {
  const opts = options || {};
  const dryRun = !!opts.dryRun;
  const sideDefs = [
    { fiIdx: 2, tradeIdx: 5, salesIdx: 6, dataStartIdx: 1, dataEndIdx: 7 },
    { fiIdx: 9, tradeIdx: 12, salesIdx: 13, dataStartIdx: 8, dataEndIdx: 14 },
  ];

  let rowsWithDates = [];
  if (opts.rows && opts.dealDateDisplay) {
    rowsWithDates = (opts.rows || []).map((row) => ({
      row: row,
      dateDisplay: opts.dealDateDisplay,
    }));
  } else if (opts.scanMonthly) {
    const sheets = getSheets();
    rowsWithDates = collectMonthlyRowsWithDates_(sheets.monthly);
  } else {
    Logger.log(
      'exportTradesToReconLog: No rows provided and scanMonthly not set.'
    );
    return null;
  }

  let scannedRows = 0;
  let candidateTrades = 0;
  let invalidTokensFound = 0;
  let skippedInvalid = 0;
  const candidates = [];

  rowsWithDates.forEach((entry) => {
    const row = entry.row || [];
    const dealDateDisplay = entry.dateDisplay;
    if (!rowHasSalesActivity_(row)) return;
    scannedRows++;
    sideDefs.forEach((side) => {
      if (!sideHasActivity_(row, side)) return;
      const sideCandidates = buildTradeExportCandidatesFromRow_(
        row,
        dealDateDisplay,
        side
      );
      if (sideCandidates.length) {
        const invalidCount = sideCandidates.reduce(
          (count, candidate) => (candidate && candidate.isInvalid ? count + 1 : count),
          0
        );
        candidateTrades += sideCandidates.length - invalidCount;
        invalidTokensFound += invalidCount;
        candidates.push(...sideCandidates);
      } else {
        skippedInvalid++;
      }
    });
  });

  const appendResult = appendTradesToRecon_(candidates, {
    dryRun: dryRun,
  }, lockCapability);
  Logger.log(
    [
      'exportTradesToReconLog summary:',
      `scanned rows: ${scannedRows}`,
      `candidate trades: ${candidateTrades}`,
      `invalid tokens found: ${invalidTokensFound}`,
      `appended: ${appendResult.appended || 0}`,
      `skipped duplicates: ${appendResult.skippedDuplicates || 0}`,
      `invalid rows appended: ${appendResult.invalidAppended || 0}`,
      `invalid rows skipped duplicates: ${
        appendResult.invalidSkippedDuplicates || 0
      }`,
      `skipped invalid/not delivered/no trade: ${skippedInvalid}`,
    ].join(' ')
  );

  return {
    scannedRows: scannedRows,
    candidateTrades: candidateTrades,
    invalidTokensFound: invalidTokensFound,
    appended: appendResult.appended || 0,
    skippedDuplicates: appendResult.skippedDuplicates || 0,
    invalidRowsAppended: appendResult.invalidAppended || 0,
    invalidRowsSkippedDuplicates: appendResult.invalidSkippedDuplicates || 0,
    skippedInvalid: skippedInvalid,
    dryRun: dryRun,
  };
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
  const fiFlag =
    rowData.length > fiIndex
      ? String(rowData[fiIndex] || '')
        .trim()
        .toUpperCase()
      : '';
  const salespersonInput =
    rowData.length > salespersonIndex
      ? String(rowData[salespersonIndex] || '').trim()
      : '';
  const isDelivered = isValidFIFlag(fiFlag);
  const hasData =
    rowData.length > dataStartIndex &&
    rowData
      .slice(dataStartIndex, dataEndIndex)
      .some((cell) => cell && String(cell).trim() !== '');

  if (hasData && !isDelivered) {
    // Non-delivered deal with data: highlight entire section (except trade column at index 4)
    applyNonDeliveredHighlight(sectionBgRow, nonDeliveredColor);
  } else if (isDelivered) {
    // Delivered deal: clear non-delivered highlights and check salesperson
    clearNonDeliveredHighlight(
      sectionBgRow,
      originalBackgroundRow,
      nonDeliveredColorUpper
    );
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
    clearAllHighlights(
      sectionBgRow,
      originalBackgroundRow,
      nonDeliveredColorUpper,
      salespersonErrorColorUpper
    );
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
    if (k !== 4) {
      // Skip trade column (index 4)
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
function clearNonDeliveredHighlight(
  sectionBgRow,
  originalBackgroundRow,
  nonDeliveredColorUpper
) {
  for (let k = 0; k < 6; k++) {
    if (
      k !== 4 &&
      originalBackgroundRow[k] &&
      originalBackgroundRow[k].toUpperCase() === nonDeliveredColorUpper
    ) {
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

  const salespersonParts = salespersonInput
    .split('/')
    .map((s) => s.trim().toUpperCase());
  const hasError = salespersonParts.some((part) => part && !aliasMap[part]);

  if (hasError) {
    sectionBgRow[5] = salespersonErrorColor; // Salesperson column is at index 5
    return true;
  } else if (
    originalBackgroundRow[5] &&
    originalBackgroundRow[5].toUpperCase() === salespersonErrorColorUpper
  ) {
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
function clearAllHighlights(
  sectionBgRow,
  originalBackgroundRow,
  nonDeliveredColorUpper,
  salespersonErrorColorUpper
) {
  for (let k = 0; k < 6; k++) {
    if (
      k !== 4 &&
      originalBackgroundRow[k] &&
      originalBackgroundRow[k].toUpperCase() === nonDeliveredColorUpper
    ) {
      sectionBgRow[k] = null;
    }
  }

  if (
    originalBackgroundRow[5] &&
    originalBackgroundRow[5].toUpperCase() === salespersonErrorColorUpper
  ) {
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

  const originalBackgroundsNew = sheet
    .getRange(startSheetRow, 2, numRows, 6)
    .getBackgrounds(); // B:G
  const originalBackgroundsUsed = sheet
    .getRange(startSheetRow, 9, numRows, 6)
    .getBackgrounds(); // I:N

  const backgroundsNewSection = [];
  const backgroundsUsedSection = [];

  for (let i = 0; i < numRows; i++) {
    const rowData = rowsData[i];
    const currentRowInSheet = startSheetRow + i;

    // Process New Car Section (columns B-G, indices 1-6)
    const newResult = processCarSection(
      rowData,
      originalBackgroundsNew[i],
      2, // FI column index
      6, // Salesperson column index
      1, // Data start index
      7, // Data end index
      aliasMap,
      NON_DELIVERED_COLOR,
      NON_DELIVERED_COLOR_UPPER,
      SALESPERSON_ERROR_COLOR,
      SALESPERSON_ERROR_COLOR_UPPER
    );
    backgroundsNewSection.push(newResult.backgroundRow);
    if (
      newResult.hasSalespersonError &&
      !salespersonErrorSheetRows.includes(currentRowInSheet)
    ) {
      salespersonErrorSheetRows.push(currentRowInSheet);
    }

    // Process Used Car Section (columns I-N, indices 8-13)
    const usedResult = processCarSection(
      rowData,
      originalBackgroundsUsed[i],
      9, // FI column index
      13, // Salesperson column index
      8, // Data start index
      14, // Data end index
      aliasMap,
      NON_DELIVERED_COLOR,
      NON_DELIVERED_COLOR_UPPER,
      SALESPERSON_ERROR_COLOR,
      SALESPERSON_ERROR_COLOR_UPPER
    );
    backgroundsUsedSection.push(usedResult.backgroundRow);
    if (
      usedResult.hasSalespersonError &&
      !salespersonErrorSheetRows.includes(currentRowInSheet)
    ) {
      salespersonErrorSheetRows.push(currentRowInSheet);
    }
  }

  // Apply all backgrounds at once
  if (numRows > 0) {
    sheet
      .getRange(startSheetRow, 2, numRows, 6)
      .setBackgrounds(backgroundsNewSection); // Columns B:G
    sheet
      .getRange(startSheetRow, 9, numRows, 6)
      .setBackgrounds(backgroundsUsedSection); // Columns I:N
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
    const chunkValues = sheet
      .getRange(chunkStart, startCol, chunkSize, numCols)
      .getValues();

    // Search backwards through the chunk for data
    for (let i = chunkValues.length - 1; i >= 0; i--) {
      // Check if any cell in the current row has content
      if (
        chunkValues[i].some(
          (cell) => cell !== '' && cell !== null && cell !== undefined
        )
      ) {
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
 * @param {number} startTime - Execution start timestamp, including lock wait
 * @returns {Object} Manager with checkTime() and getElapsed() methods
 */
function createTimeoutManager(thresholdMinutes = 5.0, startTime = Date.now()) {
  const thresholdMs = thresholdMinutes * 60 * 1000;

  return {
    /**
     * Checks if threshold has been exceeded
     * @param {string} operation - Description of current operation for logging
     * @returns {boolean} true if OK to continue, false if threshold exceeded
     */
    checkTime: function (operation) {
      const elapsed = Date.now() - startTime;
      if (elapsed > thresholdMs) {
        Logger.log(
          `⏱️ Timeout threshold (${thresholdMinutes}m) exceeded after ${(
            elapsed / 1000
          ).toFixed(1)}s during: ${operation}`
        );
        return false;
      }
      Logger.log(
        `✓ Time check OK: ${(elapsed / 1000).toFixed(
          1
        )}s elapsed at: ${operation}`
      );
      return true;
    },

    /**
     * Gets elapsed time in seconds
     * @returns {number} Seconds elapsed since creation
     */
    getElapsed: function () {
      return (Date.now() - startTime) / 1000;
    },
  };
}

// ============================================================================
// CHECKPOINT & RECOVERY SYSTEM
// ============================================================================

/**
 * Checkpoint state machine for resumable, idempotent processDaily() operations.
 */

const CHECKPOINT_KEY = 'DAILY_OPERATION_CHECKPOINT';
const CHECKPOINT_VERSION = 2;
const CHECKPOINT_STALE_HOURS = 24;
const DAILY_OPERATION_NOTE_PREFIX = 'DAILY_OPERATION:';

/**
 * Creates a checkpoint before modifying MONTHLY sheet
 * @param {Object} operationData - Data about the operation being performed
 */
function createOperationCheckpoint(operationData) {
  try {
    const dateIso =
      operationData.dateIso || normalizeDealDateIso_(operationData.dateStr);
    const dataHash = generateDataHash(operationData.rows);
    if (
      !dateIso ||
      !operationData.rowCount ||
      !dataHash ||
      !Array.isArray(operationData.sourceRows) ||
      operationData.sourceRows.length !== operationData.rowCount ||
      !Number.isInteger(operationData.monthlySheetId)
    ) {
      throw new Error('Checkpoint identity is incomplete.');
    }
    const checkpoint = {
      version: CHECKPOINT_VERSION,
      timestamp: new Date().toISOString(),
      dateProcessed: operationData.dateStr,
      dateIso: dateIso,
      rowCount: operationData.rowCount,
      status: 'STARTED',
      phase: 'PRE_MONTHLY_WRITE',
      dataHash: dataHash,
      operationId: Utilities.getUuid(),
      sourceRows: operationData.sourceRows,
      monthlySheetId: operationData.monthlySheetId,
    };

    PropertiesService.getScriptProperties().setProperty(
      CHECKPOINT_KEY,
      JSON.stringify(checkpoint)
    );

    Logger.log(
      `✓ Checkpoint created for ${operationData.dateStr} (${operationData.rowCount} rows)`
    );
    return true;
  } catch (e) {
    Logger.log(`⚠️ Failed to create checkpoint: ${e.toString()}`);
    return false;
  }
}

/**
 * Updates checkpoint status as operation progresses
 * @param {string} phase - Current durable operation phase
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
    const checkpointStr =
      PropertiesService.getScriptProperties().getProperty(CHECKPOINT_KEY);
    if (!checkpointStr) return null;

    const checkpoint = JSON.parse(checkpointStr);

    // Never discard an unfinished operation automatically. Doing so could make a
    // later retry append the same MONTHLY block again.
    const checkpointAge = Date.now() - new Date(checkpoint.timestamp).getTime();
    const maxAge = CHECKPOINT_STALE_HOURS * 60 * 60 * 1000;

    if (checkpointAge > maxAge) {
      Logger.log(
        `⚠️ Checkpoint is ${(checkpointAge / 3600000).toFixed(
          1
        )}h old; retaining it for safe recovery`
      );
      checkpoint.isStale = true;
    }

    return checkpoint;
  } catch (e) {
    Logger.log(`⚠️ Failed to retrieve checkpoint: ${e.toString()}`);
    throw new Error('Unable to read the daily operation checkpoint safely.');
  }
}

function assertCheckpointMonthlySheet_(monthlySheet, checkpoint) {
  if (!checkpoint) return;

  const isLegacyCheckpoint = checkpoint.version === undefined;
  const isLegacyAnalyticsCheckpoint =
    isLegacyCheckpoint &&
    ['ANALYTICS_PENDING', 'ANALYTICS_FAILED'].includes(checkpoint.phase);
  if (isLegacyAnalyticsCheckpoint) {
    Logger.log(
      `⚠️ Resuming legacy analytics checkpoint in phase ${checkpoint.phase}; ` +
        'the previous checkpoint format did not record a MONTHLY sheet identity.'
    );
    return;
  }

  if (isLegacyCheckpoint) {
    throw new Error(
      `Legacy checkpoint in phase ${checkpoint.phase || 'unknown'} cannot be resumed automatically. ` +
        'Inspect TODAY and MONTHLY before resolving the checkpoint.'
    );
  }
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    throw new Error(
      `Checkpoint ${checkpoint.operationId || '(unknown)'} uses unsupported version ` +
        `${checkpoint.version} and cannot be resumed automatically.`
    );
  }
  if (!Number.isInteger(checkpoint.monthlySheetId)) {
    throw new Error(
      `Checkpoint ${checkpoint.operationId || '(unknown)'} is missing its MONTHLY sheet identity. ` +
        'Processing stopped without changing either sheet.'
    );
  }
  if (checkpoint.monthlySheetId !== monthlySheet.getSheetId()) {
    throw new Error(
      `Checkpoint ${checkpoint.operationId} belongs to a different MONTHLY sheet. ` +
        'Resolve the pending daily operation before month rollover.'
    );
  }
}

function normalizeDailyHashValue_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `date:${value.getTime()}`;
  }
  if (value === null || value === undefined || value === '') return 'blank:';
  return `${typeof value}:${String(value)}`;
}

/**
 * Generates a stable SHA-256 identity for daily business data in columns B:N.
 * Column A is excluded because processDaily renumbers it before MONTHLY insertion.
 * @param {Array<Array>} rows - Daily rows to identify
 * @returns {string} Lowercase hexadecimal SHA-256 digest
 */
function generateDataHash(rows) {
  const normalizedRows = (rows || []).map((row) => {
    const values = [];
    for (let columnIndex = 1; columnIndex < 14; columnIndex++) {
      values.push(normalizeDailyHashValue_(row[columnIndex]));
    }
    return values;
  });
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(normalizedRows),
    Utilities.Charset.UTF_8
  );
  return digest
    .map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Recreates the weak identity used by checkpoints written before version 2.
 * It is used only to prove that a legacy checkpoint, its saved MONTHLY block,
 * and the still-present TODAY rows describe the same old operation.
 * @param {Array<Array>} rows Legacy daily rows
 * @returns {string} Legacy row-count/JSON-slice identity
 */
function generateLegacyDataHash_(rows) {
  try {
    const data = rows || [];
    const firstRow = data[0] ? JSON.stringify(data[0]).slice(0, 50) : '';
    const lastRow = data[data.length - 1]
      ? JSON.stringify(data[data.length - 1]).slice(0, 50)
      : '';
    return `${data.length}|${firstRow}|${lastRow}`;
  } catch (e) {
    return 'hash_error';
  }
}

/**
 * Reads the exact block recorded by a legacy MONTHLY_WRITTEN checkpoint.
 * No search or best-effort matching is allowed: the saved coordinates, date,
 * merged header, row count, and exact tail position must all agree. The old
 * hash is checked against TODAY because the legacy writer rewrote MONTHLY A.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} monthlySheet MONTHLY sheet
 * @param {Object} checkpoint Legacy or in-progress adoption checkpoint
 * @param {string} expectedHeaderNote Marker allowed during adoption retry
 * @returns {{headerRow: number, dataInsertRow: number, rows: Array<Array>, headerNote: string}}
 */
function getLegacyMonthlyWrittenBlock_(
  monthlySheet,
  checkpoint,
  expectedHeaderNote = ''
) {
  const rowCount = Number(checkpoint && checkpoint.rowCount);
  const dataInsertRow = Number(checkpoint && checkpoint.monthlyInsertRow);
  const rowsInserted = Number(checkpoint && checkpoint.rowsInserted);
  if (
    !Number.isInteger(rowCount) ||
    rowCount < 1 ||
    !Number.isInteger(dataInsertRow) ||
    dataInsertRow < 2 ||
    rowsInserted !== rowCount
  ) {
    throw new Error(
      'Legacy MONTHLY_WRITTEN checkpoint is missing exact MONTHLY row coordinates.'
    );
  }

  const headerRow = dataInsertRow - 1;
  const requiredLastRow = dataInsertRow + rowCount - 1;
  if (requiredLastRow > monthlySheet.getMaxRows()) {
    throw new Error('Legacy checkpoint MONTHLY rows are outside the sheet bounds.');
  }
  if (findLastRowInCols(monthlySheet, 1, 14) !== requiredLastRow) {
    throw new Error(
      'Legacy checkpoint MONTHLY block is no longer the exact A:N tail block.'
    );
  }

  const headerRange = monthlySheet.getRange(headerRow, 1, 1, 14);
  const hasExactMergedHeader = headerRange.getMergedRanges().some(
    (range) =>
      range.getRow() === headerRow &&
      range.getColumn() === 1 &&
      range.getNumRows() === 1 &&
      range.getNumColumns() === 14
  );
  if (!hasExactMergedHeader) {
    throw new Error(
      `Legacy checkpoint row ${headerRow} is not the expected merged date header.`
    );
  }

  const checkpointDateIso =
    checkpoint.dateIso || normalizeDealDateIso_(checkpoint.dateProcessed);
  if (
    !checkpointDateIso ||
    normalizeDealDateIso_(headerRange.getValue()) !== checkpointDateIso
  ) {
    throw new Error(
      `Legacy checkpoint MONTHLY date header at row ${headerRow} does not match.`
    );
  }

  const headerNote = headerRange.getNotes()[0][0] || '';
  if (headerNote && headerNote !== expectedHeaderNote) {
    throw new Error(
      `Legacy checkpoint MONTHLY header row ${headerRow} has an unexpected note.`
    );
  }

  const rows = monthlySheet
    .getRange(dataInsertRow, 1, rowCount, 14)
    .getValues();
  if (rows.some((row) => !dailyRowHasActivity_(row))) {
    throw new Error('Legacy checkpoint MONTHLY block contains an empty sales row.');
  }

  return {
    headerRow: headerRow,
    dataInsertRow: dataInsertRow,
    rows: rows,
    headerNote: headerNote,
  };
}

/**
 * Maps every row in a verified legacy MONTHLY block to one unique unchanged
 * TODAY row. Rows with unrelated hashes are left outside the checkpoint so
 * newer sales remain untouched. Missing or duplicate matches fail closed.
 * @param {Array<Array>} allDailyData Current TODAY data range values
 * @param {number} dailyStartRow First sheet row represented by allDailyData
 * @param {Array<Array>} monthlyRows Verified legacy MONTHLY rows
 * @param {string} legacyDataHash Legacy checkpoint identity
 * @returns {{rows: Array<Array>, sourceRows: Array<Object>}}
 */
function matchLegacyMonthlyWrittenSourceRows_(
  allDailyData,
  dailyStartRow,
  monthlyRows,
  legacyDataHash
) {
  const candidatesByHash = new Map();
  (allDailyData || []).forEach((row, index) => {
    if (!dailyRowHasActivity_(row)) return;
    const rowHash = generateDataHash([row]);
    if (!candidatesByHash.has(rowHash)) candidatesByHash.set(rowHash, []);
    candidatesByHash.get(rowHash).push({
      row: [...row],
      sheetRow: dailyStartRow + index,
    });
  });

  const expectedCounts = new Map();
  monthlyRows.forEach((row) => {
    const rowHash = generateDataHash([row]);
    expectedCounts.set(rowHash, (expectedCounts.get(rowHash) || 0) + 1);
  });
  expectedCounts.forEach((expectedCount, rowHash) => {
    const candidateCount = (candidatesByHash.get(rowHash) || []).length;
    if (candidateCount !== expectedCount) {
      throw new Error(
        'Legacy MONTHLY_WRITTEN checkpoint cannot uniquely match its TODAY rows. ' +
          'No TODAY data was cleared.'
      );
    }
  });

  const nextCandidateIndex = new Map();
  const matchedRows = monthlyRows.map((monthlyRow) => {
    const rowHash = generateDataHash([monthlyRow]);
    const candidateIndex = nextCandidateIndex.get(rowHash) || 0;
    nextCandidateIndex.set(rowHash, candidateIndex + 1);
    return candidatesByHash.get(rowHash)[candidateIndex];
  });
  const rows = matchedRows.map((entry) => entry.row);
  if (generateLegacyDataHash_(rows) !== legacyDataHash) {
    throw new Error(
      'Legacy checkpoint hash does not match the uniquely selected TODAY rows.'
    );
  }
  if (generateDataHash(rows) !== generateDataHash(monthlyRows)) {
    throw new Error('Legacy TODAY and MONTHLY business data do not match.');
  }

  return {
    rows: rows,
    sourceRows: matchedRows.map((entry) => ({
      sheetRow: entry.sheetRow,
      dataHash: generateDataHash([entry.row]),
    })),
  };
}

/**
 * Persists a version-2 adoption checkpoint before adding any marker to a
 * previously written legacy block. This makes every later step retryable.
 * @param {Object} sheets Sales-log sheets
 * @param {Object} checkpoint Legacy MONTHLY_WRITTEN checkpoint
 * @returns {Object} Persisted adoption checkpoint
 */
function prepareLegacyMonthlyWrittenCheckpoint_(sheets, checkpoint) {
  if (
    !checkpoint ||
    checkpoint.version !== undefined ||
    checkpoint.phase !== 'MONTHLY_WRITTEN'
  ) {
    return checkpoint;
  }

  const block = getLegacyMonthlyWrittenBlock_(sheets.monthly, checkpoint, '');
  const dailyRange = sheets.today.getRange(RANGES.dailyData);
  const matchedSource = matchLegacyMonthlyWrittenSourceRows_(
    dailyRange.getValues(),
    dailyRange.getRow(),
    block.rows,
    checkpoint.dataHash
  );
  const operationId = Utilities.getUuid();
  const dateIso = normalizeDealDateIso_(checkpoint.dateProcessed);
  const adoptionData = {
    version: CHECKPOINT_VERSION,
    dateIso: dateIso,
    dataHash: generateDataHash(block.rows),
    operationId: operationId,
    sourceRows: matchedSource.sourceRows,
    monthlySheetId: sheets.monthly.getSheetId(),
    headerInsertRow: block.headerRow,
    monthlyInsertRow: block.dataInsertRow,
    rowsInserted: block.rows.length,
    legacyDataHash: checkpoint.dataHash,
    legacyPhase: checkpoint.phase,
  };
  if (!updateCheckpoint('LEGACY_ADOPTION_STARTED', adoptionData)) {
    throw new Error('Could not checkpoint the legacy MONTHLY block adoption.');
  }

  const preparedCheckpoint = getOperationCheckpoint();
  if (
    !preparedCheckpoint ||
    preparedCheckpoint.operationId !== operationId ||
    preparedCheckpoint.phase !== 'LEGACY_ADOPTION_STARTED'
  ) {
    throw new Error('Legacy MONTHLY block adoption checkpoint verification failed.');
  }
  Logger.log(
    `✓ Prepared legacy MONTHLY checkpoint adoption for rows ${block.dataInsertRow}-${
      block.dataInsertRow + block.rows.length - 1
    }.`
  );
  return preparedCheckpoint;
}

/**
 * Adds the version-2 marker to a verified legacy block and only then advances
 * it to MONTHLY_WRITTEN, where the normal idempotent resume path takes over.
 * @param {Object} sheets Sales-log sheets
 * @param {Object} checkpoint Version-2 adoption checkpoint
 * @returns {Object} Persisted MONTHLY_WRITTEN checkpoint
 */
function completeLegacyMonthlyWrittenCheckpoint_(sheets, checkpoint) {
  if (!checkpoint || checkpoint.phase !== 'LEGACY_ADOPTION_STARTED') {
    return checkpoint;
  }
  if (
    checkpoint.version !== CHECKPOINT_VERSION ||
    !checkpoint.operationId ||
    !checkpoint.dateIso ||
    !checkpoint.dataHash ||
    !checkpoint.legacyDataHash ||
    !Number.isInteger(checkpoint.rowCount) ||
    !Array.isArray(checkpoint.sourceRows) ||
    checkpoint.sourceRows.length !== checkpoint.rowCount
  ) {
    throw new Error('Legacy MONTHLY block adoption identity is incomplete.');
  }

  assertCheckpointMonthlySheet_(sheets.monthly, checkpoint);
  const expectedMarker = `${DAILY_OPERATION_NOTE_PREFIX}${checkpoint.operationId}`;
  const block = getLegacyMonthlyWrittenBlock_(
    sheets.monthly,
    checkpoint,
    expectedMarker
  );
  if (generateDataHash(block.rows) !== checkpoint.dataHash) {
    throw new Error('Adopted legacy MONTHLY block changed before marker recovery.');
  }

  const dailyRange = sheets.today.getRange(RANGES.dailyData);
  const matchedSource = matchLegacyMonthlyWrittenSourceRows_(
    dailyRange.getValues(),
    dailyRange.getRow(),
    block.rows,
    checkpoint.legacyDataHash
  );
  if (
    JSON.stringify(matchedSource.sourceRows) !==
    JSON.stringify(checkpoint.sourceRows)
  ) {
    throw new Error('Legacy TODAY row identities changed during checkpoint adoption.');
  }

  const headerRange = sheets.monthly.getRange(block.headerRow, 1, 1, 14);
  if (!block.headerNote) {
    headerRange.setNote(expectedMarker);
    SpreadsheetApp.flush();
  }
  const verifiedBlock = getLegacyMonthlyWrittenBlock_(
    sheets.monthly,
    checkpoint,
    expectedMarker
  );
  if (
    verifiedBlock.headerNote !== expectedMarker ||
    generateDataHash(verifiedBlock.rows) !== checkpoint.dataHash
  ) {
    throw new Error('Legacy MONTHLY block marker verification failed.');
  }

  if (
    !updateCheckpoint('MONTHLY_WRITTEN', {
      legacyAdoptedAt: new Date().toISOString(),
    })
  ) {
    throw new Error('Could not checkpoint the adopted legacy MONTHLY block.');
  }
  const completedCheckpoint = getOperationCheckpoint();
  if (
    !completedCheckpoint ||
    completedCheckpoint.operationId !== checkpoint.operationId ||
    completedCheckpoint.phase !== 'MONTHLY_WRITTEN'
  ) {
    throw new Error('Adopted legacy MONTHLY checkpoint verification failed.');
  }
  Logger.log(
    `✓ Adopted legacy MONTHLY block as operation ${checkpoint.operationId}.`
  );
  return completedCheckpoint;
}

function dailyCheckpointDateMatches_(value, checkpoint) {
  if (
    String(value == null ? '' : value).trim() ===
    String(checkpoint.dateProcessed || '').trim()
  ) {
    return true;
  }
  return normalizeDealDateIso_(value) === checkpoint.dateIso;
}

function findMonthlyCheckpointMarkerRows_(monthlySheet, checkpoint) {
  if (!checkpoint || !checkpoint.operationId) return [];
  const lastRow = findLastRowInCols(monthlySheet, 1, 14);
  if (lastRow < 1) return [];
  const expectedNote = `${DAILY_OPERATION_NOTE_PREFIX}${checkpoint.operationId}`;
  return monthlySheet
    .getRange(1, 1, lastRow, 1)
    .getNotes()
    .map((row, index) => (row[0] === expectedNote ? index + 1 : 0))
    .filter((row) => row > 0);
}

function dailyRowHasActivity_(row) {
  return (
    row.slice(1, 7).some((cell) => cell && String(cell).trim() !== '') ||
    row.slice(8, 14).some((cell) => cell && String(cell).trim() !== '')
  );
}

function selectCheckpointSourceRows_(
  allDailyData,
  allDailyFontColors,
  allDailyBackgrounds,
  dailyStartRow,
  checkpoint
) {
  if (!Array.isArray(checkpoint.sourceRows) || !checkpoint.sourceRows.length) {
    throw new Error('Checkpoint is missing TODAY row identities.');
  }

  const rows = [];
  const fontColors = [];
  const backgrounds = [];
  const conflicts = [];
  checkpoint.sourceRows.forEach((sourceRow) => {
    const rowIndex = sourceRow.sheetRow - dailyStartRow;
    if (
      rowIndex < 0 ||
      rowIndex >= allDailyData.length ||
      generateDataHash([allDailyData[rowIndex]]) !== sourceRow.dataHash
    ) {
      conflicts.push(sourceRow.sheetRow);
      return;
    }
    rows.push([...allDailyData[rowIndex]]);
    fontColors.push([...allDailyFontColors[rowIndex]]);
    backgrounds.push([...allDailyBackgrounds[rowIndex]]);
  });

  if (conflicts.length) {
    throw new Error(
      `TODAY checkpoint source rows changed: ${conflicts.join(', ')}. ` +
        'Processing stopped without changing either sheet.'
    );
  }
  return { rows, fontColors, backgrounds };
}

function reconcileTodayClear_(todaySheet, checkpoint) {
  if (!Array.isArray(checkpoint.sourceRows) || !checkpoint.sourceRows.length) {
    throw new Error('Checkpoint is missing TODAY row identities.');
  }

  const dailyRange = todaySheet.getRange(RANGES.dailyData);
  const startRow = dailyRange.getRow();
  const values = dailyRange.getValues();
  const rowsToClear = [];
  const conflicts = [];

  checkpoint.sourceRows.forEach((sourceRow) => {
    const rowIndex = sourceRow.sheetRow - startRow;
    if (rowIndex < 0 || rowIndex >= values.length) {
      conflicts.push(sourceRow.sheetRow);
      return;
    }

    const currentRow = values[rowIndex];
    if (generateDataHash([currentRow]) === sourceRow.dataHash) {
      rowsToClear.push(sourceRow.sheetRow);
      return;
    }

    if (dailyRowHasActivity_(currentRow)) conflicts.push(sourceRow.sheetRow);
  });

  if (conflicts.length) {
    throw new Error(
      `TODAY rows changed after processing began: ${conflicts.join(', ')}. ` +
        'The checkpoint was preserved and no newer data was cleared.'
    );
  }

  if (rowsToClear.length) {
    const rowRanges = rowsToClear.map((row) => `B${row}:N${row}`);
    todaySheet.getRangeList(rowRanges).clearContent();
  }

  const sourceRowRanges = checkpoint.sourceRows.map(
    (sourceRow) => `B${sourceRow.sheetRow}:N${sourceRow.sheetRow}`
  );
  const sourceRangeList = todaySheet.getRangeList(sourceRowRanges);
  sourceRangeList.setBackground(null);
  sourceRangeList.setFontColor(null);

  const verifiedValues = dailyRange.getValues();
  const unclearedRows = checkpoint.sourceRows
    .filter((sourceRow) => {
      const rowIndex = sourceRow.sheetRow - startRow;
      return dailyRowHasActivity_(verifiedValues[rowIndex]);
    })
    .map((sourceRow) => sourceRow.sheetRow);
  if (unclearedRows.length) {
    throw new Error(
      `TODAY clear verification failed for rows: ${unclearedRows.join(', ')}.`
    );
  }

  return { clearedRows: rowsToClear.length };
}

/**
 * Finds a previously written MONTHLY block for a daily operation checkpoint.
 * A block is reusable only when its date, row count, and full B:N hash match.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} monthlySheet MONTHLY sheet
 * @param {Object} checkpoint Daily operation checkpoint
 * @returns {?{headerRow: number, dataInsertRow: number, rows: Array<Array>}}
 */
function findMonthlyCheckpointBlock_(monthlySheet, checkpoint) {
  if (
    !checkpoint ||
    !checkpoint.dateIso ||
    !checkpoint.dataHash ||
    !checkpoint.operationId ||
    !Number.isInteger(checkpoint.rowCount) ||
    checkpoint.rowCount < 1
  ) {
    return null;
  }

  const lastRow = findLastRowInCols(monthlySheet, 1, 14);
  if (lastRow < 2) return null;

  const values = monthlySheet.getRange(1, 1, lastRow, 14).getValues();
  const headerNotes = monthlySheet.getRange(1, 1, lastRow, 1).getNotes();
  const headerRows = monthlySheet
    .getRange(1, 1, lastRow, 1)
    .getMergedRanges()
    .filter(
      (range) =>
        range.getRow() > 0 &&
        range.getColumn() === 1 &&
        range.getWidth() >= 14
    )
    .map((range) => range.getRow())
    .sort((a, b) => a - b);
  const expectedNote = `${DAILY_OPERATION_NOTE_PREFIX}${checkpoint.operationId}`;
  const matchingMarkerRows = headerNotes
    .map((row, index) => (row[0] === expectedNote ? index + 1 : 0))
    .filter((row) => row > 0);
  if (matchingMarkerRows.length > 1) {
    throw new Error(
      `Multiple MONTHLY rows use checkpoint marker ${checkpoint.operationId}.`
    );
  }

  for (let index = 0; index < headerRows.length; index++) {
    const headerRow = headerRows[index];
    if (headerNotes[headerRow - 1][0] !== expectedNote) continue;
    if (!dailyCheckpointDateMatches_(values[headerRow - 1][0], checkpoint)) {
      continue;
    }

    const nextHeaderRow =
      index + 1 < headerRows.length ? headerRows[index + 1] : lastRow + 1;
    const sectionRowCount = nextHeaderRow - headerRow - 1;
    if (sectionRowCount !== checkpoint.rowCount) continue;

    const rows = values.slice(headerRow, headerRow + checkpoint.rowCount);
    if (generateDataHash(rows) !== checkpoint.dataHash) continue;

    return {
      headerRow: headerRow,
      dataInsertRow: headerRow + 1,
      rows: rows,
    };
  }

  return null;
}

/**
 * Clears an exact marked tail block when MONTHLY writing stopped before all
 * expected data rows were written. Non-tail or nonmatching content is unchanged.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} monthlySheet MONTHLY sheet
 * @param {Object} checkpoint Daily operation checkpoint
 * @param {Array<Array>} expectedRows Checkpoint-owned rows expected in the block
 * @returns {boolean} Whether an incomplete header row was cleared
 */
function removeIncompleteMonthlyWrite_(monthlySheet, checkpoint, expectedRows) {
  if (
    !checkpoint ||
    checkpoint.phase !== 'MONTHLY_WRITE_STARTED' ||
    !Number.isInteger(checkpoint.headerInsertRow) ||
    !Number.isInteger(checkpoint.rowsInserted) ||
    checkpoint.rowsInserted < 1
  ) {
    return false;
  }

  const lastRow = findLastRowInCols(monthlySheet, 1, 14);
  const headerRow = checkpoint.headerInsertRow;
  const expectedLastRow = headerRow + checkpoint.rowsInserted;
  if (lastRow < headerRow || lastRow >= expectedLastRow) return false;

  const cleanupRange = monthlySheet.getRange(
    headerRow,
    1,
    checkpoint.rowsInserted + 1,
    14
  );
  const mergedRanges = cleanupRange.getMergedRanges();
  const headerRange = monthlySheet.getRange(headerRow, 1, 1, 14);
  const isMergedHeader = headerRange.getMergedRanges().some(
    (range) =>
      range.getRow() === headerRow &&
      range.getColumn() === 1 &&
      range.getWidth() === 14
  );
  if (
    !isMergedHeader ||
    mergedRanges.some(
      (range) =>
        range.getRow() !== headerRow ||
        range.getColumn() !== 1 ||
        range.getWidth() !== 14
    )
  ) {
    return false;
  }
  const headerValue = headerRange.getValues()[0][0];
  if (!dailyCheckpointDateMatches_(headerValue, checkpoint)) return false;
  const headerNote = headerRange.getNotes()[0][0];
  if (headerNote !== `${DAILY_OPERATION_NOTE_PREFIX}${checkpoint.operationId}`) {
    return false;
  }

  const partialRowCount = lastRow - headerRow;
  if (partialRowCount > 0) {
    if (
      !Array.isArray(expectedRows) ||
      expectedRows.length !== checkpoint.rowsInserted
    ) {
      return false;
    }
    const partialRows = monthlySheet
      .getRange(headerRow + 1, 1, partialRowCount, 14)
      .getValues();
    const hasUnexpectedContent = partialRows.some((row, index) => {
      if (!row.some((cell) => cell !== '' && cell != null)) return false;
      const expectedRow = expectedRows[index];
      return (
        normalizeDailyHashValue_(row[0]) !==
          normalizeDailyHashValue_(expectedRow[0]) ||
        generateDataHash([row]) !== generateDataHash([expectedRow])
      );
    });
    if (hasUnexpectedContent) return false;
  }

  cleanupRange.clearContent().setNote('').breakApart();
  Logger.log(
    `Cleared incomplete MONTHLY block at rows ${headerRow}-${expectedLastRow}.`
  );
  return true;
}

function recoverReconForCheckpoint_(checkpoint, sheets) {
  const monthlyBlock = findMonthlyCheckpointBlock_(sheets.monthly, checkpoint);
  if (!monthlyBlock) {
    throw new Error(
      `Checkpoint ${checkpoint.operationId} has no verified MONTHLY block for Recon export.`
    );
  }

  return exportTradesToReconLog_(
    {
      rows: monthlyBlock.rows,
      dealDateDisplay: checkpoint.dateProcessed,
      dryRun: false,
    },
    RECON_LOCK_CAPABILITY
  );
}

/**
 * Recovers analytics for a checkpoint operation
 * @param {Object} checkpoint - The checkpoint to recover from
 */
function recoverAnalyticsForCheckpoint_(checkpoint) {
  try {
    toastInfo('Recovering analytics...', 'Recovery In Progress');
    Logger.log(`Starting analytics recovery for ${checkpoint.dateProcessed}`);

    const sheets = getSheets();
    invalidateAnalyticsCache();
    const analyticsData = calculateMonthlyAnalytics();

    if (analyticsData) {
      writeAnalyticsToMonthly(analyticsData, sheets.monthly);
      if (!clearOperationCheckpoint()) {
        throw new Error('Analytics recovered, but the checkpoint could not be cleared.');
      }

      toastInfo(
        `Analytics successfully recovered for ${checkpoint.dateProcessed}`,
        'Recovery Complete'
      );
      Logger.log('✓ Analytics recovery successful');
      return true;
    } else {
      updateCheckpoint('ANALYTICS_FAILED', {
        recoveryAttempts: (checkpoint.recoveryAttempts || 0) + 1,
      });
      toastInfo(
        'Analytics recovery failed. You can try "Recalculate MTD & Check Formats" from the menu to retry.',
        'Recovery Failed'
      );
      Logger.log('✗ Analytics recovery failed - no data generated');
      return false;
    }
  } catch (e) {
    logError('recoverAnalyticsForCheckpoint', e, {
      dateProcessed: checkpoint.dateProcessed,
    });
    updateCheckpoint('ANALYTICS_FAILED', {
      error: e.toString(),
      recoveryAttempts: (checkpoint.recoveryAttempts || 0) + 1,
    });
    toastInfo(
      'Error during analytics recovery: ' + e.toString(),
      'Recovery Error'
    );
    return false;
  }
}

// ============================================================================
// MAIN FLOWS
// ============================================================================

// Main flows
function processDaily() {
  const operationStartTime = Date.now();
  let pendingAlert = null;
  withScriptLock(() => {
    const timer = createTimeoutManager(5.0, operationStartTime);
    let analyticsSkipped = false;

    toastInfo('Processing daily sales...', 'Working');
    let errorSheetRows = [];
    let unknownInputs = [];
    let countsByFullName = {};

    try {
      const sheets = getSheets();
      let operationCheckpoint = getOperationCheckpoint();
      operationCheckpoint = prepareLegacyMonthlyWrittenCheckpoint_(
        sheets,
        operationCheckpoint
      );
      operationCheckpoint = completeLegacyMonthlyWrittenCheckpoint_(
        sheets,
        operationCheckpoint
      );
      if (operationCheckpoint) {
        assertCheckpointMonthlySheet_(sheets.monthly, operationCheckpoint);
      }
      if (
        operationCheckpoint &&
        operationCheckpoint.phase === 'RECON_PENDING'
      ) {
        recoverReconForCheckpoint_(operationCheckpoint, sheets);
        if (!updateCheckpoint('ANALYTICS_PENDING')) {
          throw new Error('Could not checkpoint the completed Recon export.');
        }
        recoverAnalyticsForCheckpoint_(getOperationCheckpoint());
        return;
      }
      if (
        operationCheckpoint &&
        ['ANALYTICS_PENDING', 'ANALYTICS_FAILED'].includes(
          operationCheckpoint.phase
        )
      ) {
        recoverAnalyticsForCheckpoint_(operationCheckpoint);
        return;
      }

      const today = new Date();
      if (
        !operationCheckpoint &&
        shouldSkipSundays() &&
        today.getDay() === 0
      ) {
        Logger.log(
          'Today is Sunday and skipSundays is enabled. Skipping processDaily execution.'
        );
        toastInfo(
          'Sunday is configured as a non-sales day. No processing performed.',
          'Sunday Skip'
        );
        return;
      }

      const dailyRange = sheets.today.getRange(RANGES.dailyData); // A2:N51
      const allDailyData = dailyRange.getValues();
      const allDailyFontColors = dailyRange.getFontColors(); // *** NEW: Get font colors ***
      const allDailyBackgrounds = dailyRange.getBackgrounds(); // *** NEW: Get background colors ***

      let rowsToLogToMonthly = [];
      let fontColorsToLogToMonthly = []; // *** NEW: Array for corresponding font colors ***
      let backgroundsToLogToMonthly = []; // *** NEW: Array for corresponding background colors ***
      const sourceRowIdentities = [];
      const dailyStartRow = dailyRange.getRow();

      if (
        operationCheckpoint &&
        operationCheckpoint.phase !== 'TODAY_CLEAR_PENDING'
      ) {
        const selectedSource = selectCheckpointSourceRows_(
          allDailyData,
          allDailyFontColors,
          allDailyBackgrounds,
          dailyStartRow,
          operationCheckpoint
        );
        rowsToLogToMonthly = selectedSource.rows;
        fontColorsToLogToMonthly = selectedSource.fontColors;
        backgroundsToLogToMonthly = selectedSource.backgrounds;
      } else if (!operationCheckpoint) {
        allDailyData.forEach((row, index) => {
          if (dailyRowHasActivity_(row)) {
            rowsToLogToMonthly.push([...row]);
            fontColorsToLogToMonthly.push([...allDailyFontColors[index]]);
            backgroundsToLogToMonthly.push([...allDailyBackgrounds[index]]);
            sourceRowIdentities.push({
              sheetRow: dailyStartRow + index,
              dataHash: generateDataHash([row]),
            });
          }
        });
      }

      if (
        operationCheckpoint &&
        operationCheckpoint.phase === 'TODAY_CLEAR_PENDING'
      ) {
        reconcileTodayClear_(sheets.today, operationCheckpoint);
        if (!updateCheckpoint('RECON_PENDING')) {
          throw new Error('Could not checkpoint the completed TODAY clear.');
        }
        recoverReconForCheckpoint_(getOperationCheckpoint(), sheets);
        if (!updateCheckpoint('ANALYTICS_PENDING')) {
          throw new Error('Could not checkpoint the completed Recon export.');
        }
        recoverAnalyticsForCheckpoint_(getOperationCheckpoint());
        return;
      }

      if (!rowsToLogToMonthly.length && operationCheckpoint) {
        const recoveredBlock = findMonthlyCheckpointBlock_(
          sheets.monthly,
          operationCheckpoint
        );
        if (!recoveredBlock) {
          throw new Error(
            `Checkpoint ${operationCheckpoint.operationId || '(legacy)'} cannot be resumed: ` +
              'TODAY data is empty and no matching MONTHLY block exists.'
          );
        }
        rowsToLogToMonthly = recoveredBlock.rows.map((row) => [...row]);
        Logger.log(
          `Resuming checkpoint from existing MONTHLY rows ${recoveredBlock.dataInsertRow}-${
            recoveredBlock.dataInsertRow + recoveredBlock.rows.length - 1
          }.`
        );
      }

      if (!rowsToLogToMonthly.length) {
        pendingAlert = {
          title: 'Process Complete',
          message: 'No sales activity found on the TODAY sheet to log to monthly.',
        };
        sheets.today
          .getRange(RANGES.dailyClear)
          .setBackground(null)
          .setFontColor(null); // Reset font color here too
        return;
      }

      // CHECKPOINT 1: Before MONTHLY operations (critical)
      if (!timer.checkTime('Before MONTHLY write')) {
        pendingAlert = {
          title: 'Timeout Prevention',
          message:
            'Processing time too close to limit. Please retry when system load is lower.',
        };
        return; // Exit before any changes
      }

      const dateStr = operationCheckpoint
        ? operationCheckpoint.dateProcessed
        : formatDateOffset(1);
      const dateIso = normalizeDealDateIso_(dateStr);
      const dataHash = generateDataHash(rowsToLogToMonthly);

      if (operationCheckpoint) {
        if (
          operationCheckpoint.version !== CHECKPOINT_VERSION ||
          operationCheckpoint.dateIso !== dateIso ||
          operationCheckpoint.dataHash !== dataHash ||
          operationCheckpoint.rowCount !== rowsToLogToMonthly.length
        ) {
          throw new Error(
            'An unfinished daily checkpoint does not match the current TODAY data. ' +
              'Processing stopped without changing either sheet.'
          );
        }
      } else {
        if (
          !createOperationCheckpoint({
            dateStr: dateStr,
            dateIso: dateIso,
            rowCount: rowsToLogToMonthly.length,
            rows: rowsToLogToMonthly,
            sourceRows: sourceRowIdentities,
            monthlySheetId: sheets.monthly.getSheetId(),
          })
        ) {
          throw new Error('Could not create the daily operation checkpoint.');
        }
        operationCheckpoint = getOperationCheckpoint();
      }

      // Modify Column A
      rowsToLogToMonthly = rowsToLogToMonthly.map((row, index) => {
        row[0] = index + 1;
        return row;
      });
      // Note: fontColorsToLogToMonthly does not need Column A modified, it's just colors.

      const numRowsToInsert = rowsToLogToMonthly.length;
      const numColsToInsert = 14;
      const existingMonthlyBlock = findMonthlyCheckpointBlock_(
        sheets.monthly,
        operationCheckpoint
      );
      let headerInsertRow;
      let dataInsertRow;

      if (existingMonthlyBlock) {
        headerInsertRow = existingMonthlyBlock.headerRow;
        dataInsertRow = existingMonthlyBlock.dataInsertRow;
        rowsToLogToMonthly = existingMonthlyBlock.rows.map((row) => [...row]);
        Logger.log(
          `✓ Reusing existing MONTHLY block for ${operationCheckpoint.operationId}`
        );
      } else {
        removeIncompleteMonthlyWrite_(
          sheets.monthly,
          operationCheckpoint,
          rowsToLogToMonthly
        );
        const remainingMarkerRows = findMonthlyCheckpointMarkerRows_(
          sheets.monthly,
          operationCheckpoint
        );
        if (remainingMarkerRows.length) {
          throw new Error(
            `Checkpoint marker remains on invalid MONTHLY rows ${remainingMarkerRows.join(
              ', '
            )}; refusing to append a duplicate block.`
          );
        }
        const lastRowMonthly = findLastRowInCols(sheets.monthly, 1, 14);
        headerInsertRow = lastRowMonthly + 1;
        dataInsertRow = headerInsertRow + 1;
        if (
          !updateCheckpoint('MONTHLY_WRITE_STARTED', {
            headerInsertRow: headerInsertRow,
            monthlyInsertRow: dataInsertRow,
            rowsInserted: numRowsToInsert,
          })
        ) {
          throw new Error('Could not checkpoint the pending MONTHLY write.');
        }

        const requiredLastRow = dataInsertRow + numRowsToInsert - 1;
        const maxRows = sheets.monthly.getMaxRows();
        if (requiredLastRow > maxRows) {
          sheets.monthly.insertRowsAfter(maxRows, requiredLastRow - maxRows);
        }
        sheets.monthly
          .getRange(headerInsertRow, 1, 1, 14)
          .merge()
          .setNote(`${DAILY_OPERATION_NOTE_PREFIX}${operationCheckpoint.operationId}`)
          .setValue(dateStr)
          .setHorizontalAlignment('center')
          .setFontFamily('Calibri')
          .setFontSize(10)
          .setFontWeight('bold')
          .setBackground('#FFFF00')
          .setBorder(
            true,
            true,
            true,
            true,
            true,
            true,
            '#000000',
            SpreadsheetApp.BorderStyle.SOLID_MEDIUM
          );
      }

      const monthlyDataRange = sheets.monthly.getRange(
        dataInsertRow,
        1,
        numRowsToInsert,
        numColsToInsert
      );
      if (!existingMonthlyBlock) {
        monthlyDataRange.setValues(rowsToLogToMonthly);
        SpreadsheetApp.flush();
        const writtenHeader = sheets.monthly
          .getRange(headerInsertRow, 1, 1, 1)
          .getNotes()[0][0];
        const writtenRows = monthlyDataRange.getValues();
        if (
          writtenHeader !==
            `${DAILY_OPERATION_NOTE_PREFIX}${operationCheckpoint.operationId}` ||
          generateDataHash(writtenRows) !== operationCheckpoint.dataHash
        ) {
          throw new Error('MONTHLY write verification failed.');
        }
      }

      // Apply general formatting (font family, size, borders) to B:N
      sheets.monthly
        .getRange(dataInsertRow, 2, numRowsToInsert, 13)
        .setFontFamily('Calibri')
        .setFontWeight('bold')
        .setFontSize(10)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setBorder(
          true,
          true,
          true,
          true,
          true,
          true,
          '#000000',
          SpreadsheetApp.BorderStyle.SOLID
        );

      // Specific formatting for Column A on monthly
      sheets.monthly
        .getRange(dataInsertRow, 1, numRowsToInsert, 1)
        .setNumberFormat('0')
        .setFontFamily('Calibri')
        .setFontWeight('bold')
        .setFontSize(10)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setBorder(
          true,
          true,
          true,
          true,
          true,
          true,
          '#000000',
          SpreadsheetApp.BorderStyle.SOLID
        );

      sheets.monthly
        .getRange(dataInsertRow, 6, numRowsToInsert, 1)
        .setFontSize(7); // Col F
      sheets.monthly
        .getRange(dataInsertRow, 13, numRowsToInsert, 1)
        .setFontSize(7); // Col M

      // *** NEW: Apply font colors to the new rows on monthly sheet ***
      if (fontColorsToLogToMonthly.length > 0) {
        monthlyDataRange.setFontColors(fontColorsToLogToMonthly);
      }

      // *** NEW: Apply background colors to Columns E and L on monthly sheet ***
      if (backgroundsToLogToMonthly.length > 0) {
        // Extract backgrounds for Column E (Index 4) and Column L (Index 11)
        const backgroundsE = backgroundsToLogToMonthly.map((r) => [r[4]]);
        const backgroundsL = backgroundsToLogToMonthly.map((r) => [r[11]]);

        // Apply to Monthly Sheet (Col E = 5, Col L = 12)
        sheets.monthly
          .getRange(dataInsertRow, 5, numRowsToInsert, 1)
          .setBackgrounds(backgroundsE);
        sheets.monthly
          .getRange(dataInsertRow, 12, numRowsToInsert, 1)
          .setBackgrounds(backgroundsL);
      }
      SpreadsheetApp.flush(); // Ensure formatting is applied

      const { aliasMap, displayCodeMap } = getSalespersonMaps();

      errorSheetRows = applyMonthlyRowFormatting(
        sheets.monthly,
        rowsToLogToMonthly,
        dataInsertRow,
        aliasMap
      );

      // Update checkpoint: MONTHLY data written successfully
      if (
        !updateCheckpoint('MONTHLY_WRITTEN', {
          monthlyInsertRow: dataInsertRow,
          rowsInserted: numRowsToInsert,
        })
      ) {
        throw new Error('Could not checkpoint the completed MONTHLY write.');
      }

      const sidesToTally = [
        { fiIdx: 2, saleIdx: 6 },
        { fiIdx: 9, saleIdx: 13 },
      ];
      const tallyResult = tallyCounts(
        rowsToLogToMonthly,
        aliasMap,
        sidesToTally
      );
      countsByFullName = tallyResult.counts;
      unknownInputs = tallyResult.unknownInputs;

      // Rebuild absolute MTD totals from MONTHLY so this phase is safe to rerun.
      const allMonthlyRows = collectMonthlyRowsWithDates_(sheets.monthly).map(
        (entry) => entry.row
      );
      const monthlyTally = tallyCounts(
        allMonthlyRows,
        aliasMap,
        sidesToTally
      );
      const lbRange = sheets.today.getRange(RANGES.leaderboard);
      updateLeaderboardFromCounts_(lbRange, monthlyTally.counts, { mode: 'set' });

      sheets.today.getRange(RANGES.mtd).setNumberFormat('0.#');
      sheets.today.getRange(RANGES.avg).setNumberFormat('0.#');
      reapplyCF({ throwOnError: true });

      // --- Clean Up TODAY Sheet ---
      if (!updateCheckpoint('TODAY_CLEAR_PENDING')) {
        throw new Error('Could not checkpoint the pending TODAY clear.');
      }
      reconcileTodayClear_(sheets.today, getOperationCheckpoint());

      if (!updateCheckpoint('RECON_PENDING')) {
        throw new Error('Could not checkpoint the pending Recon export.');
      }
      recoverReconForCheckpoint_(getOperationCheckpoint(), sheets);

      // Update checkpoint: Core operations complete, analytics pending
      if (!updateCheckpoint('ANALYTICS_PENDING')) {
        throw new Error('Could not checkpoint the completed Recon export.');
      }

      // CHECKPOINT 2: Before optional analytics (after critical operations)
      if (!timer.checkTime('Before analytics calculation')) {
        Logger.log('⚠️ Skipping analytics due to time constraints');
        updateCheckpoint('ANALYTICS_FAILED', { reason: 'timeout_prevention' });
        analyticsSkipped = true;
      } else {
        // Try analytics
        try {
          Logger.log('Calculating monthly analytics...');
          invalidateAnalyticsCache();
          const analyticsData = calculateMonthlyAnalytics();
          if (analyticsData) {
            writeAnalyticsToMonthly(analyticsData, sheets.monthly);
            Logger.log('✓ Monthly analytics calculation successful');
            // Clear checkpoint - operation fully complete
            if (!clearOperationCheckpoint()) {
              throw new Error(
                'Analytics completed, but the checkpoint could not be cleared.'
              );
            }
          } else {
            updateCheckpoint('ANALYTICS_FAILED', {
              reason: 'no_data_generated',
            });
            analyticsSkipped = true;
          }
        } catch (analyticsError) {
          logWarning(
            'processDaily',
            'Analytics calculation failed (non-critical)',
            { error: analyticsError.toString() }
          );
          updateCheckpoint('ANALYTICS_FAILED', {
            reason: 'exception',
            error: analyticsError.toString(),
          });
          analyticsSkipped = true;
        }
      }

      // Log execution time
      const elapsed = timer.getElapsed();
      Logger.log(`✓ processDaily completed in ${elapsed.toFixed(1)}s`);

      // Construct summary message
      const { newCount, usedCount, tradeCount } =
        summarizeRows(rowsToLogToMonthly);
      const repLines = Object.entries(countsByFullName)
        .filter(([, c]) => c > 0)
        .map(
          ([name, count]) => `  - ${displayCodeMap[name] || name}: ${count}`
        );

      let summaryTitle = `Daily Sales Logged: ${dateStr}`;
      let summaryMsg =
        `NEW DELIVERED SALES: ${newCount}\n` +
        `USED DELIVERED SALES: ${usedCount}\n` +
        `TOTAL DELIVERED UNITS: ${newCount + usedCount}\n` +
        `DELIVERED DEALS WITH TRADES: ${tradeCount}\n\n` +
        `SALESPERSON DELIVERED COUNTS:\n` +
        (repLines.length > 0
          ? repLines.join('\n')
          : '  - No specific salesperson counts for delivered deals today.') +
        `\n\nSALESPERSON CODE ERRORS (on delivered deals): ${errorSheetRows.length}`;

      if (errorSheetRows.length > 0) {
        summaryMsg += `\n(Salesperson code errors for delivered deals are highlighted on 'MONTHLY' in rows ${dataInsertRow}-${dataInsertRow + numRowsToInsert - 1
          }.)`;
      }
      if (unknownInputs.length > 0) {
        summaryMsg += `\n\nUNKNOWN SALESPEOPLE INPUTS: ${[
          ...new Set(unknownInputs),
        ].join(', ')}\n(Check spelling or add to 'SALESPEOPLE' sheet.)`;
      }

      // Enhance summary message if analytics was skipped
      if (analyticsSkipped) {
        summaryMsg +=
          '\n\n⚠️ Analytics calculation was skipped due to time constraints. ' +
          "Run 'Process Daily' again to resume analytics, or use 'Sales Tools > Recalculate MTD & Check Formats'.";
      }

      pendingAlert = { title: summaryTitle, message: summaryMsg };

      Logger.log('Daily processing complete.');
    } catch (e) {
      logError('processDaily', e);
      pendingAlert = {
        title: 'Processing Failed',
        message: 'Error during daily processing: ' + e.toString(),
      };
    }
  });
  if (pendingAlert) {
    showCustomAlert(pendingAlert.title, pendingAlert.message);
  }
}

/**
 * Reapplies conditional formatting rules to the TODAY sheet.
 */
function reapplyCF({ throwOnError = false } = {}) {
  try {
    // Get configured colors and thresholds
    const LEADERBOARD_ZERO_BG_COLOR = getColor('leaderboardZeroMtdBgColor');
    const LEADERBOARD_ZERO_BG_COLOR_UPPER =
      LEADERBOARD_ZERO_BG_COLOR.toUpperCase();
    const DUPLICATE_FILL_COLOR = getColor('duplicateStockFillColor');
    const DUPLICATE_TEXT_COLOR = getColor('duplicateStockTextColor');
    const DUPLICATE_FILL_COLOR_UPPER = DUPLICATE_FILL_COLOR.toUpperCase();
    const DUPLICATE_TEXT_COLOR_UPPER = DUPLICATE_TEXT_COLOR.toUpperCase();
    const paceThresholds = getPaceThresholds();

    const sheets = getSheets();
    const todaySheet = sheets.today;
    const leaderboardRanges = getDynamicLeaderboardRanges();

    const existingRules = todaySheet.getConditionalFormatRules();
    const rulesToKeep = [];

    const now = new Date();
    const { daysElapsed, totalDays } = memoizedGetSellingDays(
      now.getFullYear(),
      now.getMonth()
    );
    const paceBase = totalDays > 0 ? `($Q2/${daysElapsed}*${totalDays})` : null;

    const managedLeaderboardBlueRuleSignature = {
      formula: '=1=1',
      background: LEADERBOARD_ZERO_BG_COLOR_UPPER,
    };
    const PACE_COLORS_UPPER = ['#70AD47', '#FFEE32', '#C00000'].map((c) =>
      c.toUpperCase()
    );
    const normalizeFormula = (formula) =>
      String(formula || '')
        .replace(/\s+/g, '')
        .toUpperCase();
    const managedStockRuleSignatures = [
      /^=COUNTIF\(\$(E|L)\$2:\$\1\$101,\$(E|L)\d+\)>1$/,
      /^=AND\(\$(E|L)\d+<>"",COUNTIF\(\$(E|L)\$2:\$\2\$101,\$(E|L)\d+\)>1\)$/,
    ];
    const managedDepositRuleSignatures = [
      /^=COUNTIF\(INDIRECT\("DEPOSITS!G:G"\),\$(E|L)\d+\)>0$/,
      /^=AND\(\$(E|L)\d+<>"",COUNTIF\(INDIRECT\("DEPOSITS!G:G"\),\$(E|L)\d+\)>0\)$/,
    ];
    const paceNumberPattern = '-?\\d+(?:\\.\\d+)?';
    const managedPaceRuleSignatures = [
      {
        background: PACE_COLORS_UPPER[0],
        formula: new RegExp(
          `^=\\(\\$Q2\\/${paceNumberPattern}\\*${paceNumberPattern}\\)>=${paceNumberPattern}$`
        ),
      },
      {
        background: PACE_COLORS_UPPER[1],
        formula: new RegExp(
          `^=AND\\(\\(\\$Q2\\/${paceNumberPattern}\\*${paceNumberPattern}\\)>=${paceNumberPattern},\\(\\$Q2\\/${paceNumberPattern}\\*${paceNumberPattern}\\)<${paceNumberPattern}\\)$`
        ),
      },
      {
        background: PACE_COLORS_UPPER[2],
        formula: new RegExp(
          `^=\\(\\$Q2\\/${paceNumberPattern}\\*${paceNumberPattern}\\)<${paceNumberPattern}$`
        ),
      },
    ];

    // Filter out existing rules that should be replaced
    existingRules.forEach((rule) => {
      let shouldRemove = false;
      const ranges = rule.getRanges();
      const bc = rule.getBooleanCondition();
      const isCustomFormula =
        bc &&
        bc.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA;
      const currentFormulaFull = isCustomFormula
        ? String(bc.getCriteriaValues()[0] || '')
        : '';
      const currentFormulaNormalized = normalizeFormula(currentFormulaFull);
      const ruleBg = isCustomFormula && bc.getBackground()
        ? bc.getBackground().toUpperCase()
        : null;
      const ruleFontColor =
        isCustomFormula &&
        typeof bc.getFontColor === 'function' &&
        bc.getFontColor()
          ? bc.getFontColor().toUpperCase()
          : null;

      if (isCustomFormula) {
        const isManagedStockRule = managedStockRuleSignatures.some(
          (signature) => signature.test(currentFormulaNormalized)
        );
        const isManagedDepositRule = managedDepositRuleSignatures.some(
          (signature) => signature.test(currentFormulaNormalized)
        );
        const intersectsDataEntryColumns = ranges.some(
          (range) => range.getColumn() <= 14 && range.getLastColumn() >= 2
        );
        const isManagedStyledCountifDebris =
          currentFormulaNormalized.includes('COUNTIF(') &&
          ruleBg === DUPLICATE_FILL_COLOR_UPPER &&
          ruleFontColor === DUPLICATE_TEXT_COLOR_UPPER &&
          intersectsDataEntryColumns;
        shouldRemove =
          isManagedDepositRule ||
          isManagedStockRule ||
          isManagedStyledCountifDebris;
      }

      const hasManagedLeaderboardRange =
        ranges.length === 1 && /^P2:R\d+$/.test(ranges[0].getA1Notation());

      if (hasManagedLeaderboardRange && isCustomFormula) {
        // Check for "Blue" zero-sales rule
        if (
          currentFormulaNormalized ===
          managedLeaderboardBlueRuleSignature.formula &&
          ruleBg === managedLeaderboardBlueRuleSignature.background
        ) {
          shouldRemove = true;
        }

        const isManagedPaceRule = managedPaceRuleSignatures.some(
          (signature) =>
            ruleBg === signature.background &&
            signature.formula.test(currentFormulaNormalized)
        );
        if (isManagedPaceRule) {
          shouldRemove = true;
          Logger.log(
            `Removing old pace rule: ${currentFormulaFull} on range ${ranges
              .map((r) => r.getA1Notation())
              .join(',')}`
          );
        }
      }

      if (!shouldRemove) {
        rulesToKeep.push(rule);
      }
    });

    const removedRuleCount = existingRules.length - rulesToKeep.length;
    const newRules = [...rulesToKeep];

    let allMtdAreZero = true;
    try {
      if (
        leaderboardRanges.mtd &&
        leaderboardRanges.mtd.match(/^[A-Z]+\d+:[A-Z]+\d+$/)
      ) {
        const mtdRangeValues = todaySheet
          .getRange(leaderboardRanges.mtd)
          .getValues();
        for (const row of mtdRangeValues) {
          const value = Number(row[0]);
          if (!isNaN(value) && value > 0) {
            allMtdAreZero = false;
            break;
          }
        }
      } else {
        Logger.log(
          `Leaderboard MTD range ("${leaderboardRanges.mtd}") is not defined or invalid. Defaulting to standard pace rules.`
        );
        allMtdAreZero = false;
      }
    } catch (e) {
      logWarning(
        'reapplyCF',
        'Error reading MTD values for CF logic. Defaulting to standard pace rules.',
        { error: e.toString() }
      );
      allMtdAreZero = false;
    }

    const cfLeaderboardRange = todaySheet.getRange(
      leaderboardRanges.leaderboard
    );

    if (allMtdAreZero) {
      Logger.log(
        'All MTD are zero. Applying configured background to leaderboard.'
      );
      newRules.push(
        SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(managedLeaderboardBlueRuleSignature.formula)
          .setBackground(LEADERBOARD_ZERO_BG_COLOR)
          .setRanges([cfLeaderboardRange])
          .build()
      );
    } else {
      Logger.log(
        'MTD sales detected or error in MTD check. Applying standard pace conditional formatting.'
      );
      if (totalDays > 0 && paceBase) {
        newRules.push(
          SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied(`=${paceBase}>=${paceThresholds.green}`)
            .setBackground(PACE_COLORS_UPPER[0])
            .setRanges([cfLeaderboardRange])
            .build(), // Green
          SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied(
              `=AND(${paceBase}>=${paceThresholds.yellow},${paceBase}<${paceThresholds.green})`
            )
            .setBackground(PACE_COLORS_UPPER[1])
            .setRanges([cfLeaderboardRange])
            .build(), // Yellow
          SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied(`=${paceBase}<${paceThresholds.yellow}`)
            .setBackground(PACE_COLORS_UPPER[2])
            .setRanges([cfLeaderboardRange])
            .build() // Red
        );
      } else {
        Logger.log(
          'Cannot apply leaderboard pace CF: Total selling days is zero or paceBase is null.'
        );
      }
    }

    const todayNewCarRange = todaySheet.getRange(RANGES.todayNewCarDataRange);
    const todayUsedCarRange = todaySheet.getRange(RANGES.todayUsedCarDataRange);

    newRules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($E2<>"",COUNTIF($E$2:$E$101,$E2)>1)')
        .setFontColor(DUPLICATE_TEXT_COLOR)
        .setBackground(DUPLICATE_FILL_COLOR)
        .setRanges([todayNewCarRange])
        .build()
    );
    newRules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($L2<>"",COUNTIF($L$2:$L$101,$L2)>1)')
        .setFontColor(DUPLICATE_TEXT_COLOR)
        .setBackground(DUPLICATE_FILL_COLOR)
        .setRanges([todayUsedCarRange])
        .build()
    );
    newRules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(
          '=AND($E2<>"",COUNTIF(INDIRECT("DEPOSITS!G:G"),$E2)>0)'
        )
        .setFontColor(DUPLICATE_TEXT_COLOR)
        .setBackground(DUPLICATE_FILL_COLOR)
        .setRanges([todayNewCarRange])
        .build()
    );
    newRules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(
          '=AND($L2<>"",COUNTIF(INDIRECT("DEPOSITS!G:G"),$L2)>0)'
        )
        .setFontColor(DUPLICATE_TEXT_COLOR)
        .setBackground(DUPLICATE_FILL_COLOR)
        .setRanges([todayUsedCarRange])
        .build()
    );

    setCFRulesSheet(todaySheet, newRules);
    Logger.log(
      `[reapplyCF] existing=${existingRules.length} removed=${removedRuleCount} retained=${rulesToKeep.length} final=${newRules.length}`
    );
    toastInfo(
      `Conditional formatting updated. Replaced ${removedRuleCount} managed rules; ${newRules.length} total rules remain.`,
      'CF Updated'
    );
    return {
      existingCount: existingRules.length,
      removedCount: removedRuleCount,
      retainedCount: rulesToKeep.length,
      finalCount: newRules.length,
    };
  } catch (e) {
    logError('reapplyCF', e);
    if (throwOnError) {
      throw e;
    }
    alertError('Error reapplying CF: ' + e.toString(), 'CF Error');
    return null;
  }
}

function recalcMtdFromMonthly() {
  try {
    const result = withScriptLock(() => {
      toastInfo(
        "Recalculating MTD, checking 'MONTHLY' formats, and updating analytics...",
        'Working'
      );
      const sheets = getSheets();
      const monthlySheet = sheets.monthly;
      const todaySheet = sheets.today;
      const lastRowMonthly = monthlySheet.getLastRow();
      const maxColsMonthly = monthlySheet.getMaxColumns();

      if (maxColsMonthly < 14) {
        throw new Error('"MONTHLY" sheet needs at least 14 columns (A:N).');
      }
      if (lastRowMonthly < 2) {
        todaySheet.getRange(RANGES.mtd).clearContent();
        reapplyCF({ throwOnError: true });
        return {
          status: 'empty',
          message: "MTD cleared. No data in 'MONTHLY' to recalculate.",
        };
      }

      const { aliasMap } = getSalespersonMaps();
      const allMonthlyContent = monthlySheet
        .getRange(1, 1, lastRowMonthly, maxColsMonthly)
        .getValues();
      const monthlyValues = allMonthlyContent.slice(1);
      toastInfo('Reading MONTHLY sheet data...', 'Working (1/7)');

      const salespersonErrorRowsFound = applyMonthlyRowFormatting(
        monthlySheet,
        monthlyValues,
        2,
        aliasMap
      );
      const totalSalespersonErrors = salespersonErrorRowsFound.length;
      toastInfo(
        'Applying formatting and checking for errors...',
        'Working (2/7)'
      );

      const mergedRanges = monthlySheet
        .getRange(1, 1, lastRowMonthly, 1)
        .getMergedRanges();
      let actualDataRows = [];
      const dateHeaderRows = mergedRanges
        .filter(
          (mr) => mr.getRow() > 0 && mr.getColumn() === 1 && mr.getWidth() >= 14
        )
        .map((mr) => mr.getRow())
        .sort((a, b) => a - b);
      toastInfo('Identifying date sections...', 'Working (3/7)');

      if (dateHeaderRows.length > 0) {
        let startDataRowIdx = dateHeaderRows[0];
        for (let i = 1; i < dateHeaderRows.length; i++) {
          const endDataRowIdx = dateHeaderRows[i] - 1;
          if (startDataRowIdx < endDataRowIdx) {
            actualDataRows = actualDataRows.concat(
              allMonthlyContent.slice(startDataRowIdx, endDataRowIdx)
            );
          }
          startDataRowIdx = dateHeaderRows[i];
        }
        if (startDataRowIdx < lastRowMonthly) {
          actualDataRows = actualDataRows.concat(
            allMonthlyContent.slice(startDataRowIdx)
          );
        }
      } else {
        Logger.log(
          'No distinct date headers found. Reading all rows from row 2 for MTD.'
        );
        if (lastRowMonthly > 1) actualDataRows = monthlyValues;
      }

      toastInfo('Extracting sales data...', 'Working (4/7)');
      if (!actualDataRows.length) {
        todaySheet.getRange(RANGES.mtd).clearContent();
        reapplyCF({ throwOnError: true });
        return {
          status: 'empty',
          message:
            "MTD cleared. No data rows found in 'MONTHLY' after filtering headers.",
        };
      }

      const sidesToTally = [
        { fiIdx: 2, saleIdx: 6 },
        { fiIdx: 9, saleIdx: 13 },
      ];
      const { counts: countsByFullName } = tallyCounts(
        actualDataRows,
        aliasMap,
        sidesToTally
      );

      const lbRange = todaySheet.getRange(RANGES.leaderboard);
      updateLeaderboardFromCounts_(lbRange, countsByFullName, { mode: 'set' });
      todaySheet.getRange(RANGES.mtd).setNumberFormat('0.#');
      toastInfo('Updating leaderboard counts...', 'Working (5/7)');
      reapplyCF({ throwOnError: true });
      toastInfo('Reapplying conditional formatting...', 'Working (6/7)');
      toastInfo('Refreshing monthly analytics...', 'Working (7/7)');
      const analyticsResult = refreshAnalyticsInternal(sheets);

      return {
        status: 'complete',
        totalSalespersonErrors,
        analyticsResult,
      };
    });

    if (result.status === 'empty') {
      toastInfo(result.message, 'Recalc Complete', 5);
      return;
    }

    if (!result.analyticsResult.success) {
      alertError(
        'MTD recalculation completed, but analytics could not be updated: ' +
          (result.analyticsResult.error || 'Unknown error'),
        'Analytics Update Failed'
      );
      toastInfo('MTD updated. Analytics update failed.', 'Warning', 5);
      return;
    }

    toastInfo(
      `MTD and analytics updated. Found ${result.totalSalespersonErrors} salesperson code errors in 'MONTHLY'.`,
      'Update Complete',
      5
    );
  } catch (e) {
    logError('recalcMtdFromMonthly', e);
    alertError(
      'Error during MTD recalculation: ' + e.toString(),
      'Recalc Failed'
    );
  }
}

function rolloverMonth() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Confirm Month Rollover',
    'This will:\n' +
      '1. Archive the current "MONTHLY" sheet (e.g., as "5/25").\n' +
      '2. Copy the final leaderboard to the archive.\n' +
      '3. Clear the "MONTHLY" sheet for the new month.\n' +
      '4. Clear MTD sales (Column Q) on the "TODAY" sheet.\n' +
      '5. Recalculate 3-Month Rolling Averages (Column R) on "TODAY".\n\n' +
      'Are you sure you want to proceed?',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) {
    toastInfo('Rollover cancelled.', 'Cancelled');
    return;
  }

  try {
    const rolloverResult = withScriptLock(() => {
      toastInfo('Starting month rollover...', 'Working (1/5)');
      const sheets = getSheets();
      const pendingCheckpoint = getOperationCheckpoint();
      if (pendingCheckpoint) {
        throw new Error(
          `Rollover aborted: unfinished daily checkpoint ${
            pendingCheckpoint.operationId || '(legacy)'
          } is in phase ${pendingCheckpoint.phase || 'unknown'}. ` +
            'Run Process Daily to finish recovery before rolling over the month.'
        );
      }
      const currentDate = new Date();
      let archiveYear = currentDate.getFullYear();
      let archiveMonth = currentDate.getMonth() - 1;
      if (archiveMonth < 0) {
        archiveMonth = 11;
        archiveYear--;
      }
      const archiveSheetName = `${archiveMonth + 1}/${String(
        archiveYear % 100
      ).padStart(2, '0')}`;

      if (SS.getSheetByName(archiveSheetName)) {
        throw new Error(
          `Archive "${archiveSheetName}" already exists. Rollover aborted.`
        );
      }

      // Recalculate final analytics before archiving for accuracy
      try {
        Logger.log('Recalculating final analytics for archive...');
        invalidateAnalyticsCache();
        const finalAnalytics = calculateMonthlyAnalytics();
        if (finalAnalytics) {
          writeAnalyticsToMonthly(finalAnalytics, sheets.monthly);
          SpreadsheetApp.flush(); // Ensure writes complete before copy
        }
      } catch (e) {
        Logger.log('Pre-rollover analytics refresh failed: ' + e);
        // Continue with rollover even if analytics fail
      }

      const archiveSheet = sheets.monthly.copyTo(SS);
      try {
        archiveSheet.setName(archiveSheetName);
        archiveSheet.setTabColor(null);
        SpreadsheetApp.flush();
        toastInfo(
          `"MONTHLY" archived as "${archiveSheetName}".`,
          'Working (2/5)'
        );
      } catch (e) {
        try {
          SS.deleteSheet(archiveSheet);
        } catch (delErr) {
          Logger.log(`Failed to delete partial: ${delErr}`);
        }
        throw new Error(
          `Error renaming archive: ${e}. Partial archive cleanup was attempted.`
        );
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
      toastInfo('Leaderboard copied to archive.', 'Working (3/5)');

      const lastRowMonthly = sheets.monthly.getLastRow();
      if (lastRowMonthly > 1) {
        sheets.monthly
          .getRange(2, 1, lastRowMonthly - 1, sheets.monthly.getMaxColumns())
          .clear();
        sheets.monthly.setRowHeights(2, lastRowMonthly - 1, 21);
      }
      sheets.monthly
        .getRange(1, 1, 51, 14)
        .setBorder(null, null, null, null, null, null)
        .setBorder(
          true,
          true,
          true,
          true,
          true,
          true,
          '#000000',
          SpreadsheetApp.BorderStyle.SOLID
        );
      toastInfo(`"MONTHLY" sheet cleared.`, 'Working (4/5)');

      sheets.today.getRange(RANGES.mtd).clearContent();
      const leaderboardData = sheets.today
        .getRange(RANGES.leaderboard)
        .getValues();
      const averagesMap = computeThreeMonthAverageMap(
        leaderboardData.map((row) => row[0])
      );
      const avgValues = leaderboardData.map((row) => [
        averagesMap[row[0]] || 0,
      ]);
      sheets.today
        .getRange(RANGES.avg)
        .setValues(avgValues)
        .setNumberFormat('0.#');
      toastInfo('MTD cleared & Averages recalculated.', 'Working (5/5)');
      reapplyCF({ throwOnError: true });
      SpreadsheetApp.flush();
      return { archiveSheetName };
    });

    ui.alert(
      'Month Rollover Complete!',
      `"${rolloverResult.archiveSheetName}" created. "MONTHLY" & MTD reset. Averages updated.`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    logError('rolloverMonth', e);
    alertError(
      'Error during month rollover: ' + e.toString(),
      'Rollover Failed'
    );
  }
}

// ============================================================================
// CONFIGURATION UI FUNCTIONS
// ============================================================================

// ============================================================================
// MENU & INITIALIZATION
// ============================================================================

// onOpen
// onOpen
// onOpen
function onOpen() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Check required sheets (keep your existing logic if you use it elsewhere)
    const hasAllSheets =
      ss.getSheetByName('TODAY') &&
      ss.getSheetByName('MONTHLY') &&
      ss.getSheetByName('SALESPEOPLE') &&
      ss.getSheetByName('DEPOSITS');

    const ui = SpreadsheetApp.getUi();
    const menu = ui.createMenu('SalesLog Tools');

    // 1. SalesLog Tools (admin) Submenu
    const analyticsMenu = ui.createMenu('Sales Tools');
    analyticsMenu
      .addItem("Log Yesterday's Sales", 'processDaily')
      .addSeparator()
      .addItem('Recalculate Sales Numbers', 'recalcMtdFromMonthly')
      .addSeparator()
      .addItem('Start New Month (Rollover)', 'rolloverMonth')
      .addSeparator()
      .addItem('Refresh Salespeople List', 'manualRefreshLeaderboard');

    menu.addSubMenu(analyticsMenu).addSeparator();

    // 2. Service Tools Submenu
    const serviceMenu = ui.createMenu('Service Tools');
    serviceMenu
      .addItem('Authorize Recon Access', 'authorizeReconAccess')
      .addSeparator()
      .addItem('Export Trades to Recon Log', 'menuExportTradesToReconLog')
      .addSeparator()
      .addItem(
        'Dry Run: Export Trades to Recon Log',
        'menuExportTradesToReconLogDryRun'
      );

    menu.addSubMenu(serviceMenu);

    menu.addToUi();
  } catch (e) {
    // Log error with full context for debugging
    try {
      logError('onOpen', e, { operation: 'create_menu' });
    } catch (_) { }

    // Notify user
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Failed to create Sales Tools menu. Please refresh the page. If the problem persists, check the script logs.',
        'Menu Creation Error',
        10
      );
    } catch (toastError) {
      try {
        logWarning('onOpen', 'Could not display error toast', {
          error: toastError.toString(),
        });
      } catch (_) { }
    }
  } finally {
    Logger.log('[onOpen] Trigger execution completed');
  }
}

// Duplicate normalizeHeader_ definitions: replace with delegating one-liners to _normalizeHeaderImpl_
// (If any exist elsewhere in the file, e.g., function normalizeHeader_(header) { ... }, replace body with the below)
