'use strict';

/**
 * Configuration Manager Module
 * Handles saving, loading, and managing merge configurations using PropertiesService
 * 
 * Storage Format:
 * - Individual configs: Key = "cdk_merge_config_{name}", Value = JSON.stringify(config)
 * - Config list: Key = "cdk_merge_config_list", Value = JSON.stringify([names])
 * 
 * @module config_manager
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const CONFIG_KEY_PREFIX = 'cdk_merge_config_';
const CONFIG_LIST_KEY = 'cdk_merge_config_list';
const MAX_CONFIG_NAME_LENGTH = 50;
const MIN_CONFIG_NAME_LENGTH = 1;
const MIN_CONFIDENCE_VALUE = 70;
const MAX_CONFIDENCE_VALUE = 100;

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Saves a merge configuration to PropertiesService
 * 
 * @param {string} name - Configuration name (1-50 chars, alphanumeric and spaces)
 * @param {Object} config - Configuration object to save
 * @returns {Object} Result object with success status and message
 * 
 * @example
 * const config = {
 *   name: "Monthly Standard",
 *   salesLog: { newStockColumn: 5, usedStockColumn: 12, headerRow: 1, dataStartRow: 2 },
 *   cdk: { headerRow: 1, dataStartRow: 2 },
 *   matching: { requireExactMatch: false, minConfidence: 80, caseSensitive: false, 
 *               allowPartialMatches: true, validateStockType: true }
 * };
 * const result = saveConfiguration("Monthly Standard", config);
 */
function saveConfiguration(name, config) {
  try {
    // Validate configuration name
    const nameValidation = validateConfigurationName(name);
    if (!nameValidation.valid) {
      return {
        success: false,
        error: nameValidation.error
      };
    }

    // Ensure config has the name property
    const configToSave = { ...config, name: name };

    // Validate configuration structure
    const validation = validateConfiguration(configToSave);
    if (!validation.valid) {
      logError('saveConfiguration', 'Configuration validation failed', {
        name: name,
        errors: validation.errors
      });
      return {
        success: false,
        error: 'Invalid configuration: ' + validation.errors.join(', ')
      };
    }

    const props = PropertiesService.getUserProperties();
    const configKey = CONFIG_KEY_PREFIX + name;

    // Check if configuration already exists
    const existingConfig = props.getProperty(configKey);
    
    // Add or update metadata
    if (existingConfig) {
      // Updating existing config - preserve creation date and increment usage count
      try {
        const existing = JSON.parse(existingConfig);
        configToSave.metadata = {
          createdDate: existing.metadata?.createdDate || new Date().toISOString(),
          lastUsedDate: new Date().toISOString(),
          usageCount: (existing.metadata?.usageCount || 0) + 1,
          createdBy: existing.metadata?.createdBy || Session.getActiveUser().getEmail()
        };
      } catch (e) {
        logWarning('saveConfiguration', 'Could not parse existing config metadata', { name: name });
        configToSave.metadata = createNewMetadata();
      }
    } else {
      // New configuration
      configToSave.metadata = createNewMetadata();
    }

    // Serialize and check size (9KB limit per property)
    const configJson = JSON.stringify(configToSave);
    if (configJson.length > 9000) {
      logError('saveConfiguration', 'Configuration too large', {
        name: name,
        size: configJson.length
      });
      return {
        success: false,
        error: 'Configuration exceeds size limit (9KB)'
      };
    }

    // Save configuration
    props.setProperty(configKey, configJson);

    // Update configuration list
    updateConfigurationList(name, 'add');

    logInfo('saveConfiguration', 'Configuration saved successfully', {
      name: name,
      isNew: !existingConfig
    });

    return {
      success: true,
      message: existingConfig ? 'Configuration updated successfully' : 'Configuration saved successfully',
      name: name
    };

  } catch (error) {
    const { message } = logError('saveConfiguration', error, { name: name });
    return {
      success: false,
      error: 'Failed to save configuration: ' + message
    };
  }
}

