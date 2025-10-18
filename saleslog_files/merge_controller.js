'use strict';

/**
 * Merge Controller Module
 * Main orchestration module for Excel data merging operations
 * Coordinates all merge modules and provides server-side API for the UI
 * 
 * @module merge_controller
 * @requires error_logger
 * @requires stock_matcher
 * @requires data_merger
 * @requires output_generator
 */

// ==================== PUBLIC API FUNCTIONS ====================

/**
 * Opens the merge tool sidebar in Google Sheets
 * Called from custom menu item
 * 
 * @returns {void}
 */
function showMergeSidebar() {
  try {
    const html = HtmlService.createHtmlOutputFromFile('merge_sidebar')
      .setTitle('CDK Data Merge Tool')
      .setWidth(400);
    
    SpreadsheetApp.getUi().showSidebar(html);
    
    logInfo('showMergeSidebar', 'Merge sidebar opened successfully');
  } catch (error) {
    const errorLog = logError('showMergeSidebar', error);
    SpreadsheetApp.getUi().alert('Error opening merge sidebar: ' + errorLog.message);
  }
}

/**
 * Uploads and processes CDK file
 * Creates temporary file in Drive, validates format, and returns preview
 * 
 * @param {string} fileData - Base64 encoded file data
 * @param {string} fileName - Original filename
 * @param {string} sessionId - Unique session identifier
 * @returns {Object} {success, fileId, preview, rowCount, error}
 */
function uploadCDKFile(fileData, fileName, sessionId) {
  try {
    logInfo('uploadCDKFile', 'Starting CDK file upload', { fileName, sessionId });
    
    // Validate inputs
    if (!fileData || !fileName || !sessionId) {
      throw new Error('Missing required parameters: fileData, fileName, or sessionId');
    }
    
    // Update progress
    updateProgress(sessionId, 5, 'Uploading CDK file...', {});
    
    // Create temporary file in Drive
    const fileId = createTempDriveFile(fileData, fileName, sessionId);
    
    updateProgress(sessionId, 15, 'Validating file format...', {});
    
    // Validate file format
    const validation = validateFileFormat(fileId, fileName);
    if (!validation.valid) {
      cleanupTempFile(fileId);
      throw new Error('Invalid file format: ' + validation.error);
    }
    
    updateProgress(sessionId, 25, 'Reading file data...', {});
    
    // Read file data
    const fileContents = readFileContents(fileId, fileName);
    
    updateProgress(sessionId, 40, 'Processing CDK data...', {});
    
    // Store in cache for later use
    storeCachedData(sessionId, 'cdkFileId', fileId);
    storeCachedData(sessionId, 'cdkFileName', fileName);
    storeCachedData(sessionId, 'cdkData', fileContents.data);
    
    // Generate preview (first 10 rows)
    const preview = fileContents.data.slice(0, Math.min(10, fileContents.data.length));
    
    updateProgress(sessionId, 50, 'CDK file uploaded successfully', {
      rowCount: fileContents.data.length
    });
    
    logInfo('uploadCDKFile', 'CDK file processed successfully', {
      fileName,
      rowCount: fileContents.data.length
    });
    
    return {
      success: true,
      fileId: fileId,
      preview: preview,
      rowCount: fileContents.data.length,
      headers: fileContents.data[0] || []
    };
    
  } catch (error) {
    const errorLog = logError('uploadCDKFile', error, { fileName, sessionId });
    updateProgress(sessionId, 0, 'Upload failed: ' + errorLog.message, {});
    
    return {
      success: false,
      error: errorLog.message,
      technicalDetails: errorLog.fullLog
    };
  }
}

/**
 * Starts the merge process with the provided configuration
 * Orchestrates all modules in sequence and tracks progress
 * 
 * @param {Object} config - Merge configuration object
 * @param {string} config.sessionId - Session identifier
 * @param {string} config.cdkFileId - CDK file ID in Drive (optional if data cached)
 * @param {Object} config.salesLog - Sales log configuration
 * @param {Object} config.matching - Matching options
 * @returns {Object} {success, results, error}
 */
