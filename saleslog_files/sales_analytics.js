/**
 * sales_analytics.js
 * Sales Analytics Module for Sales Log Pro
 *
 * Provides comprehensive sales metrics including total sales,
 * new/used breakdowns, and per-salesperson analytics.
 *
 * Integration: Automatically calculates analytics during processDaily()
 * and preserves data during rolloverMonth() operations.
 */

// ============================================================================
// MODULE CONSTANTS
// ============================================================================

const ANALYTICS_START_COL = 19; // Column S (1-indexed)
const ANALYTICS_COL_COUNT = 6;  // Columns S through X
const CACHE_KEY_ANALYTICS = "monthlyAnalytics";
const CACHE_TTL_ANALYTICS = 300; // 5 minutes (consistent with existing patterns)

// ============================================================================
// PUBLIC API FUNCTIONS
// ============================================================================

/**
 * Calculates comprehensive sales analytics for the current month.
 * Reads all data from MONTHLY sheet, processes by salesperson and inventory type,
 * and returns analytics summary object.
 *
 * Uses existing utilities: getSalespersonMaps(), tallyCounts(), findLastRowInCols()
 *
 * @returns {Object|null} Analytics summary object containing:
 *   - totals: {Object} Month-level totals (delivered, newDelivered, usedDelivered)
 *   - teamMetrics: {Object} Team-level metrics (sellingDays, newPerDay, usedPerDay)
 *   - salespersonMetrics: {Array<Object>} Individual salesperson metrics
 *   - timestamp: {string} ISO timestamp of calculation
 *   - dataQuality: {Object} Data quality metrics and unknown salespeople
 *
 * @throws {Error} If MONTHLY sheet is missing or has insufficient columns
 */
function calculateMonthlyAnalytics() {
  try {
    // Check cache first
    const cached = CACHE.get(CACHE_KEY_ANALYTICS);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        logWarning('calculateMonthlyAnalytics', 'Analytics cache parse error', { error: e.toString() });
      }
    }

    // Standard sheet validation pattern - ensures all required sheets exist
    const sheets = getSheets();
    const monthlySheet = sheets.monthly;

    // Validate sheet has sufficient columns
    const maxCols = monthlySheet.getMaxColumns();
    if (maxCols < 26) {
      const msg = 'MONTHLY sheet needs at least 26 columns (A-Z) for analytics. Current: ' + maxCols;
      logError('calculateMonthlyAnalytics', msg, { maxCols, required: 26 });
      return null;
    }

    // Find last row with data in columns A-N
    const lastRow = findLastRowInCols(monthlySheet, 1, 14);
    if (lastRow < 2) {
      Logger.log('Analytics: MONTHLY sheet is empty, returning zero counts');
      return createEmptyAnalytics();
    }

    // Get salesperson maps (cached by getSalespersonMaps)
    const { aliasMap, displayCodeMap } = getSalespersonMaps();

    // Batch read all MONTHLY data at once (columns A-N)
    const monthlyData = monthlySheet.getRange(2, 1, lastRow - 1, 14).getValues();

    // Process data to extract metrics
    const processedData = processMonthlyDataForAnalytics(monthlyData, aliasMap);

    // Format for display
    const analyticsData = formatAnalyticsForDisplay(processedData, displayCodeMap);

    // Validate before returning
    const validationErrors = validateAnalyticsData(analyticsData);
    if (validationErrors.length > 0) {
      logWarning('calculateMonthlyAnalytics', 'Analytics validation warnings', { errors: validationErrors });
    }

    // Cache the result
    CACHE.put(CACHE_KEY_ANALYTICS, JSON.stringify(analyticsData), CACHE_TTL_ANALYTICS);

    return analyticsData;

  } catch (e) {
    logError('calculateMonthlyAnalytics', e);
    return null;
  }
}

/**
 * Writes analytics data to MONTHLY sheet in designated columns (S-X).
 * Creates formatted summary section at top of sheet with headers, totals, and team metrics.
 * Writes per-salesperson breakdown below summary section.
 *
 * Summary Section (Rows 1-8):
 *   Columns S-T: Total Delivered, New Delivered, Used Delivered, Last Updated
 *   Columns U-V: Team metrics (Selling Days, New Sold per Day, Used Sold per Day)
 *
 * Salesperson Section (Row 9+):
 *   S: Salesperson Display Code
 *   T: New Sales Count
 *   U: Used Sales Count
 *   V: Total Sales Count
 *   W: Percentage of Team Total
 *   X: Rank
 *
 * @param {Object} analyticsData - Output from calculateMonthlyAnalytics()
 * @param {GoogleAppsScript.Spreadsheet.Sheet} monthlySheet - MONTHLY sheet reference
 * @returns {void}
 *
 * @throws {Error} If sheet has insufficient columns or data is malformed
 */
