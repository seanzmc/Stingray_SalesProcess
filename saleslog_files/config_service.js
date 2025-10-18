/**
 * Configuration Service for Sales Log Pro
 * Server-side API for managing dynamic configuration via Properties Service
 * Implements hybrid storage: Properties Service (primary) + SALESPEOPLE sheet (sync)
 * 
 * Security: Server-side validation, LockService for atomic updates, XSS prevention
 * Performance: <300ms target for all operations, 10-minute cache TTL
 */

// Configuration constants
const CONFIG_PROPERTY_KEY = 'SALES_LOG_CONFIG';
const CONFIG_VERSION_KEY = 'CONFIG_VERSION';
const CONFIG_CACHE_KEY = 'config_cache';
const CONFIG_CACHE_TTL = 600; // 10 minutes in seconds

/**
 * Safely gets the current user's email address
 * Falls back to 'system@automated' for service accounts/add-ons where Session.getActiveUser() is unavailable
 *
 * @returns {string} User email or 'system@automated'
 */
function getSafeUserEmail() {
  try {
    return Session.getActiveUser().getEmail();
  } catch (e) {
    Logger.log('Session.getActiveUser() unavailable (service account/add-on context): ' + e.toString());
    return 'system@automated';
  }
}

/**
 * Default configuration based on 7.9.8.js hardcoded constants
 * This serves as the fallback and migration source
 */
const DEFAULT_CONFIG = {
  version: "1",
  salespeople: [], // Will be populated from SALESPEOPLE sheet during migration
  visual: {
    nonDeliveredColor: "#FF0000",
    salespersonErrorColor: "#FFEBEE",
    duplicateStockFillColor: "#b4ff0c",
    duplicateStockTextColor: "#ff0000",
    leaderboardZeroMtdBgColor: "#F0F8FF",
    paceThresholds: {
      green: 10,
      yellow: 8,
      red: 0
    },
    headerNewCarBgColor: "#234070",
    headerNewCarTextColor: "#FFFFFF",
    headerUsedCarBgColor: "#424242",
    headerUsedCarTextColor: "#FFFFFF",
    headerLeaderboardBgColor: "#434343",
    headerLeaderboardTextColor: "#FFFFFF",
    headerFont: "Calibri"
  },
  dates: {
    skipSundays: true,
    mondayLogsSaturday: true,
    archiveFormat: "M/YY" // Options: "M/YY", "MM/YY", "MMM/YY"
  },
  lastModified: new Date().toISOString(),
  modifiedBy: getSafeUserEmail()
};

// ============================================================================
// DATE SETTINGS HELPER FUNCTIONS
// ============================================================================

/**
 * Gets date configuration settings
 * Used by main script for date calculations
 *
 * @returns {Object} Date settings {skipSundays, mondayLogsSaturday, archiveFormat}
 */
function getDateSettings() {
  try {
    const config = getConfiguration();
    return config.dates || DEFAULT_CONFIG.dates;
  } catch (e) {
    logError('getDateSettings', e);
    return DEFAULT_CONFIG.dates;
  }
}

/**
 * Checks if Sundays should be counted as selling days
 *
 * @returns {boolean} True if Sundays should be skipped, false otherwise
 */
function shouldSkipSundays() {
  try {
    const dateSettings = getDateSettings();
    return dateSettings.skipSundays !== false; // Default to true if not set
  } catch (e) {
    logWarning('shouldSkipSundays', 'Error checking skipSundays', { error: e.toString() });
    return true; // Default to skipping Sundays on error
  }
}

/**
 * Checks if Monday should log Saturday's date
 *
 * @returns {boolean} True if Monday should default to Saturday, false otherwise
 */
function shouldMondayLogSaturday() {
  try {
    const dateSettings = getDateSettings();
    return dateSettings.mondayLogsSaturday !== false; // Default to true if not set
  } catch (e) {
    logWarning('shouldMondayLogSaturday', 'Error checking mondayLogsSaturday', { error: e.toString() });
    return true; // Default to true on error
  }
}

// ============================================================================
// HTML TEMPLATE UTILITIES
// ============================================================================

/**
 * Server-side include function for HTML templates
 * Allows separation of CSS and JavaScript into separate files
 * Used in config_sidebar.html for modular file organization
 *
 * @param {string} filename - Name of the HTML file to include (e.g., "config_sidebar.css")
 * @returns {string} HTML content of the included file
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================================
// CORE CONFIGURATION MANAGEMENT
// ============================================================================

/**
 * Retrieves the full configuration from Properties Service
 * Falls back to defaults if configuration doesn't exist
 * Uses caching for performance optimization
 * 
 * @returns {Object} Complete configuration object
 */
