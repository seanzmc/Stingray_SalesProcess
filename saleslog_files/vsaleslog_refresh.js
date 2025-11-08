/**
 * vsaleslog_refresh.js - V-SALESLOG Sheet Processing Module
 * 
 * Merges CDK_DATA and VSALES sheets into V-SALESLOG, then appends new data to DASHBOARD.
 * 
 * Features:
 * - Two-step process: merge source sheets -> append to dashboard
 * - Batch read/write operations for efficiency
 * - Match-based merging using Deal No. as key
 * - Append-only to DASHBOARD (no replacements)
 * - Trade-in lookup from TODAY sheet
 * - Comprehensive error handling and logging
 * 
 * Functions:
 * - mergeToVSalesLog(): Merges CDK_DATA + VSALES -> V-SALESLOG
 * - vSalesLog(): Appends new V-SALESLOG rows to DASHBOARD
 */

/**
 * Looks up trade-in value from TODAY sheet based on stock number and type
 * 
 * Logic:
 * - If NEW: Match Stock No in TODAY col E, return col F
 * - If USED: Match Stock No in TODAY col L, return col M
 * - Returns empty string if no match or invalid type
 * 
 * @param {string} stockNo - Stock number to lookup
 * @param {string} stockType - Type: 'NEW' or 'USED'
 * @param {Array<Array>} todayData - All data from TODAY sheet (for batch lookup)
 * @returns {string} Trade-in value or empty string
 */
function lookupTradeIn(stockNo, stockType, todayData) {
  if (!stockNo || !stockType || !todayData || todayData.length < 2) {
    return '';
  }
  
  const normalizedType = String(stockType).trim().toUpperCase();
  const normalizedStockNo = String(stockNo).trim();
  
  // Skip header row, iterate through data
  for (let i = 1; i < todayData.length; i++) {
    const row = todayData[i];
    
    if (normalizedType === 'NEW') {
      // Match col E (index 4), return col F (index 5)
      if (String(row[4] || '').trim() === normalizedStockNo) {
        return row[5] || '';
      }
    } else if (normalizedType === 'USED') {
      // Match col L (index 11), return col M (index 12)
      if (String(row[11] || '').trim() === normalizedStockNo) {
        return row[12] || '';
      }
    }
  }
  
  return '';
}

/**
 * Calculates Punched value based on RDR Date
 * Rule: IF RDR Date is empty THEN empty, ELSE "Y"
 *
 * @param {string} rdrDate - RDR Date value
 * @returns {string} "Y" if date exists, empty otherwise
 */
function getPunchedValueFromRDR(rdrDate) {
  const normalized = String(rdrDate || '').trim();
  return normalized ? 'Y' : '';
}

/**
 * Applies conditional logic for F/C/L column (N) in V-SALESLOG
 * Rule:
 * - IF PLC (CDK_DATA column K, index 10) equals 'L' THEN 'L'
 * - ELSE IF Term (CDK_DATA column L, index 11) equals 'Cash' THEN 'C'
 * - ELSE 'F'
 *
 * @param {string} plcValue - Value from CDK_DATA column K (PLC, index 10)
 * @param {string} termValue - Value from CDK_DATA column L (Term, index 11)
 * @returns {string} 'L', 'C', or 'F'
 */
function getFCLValueVSales(plcValue, termValue) {
  const normalizedPLC = String(plcValue || '').trim().toUpperCase();
  const normalizedTerm = String(termValue || '').trim().toUpperCase();
  
  // First check: if PLC is 'L', mark as lease
  if (normalizedPLC === 'L') {
    return 'L';
  }
  
  // Second check: if Term is 'CASH', mark as cash
  if (normalizedTerm === 'CASH') {
    return 'C';
  }
  
  // Default: finance
  return 'F';
}

/**
 * Merges a CDK_DATA row with its matching VSALES row into V-SALESLOG format
 *
 * @param {Array} cdkRow - Row from CDK_DATA sheet (0-indexed)
 * @param {Array} vsalesRow - Matching row from VSALES sheet (0-indexed, or null if no match)
 * @param {string} tradeInValue - Pre-looked-up trade-in value from TODAY sheet
 * @returns {Array} Merged row for V-SALESLOG (17 columns A-Q)
 */
