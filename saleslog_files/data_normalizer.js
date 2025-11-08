'use strict';

/**
 * Data Normalizer Module for Sales Log Pro
 * Normalizes and reformats daily sales data from MONTHLY sheet for CDK integration
 *
 * This module provides functionality to:
 * - Extract and normalize sales data from the MONTHLY sheet
 * - Separate New and Used car sales into individual records
 * - Create a CDK_MERGED sheet with standardized format
 * - Automatically merge with CDK_DATA for comprehensive reporting
 * - Highlight unmatched records for manual review
 *
 * Key Features:
 * - Date row detection using instanceof Date check
 * - FI flag validation using isValidFIFlag() (accepts A-Z or "BD")
 * - Separate extraction for New (B-G) and Used (I-N) columns
 * - Case-insensitive stock number matching
 * - Automatic unmatched row highlighting (#FFFFE0)
 *
 * @module data_normalizer
 * @requires error_logger
 * @requires utilities_locks
 */

/**
 * Normalizes and reformats daily sales data from MONTHLY sheet
 * Creates CDK_MERGED sheet with separated New/Used records
 * Automatically merges with CDK_DATA if available
 *
 * This function:
 * 1. Reads all data from MONTHLY sheet (columns A:N)
 * 2. Detects date rows (merged cells with Date objects)
 * 3. Extracts New car sales (columns B-G) and Used car sales (columns I-N)
 * 4. Validates FI flags using isValidFIFlag() (accepts A-Z or "BD")
 * 5. Creates/replaces CDK_MERGED sheet with normalized data
 * 6. Applies header formatting (bold, centered)
 * 7. Automatically calls mergeCDKData() for integration
 * 8. Shows completion alert to user
 *
 * Output Format (CDK_MERGED sheet):
 * - Column A: Date
 * - Column B: Type (NEW or USED)
 * - Column C: Customer
 * - Column D: FI
 * - Column E: Model
 * - Column F: StockNo (ALWAYS in column F)
 * - Column G: Trade
 * - Column H: Sales Person
 * - Columns I-Z: CDK data (appended by mergeCDKData) - 18 columns from CDK_DATA sheet (A-Q)
 * @returns {void}
 * @throws {Error} If MONTHLY sheet is missing or cannot be accessed
 */