function getConfiguration() {
  try {
    // Check cache first
    const cached = CacheService.getScriptCache().get(CONFIG_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        logWarning('getConfiguration', 'Cache parse error', { error: e.toString() });
      }
    }

    // Read from Properties Service
    const props = PropertiesService.getDocumentProperties();
    const configJson = props.getProperty(CONFIG_PROPERTY_KEY);

    if (configJson) {
      const config = JSON.parse(configJson);
      
      // Validate structure and fill in any missing defaults
      const validatedConfig = mergeWithDefaults(config);
      
      // Cache the result
      CacheService.getScriptCache().put(CONFIG_CACHE_KEY, JSON.stringify(validatedConfig), CONFIG_CACHE_TTL);
      
      return validatedConfig;
    } else {
      // No configuration exists - return defaults
      Logger.log('No configuration found in Properties. Returning defaults.');
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); // Deep copy
    }
  } catch (e) {
    logError('getConfiguration', e);
    // Return defaults on error
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

/**
 * Updates configuration with provided changes (partial updates supported)
 * Uses LockService for atomic updates to prevent race conditions
 * Invalidates cache and syncs to SALESPEOPLE sheet
 * 
 * @param {Object} updates - Partial configuration object with changes
 * @returns {Object} Updated configuration object
 * @throws {Error} If validation fails or update operation fails
 */
function updateConfiguration(updates) {
  // Acquire lock with exponential backoff retry logic
  const lockResult = acquireScriptLockWithRetry();
  
  // Check if lock acquisition was successful
  if (!lockResult.success) {
    const errorMsg = 'Failed to acquire lock for configuration update after ' +
                     lockResult.attempts + ' attempts (' + lockResult.totalTime + 'ms). ' +
                     'Another operation may be in progress. Please try again.';
    logError('updateConfiguration', new Error(errorMsg), {
      lockAttempts: lockResult.attempts,
      lockTotalTime: lockResult.totalTime
    });
    throw new Error(errorMsg);
  }
  
  try {
    Logger.log('Configuration update lock acquired on attempt ' + lockResult.attempts);
    
    // Get current configuration
    const currentConfig = getConfiguration();
    
    // Merge updates (deep merge for nested objects)
    const updatedConfig = deepMerge(currentConfig, updates);
    
    // Update metadata
    updatedConfig.lastModified = new Date().toISOString();
    updatedConfig.modifiedBy = getSafeUserEmail();
    updatedConfig.version = String(parseInt(updatedConfig.version || "1") + 1);
    
    // Validate the complete configuration
    const validationErrors = validateConfiguration(updatedConfig);
    if (validationErrors.length > 0) {
      throw new Error('Configuration validation failed: ' + validationErrors.join('; '));
    }
    
    // Save to Properties Service
    const props = PropertiesService.getDocumentProperties();
    props.setProperty(CONFIG_PROPERTY_KEY, JSON.stringify(updatedConfig));
    props.setProperty(CONFIG_VERSION_KEY, updatedConfig.version);
    
    // Invalidate cache with defensive error handling
    try {
      CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
    } catch (error) {
      logError('updateConfiguration', error, {
        severity: 'CRITICAL',
        operation: 'cache_invalidation',
        cacheKey: CONFIG_CACHE_KEY,
        impact: 'Stale config data may be served until cache expires naturally (10 minutes)'
      });
      // Continue execution - configuration save succeeded, cache invalidation is non-fatal
    }
    
    // Invalidate visual config cache if visual settings were updated
    if (updates.visual) {
      try {
        CacheService.getScriptCache().remove('visualConfig');
      } catch (error) {
        logError('updateConfiguration', error, {
          severity: 'CRITICAL',
          operation: 'cache_invalidation',
          cacheKey: 'visualConfig',
          impact: 'Stale visual config may be served until cache expires naturally (5 minutes)'
        });
        // Continue execution - configuration save succeeded, cache invalidation is non-fatal
      }
    }
    
    // Sync salespeople to sheet for backward compatibility
    if (updates.salespeople) {
      syncToSalespeopleSheet(updatedConfig);
    }
    
    Logger.log('Configuration updated successfully. Version: ' + updatedConfig.version);
    
    return updatedConfig;
    
  } catch (e) {
    logError('updateConfiguration', e);
    throw e;
  } finally {
    // Always release lock, even if operation failed
    lockResult.lock.releaseLock();
  }
}

/**
 * Resets configuration to default values
 * Preserves salespeople from SALESPEOPLE sheet
 * 
 * @returns {Object} Reset configuration object
 */
function resetToDefaults() {
  try {
    // Get current salespeople to preserve them
    const currentConfig = getConfiguration();
    const salespeople = currentConfig.salespeople || [];
    
    // Create fresh default config
    const defaultConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    defaultConfig.salespeople = salespeople;
    defaultConfig.lastModified = new Date().toISOString();
    defaultConfig.modifiedBy = getSafeUserEmail();
    
    // Save using updateConfiguration for proper locking
    return updateConfiguration(defaultConfig);
    
  } catch (e) {
    logError('resetToDefaults', e);
    throw new Error('Failed to reset configuration: ' + e.message);
  }
}

// ============================================================================
// SALESPERSON MANAGEMENT (CRUD OPERATIONS)
// ============================================================================

/**
 * Returns array of salespeople from configuration
 * 
 * @returns {Array} Array of salesperson objects
 */
function getSalespeople() {
  try {
    const config = getConfiguration();
    return config.salespeople || [];
  } catch (e) {
    logError('getSalespeople', e);
    return [];
  }
}

/**
 * Adds a new salesperson to the configuration
 * Validates data and checks for duplicates
 * 
 * @param {Object} data - Salesperson data {fullName, aliases, displayCode}
 * @returns {Object} Updated configuration
 * @throws {Error} If validation fails
 */
function addSalesperson(data) {
  try {
    // Validate salesperson data
    const errors = validateSalesperson(data);
    if (errors.length > 0) {
      throw new Error('Validation failed: ' + errors.join('; '));
    }
    
    // Sanitize input
    const sanitized = {
      fullName: sanitizeText(data.fullName).trim(),
      aliases: sanitizeText(data.aliases).trim(),
      displayCode: sanitizeText(data.displayCode).trim().toUpperCase()
    };
    
    // Get current configuration
    const config = getConfiguration();
    const salespeople = config.salespeople || [];
    
    // Check for duplicate full name
    if (salespeople.some(sp => sp.fullName === sanitized.fullName)) {
      throw new Error('A salesperson with the name "' + sanitized.fullName + '" already exists');
    }
    
    // Check for alias conflicts
    const aliasConflict = checkAliasConflict(sanitized.aliases, null);
    if (aliasConflict) {
      throw new Error('Alias conflict: ' + aliasConflict);
    }
    
    // Add new salesperson
    salespeople.push(sanitized);
    
    // Update configuration
    const result = updateConfiguration({ salespeople: salespeople });
    
    // Update sync metadata
    updateSyncMetadata(sanitized.fullName, 'sidebar');
    
    return result;
    
  } catch (e) {
    logError('addSalesperson', e, { fullName: data?.fullName });
    throw e;
  }
}

/**
 * Updates an existing salesperson
 * 
 * @param {string} fullName - Current full name of salesperson to update
 * @param {Object} data - New salesperson data
 * @returns {Object} Updated configuration
 * @throws {Error} If validation fails or salesperson not found
 */
function updateSalesperson(fullName, data) {
  try {
    // Validate new data
    const errors = validateSalesperson(data);
    if (errors.length > 0) {
      throw new Error('Validation failed: ' + errors.join('; '));
    }
    
    // Sanitize input
    const sanitized = {
      fullName: sanitizeText(data.fullName).trim(),
      aliases: sanitizeText(data.aliases).trim(),
      displayCode: sanitizeText(data.displayCode).trim().toUpperCase()
    };
    
    // Get current configuration
    const config = getConfiguration();
    const salespeople = config.salespeople || [];
    
    // Find the salesperson
    const index = salespeople.findIndex(sp => sp.fullName === fullName);
    if (index === -1) {
      throw new Error('Salesperson "' + fullName + '" not found');
    }
    
    // If name is changing, check for duplicates
    if (sanitized.fullName !== fullName) {
      if (salespeople.some(sp => sp.fullName === sanitized.fullName)) {
        throw new Error('A salesperson with the name "' + sanitized.fullName + '" already exists');
      }
    }
    
    // Check for alias conflicts (excluding current salesperson)
    const aliasConflict = checkAliasConflict(sanitized.aliases, fullName);
    if (aliasConflict) {
      throw new Error('Alias conflict: ' + aliasConflict);
    }
    
    // Update the salesperson
    salespeople[index] = sanitized;
    
    // Update configuration
    const result = updateConfiguration({ salespeople: salespeople });
    
    // Update sync metadata
    updateSyncMetadata(sanitized.fullName, 'sidebar');
    
    return result;
    
  } catch (e) {
    logError('updateSalesperson', e, { fullName, newFullName: data?.fullName });
    throw e;
  }
}

/**
 * Deletes a salesperson from configuration
 * 
 * @param {string} fullName - Full name of salesperson to delete
 * @returns {Object} Updated configuration
 * @throws {Error} If salesperson not found
 */
function deleteSalesperson(fullName) {
  try {
    // Get current configuration
    const config = getConfiguration();
    const salespeople = config.salespeople || [];
    
    // Find and remove the salesperson
    const filtered = salespeople.filter(sp => sp.fullName !== fullName);
    
    if (filtered.length === salespeople.length) {
      throw new Error('Salesperson "' + fullName + '" not found');
    }
    
    // Clean up sync metadata for deleted salesperson
    try {
      const metadata = getSyncMetadataFromProperties();
      if (metadata[fullName]) {
        delete metadata[fullName];
        saveSyncMetadata(metadata);
      }
    } catch (e) {
      Logger.log('Warning: Could not clean up sync metadata: ' + e.toString());
      // Don't throw - metadata cleanup failure shouldn't break deletion
    }
    
    // Update configuration
    return updateConfiguration({ salespeople: filtered });
    
  } catch (e) {
    logError('deleteSalesperson', e, { fullName });
    throw e;
  }
}

/**
 * Updates the leaderboard on the TODAY sheet with current salespeople
 * Syncs salesperson names from SALESPEOPLE sheet to leaderboard (P2:R28)
 * Preserves existing MTD SALES and 3-month AVERAGE data
 *
 * @returns {Object} Result object with success status and count
 * @throws {Error} If update operation fails
 */
function updateLeaderboard() {
  try {
    Logger.log('Starting leaderboard update...');
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Get SALESPEOPLE sheet
    const salesSheet = ss.getSheetByName('SALESPEOPLE');
    if (!salesSheet) {
      throw new Error('SALESPEOPLE sheet not found');
    }
    
    // Get TODAY sheet
    const todaySheet = ss.getSheetByName('TODAY');
    if (!todaySheet) {
      throw new Error('TODAY sheet not found');
    }
    
    // Read all salespeople full names from column A (starting at row 2)
    const lastRow = salesSheet.getLastRow();
    let salespeople = [];
    
    if (lastRow > 1) {
      const salespeopleData = salesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      salespeople = salespeopleData
        .map(row => String(row[0]).trim())
        .filter(name => name); // Remove empty names
    }
    
    Logger.log('Found ' + salespeople.length + ' salespeople in SALESPEOPLE sheet');
    
    // Calculate dynamic range based on actual salesperson count
    const salespersonCount = Math.min(Math.max(1, salespeople.length), 200);
    const endRow = salespersonCount + 1; // +1 because start row is 2
    const leaderboardRangeA1 = `P2:R${endRow}`;
    
    // Get the dynamic leaderboard range
    const leaderboardRange = todaySheet.getRange(leaderboardRangeA1);
    const leaderboardData = leaderboardRange.getValues();
    
    // Create new leaderboard data
    const newLeaderboardData = [];
    
    for (let i = 0; i < salespersonCount; i++) {
      if (i < salespeople.length) {
        // Add salesperson with preserved MTD and 3-month average
        newLeaderboardData.push([
          salespeople[i],                    // Column P: NAME
          leaderboardData[i][1] ?? '',       // Column Q: MTD SALES (preserve existing, including 0)
          leaderboardData[i][2] ?? ''        // Column R: 3mo. AVERAGE (preserve existing, including 0)
        ]);
      } else {
        // Fill remaining rows with empty data (should not happen with correct count)
        newLeaderboardData.push(['', '', '']);
      }
    }
    
    // Write updated leaderboard data back to sheet
    leaderboardRange.setValues(newLeaderboardData);
    
    // Apply left-alignment to names column (P)
    todaySheet.getRange(`P2:P${endRow}`).setHorizontalAlignment("left");
    
    Logger.log('Leaderboard updated successfully with ' + salespeople.length + ' salespeople');
    
    return {
      success: true,
      count: salespeople.length,
      message: 'Leaderboard updated successfully'
    };
    
  } catch (e) {
    logError('updateLeaderboard', e);
    throw new Error('Failed to update leaderboard: ' + e.message);
  }
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * NOTE: validateSalesperson() is now provided by validation_rules.js
 * This ensures consistency across config_service.js and sync_service.js
 * The function is available globally in Google Apps Script
 */

/**
 * Validates a hex color code
 *
 * @param {string} colorHex - Color in hex format (e.g., "#FF0000")
 * @returns {boolean} True if valid, false otherwise
 */
function validateColor(colorHex) {
  if (!colorHex || typeof colorHex !== 'string') {
    return false;
  }
  return /^#[0-9A-F]{6}$/i.test(colorHex);
}

// ============================================================================
// WCAG CONTRAST CALCULATION UTILITIES
// ============================================================================

/**
 * Converts a hex color code to RGB components
 *
 * @param {string} hex - Color in hex format (e.g., "#FF5733" or "FF5733")
 * @returns {Object|null} RGB object {r, g, b} with values 0-255, or null if invalid
 */
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') {
    return null;
  }
  
  // Remove # if present
  hex = hex.replace(/^#/, '');
  
  // Validate hex format (6 characters, 0-9 A-F)
  if (!/^[0-9A-F]{6}$/i.test(hex)) {
    return null;
  }
  
  // Parse hex values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return { r: r, g: g, b: b };
}

/**
 * Calculates the relative luminance of an RGB color according to WCAG 2.0 formula
 * Uses sRGB to linear RGB conversion before applying the luminance formula
 *
 * @param {number} r - Red component (0-255)
 * @param {number} g - Green component (0-255)
 * @param {number} b - Blue component (0-255)
 * @returns {number} Relative luminance value (0-1)
 */
function getLuminance(r, g, b) {
  // Convert 0-255 to 0-1 range
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;
  
  // Convert sRGB to linear RGB
  const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
  
  // Calculate relative luminance using WCAG formula
  const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
  
  return luminance;
}

/**
 * Calculates the contrast ratio between two colors according to WCAG 2.0 formula
 *
 * @param {string} color1Hex - First color in hex format (e.g., "#FF5733")
 * @param {string} color2Hex - Second color in hex format (e.g., "#FFFFFF")
 * @returns {number|null} Contrast ratio (1-21), or null if invalid colors
 */
function calculateContrastRatio(color1Hex, color2Hex) {
  // Validate and convert colors to RGB
  const rgb1 = hexToRgb(color1Hex);
  const rgb2 = hexToRgb(color2Hex);
  
  if (!rgb1 || !rgb2) {
    return null;
  }
  
  // Calculate luminance for both colors
  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  
  // WCAG formula: (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter color
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  
  const contrastRatio = (lighter + 0.05) / (darker + 0.05);
  
  return contrastRatio;
}

/**
 * Determines whether black or white text provides better contrast for a given background color
 * Returns the text color that meets or exceeds WCAG AA standards (4.5:1 ratio)
 * If both meet the standard, returns the one with better contrast
 *
 * @param {string} bgColorHex - Background color in hex format (e.g., "#FF5733")
 * @returns {string|null} "#000000" (black) or "#FFFFFF" (white), or null if invalid input
 */
function getWcagCompliantTextColor(bgColorHex) {
  // Validate background color
  if (!validateColor(bgColorHex)) {
    return null;
  }
  
  // Calculate contrast ratios for black and white text
  const contrastWithBlack = calculateContrastRatio(bgColorHex, "#000000");
  const contrastWithWhite = calculateContrastRatio(bgColorHex, "#FFFFFF");
  
  if (contrastWithBlack === null || contrastWithWhite === null) {
    return null;
  }
  
  // Return the color with better contrast
  // (both black and white should work for most colors, but we pick the better one)
  return contrastWithBlack > contrastWithWhite ? "#000000" : "#FFFFFF";
}

/**
 * Checks if an alias conflicts with existing salespeople
 * 
 * @param {string} aliasesStr - Comma-separated aliases to check
 * @param {string|null} excludeFullName - Full name to exclude from conflict check (for updates)
 * @returns {string|null} Conflict description or null if no conflict
 */
function checkAliasConflict(aliasesStr, excludeFullName) {
  try {
    if (!aliasesStr || !aliasesStr.trim()) {
      return null; // No aliases to check
    }
    
    const newAliases = aliasesStr.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
    const config = getConfiguration();
    const salespeople = config.salespeople || [];
    
    for (const sp of salespeople) {
      // Skip the salesperson being updated
      if (excludeFullName && sp.fullName === excludeFullName) {
        continue;
      }
      
      // Check against full name
      if (newAliases.includes(sp.fullName.toUpperCase())) {
        return 'Alias "' + sp.fullName + '" conflicts with existing salesperson name';
      }
      
      // Check against display code
      if (newAliases.includes(sp.displayCode.toUpperCase())) {
        return 'Alias "' + sp.displayCode + '" conflicts with existing display code for ' + sp.fullName;
      }
      
      // Check against existing aliases
      const existingAliases = sp.aliases.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
      for (const newAlias of newAliases) {
        if (existingAliases.includes(newAlias)) {
          return 'Alias "' + newAlias + '" is already used by ' + sp.fullName;
        }
      }
    }
    
    return null; // No conflicts
  } catch (e) {
    logError('checkAliasConflict', e, { aliases: aliasesStr });
    return 'Error checking aliases: ' + e.message;
  }
}

/**
 * Validates the complete configuration object
 * 
 * @param {Object} config - Configuration object to validate
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
function validateConfiguration(config) {
  const errors = [];
  
  if (!config || typeof config !== 'object') {
    errors.push('Configuration must be an object');
    return errors;
  }
  
  // Validate visual settings if present
  if (config.visual) {
    const visual = config.visual;
    
    if (visual.nonDeliveredColor && !validateColor(visual.nonDeliveredColor)) {
      errors.push('Invalid non-delivered deal color');
    }
    if (visual.salespersonErrorColor && !validateColor(visual.salespersonErrorColor)) {
      errors.push('Invalid salesperson error color');
    }
    if (visual.duplicateStockFillColor && !validateColor(visual.duplicateStockFillColor)) {
      errors.push('Invalid duplicate stock fill color');
    }
    if (visual.duplicateStockTextColor && !validateColor(visual.duplicateStockTextColor)) {
      errors.push('Invalid duplicate stock text color');
    }
    if (visual.leaderboardZeroMtdBgColor && !validateColor(visual.leaderboardZeroMtdBgColor)) {
      errors.push('Invalid leaderboard zero MTD background color');
    }
    
    // Validate pace thresholds
    if (visual.paceThresholds) {
      const thresholds = visual.paceThresholds;
      if (typeof thresholds.green !== 'number' || thresholds.green < 0) {
        errors.push('Green pace threshold must be a positive number');
      }
      if (typeof thresholds.yellow !== 'number' || thresholds.yellow < 0) {
        errors.push('Yellow pace threshold must be a positive number');
      }
      if (typeof thresholds.red !== 'number' || thresholds.red < 0) {
        errors.push('Red pace threshold must be a positive number');
      }
    }
  }
  
  // Validate date settings if present
  if (config.dates) {
    const dates = config.dates;
    
    if (dates.skipSundays !== undefined && typeof dates.skipSundays !== 'boolean') {
      errors.push('skipSundays must be a boolean');
    }
    if (dates.mondayLogsSaturday !== undefined && typeof dates.mondayLogsSaturday !== 'boolean') {
      errors.push('mondayLogsSaturday must be a boolean');
    }
    if (dates.archiveFormat && !['M/YY', 'MM/YY', 'MMM/YY'].includes(dates.archiveFormat)) {
      errors.push('Invalid archive format (must be M/YY, MM/YY, or MMM/YY)');
    }
  }
  
  // Check total size (Properties Service has 9KB per property limit)
  const configJson = JSON.stringify(config);
  if (configJson.length > 8192) {
    errors.push('Configuration is too large (max 8KB)');
  }
  
  return errors;
}

// ============================================================================
// SYNC METADATA MANAGEMENT
// ============================================================================

/**
 * Gets sync metadata from Properties Service
 * Used to track salesperson modifications for bidirectional sync
 *
 * @returns {Object} Sync metadata structure
 */
function getSyncMetadataFromProperties() {
  try {
    const props = PropertiesService.getDocumentProperties();
    const metadataJson = props.getProperty('SALES_LOG_SYNC_META');
    
    if (metadataJson) {
      return JSON.parse(metadataJson);
    } else {
      return {}; // Empty metadata
    }
  } catch (e) {
    logWarning('getSyncMetadataFromProperties', 'Error reading sync metadata', { error: e.toString() });
    return {};
  }
}

/**
 * Cleans up old sync metadata entries to reduce size.
 * Removes entries older than 30 days and orphaned entries.
 *
 * @param {Object} metadata - Current metadata object
 * @returns {Object} Cleaned metadata object
 */
function cleanupOldMetadata(metadata) {
  try {
    const RETENTION_DAYS = 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffTime = cutoffDate.getTime();
    
    const cleaned = {};
    let removedCount = 0;
    let keptCount = 0;
    
    // Preserve _stats if it exists
    if (metadata._stats) {
      cleaned._stats = metadata._stats;
    }
    
    // Filter metadata entries
    for (const key in metadata) {
      if (!metadata.hasOwnProperty(key)) continue;
      
      // Skip special keys
      if (key === '_stats') continue;
      
      const value = metadata[key];
      
      // Check if entry has lastModified timestamp
      if (value && value.lastModified) {
        const entryTime = new Date(value.lastModified).getTime();
        
        // Keep if within retention period
        if (entryTime >= cutoffTime) {
          cleaned[key] = value;
          keptCount++;
        } else {
          removedCount++;
        }
      } else {
        // Keep entries without timestamp (shouldn't happen, but defensive)
        cleaned[key] = value;
        keptCount++;
      }
    }
    
    Logger.log('[cleanupOldMetadata] Removed ' + removedCount + ' old entries, kept ' + keptCount + ' entries');
    
    return cleaned;
    
  } catch (error) {
    logWarning('cleanupOldMetadata', 'Error during cleanup', { error: error.toString() });
    // Return original metadata if cleanup fails
    return metadata;
  }
}

/**
 * Saves sync metadata to Properties Service with size validation.
 * Performs automatic cleanup of old metadata if size limit is approached.
 *
 * @param {Object} metadata - Sync metadata structure to save
 * @throws {Error} If metadata exceeds size limits even after cleanup
 */
function saveSyncMetadata(metadata) {
  try {
    const props = PropertiesService.getDocumentProperties();
    
    // Convert to JSON for size checking
    let metadataJson = JSON.stringify(metadata);
    let metadataSize = metadataJson.length;
    
    // Size validation: 8KB threshold (9KB hard limit with safety margin)
    const SIZE_LIMIT = 8192;  // 8KB in bytes
    const SIZE_WARNING = 6144; // 6KB (75% of limit)
    
    // If approaching or exceeding limit, attempt cleanup
    if (metadataSize >= SIZE_WARNING) {
      Logger.log('[saveSyncMetadata] Metadata size: ' + metadataSize + ' bytes (' + (metadataSize/1024).toFixed(2) + ' KB)');
      
      if (metadataSize >= SIZE_LIMIT) {
        // Attempt automatic cleanup
        Logger.log('[saveSyncMetadata] Size limit reached. Attempting cleanup...');
        metadata = cleanupOldMetadata(metadata);
        metadataJson = JSON.stringify(metadata);
        metadataSize = metadataJson.length;
        
        // If still too large after cleanup, throw error
        if (metadataSize >= SIZE_LIMIT) {
          throw new Error(
            'Sync metadata exceeds size limit: ' + metadataSize + ' bytes (max: ' + SIZE_LIMIT + '). ' +
            'Consider reducing retention period or implementing chunking.'
          );
        }
        
        Logger.log('[saveSyncMetadata] After cleanup: ' + metadataSize + ' bytes (' + (metadataSize/1024).toFixed(2) + ' KB)');
      } else {
        // Warning level - log but continue
        logWarning('saveSyncMetadata', 'Approaching size limit', {
          currentSize: metadataSize,
          limit: SIZE_LIMIT,
          percentUsed: ((metadataSize / SIZE_LIMIT) * 100).toFixed(1) + '%'
        });
      }
    }
    
    // Write to Properties Service
    props.setProperty('SALES_LOG_SYNC_META', metadataJson);
    
    // Log successful write with size info
    if (metadataSize >= SIZE_WARNING) {
      Logger.log('[saveSyncMetadata] Successfully saved metadata (' + metadataSize + ' bytes)');
    }
    
  } catch (error) {
    logError('saveSyncMetadata', error, {
      operation: 'properties_write',
      attemptedSize: metadataJson ? metadataJson.length : 'unknown'
    });
    throw error;
  }
}

/**
 * Updates sync metadata for a salesperson
 * Tracks modifications for conflict detection and bidirectional sync
 *
 * @param {string} fullName - Salesperson full name
 * @param {string} source - Modification source: 'sheet' or 'sidebar'
 * @returns {void}
 */
function updateSyncMetadata(fullName, source) {
  try {
    const metadata = getSyncMetadataFromProperties();
    
    metadata[fullName] = {
      lastModified: new Date().toISOString(),
      modifiedBy: getSafeUserEmail(),
      source: source,
      version: (metadata[fullName] && metadata[fullName].version) ? metadata[fullName].version + 1 : 1
    };
    
    saveSyncMetadata(metadata);
    Logger.log('Updated sync metadata for ' + fullName + ' (source: ' + source + ')');
  } catch (e) {
    logWarning('updateSyncMetadata', 'Error updating sync metadata', { error: e.toString(), fullName });
    // Don't throw - metadata tracking failure shouldn't break CRUD operations
  }
}

// ============================================================================
// MIGRATION & SYNC FUNCTIONS
// ============================================================================

/**
 * Auto-migration from hardcoded constants to Properties Service configuration
 * Safe to call multiple times - only migrates if no configuration exists
 * 
 * @returns {Object} Migration result with status and message
 */
function migrateToConfigUI() {
  try {
    const props = PropertiesService.getDocumentProperties();
    
    // Check if already migrated
    if (props.getProperty(CONFIG_PROPERTY_KEY)) {
      Logger.log('Configuration already exists. Migration not needed.');
      return {
        success: true,
        alreadyMigrated: true,
        message: 'Configuration already exists'
      };
    }
    
    Logger.log('Starting migration to configuration UI...');
    
    // Create default configuration
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    
    // Migrate salespeople from SALESPEOPLE sheet
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const salesSheet = ss.getSheetByName('SALESPEOPLE');
      
      if (salesSheet) {
        const lastRow = salesSheet.getLastRow();
        if (lastRow > 1) {
          const data = salesSheet.getRange(2, 1, lastRow - 1, 3).getValues();
          
          config.salespeople = data
            .filter(row => row[0] && String(row[0]).trim()) // Has full name
            .map(row => ({
              fullName: String(row[0]).trim(),
              aliases: String(row[1] || '').trim(),
              displayCode: String(row[2] || '').trim()
            }));
          
          Logger.log('Migrated ' + config.salespeople.length + ' salespeople from SALESPEOPLE sheet');
        }
      }
    } catch (e) {
      Logger.log('Warning: Could not migrate from SALESPEOPLE sheet: ' + e);
      // Continue with empty salespeople array
    }
    
    // Set metadata
    config.lastModified = new Date().toISOString();
    config.modifiedBy = getSafeUserEmail();
    config.version = "1";
    
    // Save to Properties Service
    props.setProperty(CONFIG_PROPERTY_KEY, JSON.stringify(config));
    props.setProperty(CONFIG_VERSION_KEY, config.version);
    
    Logger.log('Migration complete. Configuration saved to Properties Service.');
    
    // Show success message to user
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Configuration system upgraded! Open Settings to customize.',
      'Migration Complete',
      5
    );
    
    return {
      success: true,
      alreadyMigrated: false,
      message: 'Migration completed successfully',
      salespeopleCount: config.salespeople.length
    };
    
  } catch (e) {
    logError('migrateToConfigUI', e);
    return {
      success: false,
      message: 'Migration failed: ' + e.message
    };
  }
}

