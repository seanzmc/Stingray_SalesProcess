'use strict';

/**
 * Stock Number Matching Algorithm Module
 * Implements a 3-phase matching approach for reconciling sales log and CDK stock numbers
 *
 * @module stock_matcher
 * @requires error_logger
 * @requires utilities_string
 */

/**
 * String utility functions are provided by utilities_string.js:
 * - normalizeStockNumber() - Normalizes stock numbers for comparison
 * - normalizeStockType() - Normalizes stock types ('NEW'/'USED')
 * - extractNumericPortion() - Extracts numeric portion from stock numbers
 * - calculateStringSimilarity() - Calculates similarity score (0-1) using Levenshtein distance
 * - levenshteinDistance() - Computes edit distance between strings
 */

/**
 * Main matching function that orchestrates the 3-phase matching algorithm
 * 
 * @param {Array<Object>} salesLogRecords - Array of sales log records with stockNumber and stockType
 * @param {Array<Object>} cdkRecords - Array of CDK records with stockNo and stockType
 * @param {Object} options - Configuration options for matching behavior
 * @param {boolean} [options.requireExactMatch=false] - If true, only exact matches are accepted
 * @param {number} [options.minConfidence=70] - Minimum confidence score (0-100) for matches
 * @param {boolean} [options.caseSensitive=false] - Whether to perform case-sensitive matching
 * @param {boolean} [options.allowPartialMatches=true] - Whether to allow fuzzy/partial matches
 * @param {boolean} [options.validateStockType=true] - Whether stock types must match
 * 
 * @returns {Object} Matching results with matches, unmatched records, and statistics
 * @returns {Array<Object>} returns.matches - Array of successful matches
 * @returns {Array<Object>} returns.unmatchedSalesLog - Sales log records without matches
 * @returns {Array<Object>} returns.unmatchedCDK - CDK records without matches
 * @returns {Object} returns.stats - Matching statistics
 */
function matchStockNumbers(salesLogRecords, cdkRecords, options = {}) {
  try {
    // Validate inputs
    if (!Array.isArray(salesLogRecords) || !Array.isArray(cdkRecords)) {
      throw new Error('salesLogRecords and cdkRecords must be arrays');
    }

    // Set default options
    const config = {
      requireExactMatch: options.requireExactMatch || false,
      minConfidence: options.minConfidence !== undefined ? options.minConfidence : 70,
      caseSensitive: options.caseSensitive || false,
      allowPartialMatches: options.allowPartialMatches !== false,
      validateStockType: options.validateStockType !== false
    };

    // Validate confidence threshold
    if (config.minConfidence < 0 || config.minConfidence > 100) {
      throw new Error('minConfidence must be between 0 and 100');
    }

    const matches = [];
    const unmatchedSalesLog = [];
    const unmatchedCDK = cdkRecords.slice(); // Create a copy to track unmatched CDK records
    const matchedCDKIndices = new Set();

    const stats = {
      totalSalesLog: salesLogRecords.length,
      totalCDK: cdkRecords.length,
      matched: 0,
      exactMatches: 0,
      numericMatches: 0,
      partialMatches: 0,
      matchRate: 0
    };

    // Phase 1: Exact Match
    for (let i = 0; i < salesLogRecords.length; i++) {
      const salesRecord = salesLogRecords[i];
      let matched = false;

      for (let j = 0; j < cdkRecords.length; j++) {
        if (matchedCDKIndices.has(j)) continue;

        const cdkRecord = cdkRecords[j];
        const matchResult = performMatch(salesRecord, cdkRecord, 'exact', config);

        if (matchResult.isMatch) {
          matches.push({
            salesLogRecord: salesRecord,
            cdkRecord: cdkRecord,
            matchType: 'exact',
            confidence: matchResult.confidence,
            stockNumber: matchResult.normalizedStock
          });
          matchedCDKIndices.add(j);
          stats.exactMatches++;
          stats.matched++;
          matched = true;
          break;
        }
      }

      if (!matched && !config.requireExactMatch) {
        // Phase 2: Numeric Match
        for (let j = 0; j < cdkRecords.length; j++) {
          if (matchedCDKIndices.has(j)) continue;

          const cdkRecord = cdkRecords[j];
          const matchResult = performMatch(salesRecord, cdkRecord, 'numeric', config);

          if (matchResult.isMatch && matchResult.confidence >= config.minConfidence) {
            matches.push({
              salesLogRecord: salesRecord,
              cdkRecord: cdkRecord,
              matchType: 'numeric',
              confidence: matchResult.confidence,
              stockNumber: matchResult.normalizedStock
            });
            matchedCDKIndices.add(j);
            stats.numericMatches++;
            stats.matched++;
            matched = true;
            break;
          }
        }
      }

      if (!matched && config.allowPartialMatches && !config.requireExactMatch) {
        // Phase 3: Partial/Fuzzy Match
        let bestMatch = null;
        let bestMatchIndex = -1;
        let bestConfidence = config.minConfidence;

        for (let j = 0; j < cdkRecords.length; j++) {
          if (matchedCDKIndices.has(j)) continue;

          const cdkRecord = cdkRecords[j];
          const matchResult = performMatch(salesRecord, cdkRecord, 'partial', config);

          if (matchResult.isMatch && matchResult.confidence > bestConfidence) {
            bestMatch = matchResult;
            bestMatchIndex = j;
            bestConfidence = matchResult.confidence;
          }
        }

        if (bestMatch) {
          matches.push({
            salesLogRecord: salesRecord,
            cdkRecord: cdkRecords[bestMatchIndex],
            matchType: 'partial',
            confidence: bestMatch.confidence,
            stockNumber: bestMatch.normalizedStock
          });
          matchedCDKIndices.add(bestMatchIndex);
          stats.partialMatches++;
          stats.matched++;
          matched = true;
        }
      }

      if (!matched) {
        unmatchedSalesLog.push(salesRecord);
      }
    }

    // Remove matched CDK records from unmatched list
    for (let i = unmatchedCDK.length - 1; i >= 0; i--) {
      if (matchedCDKIndices.has(i)) {
        unmatchedCDK.splice(i, 1);
      }
    }

    // Calculate match rate
    stats.matchRate = stats.totalSalesLog > 0 
      ? (stats.matched / stats.totalSalesLog * 100).toFixed(1)
      : 0;

    return {
      matches: matches,
      unmatchedSalesLog: unmatchedSalesLog,
      unmatchedCDK: unmatchedCDK,
      stats: stats
    };

  } catch (error) {
    logError('matchStockNumbers', error);
    throw error;
  }
}

