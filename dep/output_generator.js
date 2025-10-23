'use strict';

/**
 * Output Generator Module
 * Writes merged data and reports to Google Sheets
 * Part of the Excel data merging application built as a Google Apps Script extension
 */

/**
 * Generates complete merged output including data, summary, and unmatched reports
 * Main entry point for writing merge results to sheets
 * 
 * @param {Array} mergedRecords - Array of merged record objects
 * @param {Object} summaryStats - Summary statistics object from data_merger
 * @param {Object} unmatchedReports - Object containing unmatched reports
 * @param {Array} unmatchedReports.salesLog - Unmatched sales log records
 * @param {Array} unmatchedReports.cdk - Unmatched CDK records
 * @returns {Object} {success, sheetUrl, sheetName, error}
 */
function generateMergedOutput(mergedRecords, summaryStats, unmatchedReports) {
  const startTime = Date.now();
  
  try {
    logInfo('generateMergedOutput', 'Starting output generation', {
      recordCount: mergedRecords ? mergedRecords.length : 0,
      hasStats: !!summaryStats,
      hasUnmatched: !!unmatchedReports
    });

    // Validate inputs
    if (!Array.isArray(mergedRecords)) {
      throw new Error('mergedRecords must be an array');
    }

    // Get or create MERGED_DATA sheet
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName('MERGED_DATA');
    
    if (!sheet) {
      sheet = spreadsheet.insertSheet('MERGED_DATA');
      logInfo('generateMergedOutput', 'Created new MERGED_DATA sheet');
    } else {
      // Clear existing content
      sheet.clear();
      logInfo('generateMergedOutput', 'Cleared existing MERGED_DATA sheet');
    }

    // Write merged data
    let currentRow = writeMergedDataSheet(sheet, mergedRecords);
    logInfo('generateMergedOutput', 'Wrote merged data', { endRow: currentRow });

    // Add blank rows for separation
    currentRow += 3;

    // Write summary report if stats provided
    if (summaryStats) {
      currentRow = writeSummaryReport(sheet, summaryStats, currentRow);
      logInfo('generateMergedOutput', 'Wrote summary report', { endRow: currentRow });
    }

    // Add blank rows for separation
    currentRow += 3;

    // Write unmatched reports if provided
    if (unmatchedReports) {
      currentRow = writeUnmatchedReport(sheet, unmatchedReports, currentRow);
      logInfo('generateMergedOutput', 'Wrote unmatched reports', { endRow: currentRow });
    }

    const duration = (Date.now() - startTime) / 1000;
    const sheetUrl = spreadsheet.getUrl() + '#gid=' + sheet.getSheetId();

    logInfo('generateMergedOutput', 'Output generation complete', {
      duration: duration,
      totalRows: currentRow
    });

    return {
      success: true,
      sheetUrl: sheetUrl,
      sheetName: 'MERGED_DATA',
      rowCount: currentRow,
      duration: duration
    };

  } catch (error) {
    const errorLog = logError('generateMergedOutput', error, {
      recordCount: mergedRecords ? mergedRecords.length : 0
    });
    
    return {
      success: false,
      error: errorLog.message,
      technicalDetails: errorLog.fullLog
    };
  }
}

/**
 * Writes merged data to sheet with headers and formatting
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {Array} mergedRecords - Array of merged record objects
 * @returns {number} Next available row number
 */