/**
 * Syncs configuration salespeople to SALESPEOPLE sheet for backward compatibility
 * Properties Service remains the source of truth, sheet is secondary storage
 * Invalidates salesperson maps cache after sync to force refresh
 *
 * @param {Object} config - Configuration object containing salespeople array
 * @returns {void}
 */
function syncToSalespeopleSheet(config) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const salesSheet = ss.getSheetByName('SALESPEOPLE');
    
    if (!salesSheet) {
      Logger.log('SALESPEOPLE sheet not found. Cannot sync.');
      return;
    }
    
    const salespeople = config.salespeople || [];
    
    // Clear existing data (except header)
    const lastRow = salesSheet.getLastRow();
    if (lastRow > 1) {
      salesSheet.getRange(2, 1, lastRow - 1, 3).clearContent();
    }
    
    // Write new data
    if (salespeople.length > 0) {
      const data = salespeople.map(sp => [
        sp.fullName,
        sp.aliases,
        sp.displayCode
      ]);
      
      salesSheet.getRange(2, 1, data.length, 3).setValues(data);
    }
    
    Logger.log('Synced ' + salespeople.length + ' salespeople to SALESPEOPLE sheet');
    
    // Invalidate the salesperson maps cache to force refresh
    try {
      CacheService.getScriptCache().remove('salespersonMaps');
    } catch (error) {
      logError('syncToSalespeopleSheet', error, {
        severity: 'HIGH',
        operation: 'cache_invalidation',
        cacheKey: 'salespersonMaps',
        impact: 'Stale salesperson maps may be served until cache expires naturally (5 minutes)',
        context: 'After syncing salespeople to SALESPEOPLE sheet'
      });
      // Continue execution - sheet sync succeeded, cache invalidation is non-fatal
    }
    
  } catch (e) {
    logWarning('syncToSalespeopleSheet', 'Error syncing to SALESPEOPLE sheet', { error: e.toString(), count: config?.salespeople?.length });
    // Don't throw - sync is secondary operation
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sanitizes text input to prevent XSS attacks
 * Removes HTML tags and encodes special characters
 * 
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // Remove HTML tags
  let sanitized = text.replace(/<[^>]*>/g, '');
  
  // Remove potentially dangerous characters for script injection
  sanitized = sanitized.replace(/[<>]/g, '');
  
  return sanitized;
}

