'use strict';

/**
 * Stock Number Matching Algorithm Module
 * Implements a 3-phase matching approach for reconciling sales log and CDK stock numbers
 * 
 * @module stock_matcher
 * @requires error_logger
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
        const matchResult = performExactMatch(salesRecord, cdkRecord, config);

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
          const matchResult = performNumericMatch(salesRecord, cdkRecord, config);

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
          const matchResult = performPartialMatch(salesRecord, cdkRecord, config);

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
 * Performs exact match comparison between two stock numbers
 * 
 * @private
 * @param {Object} salesRecord - Sales log record
 * @param {Object} cdkRecord - CDK record
 * @param {Object} config - Configuration object
 * 
 * @returns {Object} Match result with isMatch boolean and confidence score
 */
function performExactMatch(salesRecord, cdkRecord, config) {
  try {
    const salesStock = normalizeStockNumber(salesRecord.stockNumber);
    const cdkStock = normalizeStockNumber(cdkRecord.stockNo);

    // Check stock type match if validation is enabled
    if (config.validateStockType) {
      const salesType = normalizeStockType(salesRecord.stockType);
      const cdkType = normalizeStockType(cdkRecord.stockType);
      if (salesType !== cdkType) {
        return { isMatch: false, confidence: 0, normalizedStock: null };
      }
    }

    // Perform exact comparison
    if (salesStock === cdkStock) {
      return {
        isMatch: true,
        confidence: 100,
        normalizedStock: salesStock
      };
    }

    return { isMatch: false, confidence: 0, normalizedStock: null };

  } catch (error) {
    logError('performExactMatch', error);
    return { isMatch: false, confidence: 0, normalizedStock: null };
  }
}

/**
 * Performs numeric match comparison by extracting and comparing numeric portions
 * 
 * @private
 * @param {Object} salesRecord - Sales log record
 * @param {Object} cdkRecord - CDK record
 * @param {Object} config - Configuration object
 * 
 * @returns {Object} Match result with isMatch boolean and confidence score
 */
function performNumericMatch(salesRecord, cdkRecord, config) {
  try {
    const salesNumeric = extractNumericPortion(salesRecord.stockNumber);
    const cdkNumeric = extractNumericPortion(cdkRecord.stockNo);

    // Check stock type match if validation is enabled
    if (config.validateStockType) {
      const salesType = normalizeStockType(salesRecord.stockType);
      const cdkType = normalizeStockType(cdkRecord.stockType);
      if (salesType !== cdkType) {
        return { isMatch: false, confidence: 0, normalizedStock: null };
      }
    }

    if (!salesNumeric || !cdkNumeric) {
      return { isMatch: false, confidence: 0, normalizedStock: null };
    }

    // Compare numeric portions
    if (salesNumeric === cdkNumeric) {
      return {
        isMatch: true,
        confidence: 95,
        normalizedStock: normalizeStockNumber(salesRecord.stockNumber)
      };
    }

    return { isMatch: false, confidence: 0, normalizedStock: null };

  } catch (error) {
    logError('performNumericMatch', error);
    return { isMatch: false, confidence: 0, normalizedStock: null };
  }
}

/**
 * Performs partial/fuzzy match using string similarity algorithms
 * 
 * @private
 * @param {Object} salesRecord - Sales log record
 * @param {Object} cdkRecord - CDK record
 * @param {Object} config - Configuration object
 * 
 * @returns {Object} Match result with isMatch boolean and confidence score
 */
function performPartialMatch(salesRecord, cdkRecord, config) {
  try {
    const salesStock = normalizeStockNumber(salesRecord.stockNumber);
    const cdkStock = normalizeStockNumber(cdkRecord.stockNo);

    // Check stock type match if validation is enabled
    if (config.validateStockType) {
      const salesType = normalizeStockType(salesRecord.stockType);
      const cdkType = normalizeStockType(cdkRecord.stockType);
      if (salesType !== cdkType) {
        return { isMatch: false, confidence: 0, normalizedStock: null };
      }
    }

    // Calculate similarity score using Levenshtein distance
    const similarity = calculateStringSimilarity(salesStock, cdkStock);
    const confidence = Math.round(similarity * 100);

    // Require at least 75% similarity for partial matches
    if (confidence >= 75) {
      return {
        isMatch: true,
        confidence: confidence,
        normalizedStock: salesStock
      };
    }

    return { isMatch: false, confidence: 0, normalizedStock: null };

  } catch (error) {
    logError('performPartialMatch', error);
    return { isMatch: false, confidence: 0, normalizedStock: null };
  }
}