function startMergeProcess(config) {
  const startTime = Date.now();
  
  try {
    logInfo('startMergeProcess', 'Starting merge process', { sessionId: config.sessionId });
    
    // Validate configuration
    if (!config || !config.sessionId) {
      throw new Error('Invalid configuration: sessionId is required');
    }
    
    const sessionId = config.sessionId;
    
    // Initialize progress tracking
    updateProgress(sessionId, 0, 'Initializing merge process...', {});
    
    // Step 1: Read Sales Log data
    updateProgress(sessionId, 10, 'Reading Sales Log data...', {});
    const salesLogRecords = processSalesLogSheet(config.salesLog);
    
    logInfo('startMergeProcess', 'Sales Log data processed', {
      recordCount: salesLogRecords.length
    });
    
    // Step 2: Read CDK data
    updateProgress(sessionId, 25, 'Reading CDK export data...', {});
    const cdkData = getCachedData(sessionId, 'cdkData');
    
    if (!cdkData || !Array.isArray(cdkData)) {
      throw new Error('CDK data not found in cache. Please upload CDK file again.');
    }
    
    const cdkRecords = processCDKData(cdkData);
    
    logInfo('startMergeProcess', 'CDK data processed', {
      recordCount: cdkRecords.length
    });
    
    // Step 3: Match stock numbers
    updateProgress(sessionId, 40, 'Matching stock numbers...', {
      salesLogCount: salesLogRecords.length,
      cdkCount: cdkRecords.length
    });
    
    const matchResults = matchStockNumbers(
      salesLogRecords,
      cdkRecords,
      config.matching || {}
    );
    
    logInfo('startMergeProcess', 'Stock matching complete', {
      matched: matchResults.stats.matched,
      matchRate: matchResults.stats.matchRate
    });
    
    // Step 4: Merge matched records
    updateProgress(sessionId, 60, 'Merging data records...', {
      matchedCount: matchResults.matches.length
    });
    
    const mergedRecords = mergeMatchedRecords(matchResults);
    
    // Step 5: Validate merged data
    updateProgress(sessionId, 75, 'Validating merged data...', {});
    const validation = validateMergedData(mergedRecords);
    
    // Step 6: Calculate summary statistics
    updateProgress(sessionId, 85, 'Calculating statistics...', {});
    const stats = calculateSummaryStatistics(mergedRecords, matchResults);
    
    // Step 7: Prepare results for review
    updateProgress(sessionId, 95, 'Preparing results...', {});
    
    const results = {
      mergedRecords: mergedRecords,
      stats: stats,
      validation: validation,
      matchResults: matchResults,
      unmatchedReports: {
        salesLog: matchResults.unmatchedSalesLog,
        cdk: matchResults.unmatchedCDK
      }
    };
    
    // Store results in cache for confirmation step
    storeCachedData(sessionId, 'mergeResults', results);
    
    const duration = (Date.now() - startTime) / 1000;
    
    updateProgress(sessionId, 100, 'Merge process complete - ready for review', {
      duration: duration.toFixed(2),
      matchRate: stats.matchRate,
      totalRecords: stats.totalRecords,
      matched: stats.mergedRecords
    });
    
    logInfo('startMergeProcess', 'Merge process completed successfully', {
      duration: duration,
      matchRate: stats.matchRate
    });
    
    return {
      success: true,
      results: {
        stats: stats,
        validation: validation,
        needsReview: validation.flaggedForReview > 0,
        duration: duration
      }
    };
    
  } catch (error) {
    const errorLog = logError('startMergeProcess', error, { sessionId: config.sessionId });
    updateProgress(config.sessionId, 0, 'Error: ' + errorLog.message, {});
    
    return {
      success: false,
      error: errorLog.message,
      technicalDetails: errorLog.fullLog
    };
  }
}

/**
 * Gets the current merge status for a session
 * Called by UI polling to track progress
 * 
 * @param {string} sessionId - Session identifier
 * @returns {Object} {percent, message, stats, status}
 */