function reformatDailySales() {
  withScriptLock(() => {
    try {
      logInfo('reformatDailySales', 'Starting data normalization process');
      toastInfo('Normalizing sales log data...', 'Working');

      // Validate required sheets exist
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const monthlySheet = ss.getSheetByName('MONTHLY');

      if (!monthlySheet) {
        const errorMsg = 'MONTHLY sheet not found. Cannot proceed with normalization.';
        logError('reformatDailySales', errorMsg);
        alertError(errorMsg, 'Sheet Missing');
        return;
      }

      // Read all data from MONTHLY sheet (columns A:N)
      const data = monthlySheet.getRange('A:N').getValues();
      const output = [];
      let currentDate = '';

      logInfo('reformatDailySales', 'Processing MONTHLY sheet data', {
        totalRows: data.length
      });

      // Process each row
      for (let i = 0; i < data.length; i++) {
        const row = data[i];

        // Detect a date row (merged date previously in column A)
        if (row[0] instanceof Date) {
          currentDate = row[0];
          continue;
        }

        // Skip blank rows
        const isEmpty = row.join('').trim() === '';
        if (isEmpty) continue;

        // NEW sale block (columns B-G → indexes 1-6)
        const newData = row.slice(1, 7);
        // Filter out rows that do not have a valid FI initial
        const hasNewFI = newData[1] && isValidFIFlag(String(newData[1]));
        if (newData.join('').trim() !== '' && hasNewFI) {
          output.push([currentDate, 'NEW', ...newData]);
        }

        // USED sale block (columns I-N → indexes 8-13)
        const usedData = row.slice(8, 14);
        // Filter out rows that do not have a valid FI initial
        const hasUsedFI = usedData[1] && isValidFIFlag(String(usedData[1]));
        if (usedData.join('').trim() !== '' && hasUsedFI) {
          output.push([currentDate, 'USED', ...usedData]);
        }
      }

      logInfo('reformatDailySales', 'Data extraction complete', {
        recordsExtracted: output.length
      });

      if (output.length === 0) {
        showCustomAlert(
          'No Data Found',
          'No valid sales records found in MONTHLY sheet. ' +
          'Ensure the sheet has data with valid FI flags (single letters A-Z or "BD").'
        );
        return;
      }

      // Create or clear CDK_MERGED sheet
      let cleanedSheet = ss.getSheetByName('CDK_MERGED');
      if (!cleanedSheet) {
        cleanedSheet = ss.insertSheet('CDK_MERGED');
        logInfo('reformatDailySales', 'Created new CDK_MERGED sheet');
      } else {
        cleanedSheet.clear();
        logInfo('reformatDailySales', 'Cleared existing CDK_MERGED sheet');
      }

      // Define headers for CDK_MERGED sheet
      // First 8 columns are from sales log, remaining will be CDK data
      const headers = [
        'Date',
        'Type',
        'Customer',
        'FI',
        'Model',
        'StockNo',
        'Trade',
        'Sales Person',
        // CDK_DATA headers (will be merged) - matches header-rules.md structure (KEY column removed)
        'Contract Date',
        'Deal No.',
        'Stock No.',
        'Customer',
        'Salesperson',
        'Sales Manager',
        'FI Manager',
        'StockType',
        'VIN',
        'Sale Type',
        'PLC',
        'Term',
        'Front GP$',
        'Back GP$',
        'GP$',
        'Comments',
        'RDR',
        'Age'  // Column Z (index 25) - populated from VSALES column G (Days in Stock)
      ];

      // Set header format
      cleanedSheet.getRange(1, 1, 1, headers.length)
        .setValues([headers])
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('center');

      // Write normalized data
      if (output.length > 0) {
        cleanedSheet.getRange(2, 1, output.length, output[0].length)
          .setValues(output);
      }

      logInfo('reformatDailySales', 'CDK_MERGED sheet populated', {
        headers: headers.length,
        dataRows: output.length
      });

      toastInfo('Merging with CDK data...', 'Working');

      // Merge CDK_DATA with CDK_MERGED sheet
      const mergeStats = mergeCDKData();

      // Show completion message with statistics
      const summaryMsg =
        `Sales log data has been normalized and merged.\n\n` +
        `Records Processed: ${output.length}\n` +
        `CDK Matches Found: ${mergeStats.matchCount}\n` +
        `Unmatched Records: ${mergeStats.noMatchCount}\n\n` +
        `Results are available in the "CDK_MERGED" sheet.\n` +
        `${mergeStats.noMatchCount > 0 ? 'Unmatched rows are highlighted in yellow.' : ''}`;

      showCustomAlert('Normalization Complete', summaryMsg);

      logInfo('reformatDailySales', 'Normalization process completed successfully', {
        totalRecords: output.length,
        matchCount: mergeStats.matchCount,
        noMatchCount: mergeStats.noMatchCount
      });

    } catch (error) {
      logError('reformatDailySales', error);
      alertError(
        'An error occurred during data normalization: ' + error.message,
        'Normalization Error'
      );
    }
  });
}

/**
 * Merges CDK_DATA sheet with CDK_MERGED sheet by matching Stock No. values
 * Also merges Age data from VSALES sheet using Deal No. matching
 * Uses dynamic header detection and case-insensitive matching
 *
 * This function:
 * 1. Validates CDK_MERGED and CDK_DATA sheets exist
 * 2. Dynamically detects header positions for 'StockNo' and 'Stock No.'
 * 3. Builds a Map of CDK data with case-insensitive keys
 * 4. Builds a Map of VSALES data keyed by Deal No. for Age lookup
 * 5. Matches records and appends CDK columns + Age from VSALES to CDK_MERGED sheet
 * 6. Highlights unmatched rows in both sheets with #FFFFE0 (light yellow)
 * 7. Returns statistics about the merge operation
 *
 * IMPORTANT NOTES:
 * - StockNo will ALWAYS be column F in CDK_MERGED sheet
 * - CDK_DATA Stock No. is dynamically detected but expected in column D
 * - Age data is sourced from VSALES column G (Days in Stock) and mapped to CDK_MERGED column Z
 * - Age matching uses Deal No. from CDK_DATA column B matched to VSALES column A
 * - Case-insensitive matching handles variations in stock number format
 * - Only first 8 columns from CDK_MERGED are preserved (A-H)
 * - Unmatched rows are highlighted for manual review
 *
 * @returns {Object} Statistics {matchCount, noMatchCount, totalRows}
 * @throws {Error} If required sheets or columns are not found
 */