function mergeRowToVSalesLog(cdkRow, vsalesRow, tradeInValue) {
  // Initialize output row with 17 columns (A-Q)
  const outputRow = new Array(17).fill('');
  
  // Column A: Date ← CDK_DATA A (index 0, Contract Date)
  outputRow[0] = cdkRow[0] || '';
  
  // Column B: RDR Date ← CDK_DATA Q (index 16)
  outputRow[1] = cdkRow[16] || '';
  
  // Column C: Deal # ← CDK_DATA B (index 1)
  outputRow[2] = cdkRow[1] || '';
  
  // Column D: Stock # ← CDK_DATA C (index 2)
  outputRow[3] = cdkRow[2] || '';
  
  // Column E: Customer Name ← CDK_DATA D (index 3)
  outputRow[4] = cdkRow[3] || '';
  
  // Column F: Sales Rep ← VSALES I (index 8)
  outputRow[5] = vsalesRow ? (vsalesRow[8] || '') : '';
  
  // Column G: Sales Mgr ← VSALES K (index 10)
  outputRow[6] = vsalesRow ? (vsalesRow[10] || '') : '';
  
  // Column H: Punched ← Formula: IF(B="";""; "Y") where B is RDR Date
  const rdrDate = outputRow[1];
  outputRow[7] = getPunchedValueFromRDR(rdrDate);
  
  // Column I: New/Used ← CDK_DATA H (index 7, StockType)
  outputRow[8] = cdkRow[7] || '';
  
  // Column J: Make ← VSALES E (index 4)
  outputRow[9] = vsalesRow ? (vsalesRow[4] || '') : '';
  
  // Column K: Model ← VSALES F (index 5)
  outputRow[10] = vsalesRow ? (vsalesRow[5] || '') : '';
  
  // Column L: Age ← VSALES G (index 6)
  outputRow[11] = vsalesRow ? (vsalesRow[6] || '') : '';
  
  // Column M: Trade in ← TODAY sheet lookup (pre-calculated)
  outputRow[12] = tradeInValue || '';
  
  // Column N: F/C/L (conditional logic based on PLC and Term)
  const plcValue = cdkRow[10] || ''; // Column K (PLC), index 10
  const termValue = cdkRow[11] || ''; // Column L (Term), index 11
  outputRow[13] = getFCLValueVSales(plcValue, termValue);
  
  // Column O: Front Gross ← CDK_DATA M (index 12)
  outputRow[14] = cdkRow[12] ?? '';
  
  // Column P: Back Gross ← CDK_DATA N (index 13)
  outputRow[15] = cdkRow[13] ?? '';
  
  // Column Q: Total Gross ← CDK_DATA O (index 14)
  outputRow[16] = cdkRow[14] ?? '';
  
  return outputRow;
}

/**
 * Main function to merge CDK_DATA and VSALES sheets into V-SALESLOG
 *
 * Process:
 * 1. Read all data from CDK_DATA, VSALES, and TODAY sheets
 * 2. Build a lookup map of VSALES rows by Deal No.
 * 3. For each CDK_DATA row, find matching VSALES row
 * 4. Filter out rows where Sale Type (column K) is "Wholesale"
 * 5. Look up trade-in value from TODAY sheet
 * 6. Merge rows into V-SALESLOG format
 * 7. Clear and rewrite V-SALESLOG sheet completely
 *
 * Column Mapping (CDK_DATA → V-SALESLOG):
 * - A: Date ← CDK_DATA A (index 0, Contract Date)
 * - B: RDR Date ← CDK_DATA Q (index 16)
 * - C: Deal # ← CDK_DATA B (index 1)
 * - D: Stock # ← CDK_DATA C (index 2)
 * - E: Customer Name ← CDK_DATA D (index 3)
 * - F: Sales Rep ← VSALES I
 * - G: Sales Mgr ← VSALES K
 * - H: Punched ← Calculated from RDR Date
 * - I: New/Used ← CDK_DATA H (index 7, StockType)
 * - J: Make ← VSALES E
 * - K: Model ← VSALES F
 * - L: Age ← VSALES G
 * - M: Trade in ← TODAY sheet lookup
 * - N: F/C/L ← Conditional logic (PLC=L→L; Term=CASH→C; else→F)
 * - O: Front Gross ← CDK_DATA M (index 12)
 * - P: Back Gross ← CDK_DATA N (index 13)
 * - Q: Total Gross ← CDK_DATA O (index 14)
 *
 * Filtering Rules:
 * - Excludes rows where CDK_DATA column J (Sale Type, index 9) contains "Wholesale" (case-insensitive)
 * - Skips rows without a Deal No.
 *
 * @returns {Object} Result object with success status and statistics
 * @throws {Error} If required sheets are missing or operation fails
 */