function getMergeStatus(sessionId) {
  try {
    const cache = CacheService.getScriptCache();
    const progressKey = `merge_progress_${sessionId}`;
    const progressJson = cache.get(progressKey);
    
    if (!progressJson) {
      return {
        percent: 0,
        message: 'No active merge session',
        stats: {},
        status: 'idle'
      };
    }
    
    const progress = JSON.parse(progressJson);
    
    return {
      percent: progress.percent || 0,
      message: progress.message || '',
      stats: progress.stats || {},
      status: progress.status || 'processing',
      lastUpdate: progress.lastUpdate
    };
    
  } catch (error) {
    logError('getMergeStatus', error, { sessionId });
    return {
      percent: 0,
      message: 'Error retrieving status',
      stats: {},
      status: 'error'
    };
  }
}

/**
 * Confirms the merge and writes results to sheets
 * Finalizes the merge operation after user review
 * 
 * @param {string} sessionId - Session identifier
 * @returns {Object} {success, sheetUrl, sheetName, error}
 */
function confirmMerge(sessionId) {
  const startTime = Date.now();
  
  try {
    logInfo('confirmMerge', 'Starting merge confirmation', { sessionId });
    
    // Retrieve results from cache
    const results = getCachedData(sessionId, 'mergeResults');
    
    if (!results) {
      throw new Error('Merge results not found. Please run the merge process again.');
    }
    
    updateProgress(sessionId, 10, 'Writing merged data to sheet...', {});
    
    // Generate output sheet
    const outputResult = generateMergedOutput(
      results.mergedRecords,
      results.stats,
      results.unmatchedReports
    );
    
    if (!outputResult.success) {
      throw new Error('Failed to generate output: ' + outputResult.error);
    }
    
    updateProgress(sessionId, 75, 'Creating merge log entry...', {});
    
    // Create merge log entry
    const cdkFileName = getCachedData(sessionId, 'cdkFileName') || 'Unknown';
    const duration = (Date.now() - startTime) / 1000;
    
    createMergeLogEntry({
      timestamp: new Date().toISOString(),
      user: Session.getActiveUser().getEmail(),
      salesLogFile: 'Current Sheet',
      cdkFile: cdkFileName,
      totalRecords: results.stats.totalRecords,
      matched: results.stats.mergedRecords,
      unmatchedSL: results.stats.unmatchedSalesLog,
      unmatchedCDK: results.stats.unmatchedCDK,
      matchRate: results.stats.matchRate,
      duration: duration,
      status: 'Success'
    });
    
    updateProgress(sessionId, 90, 'Cleaning up temporary files...', {});
    
    // Cleanup temporary files
    const cdkFileId = getCachedData(sessionId, 'cdkFileId');
    if (cdkFileId) {
      cleanupTempFile(cdkFileId);
    }
    
    // Clear session cache
    cleanupSession(sessionId);
    
    updateProgress(sessionId, 100, 'Merge completed successfully!', {
      sheetName: outputResult.sheetName
    });
    
    logInfo('confirmMerge', 'Merge confirmed and finalized', {
      duration: duration,
      sheetName: outputResult.sheetName
    });
    
    return {
      success: true,
      sheetUrl: outputResult.sheetUrl,
      sheetName: outputResult.sheetName,
      duration: duration
    };
    
  } catch (error) {
    const errorLog = logError('confirmMerge', error, { sessionId });
    updateProgress(sessionId, 0, 'Confirmation failed: ' + errorLog.message, {});
    
    return {
      success: false,
      error: errorLog.message,
      technicalDetails: errorLog.fullLog
    };
  }
}

/**
 * Cancels an ongoing merge operation
 * Cleans up temporary data and files
 * 
 * @param {string} sessionId - Session identifier
 * @returns {Object} {success, message}
 */
function cancelMerge(sessionId) {
  try {
    logInfo('cancelMerge', 'Cancelling merge operation', { sessionId });
    
    // Update status to cancelled
    updateProgress(sessionId, 0, 'Merge cancelled by user', {});
    
    // Cleanup temporary files
    const cdkFileId = getCachedData(sessionId, 'cdkFileId');
    if (cdkFileId) {
      cleanupTempFile(cdkFileId);
    }
    
    // Clear session cache
    cleanupSession(sessionId);
    
    logInfo('cancelMerge', 'Merge cancelled and cleaned up', { sessionId });
    
    return {
      success: true,
      message: 'Merge operation cancelled successfully'
    };
    
  } catch (error) {
    const errorLog = logError('cancelMerge', error, { sessionId });
    
    return {
      success: false,
      error: errorLog.message
    };
  }
}

