'use strict';

/**
 * Data Merger Module
 * Combines matched records and merges CDK financial data into sales log records
 * Part of the Excel data merging application built as a Google Apps Script extension
 */

/**
 * String utility functions provided by utilities_string.js:
 * - normalizeStockNumber() - Stock number normalization
 * - stringSimilarity() - String similarity with threshold support
 * - levenshteinDistance() - Edit distance calculation (internal use)
 */

/**
 * Merges matched records from stock_matcher output
 * Combines sales log and CDK data for each matched pair
 * 
 * @param {Object} matchResults - Output from stock_matcher.js containing matches array
 * @param {Array} matchResults.matches - Array of matched record pairs
 * @param {Array} matchResults.unmatchedSalesLog - Unmatched sales log records
 * @param {Array} matchResults.unmatchedCDK - Unmatched CDK records
 * @param {Object} matchResults.stats - Match statistics
 * @returns {Array} Array of merged record objects with both sales log and CDK data
 */
function mergeMatchedRecords(matchResults) {
  try {
    if (!matchResults || !Array.isArray(matchResults.matches)) {
      ErrorLogger.logError('Invalid matchResults format', 'mergeMatchedRecords', matchResults);
      return [];
    }

    const mergedRecords = [];
    const errors = [];

    matchResults.matches.forEach((match, index) => {
      try {
        if (!match.salesLogRecord || !match.cdkRecord) {
          errors.push(`Match ${index}: Missing salesLogRecord or cdkRecord`);
          return;
        }

        const enrichedRecord = enrichSalesLogRecord(match.salesLogRecord, match.cdkRecord);
        
        // Add merge metadata
        enrichedRecord.matchType = match.matchType || 'unknown';
        enrichedRecord.matchConfidence = match.confidence || 0;
        enrichedRecord.mergedDate = new Date();
        enrichedRecord.dataSource = 'CDK';
        enrichedRecord.stockNumber = match.stockNumber || match.salesLogRecord.stockNumber;

        mergedRecords.push(enrichedRecord);
      } catch (error) {
        errors.push(`Match ${index}: ${error.message}`);
        ErrorLogger.logError(`Error merging match ${index}`, 'mergeMatchedRecords', error);
      }
    });

    if (errors.length > 0) {
      ErrorLogger.logWarning(`${errors.length} records had merge issues`, 'mergeMatchedRecords', errors);
    }

    return mergedRecords;
  } catch (error) {
    ErrorLogger.logError('Fatal error in mergeMatchedRecords', 'mergeMatchedRecords', error);
    return [];
  }
}

/**
 * Enriches a single sales log record with CDK financial data
 * Validates data consistency and flags mismatches
 * 
 * @param {Object} salesLogRecord - Original sales log record
 * @param {Object} cdkRecord - Matching CDK record
 * @returns {Object} Enriched record with both sales log and CDK data
 */
function enrichSalesLogRecord(salesLogRecord, cdkRecord) {
  try {
    if (!salesLogRecord || !cdkRecord) {
      throw new Error('salesLogRecord and cdkRecord are required');
    }

    // Start with all original sales log fields
    const enrichedRecord = { ...salesLogRecord };
    
    // Track validation issues
    const validationIssues = [];

    // Validate stock number match
    const normalizedSalesStock = normalizeStockNumber(salesLogRecord.stockNumber);
    const normalizedCdkStock = normalizeStockNumber(cdkRecord.stockNumber);
    
    if (normalizedSalesStock !== normalizedCdkStock) {
      validationIssues.push('Stock numbers do not match after normalization');
    }

    // Validate stock type match
    if (salesLogRecord.stockType && cdkRecord.stockType) {
      if (salesLogRecord.stockType.toLowerCase() !== cdkRecord.stockType.toLowerCase()) {
        validationIssues.push('Stock types do not match');
      }
    }

    // Validate salesperson name similarity
    if (salesLogRecord.salesperson && cdkRecord.salesperson) {
      if (!stringSimilarity(salesLogRecord.salesperson, cdkRecord.salesperson, {threshold: 0.7, returnBoolean: true})) {
        validationIssues.push('Salesperson names differ significantly');
      }
    }

    // Validate customer name similarity
    if (salesLogRecord.customerLastName && cdkRecord.customerLastName) {
      if (!stringSimilarity(salesLogRecord.customerLastName, cdkRecord.customerLastName, {threshold: 0.7, returnBoolean: true})) {
        validationIssues.push('Customer names differ significantly');
      }
    }

    // Add CDK financial fields
    enrichedRecord.contractDate = cdkRecord.contractDate || null;
    enrichedRecord.vin = cdkRecord.vin || null;
    enrichedRecord.year = cdkRecord.year || null;
    enrichedRecord.frontGP = parseFloat(cdkRecord.frontGP) || 0;
    enrichedRecord.backGP = parseFloat(cdkRecord.backGP) || 0;
    enrichedRecord.totalGP = parseFloat(cdkRecord.totalGP) || 0;
    enrichedRecord.cashPrice = parseFloat(cdkRecord.cashPrice) || 0;
    enrichedRecord.trades = parseFloat(cdkRecord.trades) || 0;
    enrichedRecord.serviceContract = parseFloat(cdkRecord.serviceContract) || 0;
    enrichedRecord.financeInstitution = cdkRecord.financeInstitution || null;
    enrichedRecord.fiManager = cdkRecord.fiManager || null;
    enrichedRecord.term = parseInt(cdkRecord.term) || null;
    enrichedRecord.dealNo = cdkRecord.dealNo || null;

    // Validate GP values
    if (enrichedRecord.totalGP < 0) {
      validationIssues.push('Total GP is negative');
    }
    if (enrichedRecord.totalGP > 50000) {
      validationIssues.push('Total GP exceeds reasonable threshold ($50,000)');
    }
    if (enrichedRecord.frontGP < 0 || enrichedRecord.backGP < 0) {
      validationIssues.push('Front GP or Back GP is negative');
    }

    // Set review flags
    enrichedRecord.needsReview = validationIssues.length > 0;
    enrichedRecord.reviewReason = validationIssues.length > 0 ? validationIssues.join('; ') : null;

    return enrichedRecord;
  } catch (error) {
    ErrorLogger.logError('Error enriching sales log record', 'enrichSalesLogRecord', error);
    throw error;
  }
}

