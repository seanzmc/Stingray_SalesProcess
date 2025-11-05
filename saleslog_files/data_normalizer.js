'use strict';

const NORMALIZED_SALES_HEADERS = [
  'Date',
  'Type',
  'Customer',
  'FI',
  'Model',
  'StockNo',
  'Trade',
  'Sales Person',
  'Deal Number',
  'Customer',
  'VIN',
  'Stock No.',
  'Status',
  'PLC',
  'Contract Date',
  'Sale Type',
  'Year',
  'Model',
  'StockType',
  'Front GP$',
  'Back GP$',
  'GP$',
  'Cash Price',
  'Trades',
  'Service Contract',
  'Finance Institution',
  'Salesperson',
  'Sales Manager',
  'FI Manager',
  'Term',
  'Comments',
  'Age'
];

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
 * - Columns I-AC: CDK data (appended by mergeCDKData)
 *
 * @returns {void}
 * @throws {Error} If MONTHLY sheet is missing or cannot be accessed
 */
function reformatDailySales() {
  withScriptLock(() => {
    try {
      const outputSheetName = 'CDK_MERGED';
      logInfo('reformatDailySales', 'Starting data normalization process');
      toastInfo('Normalizing sales log data...', 'Working');

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const monthlySheet = ss.getSheetByName('MONTHLY');

      if (!monthlySheet) {
        const errorMsg = 'MONTHLY sheet not found. Cannot proceed with normalization.';
        logError('reformatDailySales', errorMsg);
        alertError(errorMsg, 'Sheet Missing');
        return;
      }

      const normalization = normalizeSalesSheetData(monthlySheet);

      logInfo('reformatDailySales', 'Processing MONTHLY sheet data', {
        totalRows: normalization.stats.totalRows,
        dataRows: normalization.stats.dataRows,
        newRecords: normalization.stats.newRecords,
        usedRecords: normalization.stats.usedRecords
      });

      if (!normalization.format.isValid) {
        logWarning('reformatDailySales', 'MONTHLY sheet failed format validation', normalization.format);
        alertError(normalization.format.message, 'Invalid Sheet Layout');
        return;
      }

      const output = normalization.records;

      if (output.length === 0) {
        showCustomAlert(
          'No Data Found',
          'No valid sales records found in MONTHLY sheet. ' +
          'Ensure the sheet has data with valid FI flags (single letters A-Z or "BD").'
        );
        return;
      }

      let cleanedSheet = ss.getSheetByName(outputSheetName);
      if (!cleanedSheet) {
        cleanedSheet = ss.insertSheet(outputSheetName);
        logInfo('reformatDailySales', 'Created output sheet', { sheetName: outputSheetName });
      } else {
        cleanedSheet.clear();
        logInfo('reformatDailySales', 'Cleared existing output sheet', { sheetName: outputSheetName });
      }

      cleanedSheet.getRange(1, 1, 1, NORMALIZED_SALES_HEADERS.length)
        .setValues([NORMALIZED_SALES_HEADERS])
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('center');

      cleanedSheet.getRange(2, 1, output.length, output[0].length).setValues(output);

      logInfo('reformatDailySales', 'Output sheet populated', {
        sheetName: outputSheetName,
        headers: NORMALIZED_SALES_HEADERS.length,
        dataRows: output.length
      });

      toastInfo('Merging with CDK data...', 'Working');

      const mergeStats = mergeCDKData({ mergedSheetName: outputSheetName });

      const summaryMsg =
        `Sales log data has been normalized and merged.\n\n` +
        `Records Processed: ${output.length}\n` +
        `CDK Matches Found: ${mergeStats.matchCount}\n` +
        `Unmatched Records: ${mergeStats.noMatchCount}\n\n` +
        `Results are available in the "${outputSheetName}" sheet.\n` +
        `${mergeStats.noMatchCount > 0 ? 'Unmatched rows are highlighted in yellow.' : ''}`;

      showCustomAlert('Normalization Complete', summaryMsg);

      logInfo('reformatDailySales', 'Normalization process completed successfully', {
        sourceSheet: 'MONTHLY',
        outputSheet: outputSheetName,
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
 * Uses dynamic header detection and case-insensitive matching
 *
 * This function:
 * 1. Validates both CDK_MERGED and CDK_DATA sheets exist
 * 2. Dynamically detects header positions for 'StockNo' and 'Stock No.'
 * 3. Builds a Map of CDK data with case-insensitive keys
 * 4. Matches records and appends CDK columns to CDK_MERGED sheet
 * 5. Highlights unmatched rows in both sheets with #FFFFE0 (light yellow)
 * 6. Returns statistics about the merge operation
 *
 * IMPORTANT NOTES:
 * - StockNo will ALWAYS be column F in CDK_MERGED sheet
 * - CDK_DATA Stock No. is dynamically detected but expected in column D
 * - Case-insensitive matching handles variations in stock number format
 * - Only first 8 columns from CDK_MERGED are preserved (A-H)
 * - Unmatched rows are highlighted for manual review
 *
 * @returns {Object} Statistics {matchCount, noMatchCount, totalRows}
 * @throws {Error} If required sheets or columns are not found
 */
function mergeCDKData(options = {}) {
  try {
    const mergedSheetName = options.mergedSheetName || 'CDK_MERGED';
    logInfo('mergeCDKData', 'Starting CDK data merge operation', { mergedSheetName });

    // === VALIDATION ===
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cleanedSheet = ss.getSheetByName(mergedSheetName);
    const cdkSheet = ss.getSheetByName('CDK_DATA');

    if (!cleanedSheet || !cdkSheet) {
      const missingSheets = [];
      if (!cleanedSheet) missingSheets.push(mergedSheetName);
      if (!cdkSheet) missingSheets.push('CDK_DATA');

      const errorMsg = `Required sheets not found: ${missingSheets.join(', ')}`;
      logWarning('mergeCDKData', errorMsg);

      // Return empty stats if CDK_DATA doesn't exist (non-critical)
      if (!cdkSheet) {
        logInfo('mergeCDKData', 'CDK_DATA sheet not found, skipping merge');
        return { matchCount: 0, noMatchCount: 0, totalRows: 0, mergedSheetName };
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
      mergedSheetName,
      cleanedKeyIndex: cleanedKeyIndex,
      cdkKeyIndex: cdkKeyIndex
    });

    // === DATA READING ===
    const cleanedData = cleanedSheet.getDataRange().getValues().slice(1); // Skip header
    const cdkData = cdkSheet.getDataRange().getValues().slice(1); // Skip header

    // Early return for empty sheets
    if (cleanedData.length === 0) {
      logWarning('mergeCDKData', `${mergedSheetName} sheet is empty. No merge needed.`);
      return { matchCount: 0, noMatchCount: 0, totalRows: 0, mergedSheetName };
    }

    if (cdkData.length === 0) {
      logWarning('mergeCDKData', 'CDK_DATA sheet is empty. Skipping merge.');
      return { matchCount: 0, noMatchCount: cleanedData.length, totalRows: cleanedData.length, mergedSheetName };
    }

    logInfo('mergeCDKData', 'Data loaded', {
      mergedSheetName,
      cleanedRows: cleanedData.length,
      cdkRows: cdkData.length
    });

    // === MAP BUILDING with CASE-INSENSITIVE keys ===
    const cdkMap = new Map();
    for (let row of cdkData) {
      const key = String(row[cdkKeyIndex]).trim().toUpperCase(); // Case insensitive
      if (key) cdkMap.set(key, row);
    }

    logInfo('mergeCDKData', 'CDK Map built', { mapSize: cdkMap.size, mergedSheetName });

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
        // Only take first 8 columns from CDK_MERGED (A-H), then append CDK data (I-AC)
        // This prevents CDK data from being appended after empty columns
        return [...cleanedRow.slice(0, 8), ...cdkRow];
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

      logInfo('mergeCDKData', `Merged data written to ${mergedSheetName}`, {
        mergedSheetName,
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

      logInfo('mergeCDKData', 'Cleared existing background colors from both sheets', { mergedSheetName });

      // === CONDITIONAL FORMATTING for unmatched rows ===
      // Format unmatched rows in CDK_MERGED sheet with light yellow background
      if (unmatchedCleanedRows.length > 0) {
        const cleanedRanges = unmatchedCleanedRows.map(rowIndex =>
          cleanedSheet.getRange(rowIndex, 1, 1, maxCols)
        );
        const cleanedRangeList = cleanedSheet.getRangeList(cleanedRanges.map(r => r.getA1Notation()));
        cleanedRangeList.setBackground('#FFFFE0');
        logInfo('mergeCDKData', `Highlighted ${unmatchedCleanedRows.length} unmatched rows`, {
          mergedSheetName
        });
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
      totalRows: mergedData.length,
      mergedSheetName
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

function reformatSalesLogSheetInFocus() {
  withScriptLock(() => {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) {
        alertError('Unable to access the active spreadsheet.', 'Spreadsheet Missing');
        return;
      }

      let targetSheet = ss.getActiveSheet();
      const attemptedSheetNames = [];

      const eligibility = isEligibleSalesSourceSheet(targetSheet);
      if (!eligibility.eligible) {
        if (eligibility.reason) {
          showCustomAlert('Select a Source Sheet', eligibility.reason);
        }
        targetSheet = promptForSalesSheetSelection(targetSheet ? [targetSheet.getName()] : []);
      }

      if (!targetSheet) {
        showCustomAlert('Normalization Cancelled', 'No sheet selected to normalize.');
        return;
      }

      let normalization;
      for (let attempt = 0; attempt < 2; attempt++) {
        const sheetName = targetSheet.getName();
        attemptedSheetNames.push(sheetName);

        toastInfo('Normalizing "' + sheetName + '"...', 'Working');
        normalization = normalizeSalesSheetData(targetSheet);

        logInfo('reformatSalesLogSheetInFocus', 'Sheet scan complete', {
          sheetName,
          totalRows: normalization.stats.totalRows,
          dataRows: normalization.stats.dataRows,
          newRecords: normalization.stats.newRecords,
          usedRecords: normalization.stats.usedRecords
        });

        if (normalization.format.isValid) {
          break;
        }

        logWarning('reformatSalesLogSheetInFocus', 'Sheet failed format validation', {
          sheetName,
          reason: normalization.format.message,
          firstProblemRow: normalization.format.firstDataRowIndexWithoutDate
        });
        showCustomAlert(
          'Invalid Sheet Layout',
          normalization.format.message + '\n\nSheet: "' + sheetName + '"'
        );

        targetSheet = promptForSalesSheetSelection(attemptedSheetNames);
        if (!targetSheet) {
          showCustomAlert('Normalization Cancelled', 'No sheet selected to normalize.');
          return;
        }
      }

      if (!normalization || !normalization.format.isValid) {
        showCustomAlert('Normalization Cancelled', 'Unable to find a sheet with the expected layout.');
        return;
      }

      if (normalization.records.length === 0) {
        showCustomAlert(
          'No Data Found',
          'No valid sales records found in "' + targetSheet.getName() + '". ' +
          'Ensure the sheet has data with valid FI flags (single letters A-Z or "BD").'
        );
        return;
      }

      const resultSheetName = targetSheet.getName() + '_FLAT';
      let resultSheet = ss.getSheetByName(resultSheetName);
      if (!resultSheet) {
        resultSheet = ss.insertSheet(resultSheetName);
        logInfo('reformatSalesLogSheetInFocus', 'Created new flattened sheet', { sheetName: resultSheetName });
      } else {
        resultSheet.clear();
        logInfo('reformatSalesLogSheetInFocus', 'Cleared existing flattened sheet', { sheetName: resultSheetName });
      }

      resultSheet.getRange(1, 1, 1, NORMALIZED_SALES_HEADERS.length)
        .setValues([NORMALIZED_SALES_HEADERS])
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('center');

      resultSheet.getRange(2, 1, normalization.records.length, normalization.records[0].length)
        .setValues(normalization.records);

      toastInfo('Merging with CDK data...', 'Working');
      const mergeStats = mergeCDKData({ mergedSheetName: resultSheetName });

      const summaryMsg =
        `Sales log data from "${targetSheet.getName()}" has been normalized and merged.\n\n` +
        `Records Processed: ${normalization.records.length}\n` +
        `CDK Matches Found: ${mergeStats.matchCount}\n` +
        `Unmatched Records: ${mergeStats.noMatchCount}\n\n` +
        `Results are available in the "${resultSheetName}" sheet.\n` +
        `${mergeStats.noMatchCount > 0 ? 'Unmatched rows are highlighted in yellow.' : ''}`;

      showCustomAlert('Normalization Complete', summaryMsg);

      logInfo('reformatSalesLogSheetInFocus', 'Normalization process completed successfully', {
        sourceSheet: targetSheet.getName(),
        outputSheet: resultSheetName,
        totalRecords: normalization.records.length,
        matchCount: mergeStats.matchCount,
        noMatchCount: mergeStats.noMatchCount
      });

    } catch (error) {
      logError('reformatSalesLogSheetInFocus', error);
      alertError(
        'An error occurred during data normalization: ' + error.message,
        'Normalization Error'
      );
    }
  });
}

function normalizeSalesSheetData(sheet) {
  const stats = {
    totalRows: 0,
    dataRows: 0,
    newRecords: 0,
    usedRecords: 0,
    blankRows: 0
  };

  if (!sheet) {
    return {
      records: [],
      stats,
      format: {
        isValid: false,
        message: 'Sheet reference not provided.',
        hasDateRow: false,
        encounteredDataBeforeDate: false,
        firstDataRowIndexWithoutDate: null
      }
    };
  }

  const data = sheet.getRange('A:N').getValues();
  stats.totalRows = data.length;

  const records = [];
  let currentDate = null;
  let hasDateRow = false;
  let encounteredDataBeforeDate = false;
  let firstDataRowIndexWithoutDate = null;

  data.forEach((row, index) => {
    const dateCell = row[0];
    if (dateCell instanceof Date) {
      currentDate = dateCell;
      hasDateRow = true;
      return;
    }

    const newBlock = row.slice(1, 7);
    const usedBlock = row.slice(8, 14);
    const newHasContent = newBlock.join('').trim() !== '';
    const usedHasContent = usedBlock.join('').trim() !== '';

    if (!newHasContent && !usedHasContent) {
      stats.blankRows++;
      return;
    }

    stats.dataRows++;

    if (!hasDateRow) {
      encounteredDataBeforeDate = true;
      if (firstDataRowIndexWithoutDate === null) {
        firstDataRowIndexWithoutDate = index + 1;
      }
      return;
    }

    if (newHasContent) {
      const hasNewFI = newBlock[1] && isValidFIFlag(String(newBlock[1]));
      if (hasNewFI) {
        records.push([currentDate, 'NEW', ...newBlock]);
        stats.newRecords++;
      }
    }

    if (usedHasContent) {
      const hasUsedFI = usedBlock[1] && isValidFIFlag(String(usedBlock[1]));
      if (hasUsedFI) {
        records.push([currentDate, 'USED', ...usedBlock]);
        stats.usedRecords++;
      }
    }
  });

  const format = {
    isValid: true,
    message: '',
    hasDateRow,
    encounteredDataBeforeDate,
    firstDataRowIndexWithoutDate
  };

  if (!hasDateRow) {
    format.isValid = false;
    format.message = 'No date rows were found in column A. Ensure each day starts with a date cell before the sales entries.';
  } else if (encounteredDataBeforeDate) {
    format.isValid = false;
    const rowInfo = firstDataRowIndexWithoutDate
      ? ' (first issue on row ' + firstDataRowIndexWithoutDate + ')'
      : '';
    format.message = 'Sales rows appear before the first date row. Move the date cell above the sales entries.' + rowInfo;
  }

  return { records, stats, format };
}

function isEligibleSalesSourceSheet(sheet) {
  if (!sheet) {
    return {
      eligible: false,
      reason: 'No active sheet is available. Please select a sheet to normalize.'
    };
  }

  const sheetName = sheet.getName();
  if (sheetName === 'CDK_DATA') {
    return {
      eligible: false,
      reason: '"CDK_DATA" contains CDK export data and cannot be normalized.'
    };
  }

  if (sheetName === 'CDK_MERGED') {
    return {
      eligible: false,
      reason: '"CDK_MERGED" already contains merged results. Select the source sales sheet instead.'
    };
  }

  if (sheetName.endsWith('_FLAT')) {
    return {
      eligible: false,
      reason: 'The sheet "' + sheetName + '" already contains flattened results. Select the original sales sheet.'
    };
  }

  return { eligible: true, reason: '' };
}

function promptForSalesSheetSelection(excludedNames = []) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      alertError('No active spreadsheet found. Unable to select a sheet.', 'Selection Error');
      return null;
    }

    const excludedSet = new Set(Array.isArray(excludedNames) ? excludedNames : [excludedNames]);
    const sheets = ss.getSheets().filter(sheet => {
      const name = sheet.getName();
      if (excludedSet.has(name)) return false;
      return isEligibleSalesSourceSheet(sheet).eligible;
    });

    if (sheets.length === 0) {
      showCustomAlert('No Eligible Sheets Found', 'No sheets with the required layout are available to normalize.');
      return null;
    }

    const ui = SpreadsheetApp.getUi();
    const message = sheets
      .map((sheet, index) => (index + 1) + '. ' + sheet.getName())
      .join('\n');

    const result = ui.prompt(
      'Select Sales Sheet',
      'Enter the number for the sheet you want to normalize:\n\n' + message,
      ui.ButtonSet.OK_CANCEL
    );

    if (result.getSelectedButton() !== ui.Button.OK) {
      return null;
    }

    const responseText = (result.getResponseText() || '').trim();
    const choice = parseInt(responseText, 10);
    if (!choice || choice < 1 || choice > sheets.length) {
      showCustomAlert('Invalid Selection', 'Please enter a number between 1 and ' + sheets.length + '.');
      return null;
    }

    return sheets[choice - 1];
  } catch (error) {
    logError('promptForSalesSheetSelection', error);
    alertError('Unable to display sheet selection UI: ' + error.message, 'Selection Error');
    return null;
  }
}