/**
 * Deep merges two objects (source overwrites target for conflicts)
 * 
 * @param {Object} target - Target object
 * @param {Object} source - Source object with updates
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const result = JSON.parse(JSON.stringify(target)); // Deep copy
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  
  return result;
}

/**
 * Merges configuration with defaults to ensure all required fields exist
 * 
 * @param {Object} config - Configuration object
 * @returns {Object} Configuration with defaults filled in
 */
function mergeWithDefaults(config) {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  return deepMerge(defaults, config);
}

/**
 * Exports configuration as JSON string for backup/migration
 * 
 * @returns {string} Configuration as JSON
 */
function exportConfiguration() {
  try {
    const config = getConfiguration();
    return JSON.stringify(config, null, 2);
  } catch (e) {
    logError('exportConfiguration', e);
    throw new Error('Failed to export configuration: ' + e.message);
  }
}

/**
 * Imports configuration from JSON string
 * Validates before saving
 *
 * @param {string} json - Configuration JSON string
 * @returns {Object} Imported configuration
 * @throws {Error} If JSON is invalid or validation fails
 */
function importConfiguration(json) {
  try {
    const config = JSON.parse(json);
    
    // Validate structure
    const errors = validateConfiguration(config);
    if (errors.length > 0) {
      throw new Error('Invalid configuration: ' + errors.join('; '));
    }
    
    // Update using standard update function (includes locking)
    return updateConfiguration(config);
    
  } catch (e) {
    logError('importConfiguration', e);
    throw new Error('Failed to import configuration: ' + e.message);
  }
}

