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
 * - B (Skip) -> B
 * - I (Deal #) -> C
 * - F (Stock #) -> D
 * - J (Customer Name) -> E
 * - H (Sales Rep) -> F
 * - Skip -> G
 * - Conditional (Punched) -> H
 * - B (New/Used) -> I
 * - Conditional (Make) -> J
 * - E (Model) -> K
 * - Skip -> L
 * - G (Trade in) -> M
 * - Conditional (F/C/L) -> N
 * - T (Front Gross) -> O
 * - U (Back Gross) -> P
 * - V (Total Gross) -> Q
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
 * Rule: IF CDK_MERGED column B equals 'NEW' THEN 'Y', ELSE 'USED'
 * 
 * @param {string} newUsedValue - Value from CDK_MERGED column B
 * @returns {string} 'Y' for new vehicles, 'USED' for others
 */
function getPunchedValue(newUsedValue) {
  const normalized = String(newUsedValue || '').trim().toUpperCase();
  return normalized === 'NEW' ? 'Y' : 'USED';
}

/**
 * Applies conditional logic for Make column (J)
 * Rule: IF CDK_MERGED column B equals 'NEW' THEN 'CHEV', ELSE leave empty
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
 * - IF column N equals 'L' THEN 'L'
 * - ELSE IF column AC does not equal 'CASH' THEN 'F'
 * - ELSE 'C'
 * 
 * @param {string} paymentType - Value from CDK_MERGED column AC
 * @param {string} existingFCL - Value from CDK_MERGED column N
 * @returns {string} 'L', 'F', or 'C'
 */
function getFCLValue(paymentType, existingFCL) {
  const normalizedFCL = String(existingFCL || '').trim().toUpperCase();
  const normalizedPayment = String(paymentType || '').trim().toUpperCase();
  
  // First check: if existing value is 'L', keep it
  if (normalizedFCL === 'L') {
    return 'L';
  }
  
  // Second check: if not cash payment, mark as finance
  if (normalizedPayment !== 'CASH') {
    return 'F';
  }
  
  // Default: cash payment
  return 'C';
}

/**
 * Maps a single row from CDK_MERGED to DASHBOARD format
 * Applies all column mapping rules and conditional logic
 * 
 * @param {Array} sourceRow - Row from CDK_MERGED sheet (0-indexed array)
 * @returns {Array} Mapped row for DASHBOARD sheet (17 columns A-Q)
 */
function mapRowToDashboard(sourceRow) {
  // Initialize output row with 17 columns (A-Q)
  const outputRow = new Array(17).fill('');
  
  // Column A: Date (CDK_MERGED column A, index 0)
  outputRow[0] = sourceRow[0] || '';
  
  // Column B: Date Reported (SKIP - leave empty)
  outputRow[1] = '';
  
  // Column C: Deal # (CDK_MERGED column I, index 8)
  outputRow[2] = sourceRow[8] || '';
  
  // Column D: Stock # (CDK_MERGED column F, index 5)
  outputRow[3] = sourceRow[5] || '';
  
  // Column E: Customer Name (CDK_MERGED column J, index 9)
  outputRow[4] = sourceRow[9] || '';
  
  // Column F: Sales Rep (CDK_MERGED column H, index 7)
  outputRow[5] = sourceRow[7] || '';
  
  // Column G: Sales Mgr (SKIP - leave empty)
  outputRow[6] = '';
  
  // Column H: Punched (conditional logic based on column B)
  const newUsedValue = sourceRow[1] || '';
  outputRow[7] = getPunchedValue(newUsedValue);
  
  // Column I: New/Used (CDK_MERGED column B, index 1)
  outputRow[8] = sourceRow[1] || '';
  
  // Column J: Make (conditional logic based on column B)
  outputRow[9] = getMakeValue(newUsedValue);
  
  // Column K: Model (CDK_MERGED column E, index 4)
  outputRow[10] = sourceRow[4] || '';
  
  // Column L: Age (SKIP - leave empty)
  outputRow[11] = '';
  
  // Column M: Trade in (CDK_MERGED column G, index 6)
  outputRow[12] = sourceRow[6] || '';
  
  // Column N: F/C/L (conditional logic based on columns AC and N)
  const paymentType = sourceRow[28] || ''; // Column AC (index 28)
  const existingFCL = sourceRow[13] || ''; // Column N (index 13)
  outputRow[13] = getFCLValue(paymentType, existingFCL);
  
  // Column O: Front Gross (CDK_MERGED column T, index 19)
  outputRow[14] = sourceRow[19] || '';
  
  // Column P: Back Gross (CDK_MERGED column U, index 20)
  outputRow[15] = sourceRow[20] || '';
  
  // Column Q: Total Gross (CDK_MERGED column V, index 21)
  outputRow[16] = sourceRow[21] || '';
  
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
      const mappedRow = mapRowToDashboard(allData[i]);
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