/**
 * Normalizes a stock number for comparison
 * Handles: trim, uppercase, remove spaces/dashes, convert to string
 * 
 * @param {*} stockNum - Stock number to normalize
 * 
 * @returns {string} Normalized stock number
 */
function normalizeStockNumber(stockNum) {
  try {
    if (stockNum === null || stockNum === undefined) {
      return '';
    }

    return String(stockNum)
      .trim()
      .toUpperCase()
      .replace(/[\s\-\.]/g, '') // Remove spaces, dashes, and dots
      .replace(/[^A-Z0-9]/g, ''); // Remove special characters except alphanumeric

  } catch (error) {
    logError('normalizeStockNumber', error);
    return '';
  }
}

/**
 * Normalizes stock type for comparison
 * 
 * @private
 * @param {*} stockType - Stock type to normalize
 * 
 * @returns {string} Normalized stock type ('NEW' or 'USED')
 */
function normalizeStockType(stockType) {
  try {
    if (!stockType) return '';
    
    const normalized = String(stockType).trim().toUpperCase();
    
    // Map common variations
    if (normalized.includes('NEW')) return 'NEW';
    if (normalized.includes('USED')) return 'USED';
    
    return normalized;

  } catch (error) {
    logError('normalizeStockType', error);
    return '';
  }
}

/**
 * Extracts the numeric portion from a stock number
 * Handles prefixes (N/U/R) and suffixes
 * 
 * @param {*} stockNum - Stock number to extract from
 * 
 * @returns {string} Extracted numeric portion without leading zeros
 */
function extractNumericPortion(stockNum) {
  try {
    if (stockNum === null || stockNum === undefined) {
      return '';
    }

    const normalized = normalizeStockNumber(stockNum);
    
    // Remove common prefixes (N, U, R, etc.)
    let numeric = normalized.replace(/^[A-Z]+/, '');
    
    // Remove common suffixes (letters at the end)
    numeric = numeric.replace(/[A-Z]+$/, '');
    
    // Remove leading zeros but keep at least one digit
    numeric = numeric.replace(/^0+/, '') || '0';
    
    return numeric;

  } catch (error) {
    logError('extractNumericPortion', error);
    return '';
  }
}

/**
 * Calculates match confidence based on match type and similarity
 * 
 * @param {string} salesLogStock - Normalized sales log stock number
 * @param {string} cdkStock - Normalized CDK stock number
 * @param {string} matchType - Type of match ('exact', 'numeric', or 'partial')
 * 
 * @returns {number} Confidence score from 0-100
 */
function calculateMatchConfidence(salesLogStock, cdkStock, matchType) {
  try {
    if (!salesLogStock || !cdkStock) {
      return 0;
    }

    switch (matchType) {
      case 'exact':
        return salesLogStock === cdkStock ? 100 : 0;

      case 'numeric':
        const salesNumeric = extractNumericPortion(salesLogStock);
        const cdkNumeric = extractNumericPortion(cdkStock);
        return salesNumeric === cdkNumeric ? 95 : 0;

      case 'partial':
        return Math.round(calculateStringSimilarity(salesLogStock, cdkStock) * 100);

      default:
        return 0;
    }

  } catch (error) {
    logError('calculateMatchConfidence', error);
    return 0;
  }
}

/**
 * Calculates string similarity using Levenshtein distance algorithm
 * Returns a value between 0 and 1, where 1 is identical
 * 
 * @private
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * 
 * @returns {number} Similarity score between 0 and 1
 */
function calculateStringSimilarity(str1, str2) {
  try {
    if (!str1 || !str2) return 0;

    const len1 = str1.length;
    const len2 = str2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 1;

    const distance = levenshteinDistance(str1, str2);
    return 1 - (distance / maxLen);

  } catch (error) {
    logError('calculateStringSimilarity', error);
    return 0;
  }
}

/**
 * Calculates Levenshtein distance between two strings
 * 
 * @private
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * 
 * @returns {number} Levenshtein distance
 */
function levenshteinDistance(str1, str2) {
  try {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];

    // Initialize first column and row
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[len1][len2];

  } catch (error) {
    logError('levenshteinDistance', error);
    return 0;
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