/**
 * Creates a formatted report of unmatched records
 * Groups by reason and includes summary statistics
 * 
 * @param {Array} unmatchedRecords - Array of unmatched records
 * @param {string} source - Source of unmatched records ('salesLog' or 'CDK')
 * @returns {Object} Structured report object with grouping and statistics
 */
function createUnmatchedReport(unmatchedRecords, source) {
  try {
    if (!Array.isArray(unmatchedRecords)) {
      return {
        source: source,
        totalUnmatched: 0,
        byReason: {},
        records: [],
        summary: 'No unmatched records'
      };
    }

    const report = {
      source: source,
      totalUnmatched: unmatchedRecords.length,
      byReason: {},
      records: unmatchedRecords,
      summary: ''
    };

    // Group by reason
    unmatchedRecords.forEach(record => {
      const reason = record.unmatchReason || 'No match found';
      if (!report.byReason[reason]) {
        report.byReason[reason] = 0;
      }
      report.byReason[reason]++;
    });

    // Create summary
    const reasonSummary = Object.entries(report.byReason)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join('; ');
    
    report.summary = `${unmatchedRecords.length} unmatched records from ${source}. ${reasonSummary}`;

    return report;
  } catch (error) {
    ErrorLogger.logError('Error creating unmatched report', 'createUnmatchedReport', error);
    return {
      source: source,
      totalUnmatched: 0,
      byReason: {},
      records: [],
      summary: 'Error generating report',
      error: error.message
    };
  }
}

/**
 * Validates merged data quality
 * Performs comprehensive checks on merged records
 * 
 * @param {Array} mergedRecords - Array of merged record objects
 * @returns {Object} Validation report with issues and statistics
 */
function validateMergedData(mergedRecords) {
  try {
    if (!Array.isArray(mergedRecords)) {
      return {
        isValid: false,
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
        issues: ['Invalid input: mergedRecords is not an array'],
        flaggedForReview: 0,
        reviewReasons: {}
      };
    }

    const report = {
      isValid: true,
      totalRecords: mergedRecords.length,
      validRecords: 0,
      invalidRecords: 0,
      issues: [],
      flaggedForReview: 0,
      reviewReasons: {}
    };

    mergedRecords.forEach((record, index) => {
      const recordIssues = [];

      // Check required fields
      const requiredFields = ['stockNumber', 'customerLastName', 'model', 'stockType'];
      requiredFields.forEach(field => {
        if (!record[field]) {
          recordIssues.push(`Missing required field: ${field}`);
        }
      });

      // Check for reasonable value ranges
      if (record.totalGP !== null && record.totalGP !== undefined) {
        if (record.totalGP < 0) {
          recordIssues.push('Total GP is negative');
        }
        if (record.totalGP > 50000) {
          recordIssues.push('Total GP exceeds reasonable threshold');
        }
      }

      if (record.frontGP !== null && record.frontGP !== undefined && record.frontGP < 0) {
        recordIssues.push('Front GP is negative');
      }

      if (record.backGP !== null && record.backGP !== undefined && record.backGP < 0) {
        recordIssues.push('Back GP is negative');
      }

      // Check match confidence
      if (record.matchConfidence !== null && record.matchConfidence !== undefined) {
        if (record.matchConfidence < 85) {
          recordIssues.push(`Low match confidence: ${record.matchConfidence}%`);
        }
      }

      // Check for data consistency flags
      if (record.needsReview) {
        report.flaggedForReview++;
        const reason = record.reviewReason || 'Unknown reason';
        if (!report.reviewReasons[reason]) {
          report.reviewReasons[reason] = 0;
        }
        report.reviewReasons[reason]++;
      }

      if (recordIssues.length > 0) {
        report.invalidRecords++;
        report.isValid = false;
        report.issues.push({
          recordIndex: index,
          stockNumber: record.stockNumber,
          issues: recordIssues
        });
      } else {
        report.validRecords++;
      }
    });

    return report;
  } catch (error) {
    ErrorLogger.logError('Error validating merged data', 'validateMergedData', error);
    return {
      isValid: false,
      totalRecords: mergedRecords.length,
      validRecords: 0,
      invalidRecords: mergedRecords.length,
      issues: [`Validation error: ${error.message}`],
      flaggedForReview: 0,
      reviewReasons: {},
      error: error.message
    };
  }
}