/**
 * Performs stock number matching with specified match type
 * Consolidates exact, numeric, and partial matching into a single parameterized function
 * Uses shared utility functions from utilities_string.js for all string operations
 *
 * @private
 * @param {Object} salesRecord - Sales log record with stockNumber and stockType
 * @param {Object} cdkRecord - CDK record with stockNo and stockType
 * @param {string} matchType - Type of match to perform: 'exact', 'numeric', or 'partial'
 * @param {Object} config - Configuration object with validateStockType, minConfidence
 *
 * @returns {Object} Match result:
 *   - isMatch {boolean} - Whether the records match
 *   - confidence {number} - Match confidence score (0-100)
 *   - normalizedStock {string|null} - Normalized stock number if matched, null otherwise
 */
function performMatch(salesRecord, cdkRecord, matchType, config) {
  try {
    // Normalize stock numbers using shared utility
    const salesStock = normalizeStockNumber(salesRecord.stockNumber);
    const cdkStock = normalizeStockNumber(cdkRecord.stockNo);

    // Validate stock type if enabled
    if (config.validateStockType) {
      const salesType = normalizeStockType(salesRecord.stockType);
      const cdkType = normalizeStockType(cdkRecord.stockType);
      if (salesType !== cdkType) {
        return { isMatch: false, confidence: 0, normalizedStock: null };
      }
    }

    // Perform match based on type
    switch (matchType) {
      case 'exact':
        // Exact match comparison
        if (salesStock === cdkStock) {
          return { isMatch: true, confidence: 100, normalizedStock: salesStock };
        }
        break;

      case 'numeric':
        // Numeric portion match
        const salesNumeric = extractNumericPortion(salesRecord.stockNumber);
        const cdkNumeric = extractNumericPortion(cdkRecord.stockNo);
        
        if (salesNumeric && cdkNumeric && salesNumeric === cdkNumeric) {
          return { isMatch: true, confidence: 95, normalizedStock: salesStock };
        }
        break;

      case 'partial':
        // Fuzzy match using string similarity
        const similarity = calculateStringSimilarity(salesStock, cdkStock);
        const confidence = Math.round(similarity * 100);
        
        // Require at least 75% similarity for partial matches
        if (confidence >= 75) {
          return { isMatch: true, confidence: confidence, normalizedStock: salesStock };
        }
        break;

      default:
        logError('performMatch', new Error('Invalid match type: ' + matchType));
        return { isMatch: false, confidence: 0, normalizedStock: null };
    }

    return { isMatch: false, confidence: 0, normalizedStock: null };

  } catch (error) {
    logError('performMatch', error, { matchType });
    return { isMatch: false, confidence: 0, normalizedStock: null };
  }
}

/**
 * Logs errors to the error logger if available
 * 
 * @private
 * @param {string} functionName - Name of the function where error occurred
 * @param {Error} error - Error object
 */
function logError(functionName, error) {
  try {
    if (typeof logErrorToSheet === 'function') {
      logErrorToSheet(functionName, error.message, error.stack);
    } else {
      console.error(`[${functionName}] ${error.message}`);
    }
  } catch (e) {
    console.error(`Error logging in ${functionName}:`, e);
  }
}