// ============================================================================
// SIDEBAR INITIALIZATION WITH SHEET SYNC
// ============================================================================

/**
 * Gets configuration for sidebar, ensuring sheet data is synced first
 * This is the main entry point when sidebar opens
 * Reads from SALESPEOPLE sheet and syncs to Properties if needed
 *
 * @returns {Object} Configuration object with sheet data loaded
 */
function getConfigurationForSidebar() {
  try {
    Logger.log('[Config] Getting configuration for sidebar...');
    
    // Step 1: Read from SALESPEOPLE sheet
    const sheetData = readSalespeopleFromSheet();
    Logger.log('[Config] Read ' + sheetData.length + ' salespeople from sheet');
    
    // Step 2: Get current Properties config
    let config = getConfiguration();
    const propsData = config.salespeople || [];
    Logger.log('[Config] Current Properties has ' + propsData.length + ' salespeople');
    
    // Step 3: Check if sync is needed
    if (needsSync(sheetData, propsData)) {
      Logger.log('[Config] Sync needed - sheet differs from Properties');
      
      // Step 4: Sync sheet data to Properties
      const syncResult = syncFromSheetToProperties(sheetData);
      
      if (syncResult.success) {
        Logger.log('[Config] Successfully synced ' + syncResult.count + ' salespeople from sheet to Properties');
        
        // Re-read config after sync
        config = getConfiguration();
      } else {
        logWarning('getConfigurationForSidebar', 'Sync failed', { error: syncResult.error });
        // Continue with current config even if sync fails
      }
    } else {
      Logger.log('[Config] No sync needed - sheet and Properties match');
    }
    
    // Step 5: Return config (now guaranteed to match sheet or represent best state)
    return config;
    
  } catch (error) {
    logError('getConfigurationForSidebar', error);
    // Fall back to regular getConfiguration
    return getConfiguration();
  }
}