function mergeToVSalesLog() {
  try {
    Logger.log('[V-SALESLOG Merge] Starting merge process...');
    
    // Get required sheets with validation
    const cdkDataSheet = getSheetByNameOrThrow('CDK_DATA');
    const vsalesSheet = getSheetByNameOrThrow('VSALES');
    const todaySheet = getSheetByNameOrThrow('TODAY');
    
    // Get or create V-SALESLOG sheet
    const ss = SpreadsheetApp.getActive();
    let vSalesLogSheet = ss.getSheetByName('V-SALESLOG');
    if (!vSalesLogSheet) {
      vSalesLogSheet = ss.insertSheet('V-SALESLOG');
      Logger.log('[V-SALESLOG Merge] Created new V-SALESLOG sheet');
    }
    
    // Read data from source sheets
    const cdkLastRow = cdkDataSheet.getLastRow();
    const vsalesLastRow = vsalesSheet.getLastRow();
    const todayLastRow = todaySheet.getLastRow();
    
    if (cdkLastRow < 2) {
      Logger.log('[V-SALESLOG Merge] No data in CDK_DATA sheet');
      
      // Clear V-SALESLOG and write headers only
      vSalesLogSheet.clear();
      const headers = [
        'Date', 'RDR Date', 'Deal #', 'Stock #', 'Customer Name',
        'Sales Rep', 'Sales Mgr', 'Punched', 'New/Used', 'Make',
        'Model', 'Age', 'Trade in', 'F/C/L', 'Front Gross',
        'Back Gross', 'Total Gross'
      ];
      vSalesLogSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      
      SpreadsheetApp.getActive().toast(
        'No data found in CDK_DATA. V-SALESLOG cleared.',
        'Merge Complete',
        5
      );
      
      return {
        success: true,
        mergedRows: 0,
        message: 'No data to merge'
      };
    }
    
    // Batch read: CDK_DATA (skip header row 1, read columns A-Q = 17 columns)
    const cdkData = cdkDataSheet.getRange(2, 1, cdkLastRow - 1, 17).getValues();
    Logger.log(`[V-SALESLOG Merge] Read ${cdkData.length} rows from CDK_DATA`);
    
    // Batch read: VSALES (skip header row 1)
    const vsalesData = vsalesLastRow >= 2 
      ? vsalesSheet.getRange(2, 1, vsalesLastRow - 1, 15).getValues()
      : [];
    Logger.log(`[V-SALESLOG Merge] Read ${vsalesData.length} rows from VSALES`);
    
    // Batch read: TODAY sheet (all data for lookup)
    const todayData = todayLastRow >= 2
      ? todaySheet.getRange(1, 1, todayLastRow, todaySheet.getLastColumn()).getValues()
      : [];
    Logger.log(`[V-SALESLOG Merge] Read ${todayData.length} rows from TODAY`);
    
    // Build VSALES lookup map: Deal No. (col A, index 0) -> row
    const vsalesMap = {};
    for (let i = 0; i < vsalesData.length; i++) {
      const dealNo = String(vsalesData[i][0] || '').trim();
      if (dealNo) {
        vsalesMap[dealNo] = vsalesData[i];
      }
    }
    Logger.log(`[V-SALESLOG Merge] Built VSALES lookup map with ${Object.keys(vsalesMap).length} entries`);
    
    // Process and merge rows
    const mergedRows = [];
    let matchedCount = 0;
    let unmatchedCount = 0;
    let wholesaleCount = 0;
    
    for (let i = 0; i < cdkData.length; i++) {
      const cdkRow = cdkData[i];
      const dealNo = String(cdkRow[1] || '').trim(); // CDK_DATA col B (index 1, Deal No.)
      
      if (!dealNo) {
        continue; // Skip rows without Deal No.
      }
      
      // Filter out Wholesale rows (CDK_DATA column J, index 9, Sale Type)
      const saleType = String(cdkRow[9] || '').trim().toUpperCase();
      if (saleType === 'WHOLESALE') {
        wholesaleCount++;
        continue; // Skip wholesale rows
      }
      
      // Find matching VSALES row
      const vsalesRow = vsalesMap[dealNo] || null;
      
      if (vsalesRow) {
        matchedCount++;
      } else {
        unmatchedCount++;
      }
      
      // Look up trade-in value from TODAY sheet
      const stockNo = cdkRow[2] || ''; // CDK_DATA col C (index 2, Stock No.)
      const stockType = cdkRow[7] || ''; // CDK_DATA col H (index 7, StockType)
      const tradeInValue = lookupTradeIn(stockNo, stockType, todayData);
      
      // Merge row
      const mergedRow = mergeRowToVSalesLog(cdkRow, vsalesRow, tradeInValue);
      mergedRows.push(mergedRow);
    }
    
    Logger.log(`[V-SALESLOG Merge] Matched: ${matchedCount}, Unmatched: ${unmatchedCount}, Wholesale filtered: ${wholesaleCount}`);
    Logger.log(`[V-SALESLOG Merge] Total merged rows: ${mergedRows.length}`);
    
    // Clear existing V-SALESLOG data
    vSalesLogSheet.clear();
    
    // Write headers
    const headers = [
      'Date', 'RDR Date', 'Deal #', 'Stock #', 'Customer Name',
      'Sales Rep', 'Sales Mgr', 'Punched', 'New/Used', 'Make',
      'Model', 'Age', 'Trade in', 'F/C/L', 'Front Gross',
      'Back Gross', 'Total Gross'
    ];
    vSalesLogSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // Write merged data (starting at row 2)
    if (mergedRows.length > 0) {
      vSalesLogSheet.getRange(2, 1, mergedRows.length, 17).setValues(mergedRows);
      Logger.log(`[V-SALESLOG Merge] Wrote ${mergedRows.length} rows to V-SALESLOG`);
    }
    
    // Show success message
    SpreadsheetApp.getActive().toast(
      `V-SALESLOG updated: ${mergedRows.length} rows merged (${matchedCount} matched, ${unmatchedCount} unmatched, ${wholesaleCount} wholesale filtered).`,
      'Merge Complete',
      5
    );
    
    Logger.log('[V-SALESLOG Merge] Complete');
    
    return {
      success: true,
      mergedRows: mergedRows.length,
      matchedCount: matchedCount,
      unmatchedCount: unmatchedCount,
      wholesaleFilteredCount: wholesaleCount,
      message: 'V-SALESLOG merge successful'
    };
    
  } catch (error) {
    // Log error with context
    Logger.log(`[V-SALESLOG Merge] ERROR: ${error.message}`);
    Logger.log(`[V-SALESLOG Merge] Stack: ${error.stack}`);
    
    // Show user-friendly error message
    const errorMsg = 'Failed to merge to V-SALESLOG: ' + error.message;
    SpreadsheetApp.getUi().alert('Merge Failed', errorMsg, SpreadsheetApp.getUi().ButtonSet.OK);
    
    throw error;
  }
}

