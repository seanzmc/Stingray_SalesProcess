/**
 * dashboard_refresh.js - DASHBOARD Sheet Population Module
 *
 * Populates DASHBOARD sheet with filtered and mapped data from CDK_MERGED sheet.
 * Filters out yellow-highlighted rows and applies column mapping rules.
 *
 * Features:
 * - Background color filtering (excludes yellow highlighted rows)
 * - Efficient batch read/write operations
 * - Column mapping with conditional logic
 * - Menu integration for user-triggered refresh
 * - Idempotent operation (safe to run multiple times)
 * - Comprehensive error handling and logging
 *
 * Column Mapping Rules:
 * - CDK_MERGED column A (Date)                -> DASHBOARD column A
 * - CDK_MERGED column Y (RDR Date)            -> DASHBOARD column B
 * - CDK_MERGED column J (Deal #)              -> DASHBOARD column C
 * - CDK_MERGED column F (Stock #)             -> DASHBOARD column D
 * - CDK_MERGED column C (Customer Name)       -> DASHBOARD column E
 * - CDK_MERGED column H (Sales Rep)           -> DASHBOARD column F
 * - CDK_MERGED column N (Sales Mgr)           -> DASHBOARD column G
 * - Conditional on RDR Date (Punched)         -> DASHBOARD column H
 * - CDK_MERGED column B (New/Used)            -> DASHBOARD column I
 * - VSALES column E (Make) w/ fallback        -> DASHBOARD column J
 * - CDK_MERGED column E (Model)               -> DASHBOARD column K
 * - VSALES column G (Age)                     -> DASHBOARD column L
 * - CDK_MERGED column G (Trade in)            -> DASHBOARD column M
 * - Conditional on CDK_MERGED S/T (F/C/L)     -> DASHBOARD column N
 * - CDK_MERGED column U (Front Gross)         -> DASHBOARD column O
 * - CDK_MERGED column V (Back Gross)          -> DASHBOARD column P
 * - CDK_MERGED column W (Total Gross)         -> DASHBOARD column Q
 */

// Import error logging utility
// Note: In Apps Script, all files are automatically available in global scope


/**
 * Gets a sheet by name with error handling
 * Throws descriptive error if sheet doesn't exist
 *
 * @param {string} name - Sheet name
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheet object
 * @throws {Error} If sheet not found
 */
function getSheetByNameOrThrow(name) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error(`Sheet "${name}" not found. Ensure it exists before running this operation.`);
  }
  return sheet;
}

/**
 * Checks if a background color is yellow highlight (#FFFFE0)
 *
 * @param {string} colorHex - Background color in hex format
 * @returns {boolean} True if color is #FFFFE0 (should be filtered out)
 */