function writeMergedDataSheet(sheet, mergedRecords) {
  try {
    if (!sheet || !Array.isArray(mergedRecords)) {
      throw new Error('Invalid parameters for writeMergedDataSheet');
    }

    // Define column headers
    const headers = [
      'Customer Last Name', 'Model', 'Stock Number', 'Stock Type', 'Trade Stock #',
      'Salesperson', 'Contract Date', 'VIN', 'Year', 'Front GP$', 'Back GP$',
      'Total GP$', 'Cash Price', 'Trades', 'Service Contract', 'Finance Institution',
      'FI Manager', 'Term', 'Deal No.', 'Match Type', 'Match Confidence', 
      'Needs Review', 'Review Reason'
    ];

    // Write headers
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#4285f4')
               .setFontColor('#ffffff')
               .setFontWeight('bold')
               .setHorizontalAlignment('center');

    // Freeze header row
    sheet.setFrozenRows(1);

    // Set auto-filter
    const dataRange = sheet.getRange(1, 1, 1, headers.length);
    dataRange.createFilter();

    // Convert merged records to 2D array for batch writing
    const dataRows = mergedRecords.map(record => [
      record.customerLastName || '',
      record.model || '',
      record.stockNumber || '',
      record.stockType || '',
      record.tradeStock || '',
      record.salesperson || '',
      record.contractDate ? formatDate(record.contractDate) : '',
      record.vin || '',
      record.year || '',
      record.frontGP || 0,
      record.backGP || 0,
      record.totalGP || 0,
      record.cashPrice || 0,
      record.trades || 0,
      record.serviceContract || 0,
      record.financeInstitution || '',
      record.fiManager || '',
      record.term || '',
      record.dealNo || '',
      record.matchType || '',
      record.matchConfidence ? (record.matchConfidence / 100) : 0,
      record.needsReview ? 'YES' : 'NO',
      record.reviewReason || ''
    ]);

    // Write data in batch if there are records
    if (dataRows.length > 0) {
      sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);

      // Apply number formatting in batches
      const dataStartRow = 2;
      const numRows = dataRows.length;

      // Format currency columns (Front GP$, Back GP$, Total GP$, Cash Price, Trades, Service Contract)
      [10, 11, 12, 13, 14, 15].forEach(col => {
        sheet.getRange(dataStartRow, col, numRows, 1)
             .setNumberFormat('$#,##0.00')
             .setHorizontalAlignment('right');
      });

      // Format percentage column (Match Confidence)
      sheet.getRange(dataStartRow, 21, numRows, 1)
           .setNumberFormat('0.00%')
           .setHorizontalAlignment('right');

      // Format number columns (Year, Term)
      sheet.getRange(dataStartRow, 9, numRows, 1).setNumberFormat('0');
      sheet.getRange(dataStartRow, 18, numRows, 1).setNumberFormat('0');

      // Apply conditional formatting for Needs Review
      applyConditionalFormatting(sheet, dataStartRow, numRows, headers.length);
    }

    // Auto-resize columns
    for (let col = 1; col <= headers.length; col++) {
      sheet.autoResizeColumn(col);
    }

    return 1 + dataRows.length;

  } catch (error) {
    logError('writeMergedDataSheet', error, { recordCount: mergedRecords.length });
    throw error;
  }
}

/**
 * Writes summary statistics report to sheet
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {Object} summaryStats - Summary statistics object
 * @param {number} startRow - Starting row number
 * @returns {number} Next available row number
 */