/**
 * Appends new rows from V-SALESLOG to DASHBOARD (append-only, no replacement)
 * 
 * Process:
 * 1. Read all data from V-SALESLOG sheet
 * 2. Read existing DASHBOARD data (rows 7+)
 * 3. Build set of existing Deal # values in DASHBOARD
 * 4. Filter V-SALESLOG rows to only those not in DASHBOARD
 * 5. Append new rows to DASHBOARD in single batch
 * 
 * DASHBOARD structure:
 * - Headers at row 6
 * - Data starts at row 7
 * - Uses same 17-column format (A-Q) as V-SALESLOG
 * 
 * @returns {Object} Result object with success status and statistics
 * @throws {Error} If required sheets are missing or operation fails
 */
function vSalesLog() {
  try {
    Logger.log('[V-SALESLOG Append] Starting append to DASHBOARD...');
    
    // Get required sheets with validation
    const vSalesLogSheet = getSheetByNameOrThrow('V-SALESLOG');
    const dashboardSheet = getSheetByNameOrThrow('DASHBOARD');
    
    // Read V-SALESLOG data (skip header row 1)
    const vslLastRow = vSalesLogSheet.getLastRow();
    
    if (vslLastRow < 2) {
      Logger.log('[V-SALESLOG Append] No data in V-SALESLOG sheet');
      
      SpreadsheetApp.getActive().toast(
        'No data found in V-SALESLOG. Nothing to append.',
        'Append Complete',
        5
      );
      
      return {
        success: true,
        appendedRows: 0,
        message: 'No data to append'
      };
    }
    
    const vslData = vSalesLogSheet.getRange(2, 1, vslLastRow - 1, 17).getValues();
    Logger.log(`[V-SALESLOG Append] Read ${vslData.length} rows from V-SALESLOG`);
    
    // Read existing DASHBOARD data (data starts at row 7)
    const dashLastRow = dashboardSheet.getLastRow();
    const existingData = dashLastRow >= 7
      ? dashboardSheet.getRange(7, 1, dashLastRow - 6, 17).getValues()
      : [];
    Logger.log(`[V-SALESLOG Append] Read ${existingData.length} existing rows from DASHBOARD`);
    
    // Build set of existing Deal # values (column C, index 2)
    const existingDealNumbers = new Set();
    for (let i = 0; i < existingData.length; i++) {
      const dealNo = String(existingData[i][2] || '').trim();
      if (dealNo) {
        existingDealNumbers.add(dealNo);
      }
    }
    Logger.log(`[V-SALESLOG Append] Found ${existingDealNumbers.size} unique Deal # in DASHBOARD`);
    
    // Filter V-SALESLOG rows to only new ones (not in DASHBOARD)
    const newRows = [];
    let skippedCount = 0;
    
    for (let i = 0; i < vslData.length; i++) {
      const row = vslData[i];
      const dealNo = String(row[2] || '').trim(); // Column C (index 2)
      
      if (!dealNo) {
        skippedCount++;
        continue; // Skip rows without Deal No.
      }
      
      if (existingDealNumbers.has(dealNo)) {
        skippedCount++;
        continue; // Skip rows already in DASHBOARD
      }
      
      newRows.push(row);
    }
    
    Logger.log(`[V-SALESLOG Append] Found ${newRows.length} new rows to append`);
    Logger.log(`[V-SALESLOG Append] Skipped ${skippedCount} rows (duplicates or empty)`);
    
    // Append new rows to DASHBOARD
    if (newRows.length > 0) {
      const nextRow = dashLastRow + 1;
      dashboardSheet.getRange(nextRow, 1, newRows.length, 17).setValues(newRows);
      Logger.log(`[V-SALESLOG Append] Appended ${newRows.length} rows starting at row ${nextRow}`);
    }
    
    // Show success message
    SpreadsheetApp.getActive().toast(
      `${newRows.length} new rows appended to DASHBOARD. ${skippedCount} duplicates skipped.`,
      'Append Complete',
      5
    );
    
    Logger.log('[V-SALESLOG Append] Complete');
    
    return {
      success: true,
      appendedRows: newRows.length,
      skippedRows: skippedCount,
      message: 'DASHBOARD append successful'
    };
    
  } catch (error) {
    // Log error with context
    Logger.log(`[V-SALESLOG Append] ERROR: ${error.message}`);
    Logger.log(`[V-SALESLOG Append] Stack: ${error.stack}`);
    
    // Show user-friendly error message
    const errorMsg = 'Failed to append to DASHBOARD: ' + error.message;
    SpreadsheetApp.getUi().alert('Append Failed', errorMsg, SpreadsheetApp.getUi().ButtonSet.OK);
    
    throw error;
  }
}