/**
 * Calculates comprehensive summary statistics for merged records
 * Includes totals, match rates, GP breakdowns, and vehicle type analysis
 * 
 * @param {Array} mergedRecords - Array of merged record objects
 * @param {Object} matchResults - Original match results from stock_matcher
 * @returns {Object} Comprehensive summary statistics object
 */
function calculateSummaryStatistics(mergedRecords, matchResults) {
  try {
    if (!Array.isArray(mergedRecords)) {
      mergedRecords = [];
    }
    if (!matchResults) {
      matchResults = { unmatchedSalesLog: [], unmatchedCDK: [], stats: {} };
    }

    const unmatchedSalesLogCount = (matchResults.unmatchedSalesLog || []).length;
    const unmatchedCdkCount = (matchResults.unmatchedCDK || []).length;
    const totalRecords = mergedRecords.length + unmatchedSalesLogCount;

    const stats = {
      totalRecords: totalRecords,
      mergedRecords: mergedRecords.length,
      unmatchedSalesLog: unmatchedSalesLogCount,
      unmatchedCDK: unmatchedCdkCount,
      matchRate: totalRecords > 0 ? Math.round((mergedRecords.length / totalRecords) * 100) : 0,
      
      byStockType: {
        new: {
          count: 0,
          totalGP: 0,
          avgGP: 0
        },
        used: {
          count: 0,
          totalGP: 0,
          avgGP: 0
        }
      },
      
      byMatchType: {
        exact: 0,
        numeric: 0,
        partial: 0,
        unknown: 0
      },
      
      needsReview: 0,
      reviewReasons: {},
      
      financialSummary: {
        totalFrontGP: 0,
        totalBackGP: 0,
        totalGP: 0,
        avgFrontGP: 0,
        avgBackGP: 0,
        avgTotalGP: 0
      }
    };

    // Process merged records
    mergedRecords.forEach(record => {
      // Count by stock type
      const stockType = (record.stockType || 'unknown').toLowerCase();
      if (stockType === 'new') {
        stats.byStockType.new.count++;
        stats.byStockType.new.totalGP += record.totalGP || 0;
      } else if (stockType === 'used') {
        stats.byStockType.used.count++;
        stats.byStockType.used.totalGP += record.totalGP || 0;
      }

      // Count by match type
      const matchType = (record.matchType || 'unknown').toLowerCase();
      if (stats.byMatchType.hasOwnProperty(matchType)) {
        stats.byMatchType[matchType]++;
      } else {
        stats.byMatchType.unknown++;
      }

      // Count records needing review
      if (record.needsReview) {
        stats.needsReview++;
        const reason = record.reviewReason || 'Unknown reason';
        if (!stats.reviewReasons[reason]) {
          stats.reviewReasons[reason] = 0;
        }
        stats.reviewReasons[reason]++;
      }

      // Financial summary
      stats.financialSummary.totalFrontGP += record.frontGP || 0;
      stats.financialSummary.totalBackGP += record.backGP || 0;
      stats.financialSummary.totalGP += record.totalGP || 0;
    });

    // Calculate averages
    if (stats.byStockType.new.count > 0) {
      stats.byStockType.new.avgGP = Math.round(stats.byStockType.new.totalGP / stats.byStockType.new.count);
    }
    if (stats.byStockType.used.count > 0) {
      stats.byStockType.used.avgGP = Math.round(stats.byStockType.used.totalGP / stats.byStockType.used.count);
    }

    if (mergedRecords.length > 0) {
      stats.financialSummary.avgFrontGP = Math.round(stats.financialSummary.totalFrontGP / mergedRecords.length);
      stats.financialSummary.avgBackGP = Math.round(stats.financialSummary.totalBackGP / mergedRecords.length);
      stats.financialSummary.avgTotalGP = Math.round(stats.financialSummary.totalGP / mergedRecords.length);
    }

    return stats;
  } catch (error) {
    ErrorLogger.logError('Error calculating summary statistics', 'calculateSummaryStatistics', error);
    return {
      totalRecords: 0,
      mergedRecords: 0,
      unmatchedSalesLog: 0,
      unmatchedCDK: 0,
      matchRate: 0,
      byStockType: { new: { count: 0, totalGP: 0, avgGP: 0 }, used: { count: 0, totalGP: 0, avgGP: 0 } },
      byMatchType: { exact: 0, numeric: 0, partial: 0, unknown: 0 },
      needsReview: 0,
      reviewReasons: {},
      financialSummary: { totalFrontGP: 0, totalBackGP: 0, totalGP: 0, avgFrontGP: 0, avgBackGP: 0, avgTotalGP: 0 },
      error: error.message
    };
  }
}