function mergeCDKData() {
  try {
    logInfo('mergeCDKData', 'Starting CDK data merge operation');

    // === VALIDATION ===
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cleanedSheet = ss.getSheetByName('CDK_MERGED');
    const cdkSheet = ss.getSheetByName('CDK_DATA');
    const vsalesSheet = ss.getSheetByName('VSALES');

    if (!cleanedSheet || !cdkSheet) {
      const missingSheets = [];
      if (!cleanedSheet) missingSheets.push('CDK_MERGED');
      if (!cdkSheet) missingSheets.push('CDK_DATA');

      const errorMsg = `Required sheets not found: ${missingSheets.join(', ')}`;
      logWarning('mergeCDKData', errorMsg);

      // Return empty stats if CDK_DATA doesn't exist (non-critical)
      if (!cdkSheet) {
        logInfo('mergeCDKData', 'CDK_DATA sheet not found, skipping merge');
        return { matchCount: 0, noMatchCount: 0, totalRows: 0 };
      }

      throw new Error(errorMsg);
    }

    // === DYNAMIC HEADER DETECTION ===
    const cleanedHeaders = cleanedSheet.getRange(1, 1, 1, cleanedSheet.getLastColumn()).getValues()[0];
    const cdkHeaders = cdkSheet.getRange(1, 1, 1, cdkSheet.getLastColumn()).getValues()[0];

    const cleanedKeyIndex = cleanedHeaders.indexOf('StockNo');
    const cdkKeyIndex = cdkHeaders.indexOf('Stock No.');

    if (cleanedKeyIndex === -1 || cdkKeyIndex === -1) {
      const errorMsg =
        'Key columns not found: ' +
        (cleanedKeyIndex === -1 ? 'StockNo in CDK_MERGED ' : '') +
        (cdkKeyIndex === -1 ? 'Stock No. in CDK_DATA' : '');
      logError('mergeCDKData', errorMsg);
      throw new Error(errorMsg);
    }

    logInfo('mergeCDKData', 'Header detection complete', {
      cleanedKeyIndex: cleanedKeyIndex,
      cdkKeyIndex: cdkKeyIndex
    });

    // === DATA READING ===
    const cleanedData = cleanedSheet.getDataRange().getValues().slice(1); // Skip header
    const cdkData = cdkSheet.getDataRange().getValues().slice(1); // Skip header

    // Early return for empty sheets
    if (cleanedData.length === 0) {
      logWarning('mergeCDKData', 'CDK_MERGED sheet is empty. No merge needed.');
      return { matchCount: 0, noMatchCount: 0, totalRows: 0 };
    }

    if (cdkData.length === 0) {
      logWarning('mergeCDKData', 'CDK_DATA sheet is empty. Skipping merge.');
      return { matchCount: 0, noMatchCount: cleanedData.length, totalRows: cleanedData.length };
    }

    logInfo('mergeCDKData', 'Data loaded', {
      cleanedRows: cleanedData.length,
      cdkRows: cdkData.length
    });

    // === MAP BUILDING with CASE-INSENSITIVE keys ===
    const cdkMap = new Map();
    for (let row of cdkData) {
      const key = String(row[cdkKeyIndex]).trim().toUpperCase(); // Case insensitive
      if (key) cdkMap.set(key, row);
    }

    logInfo('mergeCDKData', 'CDK Map built', { mapSize: cdkMap.size });

    // === BUILD VSALES MAP for Age lookup ===
    // VSALES column A: Deal No., column G: Days in Stock (Age)
    const vsalesMap = new Map();
    if (vsalesSheet) {
      const vsalesData = vsalesSheet.getDataRange().getValues().slice(1); // Skip header
      for (let row of vsalesData) {
        const dealNo = String(row[0]).trim(); // Column A: Deal No.
        const age = row[6]; // Column G: Days in Stock (index 6, 0-based)
        if (dealNo) {
          vsalesMap.set(dealNo, age);
        }
      }
      logInfo('mergeCDKData', 'VSALES Map built for Age lookup', { mapSize: vsalesMap.size });
    } else {
      logWarning('mergeCDKData', 'VSALES sheet not found. Age data will not be populated.');
    }

    // === MERGE LOGIC with TRACKING ===
    let matchCount = 0;
    let noMatchCount = 0;
    const unmatchedCleanedRows = []; // Track unmatched CDK_MERGED row indices (1-based, accounting for header)
    const matchedCDKKeys = new Set(); // Track which CDK Stock No. values were matched

    const mergedData = cleanedData.map((cleanedRow, index) => {
      const key = String(cleanedRow[cleanedKeyIndex]).trim().toUpperCase(); // Case insensitive
      const cdkRow = cdkMap.get(key);

      if (cdkRow) {
        matchCount++;
        matchedCDKKeys.add(key); // Track this CDK key as matched
        
        // Get Age from VSALES using Deal No. from CDK_DATA column B (index 1)
        const dealNo = String(cdkRow[1]).trim(); // CDK_DATA column B: Deal No.
        const age = vsalesMap.has(dealNo) ? vsalesMap.get(dealNo) : '';
        
        // Only take first 8 columns from CDK_MERGED (A-H), then append CDK data (I-X),
        // then RDR (Y, empty for now), then Age from VSALES (Z)
        return [...cleanedRow.slice(0, 8), ...cdkRow, '', age];
      } else {
        noMatchCount++;
        unmatchedCleanedRows.push(index + 2); // +2 because: +1 for 0-based to 1-based, +1 for header row
        if (key) {
          logInfo('mergeCDKData', `No match found for Stock No: ${key}`, {
            rowIndex: index + 2
          });
        }
        // For unmatched rows, also only keep first 8 columns to maintain consistency
        return cleanedRow.slice(0, 8);
      }
    });

    // === ROW PADDING ===
    if (mergedData.length > 0) {
      const maxCols = Math.max(...mergedData.map(row => row.length));
      const paddedData = mergedData.map(row => {
        const padded = [...row];
        while (padded.length < maxCols) {
          padded.push('');
        }
        return padded;
      });

      // === WRITE BACK (batch operation) ===
      cleanedSheet.getRange(2, 1, paddedData.length, maxCols).setValues(paddedData);
      SpreadsheetApp.flush(); // Ensure write completion

      logInfo('mergeCDKData', 'Merged data written to CDK_MERGED sheet', {
        rows: paddedData.length,
        columns: maxCols
      });

      // === CLEAR EXISTING BACKGROUND COLORS ===
      // Clear backgrounds from CDK_MERGED sheet (data rows only, preserve header)
      const cleanedLastRow = cleanedSheet.getLastRow();
      const cleanedLastCol = cleanedSheet.getLastColumn();
      if (cleanedLastRow > 1 && cleanedLastCol > 0) {
        cleanedSheet.getRange(2, 1, cleanedLastRow - 1, cleanedLastCol).setBackground(null);
      }

      // Clear backgrounds from CDK_DATA sheet (data rows only, preserve header)
      const cdkLastRow = cdkSheet.getLastRow();
      const cdkLastCol = cdkSheet.getLastColumn();
      if (cdkLastRow > 1 && cdkLastCol > 0) {
        cdkSheet.getRange(2, 1, cdkLastRow - 1, cdkLastCol).setBackground(null);
      }

      logInfo('mergeCDKData', 'Cleared existing background colors from both sheets');

      // === CONDITIONAL FORMATTING for unmatched rows ===
      // Format unmatched rows in CDK_MERGED sheet with light yellow background
      if (unmatchedCleanedRows.length > 0) {
        const cleanedRanges = unmatchedCleanedRows.map(rowIndex =>
          cleanedSheet.getRange(rowIndex, 1, 1, maxCols)
        );
        const cleanedRangeList = cleanedSheet.getRangeList(cleanedRanges.map(r => r.getA1Notation()));
        cleanedRangeList.setBackground('#FFFFE0');
        logInfo('mergeCDKData', `Highlighted ${unmatchedCleanedRows.length} unmatched rows in CDK_MERGED sheet`);
      }

      // Format unmatched rows in CDK_DATA sheet
      const unmatchedCDKRows = [];
      cdkData.forEach((row, index) => {
        const key = String(row[cdkKeyIndex]).trim().toUpperCase();
        if (key && !matchedCDKKeys.has(key)) {
          unmatchedCDKRows.push(index + 2); // +2 for 0-based to 1-based, +1 for header
        }
      });

      if (unmatchedCDKRows.length > 0) {
        const cdkMaxCols = cdkSheet.getLastColumn();
        const cdkRanges = unmatchedCDKRows.map(rowIndex =>
          cdkSheet.getRange(rowIndex, 1, 1, cdkMaxCols)
        );
        const cdkRangeList = cdkSheet.getRangeList(cdkRanges.map(r => r.getA1Notation()));
        cdkRangeList.setBackground('#FFFFE0');
        logInfo('mergeCDKData', `Highlighted ${unmatchedCDKRows.length} unmatched rows in CDK_DATA sheet`);
      }
    }

    // === COMPREHENSIVE LOGGING ===
    const stats = {
      matchCount: matchCount,
      noMatchCount: noMatchCount,
      totalRows: mergedData.length
    };

    const matchRate = mergedData.length > 0
      ? ((matchCount / mergedData.length) * 100).toFixed(1)
      : '0.0';

    logInfo('mergeCDKData', `Merge complete: ${matchCount} matches found, ${noMatchCount} rows without matches (${matchRate}% match rate)`, stats);

    return stats;

  } catch (error) {
    logError('mergeCDKData', error);
    throw error;
  }
}