/**
 * Combined workflow: Merge to V-SALESLOG then append to DASHBOARD
 * 
 * This is a convenience function that runs both steps in sequence:
 * 1. mergeToVSalesLog() - Merge CDK_DATA + VSALES -> V-SALESLOG
 * 2. vSalesLog() - Append new V-SALESLOG rows to DASHBOARD
 * 
 * @returns {Object} Combined result object with statistics from both operations
 * @throws {Error} If either operation fails
 */
function processVSalesLogComplete() {
  try {
    Logger.log('[V-SALESLOG Complete] Starting full process...');
    
    // Step 1: Merge to V-SALESLOG
    const mergeResult = mergeToVSalesLog();
    Logger.log(`[V-SALESLOG Complete] Merge complete: ${mergeResult.mergedRows} rows`);
    
    // Step 2: Append to DASHBOARD
    const appendResult = vSalesLog();
    Logger.log(`[V-SALESLOG Complete] Append complete: ${appendResult.appendedRows} rows`);
    
    // Show combined success message
    SpreadsheetApp.getActive().toast(
      `Process complete: ${mergeResult.mergedRows} rows merged, ${appendResult.appendedRows} rows appended to DASHBOARD.`,
      'V-SALESLOG Process Complete',
      6
    );
    
    Logger.log('[V-SALESLOG Complete] Full process complete');
    
    return {
      success: true,
      merge: mergeResult,
      append: appendResult,
      message: 'Full V-SALESLOG process successful'
    };
    
  } catch (error) {
    Logger.log(`[V-SALESLOG Complete] ERROR: ${error.message}`);
    throw error;
  }
}