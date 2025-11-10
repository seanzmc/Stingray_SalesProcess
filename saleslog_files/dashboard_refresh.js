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
 * Column Mapping (CDK_MERGED -> DASHBOARD):
 * - A (Date) -> A
 * - Y (RDR Date) -> B
 * - K (Deal #) -> C
 * - L (Stock #) -> D
 * - C (Customer Name) -> E
 * - H (Sales Person) -> F
 * - O (Sales Manager) -> G
 * - Conditional (Punched) -> H
 * - B (Type/New/Used) -> I
 * - Conditional (Make) -> J
 * - E (Model) -> K
 * - Z (Age) -> L
 * - G (Trade in) -> M
 * - Conditional (F/C/L based on T/PLC and U/Term) -> N
 * - V (Front GP$) -> O
 * - W (Back GP$) -> P
 * - X (Total GP$) -> Q
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
 * Builds a lookup map of Deal No. -> Make from the VSALES sheet
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} vsalesSheet - VSALES sheet reference
 * @returns {Map<string, string>} Map of normalized deal numbers to make values
 */
function buildVsalesMakeMap(vsalesSheet) {
  const makeMap = new Map();
  if (!vsalesSheet) {
    return makeMap;
  }

  const lastRow = vsalesSheet.getLastRow();
  if (lastRow < 2) {
    return makeMap;
  }

  const numRows = lastRow - 1;
  const data = vsalesSheet.getRange(2, 1, numRows, 5).getValues(); // Columns A:E (Deal No., ..., Make)

  data.forEach(row => {
    const dealKey = normalizeDealKey(row[0]);
    if (!dealKey) return;
    const makeValue = row[4] || '';
    makeMap.set(dealKey, makeValue);
  });

  return makeMap;
}

/**
 * Retrieves the Make from the VSALES map using Deal No.
 *
 * @param {*} dealNoValue - Deal number from CDK_MERGED row
 * @param {Map<string, string>} vsalesMakeMap - Lookup map
 * @returns {string} Make value if found, otherwise empty string
 */
function getVsalesMake(dealNoValue, vsalesMakeMap) {
  if (!vsalesMakeMap || !(vsalesMakeMap instanceof Map)) {
    return '';
  }
  const key = normalizeDealKey(dealNoValue);
  if (!key) {
    return '';
  }
  return vsalesMakeMap.get(key) || '';
}

/**
 * Maps a single row from CDK_MERGED to DASHBOARD format
 * Applies all column mapping rules and conditional logic
 * 
 * @param {Array} sourceRow - Row from CDK_MERGED sheet (0-indexed array)
 * @param {Map<string, string>} vsalesMakeMap - Lookup map for Deal No. -> Make
 * @returns {Array} Mapped row for DASHBOARD sheet (17 columns A-Q)
 */
function mapRowToDashboard(sourceRow, vsalesMakeMap) {
  // Initialize output row with 17 columns (A-Q)
  const outputRow = new Array(17).fill('');
  
  // Column A: Date (CDK_MERGED column A, index 0)
  outputRow[0] = sourceRow[0] || '';
  
  // Column B: RDR Date (CDK_MERGED column Y, index 24)
  const rdrDateValue = sourceRow[24] || '';
  outputRow[1] = rdrDateValue;
  
  // Column C: Deal # (CDK_MERGED column K [Deal No.], index 10)
  const dealNumberValue = sourceRow[10] || '';
  outputRow[2] = dealNumberValue;
  
  // Column D: Stock # (CDK_MERGED column L [Stock No.], index 11)
  outputRow[3] = sourceRow[11] || '';

  // Column E: Customer Name (CDK_MERGED column C [Customer], index 2)
  outputRow[4] = sourceRow[2] || '';

  // Column F: Sales Rep (CDK_MERGED column H [Sales Person], index 7)
  outputRow[5] = sourceRow[7] || '';

  // Column G: Sales Mgr (CDK_MERGED column O [Sales Manager], index 14)
  outputRow[6] = sourceRow[14] || '';

  // Column H: Punched (conditional logic based on RDR Date)
  const newUsedValue = sourceRow[1] || '';
  outputRow[7] = getPunchedValue(rdrDateValue);

  // Column I: New/Used (CDK_MERGED column B [Type], index 1)
  outputRow[8] = sourceRow[1] || '';
  
  // Column J: Make (VSALES lookup via Deal No., fallback to NEW logic)
  const vsalesMake = getVsalesMake(dealNumberValue, vsalesMakeMap);
  outputRow[9] = vsalesMake || getMakeValue(newUsedValue);

  // Column K: Model (CDK_MERGED column E [Model], index 4)
  outputRow[10] = sourceRow[4] || '';

  // Column L: Age (CDK_MERGED column Z [Age], index 25)
  outputRow[11] = sourceRow[25] || '';

  // Column M: Trade in (CDK_MERGED column G [Trade], index 6)
  outputRow[12] = sourceRow[6] || '';

  // Column N: F/C/L (conditional logic based on column U [Term] and column T [PLC])
  const termValue = sourceRow[20] || ''; // Column U [Term] (index 20)
  const plcValue = sourceRow[19] || ''; // Column T [PLC] (index 19)
  outputRow[13] = getFCLValue(termValue, plcValue);

  // Column O: Front Gross (CDK_MERGED column V [Front GP$], index 21)
  outputRow[14] = sourceRow[21] ?? '';

  // Column P: Back Gross (CDK_MERGED column W [Back GP$], index 22)
  outputRow[15] = sourceRow[22] ?? '';

  // Column Q: Total Gross (CDK_MERGED column X [GP$], index 23)
  outputRow[16] = sourceRow[23] ?? '';

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
    const vsalesMakeMap = buildVsalesMakeMap(vsalesSheet);
    Logger.log(`[Dashboard Refresh] Loaded ${vsalesMakeMap.size} VSALES make entries`);

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
      const mappedRow = mapRowToDashboard(allData[i], vsalesMakeMap);
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