function writeAnalyticsToMonthly(analyticsData, monthlySheet) {
  if (!analyticsData || !monthlySheet) {
    Logger.log('writeAnalyticsToMonthly: Invalid parameters');
    return;
  }

  try {
    // Clear existing analytics columns (S:X)
    const maxRows = monthlySheet.getMaxRows();
    monthlySheet.getRange(1, ANALYTICS_START_COL, maxRows, ANALYTICS_COL_COUNT).clear();

    // Build summary section (rows 1-8)
    const summaryData = buildSummarySection(analyticsData);

    // Write summary section
    monthlySheet.getRange(1, ANALYTICS_START_COL, summaryData.length, ANALYTICS_COL_COUNT)
      .setValues(summaryData);

    // Apply summary formatting
    formatSummarySection(monthlySheet);

    // Build salesperson data array
    const salespersonData = buildSalespersonSection(analyticsData);

    // Write salesperson data starting at row 9
    if (salespersonData.length > 0) {
      monthlySheet.getRange(9, ANALYTICS_START_COL, salespersonData.length, ANALYTICS_COL_COUNT)
        .setValues(salespersonData);

      // Apply salesperson data formatting
      formatSalespersonSection(monthlySheet, salespersonData.length);
    }

    SpreadsheetApp.flush();
    Logger.log('Analytics written to MONTHLY sheet columns S-X');

  } catch (e) {
    logError('writeAnalyticsToMonthly', e);
    throw e;
  }
}

/**
 * Reads existing analytics data from MONTHLY sheet columns S-Z.
 * Returns parsed analytics object without performing new calculations.
 * Useful for displaying current state or exporting data.
 *
 * @returns {Object|null} Analytics object or null if no analytics exist
 */
function getMonthlyAnalyticsSummary() {
  try {
    // Check cache first
    const cached = CACHE.get(CACHE_KEY_ANALYTICS);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        logWarning('getMonthlyAnalyticsSummary', 'Cache parse error', { error: e.toString() });
      }
    }

    // If no cache, read from sheet
    const sheets = getSheets();
    const monthlySheet = sheets.monthly;

    // Read summary values from rows 3-5, column T (index 1 in our range)
    const summaryRange = monthlySheet.getRange(3, ANALYTICS_START_COL + 1, 3, 1);
    const summaryValues = summaryRange.getValues();

    // Check if analytics exist
    if (!summaryValues[0][0] && !summaryValues[1][0] && !summaryValues[2][0]) {
      return null; // No analytics data
    }

    // Read timestamp from row 6
    const timestampValue = monthlySheet.getRange(6, ANALYTICS_START_COL + 1, 1, 1).getValue();

    // Build summary object from sheet data
    return {
      version: "1.0",
      timestamp: timestampValue || new Date().toISOString(),
      totals: {
        delivered: summaryValues[0][0] || 0,
        newDelivered: summaryValues[1][0] || 0,
        usedDelivered: summaryValues[2][0] || 0
      },
      dataQuality: {
        unknownSalespeople: [],
        errorCount: 0
      }
    };

  } catch (e) {
    logError('getMonthlyAnalyticsSummary', e);
    return null;
  }
}

/**
 * Invalidates analytics cache
 * Should be called after processDaily, recalcMtdFromMonthly, or manual data edits
 * @returns {void}
 */
function invalidateAnalyticsCache() {
  try {
    CACHE.remove(CACHE_KEY_ANALYTICS);
  } catch (error) {
    logError('invalidateAnalyticsCache', error, {
      severity: 'MEDIUM',
      operation: 'cache_invalidation',
      cacheKey: CACHE_KEY_ANALYTICS,
      impact: 'Stale analytics data may be served until cache expires naturally (5 minutes)'
    });
    // Continue execution - cache invalidation failure is non-fatal
  }
}
/**
 * Internal helper that performs analytics refresh without user prompts.
 * Used by both recalcMtdFromMonthly() and refreshAnalyticsManually().
 * 
 * @param {Object} sheets - Sheet references from getSheets()
 * @returns {Object} Result object with structure:
 *   {
 *     success: boolean,
 *     data: Object|null,  // Analytics data if successful
 *     error: string|null   // Error message if failed
 *   }
 */