function writeSummaryReport(sheet, summaryStats, startRow) {
  try {
    if (!sheet || !summaryStats) {
      throw new Error('Invalid parameters for writeSummaryReport');
    }

    let currentRow = startRow;

    // Section header
    sheet.getRange(currentRow, 1).setValue('SUMMARY STATISTICS');
    sheet.getRange(currentRow, 1, 1, 2)
         .setFontWeight('bold')
         .setFontSize(14)
         .setBackground('#f3f3f3');
    currentRow += 2;

    // Overall Statistics
    sheet.getRange(currentRow, 1).setValue('Overall Statistics')
         .setFontWeight('bold')
         .setBackground('#e8f4f8');
    currentRow++;

    const overallStats = [
      ['Total Records', summaryStats.totalRecords],
      ['Merged Records', summaryStats.mergedRecords],
      ['Unmatched Sales Log', summaryStats.unmatchedSalesLog],
      ['Unmatched CDK', summaryStats.unmatchedCDK],
      ['Match Rate', formatPercentage(summaryStats.matchRate / 100)]
    ];

    sheet.getRange(currentRow, 1, overallStats.length, 2).setValues(overallStats);
    sheet.getRange(currentRow, 1, overallStats.length, 1).setFontWeight('bold');
    currentRow += overallStats.length + 2;

    // By Stock Type
    if (summaryStats.byStockType) {
      sheet.getRange(currentRow, 1).setValue('By Stock Type')
           .setFontWeight('bold')
           .setBackground('#e8f4f8');
      currentRow++;

      const stockTypeStats = [
        ['New Vehicles', summaryStats.byStockType.new.count, formatCurrency(summaryStats.byStockType.new.avgGP)],
        ['Used Vehicles', summaryStats.byStockType.used.count, formatCurrency(summaryStats.byStockType.used.avgGP)]
      ];

      sheet.getRange(currentRow, 1, 1, 3).setValues([['Type', 'Count', 'Avg GP']]);
      sheet.getRange(currentRow, 1, 1, 3).setFontWeight('bold');
      currentRow++;

      sheet.getRange(currentRow, 1, stockTypeStats.length, 3).setValues(stockTypeStats);
      currentRow += stockTypeStats.length + 2;
    }

    // By Match Type
    if (summaryStats.byMatchType) {
      sheet.getRange(currentRow, 1).setValue('By Match Type')
           .setFontWeight('bold')
           .setBackground('#e8f4f8');
      currentRow++;

      const matchTypeStats = [
        ['Exact Match', summaryStats.byMatchType.exact || 0],
        ['Numeric Match', summaryStats.byMatchType.numeric || 0],
        ['Partial Match', summaryStats.byMatchType.partial || 0],
        ['Unknown', summaryStats.byMatchType.unknown || 0]
      ];

      sheet.getRange(currentRow, 1, matchTypeStats.length, 2).setValues(matchTypeStats);
      sheet.getRange(currentRow, 1, matchTypeStats.length, 1).setFontWeight('bold');
      currentRow += matchTypeStats.length + 2;
    }

    // Financial Summary
    if (summaryStats.financialSummary) {
      sheet.getRange(currentRow, 1).setValue('Financial Summary')
           .setFontWeight('bold')
           .setBackground('#e8f4f8');
      currentRow++;

      const financialStats = [
        ['Total Front GP', formatCurrency(summaryStats.financialSummary.totalFrontGP)],
        ['Total Back GP', formatCurrency(summaryStats.financialSummary.totalBackGP)],
        ['Total GP', formatCurrency(summaryStats.financialSummary.totalGP)],
        ['Avg Front GP', formatCurrency(summaryStats.financialSummary.avgFrontGP)],
        ['Avg Back GP', formatCurrency(summaryStats.financialSummary.avgBackGP)],
        ['Avg Total GP', formatCurrency(summaryStats.financialSummary.avgTotalGP)]
      ];

      sheet.getRange(currentRow, 1, financialStats.length, 2).setValues(financialStats);
      sheet.getRange(currentRow, 1, financialStats.length, 1).setFontWeight('bold');
      currentRow += financialStats.length + 2;
    }

    // Review Flags
    sheet.getRange(currentRow, 1).setValue('Review Flags')
         .setFontWeight('bold')
         .setBackground('#e8f4f8');
    currentRow++;

    sheet.getRange(currentRow, 1, 1, 2).setValues([['Records Needing Review', summaryStats.needsReview || 0]]);
    sheet.getRange(currentRow, 1).setFontWeight('bold');
    currentRow++;

    if (summaryStats.reviewReasons && Object.keys(summaryStats.reviewReasons).length > 0) {
      const reasonStats = Object.entries(summaryStats.reviewReasons).map(([reason, count]) => [reason, count]);
      sheet.getRange(currentRow, 1, reasonStats.length, 2).setValues(reasonStats);
      currentRow += reasonStats.length;
    }

    return currentRow;

  } catch (error) {
    logError('writeSummaryReport', error, { startRow: startRow });
    throw error;
  }
}

/**
 * Writes unmatched records report to sheet
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {Object} unmatchedReports - Object with salesLog and cdk arrays
 * @param {number} startRow - Starting row number
 * @returns {number} Next available row number
 */