// ============================================================================
// SCRIPTLET INTEGRATION FUNCTIONS
// ============================================================================

/**
 * Prepares all data needed for scriptlet injection in HTML templates
 * This is the main entry point for server-side rendering optimization
 *
 * @returns {Object} Object containing all scriptlet data
 */
function prepareScriptletData() {
  try {
    const config = getConfiguration();
    
    return {
      cssVariables: generateCssVariables(config.visual),
      initialState: prepareInitialState(config),
      featureFlags: prepareFeatureFlags(config)
    };
  } catch (e) {
    logError('prepareScriptletData', e);
    // Return safe defaults on error
    return {
      cssVariables: generateCssVariables(DEFAULT_CONFIG.visual),
      initialState: prepareInitialState(DEFAULT_CONFIG),
      featureFlags: prepareFeatureFlags(DEFAULT_CONFIG)
    };
  }
}

/**
 * Generates CSS variable declarations from visual configuration
 * Used in config_sidebar_css.html for dynamic theming
 *
 * @param {Object} visual - Visual configuration object
 * @returns {string} CSS variable declarations
 */
function generateCssVariables(visual) {
  if (!visual) {
    visual = DEFAULT_CONFIG.visual;
  }
  
  const vars = [];
  
  // Color variables
  if (visual.nonDeliveredColor) {
    vars.push(`--color-non-delivered: ${visual.nonDeliveredColor};`);
  }
  if (visual.salespersonErrorColor) {
    vars.push(`--color-salesperson-error: ${visual.salespersonErrorColor};`);
  }
  if (visual.duplicateStockFillColor) {
    vars.push(`--color-duplicate-fill: ${visual.duplicateStockFillColor};`);
  }
  if (visual.duplicateStockTextColor) {
    vars.push(`--color-duplicate-text: ${visual.duplicateStockTextColor};`);
  }
  if (visual.leaderboardZeroMtdBgColor) {
    vars.push(`--color-leaderboard-zero: ${visual.leaderboardZeroMtdBgColor};`);
  }
  
  // Pace threshold variables (for potential future use)
  if (visual.paceThresholds) {
    vars.push(`--threshold-green: ${visual.paceThresholds.green};`);
    vars.push(`--threshold-yellow: ${visual.paceThresholds.yellow};`);
    vars.push(`--threshold-red: ${visual.paceThresholds.red};`);
  }
  
  return vars.join('\n        ');
}