/**
 * Activates the MERGED_DATA sheet and scrolls to top
 * 
 * @returns {Object} {success, message, error}
 */
function viewMergedDataSheet() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MERGED_DATA');
    
    if (!sheet) {
      throw new Error('MERGED_DATA sheet not found. Please run a merge first.');
    }
    
    sheet.activate();
    sheet.setActiveCell(sheet.getRange('A1'));
    
    return {
      success: true,
      message: 'Viewing MERGED_DATA sheet'
    };
    
  } catch (error) {
    const errorLog = logError('viewMergedDataSheet', error);
    
    return {
      success: false,
      error: errorLog.message
    };
  }
}

/**
 * Navigates to the unmatched records section in MERGED_DATA sheet
 * 
 * @returns {Object} {success, message, error}
 */
function viewUnmatchedSheet() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MERGED_DATA');
    
    if (!sheet) {
      throw new Error('MERGED_DATA sheet not found');
    }
    
    // Find "UNMATCHED RECORDS" section
    const lastRow = sheet.getLastRow();
    let unmatchedRow = null;
    
    for (let i = 1; i <= lastRow; i++) {
      const value = sheet.getRange(i, 1).getValue();
      if (String(value).toUpperCase().includes('UNMATCHED RECORDS')) {
        unmatchedRow = i;
        break;
      }
    }
    
    if (unmatchedRow) {
      sheet.activate();
      sheet.setActiveCell(sheet.getRange(unmatchedRow, 1));
      return {
        success: true,
        message: 'Viewing unmatched records section'
      };
    } else {
      sheet.activate();
      return {
        success: true,
        message: 'No unmatched records section found'
      };
    }
    
  } catch (error) {
    const errorLog = logError('viewUnmatchedSheet', error);
    
    return {
      success: false,
      error: errorLog.message
    };
  }
}

/**
 * Auto-detects column mapping from the sales log sheet
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Sales log sheet
 * @returns {Object} Configuration object with detected columns
 */
function detectColumnMapping(sheet) {
  try {
    if (!sheet) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    }
    
    // Default column mapping based on architecture specs
    const config = {
      salesLog: {
        sheet: sheet,
        newStockColumn: 5,    // Column E
        usedStockColumn: 12,  // Column L
        headerRow: 1,
        dataStartRow: 2
      },
      cdk: {
        headerRow: 1,
        dataStartRow: 2
      },
      matching: {
        requireExactMatch: false,
        minConfidence: 70,
        caseSensitive: false,
        allowPartialMatches: true,
        validateStockType: true
      }
    };
    
    logInfo('detectColumnMapping', 'Column mapping detected', config);
    
    return config;
    
  } catch (error) {
    logError('detectColumnMapping', error);
    throw error;
  }
}

// ==================== INTERNAL HELPER FUNCTIONS ====================

/**
 * Processes Sales Log sheet and extracts records
 * 
 * @private
 * @param {Object} salesLogConfig - Sales log configuration
 * @returns {Array} Array of sales log record objects
 */
function processSalesLogSheet(salesLogConfig) {
  try {
    const sheet = salesLogConfig.sheet || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const lastRow = sheet.getLastRow();
    const dataStartRow = salesLogConfig.dataStartRow || 2;
    
    if (lastRow < dataStartRow) {
      return [];
    }
    
    const data = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 14).getValues();
    const records = [];
    
    data.forEach((row, index) => {
      // Check if row has data (customer name not empty)
      if (row[1]) { // Column B - Customer
        const record = {
          rowNumber: dataStartRow + index,
          customerLastName: row[1] || '',
          model: row[2] || '',
          fiNew: row[3] || '',
          stockNumber: row[4] || row[11] || '', // E (new) or L (used)
          stockType: row[4] ? 'NEW' : 'USED',
          tradeStock: row[5] || row[12] || '',
          salesperson: row[6] || row[13] || ''
        };
        
        if (record.stockNumber) {
          records.push(record);
        }
      }
    });
    
    logInfo('processSalesLogSheet', 'Extracted sales log records', {
      recordCount: records.length
    });
    
    return records;
    
  } catch (error) {
    logError('processSalesLogSheet', error);
    throw error;
  }
}