function isYellowBackground(colorHex) {
  if (!colorHex) {
    return false;
  }

  // Check for exact match with #FFFFE0 (case-insensitive)
  const normalized = colorHex.toUpperCase().replace(/^#/, '');
  return normalized === 'FFFFE0';
}

/**
 * Applies conditional logic for Punched column (H)
 * Rule: IF RDR Date (column Y) has a value THEN 'Y', ELSE '' (empty string)
 *
 * @param {*} rdrDateValue - Value from CDK_MERGED column Y
 * @returns {string} 'Y' when an RDR date exists, otherwise ''
 */
function getPunchedValue(rdrDateValue) {
  if (rdrDateValue instanceof Date) {
    return 'Y';
  }
  const normalized = String(rdrDateValue || '').trim();
  return normalized ? 'Y' : '';
}

/**
 * Applies fallback logic for Make column (J)
 * Used when no matching record is found in VSALES
 *
 * @param {string} newUsedValue - Value from CDK_MERGED column B
 * @returns {string} 'CHEV' for new vehicles, empty string for others
 */
function getMakeValue(newUsedValue) {
  const normalized = String(newUsedValue || '').trim().toUpperCase();
  return normalized === 'NEW' ? 'CHEV' : '';
}

/**
 * Applies conditional logic for F/C/L column (N)
 * Rule:
 * - IF Term (column U) does not equal 'CASH' AND PLC (column T) does not equal 'L' THEN 'F'
 * - IF PLC (column T) equals 'L' THEN 'L'
 * - ELSE 'C'
 *
 * @param {string} termValue - Value from CDK_MERGED column U (Term)
 * @param {string} plcValue - Value from CDK_MERGED column T (PLC)
 * @returns {string} 'L', 'F', or 'C'
 */
function getFCLValue(termValue, plcValue) {
  const normalizedTerm = String(termValue || '').trim().toUpperCase();
  const normalizedPLC = String(plcValue || '').trim().toUpperCase();

  // First check: if PLC is 'L', mark as lease
  if (normalizedPLC === 'L') {
    return 'L';
  }

  // Second check: if Term is not CASH and PLC is not L, mark as finance
  if (normalizedTerm !== 'CASH' && normalizedPLC !== 'L') {
    return 'F';
  }

  // Default: cash payment
  return 'C';
}

/**
 * Normalizes a deal number for consistent map lookups
 *
 * @param {*} value - Deal number value
 * @returns {string} Normalized key
 */
function normalizeDealKey(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * Builds a lookup map of Deal No. -> { make, age } from the VSALES sheet
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} vsalesSheet - VSALES sheet reference
 * @returns {Map<string, {make: string, age: string}>} Map of normalized deal numbers to VSALES values
 */
function buildVsalesLookupMap(vsalesSheet) {
  const lookupMap = new Map();
  if (!vsalesSheet) {
    return lookupMap;
  }

  const lastRow = vsalesSheet.getLastRow();
  if (lastRow < 2) {
    return lookupMap;
  }

  const numRows = lastRow - 1;
  const data = vsalesSheet.getRange(2, 1, numRows, 7).getValues(); // Columns A:G (Deal No., ..., Age)

  data.forEach(row => {
    const dealKey = normalizeDealKey(row[0]);
    if (!dealKey) return;
    lookupMap.set(dealKey, {
      make: row[4] || '',
      age: row[6] || ''
    });
  });

  return lookupMap;
}

/**
 * Retrieves the VSALES values (make, age) for a deal number
 *
 * @param {*} dealNoValue - Deal number from CDK_MERGED row
 * @param {Map<string, {make: string, age: string}>} vsalesLookupMap - Lookup map
 * @returns {{make: string, age: string}} Object with VSALES values; defaults to empty strings
 */
function getVsalesDealData(dealNoValue, vsalesLookupMap) {
  if (!vsalesLookupMap || !(vsalesLookupMap instanceof Map)) {
    return { make: '', age: '' };
  }
  const key = normalizeDealKey(dealNoValue);
  if (!key) {
    return { make: '', age: '' };
  }
  return vsalesLookupMap.get(key) || { make: '', age: '' };
}

/**
 * Maps a single row from CDK_MERGED to DASHBOARD format
 * Applies all column mapping rules and conditional logic
 *
 * @param {Array} sourceRow - Row from CDK_MERGED sheet (0-indexed array)
 * @param {Map<string, {make: string, age: string}>} vsalesLookupMap - Lookup map for Deal No. -> VSALES data
 * @returns {Array} Mapped row for DASHBOARD sheet (17 columns A-Q)
 */
function mapRowToDashboard(sourceRow, vsalesLookupMap) {
  // Initialize output row with 17 columns (A-Q)
  const outputRow = new Array(17).fill('');

  // Column A: Date (CDK_MERGED column A, index 0)
  outputRow[0] = sourceRow[0] || '';

  // Column B: RDR Date (CDK_MERGED column Y, index 24)
  const rdrDateValue = sourceRow[24] || '';
  outputRow[1] = rdrDateValue;

  // Column C: Deal # (CDK_MERGED column J [Deal No.], index 9)
  const dealNumberValue = sourceRow[9] || '';
  outputRow[2] = dealNumberValue;

  // Column D: Stock # (CDK_MERGED column F [Stock No.], index 5)
  outputRow[3] = sourceRow[5] || '';

  // Column E: Customer Name (CDK_MERGED column C [Customer], index 2)
  outputRow[4] = sourceRow[2] || '';

  // Column F: Sales Rep (CDK_MERGED column H [Sales Person], index 7)
  outputRow[5] = sourceRow[7] || '';

  // Column G: Sales Mgr (CDK_MERGED column N [Sales Manager], index 13)
  outputRow[6] = sourceRow[13] || '';

  // Column H: Punched (conditional logic based on RDR Date)
  const newUsedValue = sourceRow[1] || '';
  outputRow[7] = getPunchedValue(rdrDateValue);

  // Column I: New/Used (CDK_MERGED column B [Type], index 1)
  outputRow[8] = newUsedValue;

  // Column J: Make (VSALES lookup via Deal No., fallback to NEW logic)
  const { make: vsalesMake, age: vsalesAge } = getVsalesDealData(dealNumberValue, vsalesLookupMap);
  outputRow[9] = vsalesMake || getMakeValue(newUsedValue);

  // Column K: Model (CDK_MERGED column E [Model], index 4)
  outputRow[10] = sourceRow[4] || '';

  // Column L: Age (VSALES column G [Age], index 6)
  outputRow[11] = vsalesAge || '';

  // Column M: Trade in (CDK_MERGED column G [Trade], index 6)
  outputRow[12] = sourceRow[6] || '';

  // Column N: F/C/L (conditional logic based on column T [Term] and column S [PLC])
  const termValue = sourceRow[19] || ''; // Column T [Term] (index 19)
  const plcValue = sourceRow[18] || ''; // Column S [PLC] (index 18)
  outputRow[13] = getFCLValue(termValue, plcValue);

  // Column O: Front Gross (CDK_MERGED column U [Front GP$], index 20)
  outputRow[14] = sourceRow[20] ?? '';

  // Column P: Back Gross (CDK_MERGED column V [Back GP$], index 21)
  outputRow[15] = sourceRow[21] ?? '';

  // Column Q: Total Gross (CDK_MERGED column W [GP$], index 22)
  outputRow[16] = sourceRow[22] ?? '';

  return outputRow;
}

/**
 * Main function to refresh DASHBOARD sheet with data from CDK_MERGED
 * Filters out yellow-highlighted rows and applies column mapping
 *
 * Process:
 * 1. Read all data and backgrounds from CDK_MERGED
 * 2. Filter out yellow-highlighted rows
 * 3. Map filtered rows to DASHBOARD format
 * 4. Clear existing DASHBOARD data (rows 7+)
 * 5. Write new data in single batch operation
 *
 * @returns {Object} Result object with success status and statistics
 * @throws {Error} If sheets are missing or operation fails
 */
function refreshDashboard() {
  try {
    Logger.log('[Dashboard Refresh] Starting...');

    // Get required sheets with validation
    const cdkMergedSheet = getSheetByNameOrThrow('CDK_MERGED');
    const dashboardSheet = getSheetByNameOrThrow('DASHBOARD');
    const vsalesSheet = getSheetByNameOrThrow('VSALES');

    // Read all data from CDK_MERGED sheet
    const lastRow = cdkMergedSheet.getLastRow();

    if (lastRow < 2) {
      // No data rows (only header or empty)
      Logger.log('[Dashboard Refresh] No data in CDK_MERGED sheet');

      // Clear existing dashboard data
      const dashboardLastRow = dashboardSheet.getLastRow();
      if (dashboardLastRow >= 7) {
        dashboardSheet.getRange(7, 1, dashboardLastRow - 6, 17).clearContent();
      }

      SpreadsheetApp.getActive().toast(
        'No data found in CDK_MERGED sheet. DASHBOARD cleared.',
        'Refresh Complete',
        5
      );

      return {
        success: true,
        totalRows: 0,
        filteredRows: 0,
        message: 'No data to process'
      };
    }

    // Read data starting from row 2 (skip header)
    const dataStartRow = 2;
    const numRows = lastRow - dataStartRow + 1;
    const numCols = cdkMergedSheet.getLastColumn();

    Logger.log(`[Dashboard Refresh] Reading ${numRows} rows from CDK_MERGED`);

    // Batch read: get values and backgrounds
    const dataRange = cdkMergedSheet.getRange(dataStartRow, 1, numRows, numCols);
    const allData = dataRange.getValues();
    const allBackgrounds = dataRange.getBackgrounds();

    // Build lookup map for Make values from VSALES (Deal No. -> Make)
    const vsalesLookupMap = buildVsalesLookupMap(vsalesSheet);
    Logger.log(`[Dashboard Refresh] Loaded ${vsalesLookupMap.size} VSALES entries`);

    // Filter and map rows
    const mappedRows = [];
    let filteredCount = 0;

    for (let i = 0; i < allData.length; i++) {
      // Check if row has yellow background in first column
      const rowBackgroundColor = allBackgrounds[i][0]; // Check column A background

      if (isYellowBackground(rowBackgroundColor)) {
        filteredCount++;
        continue; // Skip yellow-highlighted rows
      }

      // Map row to DASHBOARD format
      const mappedRow = mapRowToDashboard(allData[i], vsalesLookupMap);
      mappedRows.push(mappedRow);
    }

    Logger.log(`[Dashboard Refresh] Filtered out ${filteredCount} yellow rows`);
    Logger.log(`[Dashboard Refresh] Mapped ${mappedRows.length} rows for DASHBOARD`);

    // Clear existing DASHBOARD data (rows 7 onwards)
    const dashboardLastRow = dashboardSheet.getLastRow();
    if (dashboardLastRow >= 7) {
      const clearRowCount = dashboardLastRow - 6;
      dashboardSheet.getRange(7, 1, clearRowCount, 17).clearContent();
      Logger.log(`[Dashboard Refresh] Cleared ${clearRowCount} existing rows from DASHBOARD`);
    }

    // Write new data to DASHBOARD (starting at row 7)
    if (mappedRows.length > 0) {
      const targetRange = dashboardSheet.getRange(7, 1, mappedRows.length, 17);
      targetRange.setValues(mappedRows);
      Logger.log(`[Dashboard Refresh] Wrote ${mappedRows.length} rows to DASHBOARD`);
    }

    // Show success message
    SpreadsheetApp.getActive().toast(
      `DASHBOARD updated: ${mappedRows.length} rows written, ${filteredCount} rows filtered out.`,
      'Refresh Complete',
      5
    );

    Logger.log('[Dashboard Refresh] Complete');

    return {
      success: true,
      totalRows: numRows,
      filteredRows: filteredCount,
      writtenRows: mappedRows.length,
      message: 'DASHBOARD refreshed successfully'
    };

  } catch (error) {
    // Log error with context
    logError('refreshDashboard', error, {
      operation: 'dashboard_refresh',
      severity: 'HIGH'
    });

    // Show user-friendly error message
    const errorMsg = 'Failed to refresh DASHBOARD: ' + error.message;
    SpreadsheetApp.getUi().alert('Refresh Failed', errorMsg, SpreadsheetApp.getUi().ButtonSet.OK);

    throw error;
  }
}

/**
 * Adds "Refresh Dashboard" menu option to the Sales Tools menu
 * Should be called from the main onOpen() function in core_saleslogPro.js
 *
 * Note: This function provides the menu item definition.
 * Integration into the main menu should be done in core_saleslogPro.js onOpen()
 */
function addDashboardMenuItem() {
  try {
    const ui = SpreadsheetApp.getUi();
    // This would be integrated into the existing Sales Tools menu
    // Example integration code for core_saleslogPro.js:
    // menu.addItem("Refresh Dashboard", "refreshDashboard")
    Logger.log('[Dashboard Menu] Menu item ready for integration');
  } catch (error) {
    Logger.log('[Dashboard Menu] Error adding menu item: ' + error.toString());
  }
}

/**
 * Creates an installable onOpen trigger for this module
 * This is an alternative if you want a separate menu, but it's better
 * to integrate into the existing Sales Tools menu in core_saleslogPro.js
 */
function createDashboardMenu() {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('Dashboard Tools')
      .addItem('Refresh Dashboard', 'refreshDashboard')
      .addToUi();
  } catch (error) {
    logError('createDashboardMenu', error);
  }
}