/**
 * Prepares initial configuration state for injection into JavaScript
 * Eliminates the need for initial API call on page load
 *
 * @param {Object} config - Full configuration object
 * @returns {string} JSON-encoded configuration safe for script injection
 */
function prepareInitialState(config) {
  if (!config) {
    config = DEFAULT_CONFIG;
  }
  
  // Create a clean copy for client-side use
  const clientConfig = {
    version: config.version || "1",
    salespeople: config.salespeople || [],
    visual: config.visual || DEFAULT_CONFIG.visual,
    dates: config.dates || DEFAULT_CONFIG.dates,
    lastModified: config.lastModified,
    modifiedBy: config.modifiedBy
  };
  
  // Convert to JSON and escape for safe injection
  return escapeHtmlForScriptlet(JSON.stringify(clientConfig));
}

/**
 * Prepares feature flags for conditional rendering in templates
 * Allows server-side decisions about which features to enable
 *
 * @param {Object} config - Configuration object
 * @returns {Object} Feature flags object
 */
function prepareFeatureFlags(config) {
  return {
    hasSalespeople: config.salespeople && config.salespeople.length > 0,
    hasCustomColors: config.visual && (
      config.visual.nonDeliveredColor !== DEFAULT_CONFIG.visual.nonDeliveredColor ||
      config.visual.salespersonErrorColor !== DEFAULT_CONFIG.visual.salespersonErrorColor
    ),
    hasCustomThresholds: config.visual && config.visual.paceThresholds && (
      config.visual.paceThresholds.green !== DEFAULT_CONFIG.visual.paceThresholds.green ||
      config.visual.paceThresholds.yellow !== DEFAULT_CONFIG.visual.paceThresholds.yellow ||
      config.visual.paceThresholds.red !== DEFAULT_CONFIG.visual.paceThresholds.red
    ),
    skipSundays: config.dates ? config.dates.skipSundays : true,
    mondayLogsSaturday: config.dates ? config.dates.mondayLogsSaturday : true
  };
}

/**
 * Escapes HTML special characters for safe scriptlet injection
 * Prevents XSS attacks when injecting user data into templates
 *
 * @param {string} text - Text to escape
 * @returns {string} HTML-escaped text
 */
function escapeHtmlForScriptlet(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;');
}