function writeUnmatchedReport(sheet, unmatchedReports, startRow) {
  try {
    if (!sheet || !unmatchedReports) {
      throw new Error('Invalid parameters for writeUnmatchedReport');
    }

    let currentRow = startRow;

    // Section header
    sheet.getRange(currentRow, 1).setValue('UNMATCHED RECORDS');
    sheet.getRange(currentRow, 1, 1, 2)
         .setFontWeight('bold')
         .setFontSize(14)
         .setBackground('#f3f3f3');
    currentRow += 2;

    // Unmatched Sales Log Records
    if (unmatchedReports.salesLog && unmatchedReports.salesLog.length > 0) {
      sheet.getRange(currentRow, 1).setValue('Unmatched Sales Log Records')
           .setFontWeight('bold')
           .setBackground('#fff4e1');
      currentRow++;

      // Headers
      const slHeaders = ['Stock Number', 'Customer', 'Model', 'Stock Type', 'Reason'];
      sheet.getRange(currentRow, 1, 1, slHeaders.length).setValues([slHeaders]);
      sheet.getRange(currentRow, 1, 1, slHeaders.length).setFontWeight('bold');
      currentRow++;

      // Data
      const slData = unmatchedReports.salesLog.map(record => [
        record.stockNumber || '',
        record.customerLastName || '',
        record.model || '',
        record.stockType || '',
        record.unmatchReason || 'No match found'
      ]);

      sheet.getRange(currentRow, 1, slData.length, slHeaders.length).setValues(slData);
      currentRow += slData.length + 2;
    } else {
      sheet.getRange(currentRow, 1).setValue('No unmatched Sales Log records');
      currentRow += 2;
    }

    // Unmatched CDK Records
    if (unmatchedReports.cdk && unmatchedReports.cdk.length > 0) {
      sheet.getRange(currentRow, 1).setValue('Unmatched CDK Records')
           .setFontWeight('bold')
           .setBackground('#ffe1e1');
      currentRow++;

      // Headers
      const cdkHeaders = ['Stock Number', 'Customer', 'Model', 'Stock Type', 'Total GP', 'Reason'];
      sheet.getRange(currentRow, 1, 1, cdkHeaders.length).setValues([cdkHeaders]);
      sheet.getRange(currentRow, 1, 1, cdkHeaders.length).setFontWeight('bold');
      currentRow++;

      // Data
      const cdkData = unmatchedReports.cdk.map(record => [
        record.stockNumber || '',
        record.customerLastName || '',
        record.model || '',
        record.stockType || '',
        formatCurrency(record.totalGP || 0),
        record.unmatchReason || 'No match found'
      ]);

      sheet.getRange(currentRow, 1, cdkData.length, cdkHeaders.length).setValues(cdkData);
      currentRow += cdkData.length;
    } else {
      sheet.getRange(currentRow, 1).setValue('No unmatched CDK records');
      currentRow += 1;
    }

    return currentRow;

  } catch (error) {
    logError('writeUnmatchedReport', error, { startRow: startRow });
    throw error;
  }
}

/**
 * Creates or updates merge log entry in MERGE_LOG sheet
 * Maintains audit trail of all merge operations
 * 
 * @param {Object} mergeSession - Merge session metadata
 * @param {string} mergeSession.timestamp - ISO timestamp of merge
 * @param {string} mergeSession.user - User email
 * @param {string} mergeSession.salesLogFile - Sales log filename
 * @param {string} mergeSession.cdkFile - CDK filename
 * @param {number} mergeSession.totalRecords - Total records processed
 * @param {number} mergeSession.matched - Number matched
 * @param {number} mergeSession.unmatchedSL - Unmatched sales log count
 * @param {number} mergeSession.unmatchedCDK - Unmatched CDK count
 * @param {number} mergeSession.matchRate - Match rate percentage
 * @param {number} mergeSession.duration - Duration in seconds
 * @param {string} mergeSession.status - Status (Success/Failed)
 * @returns {number} Log entry row number
 */