function refreshAnalyticsInternal(sheets) {
  try {
    // Invalidate cache
    invalidateAnalyticsCache();
    
    // Calculate analytics
    const analytics = calculateMonthlyAnalytics();
    
    if (!analytics) {
      return {
        success: false,
        data: null,
        error: "Analytics calculation returned no data"
      };
    }
    
    // Write to sheet
    writeAnalyticsToMonthly(analytics, sheets.monthly);
    
    return {
      success: true,
      data: analytics,
      error: null
    };
  } catch (e) {
    Logger.log("refreshAnalyticsInternal error: " + e);
    return {
      success: false,
      data: null,
      error: e.message || String(e)
    };
  }
}


// ============================================================================
// DATA PROCESSING FUNCTIONS
// ============================================================================

/**
 * Processes raw MONTHLY sheet data to extract analytics metrics.
 * Filters for delivered deals only (single-letter FI flags A-Z).
 * Separates new vs. used inventory based on column positions.
 * Handles split sales (e.g., "John/Jane") with 0.5 credit each.
 * Counts selling days where column A contains exactly 1.
 *
 * @param {Array<Array>} monthlyData - 2D array from MONTHLY sheet (columns A-N)
 * @param {Object} aliasMap - Salesperson alias mapping from getSalespersonMaps()
 *
 * @returns {Object} Processed analytics data:
 *   - totalNew: {number} Total new units delivered
 *   - totalUsed: {number} Total used units delivered
 *   - sellingDays: {number} Count of rows where column A = 1
 *   - salespersonAccumulator: {Object} Map of fullName -> {newCount, usedCount}
 *   - unknownSalespeople: {Array<string>} Unrecognized salesperson inputs
 */
function processMonthlyDataForAnalytics(monthlyData, aliasMap) {
  const metrics = {
    totalNew: 0,
    totalUsed: 0,
    sellingDays: 0,
    salespersonAccumulator: {},
    unknownSalespeople: [],
    totalRowsProcessed: monthlyData.length,
    deliveredRowsProcessed: 0
  };

  monthlyData.forEach((row, index) => {
    try {
      // Count selling days where column A = 1
      if (row[0] === 1) {
        metrics.sellingDays++;
      }

      // Process New Car Section (columns B-G, array indices 1-6)
      const newFI = String(row[2] || "").trim().toUpperCase(); // Col C (index 2)
      const newSalesperson = String(row[6] || "").trim(); // Col G (index 6)

      if (/^[A-Z]$/.test(newFI) && newSalesperson) {
        processNewSale(newSalesperson, metrics, aliasMap);
        metrics.deliveredRowsProcessed++;
      }

      // Process Used Car Section (columns I-N, array indices 8-13)
      const usedFI = String(row[9] || "").trim().toUpperCase(); // Col J (index 9)
      const usedSalesperson = String(row[13] || "").trim(); // Col N (index 13)

      if (/^[A-Z]$/.test(usedFI) && usedSalesperson) {
        processUsedSale(usedSalesperson, metrics, aliasMap);
        if (!/^[A-Z]$/.test(newFI)) {
          // Only increment if not already counted from new section
          metrics.deliveredRowsProcessed++;
        }
      }

    } catch (e) {
      logWarning('processMonthlyDataForAnalytics', 'Error processing row', { row: index + 2, error: e.toString() });
    }
  });

  return metrics;
}

/**
 * Processes a single new car sale
 * Handles split sales by dividing credit (0.5 each for "John/Jane")
 * Updates metrics.totalNew and metrics.salespersonAccumulator
 *
 * @param {string} salespersonInput - Raw salesperson input from sheet (may contain "/" for splits)
 * @param {Object} metrics - Metrics accumulator object to update
 * @param {Object} aliasMap - Alias to full name mapping
 * @returns {void}
 */
function processNewSale(salespersonInput, metrics, aliasMap) {
  const parts = salespersonInput.split("/").map(s => s.trim());
  const increment = parts.length > 1 ? 0.5 : 1;

  parts.forEach(part => {
    if (!part) return;

    const upperPart = part.toUpperCase();
    const fullName = aliasMap[upperPart];

    if (fullName) {
      if (!metrics.salespersonAccumulator[fullName]) {
        metrics.salespersonAccumulator[fullName] = {
          newCount: 0,
          usedCount: 0
        };
      }
      metrics.salespersonAccumulator[fullName].newCount += increment;
      metrics.totalNew += increment;
    } else {
      // Track unknown salesperson
      if (!metrics.unknownSalespeople.includes(part)) {
        metrics.unknownSalespeople.push(part);
      }
    }
  });
}

