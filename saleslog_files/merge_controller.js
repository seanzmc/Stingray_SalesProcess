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
    const html = HtmlService.createTemplateFromFile('merge_sidebar')
      .evaluate()
      .setTitle('CDK Data Merge Tool')
      .setWidth(400);
    
    SpreadsheetApp.getUi().showSidebar(html);
    
    logInfo('showMergeSidebar', 'Merge sidebar opened successfully');
  } catch (error) {
    const errorLog = logError('showMergeSidebar', error);
    const errorMessage = errorLog?.message || 'Unknown error occurred';
    SpreadsheetApp.getUi().alert('Error opening merge sidebar: ' + errorMessage);
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
    
    // Validate inputs with safe checks
    if (!fileData || typeof fileData !== 'string') {
      return {
        success: false,
        error: 'Invalid file data provided'
      };
    }
    
    if (!fileName || typeof fileName !== 'string') {
      return {
        success: false,
        error: 'Invalid file name provided'
      };
    }
    
    if (!sessionId || typeof sessionId !== 'string') {
      return {
        success: false,
        error: 'Invalid session ID provided'
      };
    }
    
    // Update progress
    updateProgress(sessionId, 5, 'Uploading CDK file...', {});
    
    // Create temporary file in Drive
    let fileId;
    try {
      fileId = createTempDriveFile(fileData, fileName, sessionId);
    } catch (driveError) {
      logError('uploadCDKFile', driveError, { step: 'createTempDriveFile' });
      return {
        success: false,
        error: 'Failed to create temporary file: ' + (driveError.message || driveError)
      };
    }
    
    updateProgress(sessionId, 15, 'Validating file format...', {});
    
    // Validate file format
    const validation = validateFileFormat(fileId, fileName);
    if (!validation.valid) {
      cleanupTempFile(fileId);
      return {
        success: false,
        error: validation.error || 'Invalid file format'
      };
    }
    
    updateProgress(sessionId, 25, 'Reading file data...', {});
    
    // Read file data with error handling
    let fileContents;
    try {
      fileContents = readFileContents(fileId, fileName);
      
      if (!fileContents || !fileContents.data || !Array.isArray(fileContents.data)) {
        throw new Error('File contents could not be read or are invalid');
      }
      
      if (fileContents.data.length === 0) {
        throw new Error('File appears to be empty');
      }
      
    } catch (readError) {
      logError('uploadCDKFile', readError, { step: 'readFileContents' });
      cleanupTempFile(fileId);
      return {
        success: false,
        error: 'Failed to read file contents: ' + (readError.message || readError)
      };
    }
    
    updateProgress(sessionId, 40, 'Processing CDK data...', {});
    
    // Store in cache for later use
    try {
      storeCachedData(sessionId, 'cdkFileId', fileId);
      storeCachedData(sessionId, 'cdkFileName', fileName);
      storeCachedData(sessionId, 'cdkData', fileContents.data);
    } catch (cacheError) {
      logError('uploadCDKFile', cacheError, { step: 'storeCachedData' });
      cleanupTempFile(fileId);
      return {
        success: false,
        error: 'Failed to cache file data: ' + (cacheError.message || cacheError)
      };
    }
    
    // Generate preview (first 10 rows)
    const preview = fileContents.data.slice(0, Math.min(10, fileContents.data.length));
    
    // Detect columns for mapping
    const detectedColumns = {
      headers: fileContents.data[0] || [],
      stockColumn: undefined,
      typeColumn: undefined,
      frontGPColumn: undefined,
      backGPColumn: undefined,
      totalGPColumn: undefined
    };
    
    updateProgress(sessionId, 50, 'CDK file uploaded successfully', {
      rowCount: fileContents.data.length
    });
    
    logInfo('uploadCDKFile', 'CDK file processed successfully', {
      fileName,
      rowCount: fileContents.data.length,
      columnCount: detectedColumns.headers.length
    });
    
    return {
      success: true,
      fileId: fileId,
      fileName: fileName,
      preview: preview,
      rowCount: fileContents.data.length,
      columnCount: detectedColumns.headers.length,
      detectedColumns: detectedColumns
    };
    
  } catch (error) {
    // Catch-all for any unexpected errors
    const errorLog = logError('uploadCDKFile', error, { fileName, sessionId });
    
    try {
      updateProgress(sessionId, 0, 'Upload failed', {});
    } catch (e) {
      // Ignore progress update errors
    }
    
    // Return a safe error response
    return {
      success: false,
      error: errorLog?.message || 'An unexpected error occurred during file upload'
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
    logInfo('startMergeProcess', 'Starting merge process', { config });
    
    // Validate configuration with safe checks
    if (!config || typeof config !== 'object') {
      return {
        success: false,
        error: 'Invalid configuration provided'
      };
    }
    
    if (!config.sessionId || typeof config.sessionId !== 'string') {
      return {
        success: false,
        error: 'Session ID is required'
      };
    }
    
    const sessionId = config.sessionId;
    
    // Initialize progress tracking
    updateProgress(sessionId, 0, 'Initializing merge process...', {});
    
    // Step 1: Read Sales Log data
    updateProgress(sessionId, 10, 'Reading Sales Log data...', {});
    
    // Build sales log configuration
    const salesLogConfig = {
      sheet: SpreadsheetApp.getActiveSpreadsheet().getActiveSheet(),
      newStockColumn: 5,
      usedStockColumn: 12,
      headerRow: 1,
      dataStartRow: 2
    };
    
    let salesLogRecords;
    try {
      salesLogRecords = processSalesLogSheet(salesLogConfig);
      logInfo('startMergeProcess', 'Sales Log data processed', {
        recordCount: salesLogRecords.length
      });
    } catch (salesLogError) {
      logError('startMergeProcess', salesLogError, { step: 'processSalesLogSheet' });
      return {
        success: false,
        error: 'Failed to read Sales Log data: ' + (salesLogError.message || salesLogError)
      };
    }
    
    // Step 2: Read CDK data
    updateProgress(sessionId, 25, 'Reading CDK export data...', {});
    const cdkData = getCachedData(sessionId, 'cdkData');
    
    if (!cdkData || !Array.isArray(cdkData)) {
      return {
        success: false,
        error: 'CDK data not found in cache. Please upload CDK file again.'
      };
    }
    
    let cdkRecords;
    try {
      cdkRecords = processCDKData(cdkData, config.columnMapping);
      logInfo('startMergeProcess', 'CDK data processed', {
        recordCount: cdkRecords.length
      });
    } catch (cdkError) {
      logError('startMergeProcess', cdkError, { step: 'processCDKData' });
      return {
        success: false,
        error: 'Failed to process CDK data: ' + (cdkError.message || cdkError)
      };
    }
    
    // Step 3: Match stock numbers
    updateProgress(sessionId, 40, 'Matching stock numbers...', {
      salesLogCount: salesLogRecords.length,
      cdkCount: cdkRecords.length
    });
    
    // Build matching options from config
    const matchingOptions = {
      requireExactMatch: false,
      minConfidence: (config.matchingOptions && config.matchingOptions.confidenceThreshold)
        ? config.matchingOptions.confidenceThreshold * 100
        : 70,
      caseSensitive: config.matchingOptions && config.matchingOptions.caseInsensitive ? false : true,
      allowPartialMatches: config.matchingOptions && config.matchingOptions.enablePartialMatch ? true : false,
      validateStockType: true,
      ignoreLeadingZeros: config.matchingOptions && config.matchingOptions.ignoreLeadingZeros ? true : false
    };
    
    let matchResults;
    try {
      matchResults = matchStockNumbers(
        salesLogRecords,
        cdkRecords,
        matchingOptions
      );
    } catch (matchError) {
      logError('startMergeProcess', matchError, { step: 'matchStockNumbers' });
      return {
        success: false,
        error: 'Failed to match stock numbers: ' + (matchError.message || matchError)
      };
    }
    
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
    
    // CRITICAL FIX: Store results in progress object to avoid race condition
    // When frontend polls getMergeStatus, results will be immediately available
    updateProgress(sessionId, 100, 'Merge process complete - ready for review', {
      duration: duration.toFixed(2),
      matchRate: stats.matchRate,
      totalRecords: stats.totalRecords,
      matched: stats.mergedRecords,
      // Include formatted results for immediate frontend access
      results: {
        totalRecords: stats.totalRecords || 0,
        matchedRecords: stats.mergedRecords || 0,
        totalGP: stats.financialSummary ? stats.financialSummary.totalGP : 0,
        unmatchedCount: stats.unmatchedSalesLog || 0,
        reviewRecords: [],
        matchRate: stats.matchRate || 0
      }
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
    const errorMessage = errorLog?.message || 'Unknown error occurred';
    const technicalDetails = errorLog?.fullLog || 'No technical details available';
    
    updateProgress(config.sessionId, 0, 'Error: ' + errorMessage, {});
    
    return {
      success: false,
      error: errorMessage,
      technicalDetails: technicalDetails
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
    
    const response = {
      percentage: progress.percent || 0,
      message: progress.message || '',
      stats: progress.stats || {},
      status: progress.status || 'processing',
      lastUpdate: progress.lastUpdate
    };
    
    // If merge is complete, retrieve and format results for frontend
    if (progress.status === 'complete') {
      // CRITICAL FIX: First try to get results from progress.stats (no race condition)
      // This was stored along with the progress update, so it's immediately available
      if (progress.stats && progress.stats.results) {
        response.results = progress.stats.results;
        
        logInfo('getMergeStatus', 'Results retrieved from progress object', {
          totalRecords: response.results.totalRecords,
          matchedRecords: response.results.matchedRecords
        });
      } else {
        // FALLBACK: Try to retrieve from separate cache (legacy support)
        const cachedResults = getCachedData(sessionId, 'mergeResults');
        
        // Diagnostic logging to identify cache retrieval issues
        logInfo('getMergeStatus', 'Falling back to cached results retrieval', {
          sessionId: sessionId,
          cachedResultsExists: !!cachedResults,
          hasStats: cachedResults ? !!cachedResults.stats : false
        });
        
        if (cachedResults && cachedResults.stats) {
          // Transform the cached results structure to match what the frontend expects
          response.results = {
            totalRecords: cachedResults.stats.totalRecords || 0,
            matchedRecords: cachedResults.stats.mergedRecords || 0,
            totalGP: cachedResults.stats.financialSummary ? cachedResults.stats.financialSummary.totalGP : 0,
            unmatchedCount: cachedResults.stats.unmatchedSalesLog || 0,
            reviewRecords: [],  // Placeholder - could be populated from validation if needed
            matchRate: cachedResults.stats.matchRate || 0
          };
          
          logInfo('getMergeStatus', 'Results successfully retrieved from fallback cache', {
            totalRecords: response.results.totalRecords,
            matchedRecords: response.results.matchedRecords
          });
        } else {
          // CRITICAL: Both retrieval methods failed - log for diagnosis
          logError('getMergeStatus', new Error('Failed to retrieve results from both sources'), {
            sessionId: sessionId,
            progressStatsResults: !!(progress.stats && progress.stats.results),
            cachedResultsNull: !cachedResults,
            statsUndefined: cachedResults ? !cachedResults.stats : 'N/A',
            progressPercent: progress.percent,
            progressStatus: progress.status
          });
          
          // Set error flag and informative message
          response.stats.cacheError = true;
          response.message = 'Results not yet available - please wait and the page will auto-update';
        }
      }
    }
    
    return response;
    
  } catch (error) {
    logError('getMergeStatus', error, { sessionId });
    return {
      percentage: 0,
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
    
    // STEP 1: Retrieve results using dual-path strategy
    logInfo('confirmMerge', 'STEP 1: Retrieving merge results', { sessionId });
    let results = null;
    
    // PRIMARY: Try to get results from progress object first (follows getMergeStatus pattern)
    try {
      const cache = CacheService.getScriptCache();
      const progressKey = `merge_progress_${sessionId}`;
      const progressJson = cache.get(progressKey);
      
      if (progressJson) {
        const progress = JSON.parse(progressJson);
        
        // Check if progress indicates completion and results are available
        if (progress.status === 'complete' && progress.stats && progress.stats.results) {
          // Progress exists and shows completion - retrieve full results from cache
          results = getCachedData(sessionId, 'mergeResults');
          
          if (results) {
            logInfo('confirmMerge', 'Retrieved results from progress-indicated cache', {
              hasMergedRecords: !!results.mergedRecords,
              hasStats: !!results.stats,
              mergedRecordsLength: results.mergedRecords ? results.mergedRecords.length : 0
            });
          }
        }
      }
    } catch (progressError) {
      logWarning('confirmMerge', 'Could not check progress object, trying fallback', {
        error: progressError.message
      });
    }
    
    // FALLBACK: Try cache directly if progress path didn't work
    if (!results) {
      results = getCachedData(sessionId, 'mergeResults');
      
      if (results) {
        logInfo('confirmMerge', 'Retrieved results from cache fallback', {
          hasMergedRecords: !!results.mergedRecords,
          hasStats: !!results.stats,
          hasUnmatchedReports: !!results.unmatchedReports,
          mergedRecordsLength: results.mergedRecords ? results.mergedRecords.length : 0
        });
      }
    }
    
    // Only throw error if BOTH paths failed
    if (!results) {
      logError('confirmMerge', new Error('Results not found in either location'), {
        sessionId: sessionId,
        checkedProgressPath: true,
        checkedCacheFallback: true,
        possibleCause: 'Cache size limit exceeded or data expired'
      });
      
      // Enhanced error message with diagnostic information
      throw new Error(
        'Merge results not found in cache. This may occur if:\n' +
        '1. The merge results exceeded the cache size limit (100KB)\n' +
        '2. The cache data has expired (6 hour TTL)\n' +
        '3. The merge process did not complete successfully\n\n' +
        'Please run the merge process again. The system now uses chunking to handle large datasets.'
      );
    }
    
    logInfo('confirmMerge', 'Results successfully retrieved via dual-path strategy', {
      hasMergedRecords: !!results.mergedRecords,
      hasStats: !!results.stats,
      hasUnmatchedReports: !!results.unmatchedReports,
      mergedRecordsLength: results.mergedRecords ? results.mergedRecords.length : 0
    });
    
    if (!results.mergedRecords || !Array.isArray(results.mergedRecords)) {
      throw new Error('Invalid merge results: mergedRecords is missing or not an array');
    }
    
    if (!results.stats) {
      throw new Error('Invalid merge results: stats object is missing');
    }
    
    updateProgress(sessionId, 10, 'Writing merged data to sheet...', {});
    
    // STEP 2: Generate output sheet
    logInfo('confirmMerge', 'STEP 2: Generating merged output', {
      recordCount: results.mergedRecords.length,
      hasStats: !!results.stats,
      hasUnmatchedReports: !!results.unmatchedReports
    });
    
    let outputResult;
    try {
      outputResult = generateMergedOutput(
        results.mergedRecords,
        results.stats,
        results.unmatchedReports
      );
      
      logInfo('confirmMerge', 'generateMergedOutput returned', {
        success: outputResult ? outputResult.success : false,
        hasSheetName: outputResult ? !!outputResult.sheetName : false,
        hasSheetUrl: outputResult ? !!outputResult.sheetUrl : false,
        error: outputResult && !outputResult.success ? outputResult.error : null
      });
    } catch (outputError) {
      const outputErrorLog = logError('confirmMerge', outputError, {
        step: 'generateMergedOutput',
        recordCount: results.mergedRecords.length
      });
      throw new Error('Output generation failed: ' + outputErrorLog.message);
    }
    
    if (!outputResult) {
      throw new Error('generateMergedOutput returned null or undefined');
    }
    
    if (!outputResult.success) {
      throw new Error('Failed to generate output: ' + (outputResult.error || 'Unknown reason'));
    }
    
    updateProgress(sessionId, 75, 'Creating merge log entry...', {});
    
    // STEP 3: Create merge log entry
    logInfo('confirmMerge', 'STEP 3: Creating merge log entry');
    
    let cdkFileName;
    try {
      cdkFileName = getCachedData(sessionId, 'cdkFileName') || 'Unknown';
    } catch (fileNameError) {
      logWarning('confirmMerge', 'Could not retrieve CDK filename', { error: fileNameError.message });
      cdkFileName = 'Unknown';
    }
    
    const duration = (Date.now() - startTime) / 1000;
    
    try {
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
      
      logInfo('confirmMerge', 'Merge log entry created successfully');
    } catch (logEntryError) {
      // Log entry failure shouldn't stop the merge completion
      const logEntryErrorLog = logError('confirmMerge', logEntryError, { step: 'createMergeLogEntry' });
      logWarning('confirmMerge', 'Merge log entry creation failed but continuing: ' + logEntryErrorLog.message);
    }
    
    updateProgress(sessionId, 90, 'Cleaning up temporary files...', {});
    
    // STEP 4: Cleanup temporary files
    logInfo('confirmMerge', 'STEP 4: Cleaning up temporary files');
    try {
      const cdkFileId = getCachedData(sessionId, 'cdkFileId');
      if (cdkFileId) {
        cleanupTempFile(cdkFileId);
        logInfo('confirmMerge', 'Temporary file cleaned up', { fileId: cdkFileId });
      }
    } catch (cleanupError) {
      logWarning('confirmMerge', 'Temp file cleanup failed but continuing: ' + cleanupError.message);
    }
    
    // STEP 5: Clear session cache
    logInfo('confirmMerge', 'STEP 5: Clearing session cache');
    try {
      cleanupSession(sessionId);
      logInfo('confirmMerge', 'Session cache cleared successfully');
    } catch (sessionError) {
      logWarning('confirmMerge', 'Session cleanup failed but continuing: ' + sessionError.message);
    }
    
    updateProgress(sessionId, 100, 'Merge completed successfully!', {
      sheetName: outputResult.sheetName
    });
    
    logInfo('confirmMerge', 'Merge confirmed and finalized successfully', {
      duration: duration,
      sheetName: outputResult.sheetName,
      sheetUrl: outputResult.sheetUrl
    });
    
    return {
      success: true,
      sheetUrl: outputResult.sheetUrl,
      sheetName: outputResult.sheetName,
      duration: duration
    };
    
  } catch (error) {
    // CRITICAL: Comprehensive error logging
    logError('confirmMerge', error, {
      sessionId,
      errorType: error.constructor ? error.constructor.name : typeof error,
      errorMessage: error.message || String(error),
      errorStack: error.stack || 'No stack trace available'
    });
    
    const errorMessage = error.message || String(error) || 'Unknown error occurred';
    const technicalDetails = error.stack || error.toString() || 'No technical details available';
    
    // Log the exact error details that will be returned
    logInfo('confirmMerge', 'Returning error response', {
      errorMessage: errorMessage,
      technicalDetails: technicalDetails,
      hasStack: !!error.stack
    });
    
    try {
      updateProgress(sessionId, 0, 'Confirmation failed: ' + errorMessage, {});
    } catch (progressError) {
      logWarning('confirmMerge', 'Could not update progress for error state: ' + progressError.message);
    }
    
    return {
      success: false,
      error: errorMessage,
      technicalDetails: technicalDetails
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
      error: errorLog?.message || 'Unknown error occurred'
    };
  }
}

/**
 * Gets the current merge configuration
 * Returns default configuration for the merge tool
 *
 * @returns {Object} Configuration object
 */
function getMergeConfiguration() {
  try {
    logInfo('getMergeConfiguration', 'Retrieving merge configuration');
    
    // Return default configuration
    const config = {
      salesLog: {
        newStockColumn: 5,    // Column E
        usedStockColumn: 12,  // Column L
        headerRow: 1,
        dataStartRow: 2
      },
      cdk: {
        headerRow: 1,
        dataStartRow: 2,
        stockColumn: 3,       // Column D (default)
        typeColumn: 9,        // Column J (default)
        frontGPColumn: 10,    // Column K (default)
        backGPColumn: 11,     // Column L (default)
        totalGPColumn: 12     // Column M (default)
      },
      matching: {
        requireExactMatch: false,
        minConfidence: 70,
        caseSensitive: false,
        allowPartialMatches: true,
        validateStockType: true,
        ignoreLeadingZeros: true
      }
    };
    
    logInfo('getMergeConfiguration', 'Configuration retrieved successfully');
    return config;
    
  } catch (error) {
    const errorLog = logError('getMergeConfiguration', error);
    return {
      success: false,
      error: errorLog?.message || 'Unknown error occurred'
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
      error: errorLog?.message || 'Unknown error occurred'
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
      error: errorLog?.message || 'Unknown error occurred'
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
      // Read CSV file with encoding handling
      let csvContent;
      try {
        csvContent = file.getBlob().getDataAsString('UTF-8');
      } catch (encodingError) {
        // Try without encoding specification
        csvContent = file.getBlob().getDataAsString();
      }
      
      if (!csvContent || csvContent.trim().length === 0) {
        throw new Error('CSV file appears to be empty');
      }
      
      // Parse CSV with error handling
      let data;
      try {
        data = Utilities.parseCsv(csvContent);
      } catch (parseError) {
        logError('readFileContents', parseError, { step: 'parseCsv', contentLength: csvContent.length });
        throw new Error('Failed to parse CSV file. The file may be corrupted or have invalid formatting.');
      }
      
      // Validate parsed data
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('CSV file contains no data');
      }
      
      // Clean up data - remove completely empty rows at the end
      while (data.length > 0 && data[data.length - 1].every(cell => !cell || cell === '')) {
        data.pop();
      }
      
      if (data.length === 0) {
        throw new Error('CSV file contains only empty rows');
      }
      
      logInfo('readFileContents', 'CSV file parsed successfully', {
        rows: data.length,
        columns: data[0] ? data[0].length : 0
      });
      
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
      
      let convertedFile;
      try {
        convertedFile = Drive.Files.copy(resource, fileId);
      } catch (convertError) {
        logError('readFileContents', convertError, { step: 'Drive.Files.copy' });
        throw new Error('Failed to convert Excel file. The file may be password-protected or corrupted.');
      }
      
      let data;
      try {
        const sheet = SpreadsheetApp.openById(convertedFile.id).getSheets()[0];
        data = sheet.getDataRange().getValues();
      } catch (sheetError) {
        logError('readFileContents', sheetError, { step: 'getDataRange' });
        throw new Error('Failed to read data from converted spreadsheet');
      } finally {
        // Always try to delete the converted file
        try {
          if (convertedFile && convertedFile.id) {
            DriveApp.getFileById(convertedFile.id).setTrashed(true);
          }
        } catch (cleanupError) {
          logWarning('readFileContents', 'Could not cleanup converted file', { fileId: convertedFile ? convertedFile.id : 'unknown' });
        }
      }
      
      if (!data || data.length === 0) {
        throw new Error('Excel file contains no data');
      }
      
      logInfo('readFileContents', 'Excel file converted and parsed successfully', {
        rows: data.length,
        columns: data[0] ? data[0].length : 0
      });
      
      return {
        data: data,
        headers: data[0] || []
      };
    }
    
  } catch (error) {
    const errorLog = logError('readFileContents', error, { fileId, fileName });
    const errorMessage = errorLog?.message || 'Unknown error occurred';
    throw new Error('Failed to read file contents: ' + errorMessage);
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
 * Implements chunking strategy for data exceeding 90KB to avoid CacheService 100KB limit
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
    const jsonData = JSON.stringify(data);
    const dataSize = jsonData.length;
    
    // Log data size for diagnostics
    logInfo('storeCachedData', 'Caching data', {
      sessionId: sessionId,
      key: key,
      sizeBytes: dataSize,
      sizeKB: (dataSize / 1024).toFixed(2)
    });
    
    // CacheService has 100KB limit per entry - use 90KB threshold for safety
    const MAX_CACHE_SIZE = 90 * 1024; // 90KB - leave 10KB buffer
    const CHUNK_SIZE = 80 * 1024; // 80KB per chunk - safe size with buffer
    
    if (dataSize <= MAX_CACHE_SIZE) {
      // Data is small enough, store in single entry
      cache.put(cacheKey, jsonData, 21600); // 6 hours
      
      logInfo('storeCachedData', 'Data stored in single cache entry', {
        key: key,
        sizeKB: (dataSize / 1024).toFixed(2)
      });
    } else {
      // Data exceeds safe limit, implement chunking strategy
      logInfo('storeCachedData', 'Data exceeds cache limit, implementing chunking', {
        key: key,
        sizeKB: (dataSize / 1024).toFixed(2),
        thresholdKB: (MAX_CACHE_SIZE / 1024).toFixed(2)
      });
      
      // Calculate number of chunks needed
      const numChunks = Math.ceil(dataSize / CHUNK_SIZE);
      
      // Store metadata about the chunks
      const metadata = {
        totalSize: dataSize,
        numChunks: numChunks,
        chunkSize: CHUNK_SIZE,
        timestamp: new Date().getTime()
      };
      
      const metaKey = `${cacheKey}_meta`;
      cache.put(metaKey, JSON.stringify(metadata), 21600);
      
      // Split data into chunks and store each atomically
      const storedChunks = [];
      try {
        for (let i = 0; i < numChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, dataSize);
          const chunk = jsonData.substring(start, end);
          const chunkKey = `${cacheKey}_chunk_${i}`;
          
          cache.put(chunkKey, chunk, 21600);
          storedChunks.push(chunkKey);
          
          logInfo('storeCachedData', `Stored chunk ${i + 1}/${numChunks}`, {
            chunkIndex: i,
            chunkSizeKB: (chunk.length / 1024).toFixed(2)
          });
        }
        
        logInfo('storeCachedData', 'All chunks stored successfully', {
          key: key,
          numChunks: numChunks,
          totalSizeKB: (dataSize / 1024).toFixed(2)
        });
        
      } catch (chunkError) {
        // Cleanup partial chunks on failure to maintain atomicity
        logError('storeCachedData', chunkError, {
          key: key,
          failedAtChunk: storedChunks.length,
          totalChunks: numChunks
        });
        
        // Remove metadata
        cache.remove(metaKey);
        
        // Remove all stored chunks
        storedChunks.forEach(chunkKey => {
          try {
            cache.remove(chunkKey);
          } catch (cleanupError) {
            // Log but don't throw - best effort cleanup
            logWarning('storeCachedData', 'Failed to cleanup chunk: ' + chunkKey);
          }
        });
        
        throw new Error(`Failed to store chunk ${storedChunks.length} of ${numChunks}. Cache operation aborted.`);
      }
    }
    
  } catch (error) {
    logError('storeCachedData', error, {
      sessionId,
      key,
      errorMessage: error.message || 'Unknown error'
    });
    throw error;
  }
}

/**
 * Retrieves data from cache for a session
 * Handles both chunked (large) and single-entry (small) data with backward compatibility
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
    
    // Check for metadata first (indicates chunked data)
    const metaKey = `${cacheKey}_meta`;
    const metadataJson = cache.get(metaKey);
    
    if (metadataJson) {
      // Data was stored in chunks, reassemble it
      const metadata = JSON.parse(metadataJson);
      
      logInfo('getCachedData', 'Retrieving chunked data', {
        key: key,
        numChunks: metadata.numChunks,
        totalSizeKB: (metadata.totalSize / 1024).toFixed(2)
      });
      
      let reconstructedData = '';
      let missingChunks = [];
      
      // Retrieve and concatenate all chunks
      for (let i = 0; i < metadata.numChunks; i++) {
        const chunkKey = `${cacheKey}_chunk_${i}`;
        const chunk = cache.get(chunkKey);
        
        if (!chunk) {
          missingChunks.push(i);
          logWarning('getCachedData', `Missing chunk ${i}`, {
            key: key,
            chunkIndex: i,
            totalChunks: metadata.numChunks
          });
        } else {
          reconstructedData += chunk;
        }
      }
      
      // If any chunks are missing, data is incomplete
      if (missingChunks.length > 0) {
        logError('getCachedData', new Error('Incomplete chunked data'), {
          key: key,
          missingChunks: missingChunks,
          totalChunks: metadata.numChunks
        });
        return null;
      }
      
      // Verify reconstructed size matches metadata
      if (reconstructedData.length !== metadata.totalSize) {
        logError('getCachedData', new Error('Size mismatch after reassembly'), {
          key: key,
          expectedSize: metadata.totalSize,
          actualSize: reconstructedData.length
        });
        return null;
      }
      
      logInfo('getCachedData', 'Successfully reassembled chunked data', {
        key: key,
        numChunks: metadata.numChunks,
        reconstructedSizeKB: (reconstructedData.length / 1024).toFixed(2)
      });
      
      return JSON.parse(reconstructedData);
      
    } else {
      // No metadata found - try single entry retrieval (backward compatibility)
      const data = cache.get(cacheKey);
      
      if (data) {
        logInfo('getCachedData', 'Retrieved single cache entry', {
          key: key,
          sizeKB: (data.length / 1024).toFixed(2)
        });
        return JSON.parse(data);
      } else {
        logInfo('getCachedData', 'No data found in cache', {
          key: key,
          sessionId: sessionId
        });
        return null;
      }
    }
    
  } catch (error) {
    logError('getCachedData', error, {
      sessionId,
      key,
      errorMessage: error.message || 'Unknown error'
    });
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