function createMergeLogEntry(mergeSession) {
  try {
    if (!mergeSession) {
      throw new Error('mergeSession is required');
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = spreadsheet.getSheetByName('MERGE_LOG');

    // Create sheet if it doesn't exist
    if (!logSheet) {
      logSheet = spreadsheet.insertSheet('MERGE_LOG');
      
      // Write headers
      const headers = [
        'Timestamp', 'User', 'Sales Log Sheet', 'CDK File', 'Total Records',
        'Matched', 'Unmatched SL', 'Unmatched CDK', 'Match Rate', 'Duration (s)', 'Status'
      ];
      
      logSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      logSheet.getRange(1, 1, 1, headers.length)
              .setBackground('#4285f4')
              .setFontColor('#ffffff')
              .setFontWeight('bold')
              .setHorizontalAlignment('center');
      
      logSheet.setFrozenRows(1);
      
      logInfo('createMergeLogEntry', 'Created new MERGE_LOG sheet');
    }

    // Prepare log entry
    const logEntry = [
      mergeSession.timestamp || new Date().toISOString(),
      mergeSession.user || Session.getActiveUser().getEmail(),
      mergeSession.salesLogFile || 'Unknown',
      mergeSession.cdkFile || 'Unknown',
      mergeSession.totalRecords || 0,
      mergeSession.matched || 0,
      mergeSession.unmatchedSL || 0,
      mergeSession.unmatchedCDK || 0,
      formatPercentage((mergeSession.matchRate || 0) / 100),
      mergeSession.duration ? mergeSession.duration.toFixed(2) : '0.00',
      mergeSession.status || 'Success'
    ];

    // Append to end of log
    const lastRow = logSheet.getLastRow();
    const newRow = lastRow + 1;
    
    logSheet.getRange(newRow, 1, 1, logEntry.length).setValues([logEntry]);

    // Format the new row
    logSheet.getRange(newRow, 9, 1, 1).setNumberFormat('0.00%'); // Match Rate
    logSheet.getRange(newRow, 10, 1, 1).setNumberFormat('0.00'); // Duration

    // Auto-resize columns if first data row
    if (lastRow === 1) {
      for (let col = 1; col <= logEntry.length; col++) {
        logSheet.autoResizeColumn(col);
      }
    }

    logInfo('createMergeLogEntry', 'Created merge log entry', { row: newRow });

    return newRow;

  } catch (error) {
    logError('createMergeLogEntry', error, mergeSession);
    throw error;
  }
}

/**
 * Applies conditional formatting to highlight rows needing review
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Target sheet
 * @param {number} startRow - First data row
 * @param {number} numRows - Number of data rows
 * @param {number} numCols - Number of columns
 * @private
 */
function applyConditionalFormatting(sheet, startRow, numRows, numCols) {
  try {
    // Find "Needs Review" column (column 22)
    const needsReviewCol = 22;
    
    // Create conditional format rule
    const dataRange = sheet.getRange(startRow, 1, numRows, numCols);
    const rules = sheet.getConditionalFormatRules();
    
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$V' + startRow + '="YES"')
      .setBackground('#f4cccc')
      .setRanges([dataRange])
      .build();
    
    rules.push(rule);
    sheet.setConditionalFormatRules(rules);

    logInfo('applyConditionalFormatting', 'Applied conditional formatting', {
      startRow: startRow,
      numRows: numRows
    });

  } catch (error) {
    logWarning('applyConditionalFormatting', 'Could not apply conditional formatting: ' + error.message);
  }
}

/**
 * Formats a number as currency ($X,XXX.XX)
 * 
 * @param {number} value - Number to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return '$0.00';
  }
  
  const num = parseFloat(value);
  return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats a number as percentage (XX.XX%)
 * 
 * @param {number} value - Number to format (0-1 range)
 * @returns {string} Formatted percentage string
 */
function formatPercentage(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return '0.00%';
  }
  
  const num = parseFloat(value);
  return (num * 100).toFixed(2) + '%';
}

/**
 * Formats a date consistently (YYYY-MM-DD HH:MM:SS)
 * Assumes standardized date input from CDK_DATA sheet
 *
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string or empty string if invalid
 */
function formatDate(date) {
  try {
    if (!date) return '';
    
    const dateObj = date instanceof Date ? date : new Date(date);
    
    // Simple validation
    if (isNaN(dateObj.getTime())) {
      return '';
    }
    
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    
  } catch (error) {
    logWarning('formatDate', 'Date formatting error', { date });
    return '';
  }
}