/**
 * Processes CDK data array and extracts records
 * 
 * @private
 * @param {Array} cdkData - 2D array of CDK data
 * @returns {Array} Array of CDK record objects
 */
function processCDKData(cdkData) {
  try {
    if (!Array.isArray(cdkData) || cdkData.length < 2) {
      throw new Error('Invalid CDK data format');
    }
    
    // Assume first row is headers
    const headers = cdkData[0];
    const records = [];
    
    // Process data rows
    for (let i = 1; i < cdkData.length; i++) {
      const row = cdkData[i];
      
      const record = {
        rowNumber: i,
        contractDate: row[0] || null,
        customerLastName: row[1] || '',
        stockNo: row[3] || '',
        model: row[8] || '',
        stockType: row[9] || '',
        frontGP: parseFloat(row[10]) || 0,
        backGP: parseFloat(row[11]) || 0,
        totalGP: parseFloat(row[12]) || 0,
        cashPrice: parseFloat(row[13]) || 0,
        trades: parseFloat(row[14]) || 0,
        serviceContract: parseFloat(row[15]) || 0,
        vin: row[16] || '',
        year: parseInt(row[17]) || null,
        financeInstitution: row[18] || '',
        fiManager: row[19] || '',
        term: parseInt(row[20]) || null,
        dealNo: row[21] || '',
        salesperson: row[22] || ''
      };
      
      if (record.stockNo) {
        records.push(record);
      }
    }
    
    logInfo('processCDKData', 'Extracted CDK records', {
      recordCount: records.length
    });
    
    return records;
    
  } catch (error) {
    logError('processCDKData', error);
    throw error;
  }
}

/**
 * Creates a temporary file in Drive
 * 
 * @private
 * @param {string} base64Data - Base64 encoded file data
 * @param {string} fileName - Original filename
 * @param {string} sessionId - Session identifier
 * @returns {string} Drive file ID
 */
function createTempDriveFile(base64Data, fileName, sessionId) {
  try {
    // Decode base64 data
    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      MimeType.MICROSOFT_EXCEL,
      fileName
    );
    
    // Create file in Drive
    const file = DriveApp.createFile(blob);
    file.setName(`merge_temp_${sessionId}_${fileName}`);
    
    logInfo('createTempDriveFile', 'Created temporary file', {
      fileId: file.getId(),
      fileName: fileName
    });
    
    return file.getId();
    
  } catch (error) {
    logError('createTempDriveFile', error, { fileName });
    throw new Error('Failed to create temporary file: ' + error.message);
  }
}

/**
 * Validates file format
 * 
 * @private
 * @param {string} fileId - Drive file ID
 * @param {string} fileName - Filename
 * @returns {Object} {valid, error}
 */
function validateFileFormat(fileId, fileName) {
  try {
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();
    
    // Check file extension
    const extension = fileName.toLowerCase().split('.').pop();
    const validExtensions = ['xlsx', 'xls', 'csv'];
    
    if (!validExtensions.includes(extension)) {
      return {
        valid: false,
        error: `Unsupported file format: ${extension}. Please use .xlsx, .xls, or .csv`
      };
    }
    
    return { valid: true };
    
  } catch (error) {
    logError('validateFileFormat', error, { fileId, fileName });
    return {
      valid: false,
      error: 'Could not validate file format: ' + error.message
    };
  }
}

/**
 * Reads file contents from Drive
 * 
 * @private
 * @param {string} fileId - Drive file ID
 * @param {string} fileName - Filename
 * @returns {Object} {data, headers}
 */