/**
 * Loads a saved configuration by name
 * 
 * @param {string} name - Configuration name to load
 * @returns {Object|null} Configuration object, or null if not found
 * 
 * @example
 * const config = loadConfiguration("Monthly Standard");
 * if (config) {
 *   console.log("Loaded config:", config.name);
 * }
 */
function loadConfiguration(name) {
  try {
    if (!name || typeof name !== 'string') {
      logWarning('loadConfiguration', 'Invalid configuration name', { name: name });
      return null;
    }

    const props = PropertiesService.getUserProperties();
    const configKey = CONFIG_KEY_PREFIX + name;
    const configJson = props.getProperty(configKey);

    if (!configJson) {
      logInfo('loadConfiguration', 'Configuration not found', { name: name });
      return null;
    }

    const config = JSON.parse(configJson);
    
    // Update last used date
    updateConfigurationMetadata(name, {
      lastUsedDate: new Date().toISOString()
    });

    logInfo('loadConfiguration', 'Configuration loaded successfully', { name: name });
    return config;

  } catch (error) {
    logError('loadConfiguration', error, { name: name });
    return null;
  }
}

/**
 * Returns array of all saved configuration names with metadata
 * 
 * @returns {Array} Array of configuration objects with name and metadata
 * 
 * @example
 * const configs = listConfigurations();
 * configs.forEach(cfg => console.log(cfg.name, cfg.metadata.lastUsedDate));
 */
function listConfigurations() {
  try {
    const props = PropertiesService.getUserProperties();
    const listJson = props.getProperty(CONFIG_LIST_KEY);

    if (!listJson) {
      logInfo('listConfigurations', 'No configurations found');
      return [];
    }

    const configNames = JSON.parse(listJson);
    const configurations = [];

    for (const name of configNames) {
      const configKey = CONFIG_KEY_PREFIX + name;
      const configJson = props.getProperty(configKey);

      if (configJson) {
        try {
          const config = JSON.parse(configJson);
          configurations.push({
            name: config.name,
            metadata: config.metadata || {
              createdDate: 'Unknown',
              lastUsedDate: 'Unknown',
              usageCount: 0,
              createdBy: 'Unknown'
            }
          });
        } catch (e) {
          logWarning('listConfigurations', 'Could not parse configuration', { name: name });
        }
      }
    }

    // Sort by last used date (most recent first)
    configurations.sort((a, b) => {
      const dateA = new Date(a.metadata.lastUsedDate || 0);
      const dateB = new Date(b.metadata.lastUsedDate || 0);
      return dateB - dateA;
    });

    logInfo('listConfigurations', 'Configurations listed', { count: configurations.length });
    return configurations;

  } catch (error) {
    logError('listConfigurations', error);
    return [];
  }
}

/**
 * Deletes a saved configuration
 * 
 * @param {string} name - Configuration name to delete
 * @returns {Object} Result object with success status
 * 
 * @example
 * const result = deleteConfiguration("Old Config");
 * if (result.success) {
 *   console.log("Configuration deleted");
 * }
 */
function deleteConfiguration(name) {
  try {
    if (!name || typeof name !== 'string') {
      return {
        success: false,
        error: 'Invalid configuration name'
      };
    }

    const props = PropertiesService.getUserProperties();
    const configKey = CONFIG_KEY_PREFIX + name;

    // Check if configuration exists
    const configJson = props.getProperty(configKey);
    if (!configJson) {
      return {
        success: false,
        error: 'Configuration not found'
      };
    }

    // Delete configuration
    props.deleteProperty(configKey);

    // Update configuration list
    updateConfigurationList(name, 'remove');

    logInfo('deleteConfiguration', 'Configuration deleted', { name: name });

    return {
      success: true,
      message: 'Configuration deleted successfully'
    };

  } catch (error) {
    const { message } = logError('deleteConfiguration', error, { name: name });
    return {
      success: false,
      error: 'Failed to delete configuration: ' + message
    };
  }
}

