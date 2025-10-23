'use strict';

/**
 * String Utilities Module
 * Shared string manipulation functions for the Sales Log / CDK Data Merge Tool
 * Provides normalized string operations for stock number matching and data comparison
 * 
 * @module utilities_string
 * @version 1.0.0
 * @requires error_logger
 */

// ==================== STOCK NUMBER UTILITIES ====================

/**
 * Normalizes a stock number for comparison
 * Comprehensive normalization that handles various formats and edge cases
 * 
 * This function:
 * - Converts to uppercase
 * - Removes spaces, dashes, dots, and special characters
 * - Preserves only alphanumeric characters
 * - Handles null/undefined values safely
 * 
 * @param {*} stockNum - Stock number to normalize (string, number, or null/undefined)
 * @returns {string} Normalized stock number (empty string if invalid input)
 * 
 * @example
 * normalizeStockNumber('N-12345')  // Returns: 'N12345'
 * normalizeStockNumber('  u 0042 ')  // Returns: 'U0042'
 * normalizeStockNumber('123-45.6')  // Returns: '123456'
 * normalizeStockNumber(null)  // Returns: ''
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
    if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
      ErrorLogger.logError('normalizeStockNumber', 'utilities_string', error);
    }
    return '';
  }
}

/**
 * Normalizes stock type for comparison
 * Maps common variations to standard values: 'NEW' or 'USED'
 * 
 * This function handles various stock type representations:
 * - 'New', 'new', 'NEW', 'N'
 * - 'Used', 'used', 'USED', 'U'
 * - 'Pre-Owned', 'Certified Pre-Owned'
 * 
 * @param {*} stockType - Stock type to normalize (any type accepted)
 * @returns {string} Normalized stock type ('NEW', 'USED', or empty string)
 * 
 * @example
 * normalizeStockType('new')  // Returns: 'NEW'
 * normalizeStockType('Used')  // Returns: 'USED'
 * normalizeStockType('N')  // Returns: 'NEW'
 * normalizeStockType('Pre-Owned')  // Returns: 'USED'
 * normalizeStockType(null)  // Returns: ''
 */
function normalizeStockType(stockType) {
  try {
    if (!stockType) return '';
    
    const normalized = String(stockType).trim().toUpperCase();
    
    // Map common variations
    if (normalized.includes('NEW')) return 'NEW';
    if (normalized.includes('USED')) return 'USED';
    if (normalized === 'N') return 'NEW';
    if (normalized === 'U') return 'USED';
    if (normalized.includes('PRE') || normalized.includes('OWNED')) return 'USED';
    
    return normalized;

  } catch (error) {
    if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
      ErrorLogger.logError('normalizeStockType', 'utilities_string', error);
    }
    return '';
  }
}