/**
 * Processes a single used car sale
 * Handles split sales by dividing credit (0.5 each for "John/Jane")
 * Updates metrics.totalUsed and metrics.salespersonAccumulator
 *
 * @param {string} salespersonInput - Raw salesperson input from sheet (may contain "/" for splits)
 * @param {Object} metrics - Metrics accumulator object to update
 * @param {Object} aliasMap - Alias to full name mapping
 * @returns {void}
 */
function processUsedSale(salespersonInput, metrics, aliasMap) {
  const parts = salespersonInput.split("/").map(s => s.trim());
  const increment = parts.length > 1 ? 0.5 : 1;

  parts.forEach(part => {
    if (!part) return;

    const upperPart = part.toUpperCase();
    const fullName = aliasMap[upperPart];

    if (fullName) {
      if (!metrics.salespersonAccumulator[fullName]) {
        metrics.salespersonAccumulator[fullName] = {
          newCount: 0,
          usedCount: 0
        };
      }
      metrics.salespersonAccumulator[fullName].usedCount += increment;
      metrics.totalUsed += increment;
    } else {
      // Track unknown salesperson
      if (!metrics.unknownSalespeople.includes(part)) {
        metrics.unknownSalespeople.push(part);
      }
    }
  });
}

// ============================================================================
// FORMATTING FUNCTIONS
// ============================================================================

/**
 * Converts processed analytics into formatted display-ready structure.
 * Sorts salespeople by total sales (descending).
 * Calculates team percentages and team-level metrics.
 * Maps full names to display codes for compact presentation.
 *
 * @param {Object} processedData - Output from processMonthlyDataForAnalytics()
 * @param {Object} displayCodeMap - Display code mapping from getSalespersonMaps()
 *
 * @returns {Object} Formatted analytics ready for writeAnalyticsToMonthly()
 */
function formatAnalyticsForDisplay(processedData, displayCodeMap) {
  const totalDelivered = processedData.totalNew + processedData.totalUsed;
  const sellingDays = processedData.sellingDays || 0;

  // Calculate team-level metrics
  const teamMetrics = {
    sellingDays: sellingDays,
    newPerDay: sellingDays > 0 ? Math.round((processedData.totalNew / sellingDays) * 100) / 100 : 0,
    usedPerDay: sellingDays > 0 ? Math.round((processedData.totalUsed / sellingDays) * 100) / 100 : 0
  };

  // Convert accumulator to array
  const salespersonMetrics = [];
  Object.entries(processedData.salespersonAccumulator).forEach(([fullName, counts]) => {
    const totalSales = counts.newCount + counts.usedCount;

    salespersonMetrics.push({
      fullName: fullName,
      displayCode: displayCodeMap[fullName] || fullName,
      newSales: counts.newCount,
      usedSales: counts.usedCount,
      totalSales: totalSales,
      percentOfTeam: totalDelivered > 0 ? (totalSales / totalDelivered * 100) : 0,
      rank: 0 // Will be set after sorting
    });
  });

  // Sort by total sales descending
  salespersonMetrics.sort((a, b) => b.totalSales - a.totalSales);

  // Assign ranks
  salespersonMetrics.forEach((person, index) => {
    person.rank = index + 1;
  });

  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    totals: {
      delivered: totalDelivered,
      newDelivered: processedData.totalNew,
      usedDelivered: processedData.totalUsed
    },
    teamMetrics: teamMetrics,
    salespersonMetrics: salespersonMetrics,
    dataQuality: {
      unknownSalespeople: processedData.unknownSalespeople || [],
      totalRowsProcessed: processedData.totalRowsProcessed || 0,
      deliveredRowsProcessed: processedData.deliveredRowsProcessed || 0,
      errorCount: (processedData.unknownSalespeople || []).length
    }
  };
}

/**
 * Builds summary section data array for MONTHLY sheet.
 * Creates rows 1-8 with headers, totals, and team metrics.
 *
 * @param {Object} analyticsData - Formatted analytics data
 * @returns {Array<Array>} 2D array for summary section
 */