/**
 * Returns default configuration template
 * 
 * @returns {Object} Default configuration object
 * 
 * @example
 * const defaultConfig = getDefaultConfiguration();
 * console.log("Default new stock column:", defaultConfig.salesLog.newStockColumn);
 */
function getDefaultConfiguration() {
  return {
    name: "Default",
    salesLog: {
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
}

/**
 * Validates configuration structure and values
 * 
 * @param {Object} config - Configuration object to validate
 * @returns {Object} Validation result with valid flag and errors array
 * 
 * @example
 * const validation = validateConfiguration(config);
 * if (!validation.valid) {
 *   console.error("Validation errors:", validation.errors);
 * }
 */
function validateConfiguration(config) {
  const errors = [];

  // Check if config is an object
  if (!config || typeof config !== 'object') {
    errors.push('Configuration must be an object');
    return { valid: false, errors: errors };
  }

  // Validate name
  if (!config.name || typeof config.name !== 'string') {
    errors.push('Configuration name is required');
  } else {
    const nameValidation = validateConfigurationName(config.name);
    if (!nameValidation.valid) {
      errors.push(nameValidation.error);
    }
  }

  // Validate salesLog section
  if (!config.salesLog || typeof config.salesLog !== 'object') {
    errors.push('salesLog section is required');
  } else {
    if (!isPositiveInteger(config.salesLog.newStockColumn)) {
      errors.push('salesLog.newStockColumn must be a positive integer');
    }
    if (!isPositiveInteger(config.salesLog.usedStockColumn)) {
      errors.push('salesLog.usedStockColumn must be a positive integer');
    }
    if (!isPositiveInteger(config.salesLog.headerRow) || config.salesLog.headerRow < 1) {
      errors.push('salesLog.headerRow must be >= 1');
    }
    if (!isPositiveInteger(config.salesLog.dataStartRow)) {
      errors.push('salesLog.dataStartRow must be a positive integer');
    } else if (config.salesLog.headerRow && config.salesLog.dataStartRow <= config.salesLog.headerRow) {
      errors.push('salesLog.dataStartRow must be greater than headerRow');
    }
  }

  // Validate cdk section
  if (!config.cdk || typeof config.cdk !== 'object') {
    errors.push('cdk section is required');
  } else {
    if (!isPositiveInteger(config.cdk.headerRow) || config.cdk.headerRow < 1) {
      errors.push('cdk.headerRow must be >= 1');
    }
    if (!isPositiveInteger(config.cdk.dataStartRow)) {
      errors.push('cdk.dataStartRow must be a positive integer');
    } else if (config.cdk.headerRow && config.cdk.dataStartRow <= config.cdk.headerRow) {
      errors.push('cdk.dataStartRow must be greater than headerRow');
    }
  }

  // Validate matching section
  if (!config.matching || typeof config.matching !== 'object') {
    errors.push('matching section is required');
  } else {
    if (typeof config.matching.requireExactMatch !== 'boolean') {
      errors.push('matching.requireExactMatch must be a boolean');
    }
    if (typeof config.matching.minConfidence !== 'number' || 
        config.matching.minConfidence < MIN_CONFIDENCE_VALUE || 
        config.matching.minConfidence > MAX_CONFIDENCE_VALUE) {
      errors.push(`matching.minConfidence must be between ${MIN_CONFIDENCE_VALUE} and ${MAX_CONFIDENCE_VALUE}`);
    }
    if (typeof config.matching.caseSensitive !== 'boolean') {
      errors.push('matching.caseSensitive must be a boolean');
    }
    if (typeof config.matching.allowPartialMatches !== 'boolean') {
      errors.push('matching.allowPartialMatches must be a boolean');
    }
    if (typeof config.matching.validateStockType !== 'boolean') {
      errors.push('matching.validateStockType must be a boolean');
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Updates configuration metadata (last used date, usage count, etc.)
 * 
 * @param {string} name - Configuration name
 * @param {Object} metadata - Metadata fields to update
 * @returns {Object} Result object with success status
 * 
 * @example
 * updateConfigurationMetadata("Monthly Standard", { lastUsedDate: new Date() });
 */
function updateConfigurationMetadata(name, metadata) {
  try {
    const props = PropertiesService.getUserProperties();
    const configKey = CONFIG_KEY_PREFIX + name;
    const configJson = props.getProperty(configKey);

    if (!configJson) {
      return {
        success: false,
        error: 'Configuration not found'
      };
    }

    const config = JSON.parse(configJson);
    
    // Update metadata fields
    config.metadata = config.metadata || {};
    if (metadata.lastUsedDate) {
      config.metadata.lastUsedDate = metadata.lastUsedDate;
    }
    if (metadata.usageCount !== undefined) {
      config.metadata.usageCount = metadata.usageCount;
    }

    // Save updated configuration
    props.setProperty(configKey, JSON.stringify(config));

    return {
      success: true,
      message: 'Metadata updated successfully'
    };

  } catch (error) {
    logError('updateConfigurationMetadata', error, { name: name });
    return {
      success: false,
      error: 'Failed to update metadata'
    };
  }
}

// ============================================================================
// ADDITIONAL HELPER FUNCTIONS
// ============================================================================

/**
 * Exports configuration as JSON string for backup
 * 
 * @param {string} name - Configuration name to export
 * @returns {string|null} JSON string of configuration, or null if not found
 * 
 * @example
 * const jsonString = exportConfiguration("Monthly Standard");
 * // Save jsonString to file or clipboard
 */
function exportConfiguration(name) {
  try {
    const config = loadConfiguration(name);
    if (!config) {
      logWarning('exportConfiguration', 'Configuration not found', { name: name });
      return null;
    }

    const exportJson = JSON.stringify(config, null, 2);
    logInfo('exportConfiguration', 'Configuration exported', { name: name });
    return exportJson;

  } catch (error) {
    logError('exportConfiguration', error, { name: name });
    return null;
  }
}

/**
 * Imports configuration from JSON string
 * 
 * @param {string} jsonString - JSON string containing configuration
 * @returns {Object} Result object with success status
 * 
 * @example
 * const result = importConfiguration(jsonString);
 * if (result.success) {
 *   console.log("Configuration imported:", result.name);
 * }
 */
function importConfiguration(jsonString) {
  try {
    if (!jsonString || typeof jsonString !== 'string') {
      return {
        success: false,
        error: 'Invalid JSON string'
      };
    }

    // Parse JSON
    let config;
    try {
      config = JSON.parse(jsonString);
    } catch (parseError) {
      return {
        success: false,
        error: 'Invalid JSON format: ' + parseError.message
      };
    }

    // Validate configuration
    const validation = validateConfiguration(config);
    if (!validation.valid) {
      return {
        success: false,
        error: 'Invalid configuration: ' + validation.errors.join(', ')
      };
    }

    // Save configuration
    const result = saveConfiguration(config.name, config);
    
    if (result.success) {
      logInfo('importConfiguration', 'Configuration imported', { name: config.name });
    }

    return result;

  } catch (error) {
    const { message } = logError('importConfiguration', error);
    return {
      success: false,
      error: 'Failed to import configuration: ' + message
    };
  }
}

/**
 * Returns statistics about saved configurations
 * 
 * @returns {Object} Statistics object with usage information
 * 
 * @example
 * const stats = getConfigurationUsageStats();
 * console.log("Total configs:", stats.totalCount);
 * console.log("Most used:", stats.mostUsed.name);
 */
function getConfigurationUsageStats() {
  try {
    const configurations = listConfigurations();

    if (configurations.length === 0) {
      return {
        totalCount: 0,
        mostUsed: null,
        leastUsed: null,
        averageUsageCount: 0,
        recentlyUsed: []
      };
    }

    // Calculate statistics
    let totalUsageCount = 0;
    let mostUsed = configurations[0];
    let leastUsed = configurations[0];

    for (const config of configurations) {
      const usageCount = config.metadata.usageCount || 0;
      totalUsageCount += usageCount;

      if (usageCount > (mostUsed.metadata.usageCount || 0)) {
        mostUsed = config;
      }
      if (usageCount < (leastUsed.metadata.usageCount || 0)) {
        leastUsed = config;
      }
    }

    // Get recently used (already sorted by last used date in listConfigurations)
    const recentlyUsed = configurations.slice(0, 5);

    const stats = {
      totalCount: configurations.length,
      mostUsed: {
        name: mostUsed.name,
        usageCount: mostUsed.metadata.usageCount || 0
      },
      leastUsed: {
        name: leastUsed.name,
        usageCount: leastUsed.metadata.usageCount || 0
      },
      averageUsageCount: totalUsageCount / configurations.length,
      recentlyUsed: recentlyUsed.map(cfg => ({
        name: cfg.name,
        lastUsedDate: cfg.metadata.lastUsedDate
      }))
    };

    logInfo('getConfigurationUsageStats', 'Statistics calculated', { totalCount: stats.totalCount });
    return stats;

  } catch (error) {
    logError('getConfigurationUsageStats', error);
    return {
      totalCount: 0,
      error: 'Failed to calculate statistics'
    };
  }
}

// ============================================================================
// INTERNAL HELPER FUNCTIONS
// ============================================================================

/**
 * Validates configuration name format
 * 
 * @private
 * @param {string} name - Configuration name to validate
 * @returns {Object} Validation result
 */
function validateConfigurationName(name) {
  if (!name || typeof name !== 'string') {
    return {
      valid: false,
      error: 'Configuration name must be a string'
    };
  }

  const trimmedName = name.trim();

  if (trimmedName.length < MIN_CONFIG_NAME_LENGTH || trimmedName.length > MAX_CONFIG_NAME_LENGTH) {
    return {
      valid: false,
      error: `Configuration name must be between ${MIN_CONFIG_NAME_LENGTH} and ${MAX_CONFIG_NAME_LENGTH} characters`
    };
  }

  // Check for alphanumeric and spaces only
  const validNamePattern = /^[a-zA-Z0-9\s]+$/;
  if (!validNamePattern.test(trimmedName)) {
    return {
      valid: false,
      error: 'Configuration name must contain only letters, numbers, and spaces'
    };
  }

  return {
    valid: true
  };
}

/**
 * Checks if value is a positive integer
 * 
 * @private
 * @param {*} value - Value to check
 * @returns {boolean} True if positive integer
 */
function isPositiveInteger(value) {
  return typeof value === 'number' && 
         Number.isInteger(value) && 
         value > 0;
}

/**
 * Creates new metadata object for configuration
 * 
 * @private
 * @returns {Object} Metadata object
 */
function createNewMetadata() {
  const now = new Date().toISOString();
  return {
    createdDate: now,
    lastUsedDate: now,
    usageCount: 0,
    createdBy: Session.getActiveUser().getEmail()
  };
}

/**
 * Updates the configuration list in PropertiesService
 * 
 * @private
 * @param {string} name - Configuration name
 * @param {string} action - 'add' or 'remove'
 */
function updateConfigurationList(name, action) {
  try {
    const props = PropertiesService.getUserProperties();
    const listJson = props.getProperty(CONFIG_LIST_KEY);
    
    let configList = [];
    if (listJson) {
      try {
        configList = JSON.parse(listJson);
      } catch (e) {
        logWarning('updateConfigurationList', 'Could not parse config list, creating new', { error: e.toString() });
        configList = [];
      }
    }

    if (action === 'add') {
      // Add to list if not already present
      if (!configList.includes(name)) {
        configList.push(name);
      }
    } else if (action === 'remove') {
      // Remove from list
      configList = configList.filter(n => n !== name);
    }

    // Save updated list
    props.setProperty(CONFIG_LIST_KEY, JSON.stringify(configList));

  } catch (error) {
    logError('updateConfigurationList', error, { name: name, action: action });
  }
}