function readFileContents(fileId, fileName) {
  try {
    const file = DriveApp.getFileById(fileId);
    const extension = fileName.toLowerCase().split('.').pop();
    
    if (extension === 'csv') {
      // Read CSV file
      const csvContent = file.getBlob().getDataAsString();
      const data = Utilities.parseCsv(csvContent);
      
      return {
        data: data,
        headers: data[0] || []
      };
    } else {
      // Convert Excel to Sheets format
      const resource = {
        title: file.getName(),
        mimeType: MimeType.GOOGLE_SHEETS
      };
      
      const convertedFile = Drive.Files.copy(resource, fileId);
      const sheet = SpreadsheetApp.openById(convertedFile.id).getSheets()[0];
      const data = sheet.getDataRange().getValues();
      
      // Delete the converted file
      DriveApp.getFileById(convertedFile.id).setTrashed(true);
      
      return {
        data: data,
        headers: data[0] || []
      };
    }
    
  } catch (error) {
    logError('readFileContents', error, { fileId, fileName });
    throw new Error('Failed to read file contents: ' + error.message);
  }
}

/**
 * Updates progress for a session
 * 
 * @private
 * @param {string} sessionId - Session identifier
 * @param {number} percent - Progress percentage (0-100)
 * @param {string} message - Status message
 * @param {Object} stats - Additional statistics
 */
function updateProgress(sessionId, percent, message, stats = {}) {
  try {
    const progress = {
      sessionId: sessionId,
      status: percent === 100 ? 'complete' : (percent === 0 ? 'error' : 'processing'),
      percent: percent,
      message: message,
      stats: stats,
      lastUpdate: new Date().getTime()
    };
    
    const cache = CacheService.getScriptCache();
    cache.put(
      `merge_progress_${sessionId}`,
      JSON.stringify(progress),
      21600  // 6 hours
    );
    
  } catch (error) {
    logError('updateProgress', error, { sessionId, percent, message });
  }
}

/**
 * Stores data in cache for a session
 * 
 * @private
 * @param {string} sessionId - Session identifier
 * @param {string} key - Data key
 * @param {*} data - Data to store
 */
function storeCachedData(sessionId, key, data) {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = `merge_data_${sessionId}_${key}`;
    
    cache.put(cacheKey, JSON.stringify(data), 21600); // 6 hours
    
  } catch (error) {
    logError('storeCachedData', error, { sessionId, key });
  }
}

/**
 * Retrieves data from cache for a session
 * 
 * @private
 * @param {string} sessionId - Session identifier
 * @param {string} key - Data key
 * @returns {*} Cached data or null
 */
function getCachedData(sessionId, key) {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = `merge_data_${sessionId}_${key}`;
    const data = cache.get(cacheKey);
    
    return data ? JSON.parse(data) : null;
    
  } catch (error) {
    logError('getCachedData', error, { sessionId, key });
    return null;
  }
}

/**
 * Cleans up temporary file from Drive
 * 
 * @private
 * @param {string} fileId - Drive file ID
 */
function cleanupTempFile(fileId) {
  try {
    if (fileId) {
      const file = DriveApp.getFileById(fileId);
      file.setTrashed(true);
      
      logInfo('cleanupTempFile', 'Temporary file cleaned up', { fileId });
    }
  } catch (error) {
    logWarning('cleanupTempFile', 'Could not cleanup temporary file: ' + error.message, { fileId });
  }
}

/**
 * Cleans up session cache
 * 
 * @private
 * @param {string} sessionId - Session identifier
 */
function cleanupSession(sessionId) {
  try {
    const cache = CacheService.getScriptCache();
    const keys = [
      `merge_progress_${sessionId}`,
      `merge_data_${sessionId}_cdkFileId`,
      `merge_data_${sessionId}_cdkFileName`,
      `merge_data_${sessionId}_cdkData`,
      `merge_data_${sessionId}_mergeResults`
    ];
    
    keys.forEach(key => {
      cache.remove(key);
    });
    
    logInfo('cleanupSession', 'Session cache cleaned up', { sessionId });
    
  } catch (error) {
    logWarning('cleanupSession', 'Could not cleanup session: ' + error.message, { sessionId });
  }
}