/**
 * Extracts the numeric portion from a stock number
 * Handles prefixes (N/U/R) and suffixes, removes leading zeros
 * 
 * Common stock number patterns:
 * - 'N12345' -> '12345'
 * - 'U00042' -> '42'
 * - '12345A' -> '12345'
 * - 'R0001Z' -> '1'
 * 
 * @param {*} stockNum - Stock number to extract from
 * @returns {string} Extracted numeric portion (without leading zeros, or '0' if none found)
 * 
 * @example
 * extractNumericPortion('N12345')  // Returns: '12345'
 * extractNumericPortion('U00042')  // Returns: '42'
 * extractNumericPortion('12345A')  // Returns: '12345'
 * extractNumericPortion('ABC')  // Returns: '0'
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
    if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
      ErrorLogger.logError('extractNumericPortion', 'utilities_string', error);
    }
    return '';
  }
}

// ==================== STRING SIMILARITY UTILITIES ====================

/**
 * Calculates Levenshtein distance between two strings
 * Uses dynamic programming to compute the minimum edit distance
 * 
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one string into another.
 * 
 * Time complexity: O(m * n) where m and n are string lengths
 * Space complexity: O(m * n)
 * 
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Levenshtein distance (0 means identical strings)
 * 
 * @example
 * levenshteinDistance('kitten', 'sitting')  // Returns: 3
 * levenshteinDistance('hello', 'hello')  // Returns: 0
 * levenshteinDistance('', 'abc')  // Returns: 3
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
    if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
      ErrorLogger.logError('levenshteinDistance', 'utilities_string', error);
    }
    return 0;
  }
}

/**
 * Calculates string similarity as a numeric score between 0 and 1
 * Uses Levenshtein distance normalized by maximum string length
 * 
 * Score interpretation:
 * - 1.0 = identical strings
 * - 0.9-0.99 = very similar (1-10% difference)
 * - 0.7-0.89 = similar (11-30% difference)
 * - 0.5-0.69 = somewhat similar (31-50% difference)
 * - 0.0-0.49 = dissimilar (>50% difference)
 * 
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score from 0 (completely different) to 1 (identical)
 * 
 * @example
 * calculateStringSimilarity('hello', 'hello')  // Returns: 1.0
 * calculateStringSimilarity('hello', 'hallo')  // Returns: 0.8
 * calculateStringSimilarity('abc', 'xyz')  // Returns: 0.0
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
    if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
      ErrorLogger.logError('calculateStringSimilarity', 'utilities_string', error);
    }
    return 0;
  }
}

/**
 * Checks if two strings are similar based on a configurable threshold
 * Unified function that combines boolean and numeric similarity checking
 * 
 * This function performs multiple checks in order of efficiency:
 * 1. Null/empty handling (allows null values)
 * 2. Exact match (case-insensitive after trim)
 * 3. Substring containment check
 * 4. Levenshtein distance similarity
 * 
 * @param {string} str1 - First string to compare
 * @param {string} str2 - Second string to compare
 * @param {Object} [options] - Comparison options
 * @param {number} [options.threshold=0.7] - Similarity threshold (0-1), default 0.7 (70%)
 * @param {boolean} [options.returnScore=false] - If true, returns numeric score; if false, returns boolean
 * @param {boolean} [options.caseSensitive=false] - Whether to perform case-sensitive comparison
 * @returns {boolean|number} Boolean (is similar?) or numeric similarity score based on returnScore option
 * 
 * @example
 * // Boolean mode (default)
 * stringSimilarity('John Smith', 'JOHN SMITH')  // Returns: true
 * stringSimilarity('ABC Corp', 'XYZ Corp')  // Returns: false
 * 
 * // Numeric mode
 * stringSimilarity('hello', 'hallo', {returnScore: true})  // Returns: 0.8
 * 
 * // Custom threshold
 * stringSimilarity('test', 'tost', {threshold: 0.9})  // Returns: false
 * 
 * // Case sensitive
 * stringSimilarity('Test', 'test', {caseSensitive: true})  // Returns: false
 */
function stringSimilarity(str1, str2, options) {
  try {
    // Default options
    const opts = options || {};
    const threshold = opts.threshold !== undefined ? opts.threshold : 0.7;
    const returnScore = opts.returnScore || false;
    const caseSensitive = opts.caseSensitive || false;
    
    // Allow null/empty values - consider them similar
    if (!str1 || !str2) {
      return returnScore ? 1 : true;
    }
    
    // Normalize strings for comparison
    let s1 = String(str1).trim();
    let s2 = String(str2).trim();
    
    if (!caseSensitive) {
      s1 = s1.toLowerCase();
      s2 = s2.toLowerCase();
    }
    
    // Quick exact match check
    if (s1 === s2) {
      return returnScore ? 1 : true;
    }
    
    // Check if one contains the other
    if (s1.includes(s2) || s2.includes(s1)) {
      return returnScore ? 0.85 : true; // High similarity for containment
    }
    
    // Calculate Levenshtein-based similarity
    const similarity = calculateStringSimilarity(s1, s2);
    
    if (returnScore) {
      return similarity;
    } else {
      return similarity >= threshold;
    }
    
  } catch (error) {
    if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
      ErrorLogger.logError('stringSimilarity', 'utilities_string', error);
    }
    // On error, return safe defaults
    return options && options.returnScore ? 0 : false;
  }
}

// ==================== MODULE EXPORTS ====================
// All functions are available in global scope for Google Apps Script
// No explicit exports needed, but listed here for documentation

/**
 * @exports utilities_string
 * @description Available functions:
 * - normalizeStockNumber(stockNum)
 * - normalizeStockType(stockType)
 * - extractNumericPortion(stockNum)
 * - levenshteinDistance(str1, str2)
 * - calculateStringSimilarity(str1, str2)
 * - stringSimilarity(str1, str2, options)
 */