function buildSummarySection(analyticsData) {
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${now.toLocaleTimeString()}`;

  const sellingDays = analyticsData.teamMetrics.sellingDays;
  const newPerDay = sellingDays > 0 ? analyticsData.teamMetrics.newPerDay : "N/A";
  const usedPerDay = sellingDays > 0 ? analyticsData.teamMetrics.usedPerDay : "N/A";

  return [
    ["MONTHLY ANALYTICS", "", "", "", "", ""],              // Row 1 (will merge S1:X1)
    ["Metric", "Value", "Metric", "Value", "", ""],         // Row 2
    ["Total Delivered", analyticsData.totals.delivered, "Selling Days", sellingDays, "", ""],  // Row 3
    ["New Delivered", analyticsData.totals.newDelivered, "New Sold per Day", newPerDay, "", ""],  // Row 4
    ["Used Delivered", analyticsData.totals.usedDelivered, "Used Sold per Day", usedPerDay, "", ""],  // Row 5
    ["Last Updated", dateStr, "", "", "", ""],              // Row 6
    ["", "", "", "", "", ""],                               // Row 7 (separator)
    ["Salesperson", "New", "Used", "Total", "% of Team", "Rank"]  // Row 8
  ];
}

/**
 * Builds salesperson data array for MONTHLY sheet.
 * Creates rows starting at row 9 with individual metrics.
 * Outputs 6 columns (S-X): Salesperson, New, Used, Total, % of Team, Rank
 *
 * @param {Object} analyticsData - Formatted analytics data
 * @returns {Array<Array>} 2D array for salesperson section
 */
function buildSalespersonSection(analyticsData) {
  return analyticsData.salespersonMetrics.map(person => [
    person.displayCode,                         // Column S
    person.newSales,                            // Column T
    person.usedSales,                           // Column U
    person.totalSales,                          // Column V
    Math.round(person.percentOfTeam * 10) / 10, // Column W - Round to 1 decimal
    person.rank                                 // Column X
  ]);
}

/**
 * Applies formatting to summary section (rows 1-7)
 * Sets fonts, colors, alignments, and merges header cells
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - MONTHLY sheet
 * @returns {void}
 */
function formatSummarySection(sheet) {
  try {
    // Merge and format header (row 1)
    sheet.getRange(1, ANALYTICS_START_COL, 1, ANALYTICS_COL_COUNT)
      .merge()
      .setHorizontalAlignment("center")
      .setFontWeight("bold")
      .setFontSize(12)
      .setBackground("#4A86E8")
      .setFontColor("#FFFFFF")
      .setFontFamily("Calibri");

    // Format column headers (row 2)
    sheet.getRange(2, ANALYTICS_START_COL, 1, ANALYTICS_COL_COUNT)
      .setFontWeight("bold")
      .setBackground("#E8F0FE")
      .setHorizontalAlignment("center")
      .setFontFamily("Calibri")
      .setFontSize(10);

    // Format data rows (3-6)
    sheet.getRange(3, ANALYTICS_START_COL, 4, ANALYTICS_COL_COUNT)
      .setFontFamily("Calibri")
      .setFontSize(10)
      .setHorizontalAlignment("center")
      .setFontWeight("bold");

    // Format salesperson header row (row 8)
    sheet.getRange(8, ANALYTICS_START_COL, 1, ANALYTICS_COL_COUNT)
      .setFontWeight("bold")
      .setBackground("#E8F0FE")
      .setHorizontalAlignment("center")
      .setFontFamily("Calibri")
      .setFontSize(10);

  } catch (e) {
    logWarning('formatSummarySection', 'Error formatting summary section', { error: e.toString() });
  }
}

/**
 * Applies formatting to salesperson data section
 * Sets fonts, number formats for counts and percentages
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - MONTHLY sheet
 * @param {number} rowCount - Number of salesperson rows to format
 * @returns {void}
 */
function formatSalespersonSection(sheet, rowCount) {
  try {
    if (rowCount === 0) return;

    const dataRange = sheet.getRange(9, ANALYTICS_START_COL, rowCount, ANALYTICS_COL_COUNT);

    dataRange
      .setFontFamily("Calibri")
      .setFontSize(10)
      .setHorizontalAlignment("center")
      .setFontWeight("bold");

    // Set number formats
    sheet.getRange(9, ANALYTICS_START_COL + 1, rowCount, 3) // Columns T-V (counts)
      .setNumberFormat("0.#");

    sheet.getRange(9, ANALYTICS_START_COL + 4, rowCount, 1) // Column W (percentage)
      .setNumberFormat("0.0\"%\"");

  } catch (e) {
    logWarning('formatSalespersonSection', 'Error formatting salesperson section', { error: e.toString() });
  }
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Performs validation checks on analytics data before writing to sheet.
 * Ensures all required fields are present and valid.
 * Checks for data integrity issues (negative counts, missing names, etc.).
 *
 * @param {Object} analyticsData - Analytics data to validate
 *
 * @returns {Array<string>} Array of validation error messages (empty if valid)
 */
function validateAnalyticsData(analyticsData) {
  const errors = [];

  if (!analyticsData) {
    errors.push("Analytics data is null or undefined");
    return errors;
  }

  // Validate totals
  if (!analyticsData.totals) {
    errors.push("Missing totals object");
  } else {
    if (typeof analyticsData.totals.delivered !== 'number') {
      errors.push("Invalid delivered count");
    }
    if (typeof analyticsData.totals.newDelivered !== 'number') {
      errors.push("Invalid newDelivered count");
    }
    if (typeof analyticsData.totals.usedDelivered !== 'number') {
      errors.push("Invalid usedDelivered count");
    }

    // Check for negative values
    if (analyticsData.totals.delivered < 0 ||
        analyticsData.totals.newDelivered < 0 ||
        analyticsData.totals.usedDelivered < 0) {
      errors.push("Negative count values detected");
    }

    // Check totals match
    const expectedTotal = analyticsData.totals.newDelivered + analyticsData.totals.usedDelivered;
    if (Math.abs(analyticsData.totals.delivered - expectedTotal) > 0.01) {
      errors.push("Total delivered doesn't match sum of new and used");
    }
  }

  // Validate salesperson metrics
  if (!Array.isArray(analyticsData.salespersonMetrics)) {
    errors.push("salespersonMetrics is not an array");
  } else {
    analyticsData.salespersonMetrics.forEach((person, index) => {
      if (!person.displayCode) {
        errors.push(`Salesperson at index ${index} missing displayCode`);
      }
      if (typeof person.totalSales !== 'number' || person.totalSales < 0) {
        errors.push(`Invalid totalSales for ${person.displayCode || index}`);
      }
    });
  }

  return errors;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates an empty analytics object for when MONTHLY sheet is empty.
 *
 * @returns {Object} Empty analytics object
 */
function createEmptyAnalytics() {
  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    totals: {
      delivered: 0,
      newDelivered: 0,
      usedDelivered: 0
    },
    salespersonMetrics: [],
    dataQuality: {
      unknownSalespeople: [],
      totalRowsProcessed: 0,
      deliveredRowsProcessed: 0,
      errorCount: 0
    }
  };
}

/**
 * Manually refresh analytics from the menu.
 * Shows confirmation dialog before execution and summary after completion.
 */
function refreshAnalyticsManually() {
  withScriptLock(() => {
    try {
      const ui = SpreadsheetApp.getUi();
      
      // Confirmation dialog
      const response = ui.alert(
        "Refresh Monthly Analytics",
        "This will recalculate all monthly analytics from MONTHLY sheet data.\n\nContinue?",
        ui.ButtonSet.YES_NO
      );
      
      if (response !== ui.Button.YES) {
        return;
      }
      
      // Get sheet references
      const sheets = getSheets();
      if (!sheets) {
        alertError("Required sheets not found.");
        return;
      }
      
      // Execute analytics refresh
      toastInfo("Refreshing analytics...", "Analytics", 3);
      const result = refreshAnalyticsInternal(sheets);
      
      if (!result.success) {
        alertError("Analytics refresh failed: " + (result.error || "Unknown error"));
        return;
      }
      
      // Show summary dialog
      const analytics = result.data;
      const topPerformer = analytics.salespersonMetrics[0] || { displayCode: "N/A", totalSales: 0 };
      
      ui.alert(
        "Analytics Updated",
        `Monthly analytics refreshed successfully!\n\n` +
        `Total Delivered: ${analytics.totals.delivered || 0}\n` +
        `New: ${analytics.totals.newDelivered || 0}\n` +
        `Used: ${analytics.totals.usedDelivered || 0}\n\n` +
        `Top Performer: ${topPerformer.displayCode} (${topPerformer.totalSales} units)`,
        ui.ButtonSet.OK
      );
      
    } catch (e) {
      logError("refreshAnalyticsManually", e);
      alertError("Error refreshing analytics: " + e.message);
    }
  });
}
