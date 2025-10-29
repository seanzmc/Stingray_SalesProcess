/**
 * Shared Validation Rules for Salesperson Data
 * Centralizes validation logic to ensure consistency across config_service.js and sync_service.js
 * 
 * All validation functions return error messages (string) if invalid, or null if valid
 */

// ============================================================================
// FIELD-SPECIFIC VALIDATORS
// ============================================================================

/**
 * Validates full name field
 * @param {string} fullName - Full name to validate
 * @returns {string|null} Error message or null if valid
 */
function validateName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return 'Full name is required';
  }
  
  const trimmed = fullName.trim();
  
  if (trimmed.length < 2) {
    return 'Full name must be at least 2 characters';
  }
  
  if (trimmed.length > 100) {
    return 'Full name must be less than 100 characters';
  }
  
  if (!/^[A-Za-z\s\-']+$/.test(trimmed)) {
    return 'Full name can only contain letters, spaces, hyphens, and apostrophes';
  }
  
  return null; // Valid
}

/**
 * Validates aliases field (optional)
 * @param {string} aliases - Aliases to validate (can be empty/null)
 * @returns {string|null} Error message or null if valid
 */
function validateAliases(aliases) {
  // Aliases are optional
  if (aliases === undefined || aliases === null || aliases === '') {
    return null; // Valid (empty is allowed)
  }
  
  const trimmed = String(aliases).trim();
  
  if (trimmed.length > 200) {
    return 'Aliases must be less than 200 characters';
  }
  
  // Aliases can contain letters, numbers, spaces, commas, hyphens, apostrophes
  if (!/^[A-Za-z0-9\s,\-']+$/.test(trimmed)) {
    return 'Aliases can only contain letters, numbers, spaces, commas, hyphens, and apostrophes';
  }
  
  return null; // Valid
}

/**
 * Validates display code field
 * @param {string} displayCode - Display code to validate
 * @returns {string|null} Error message or null if valid
 */
function validateDisplayCode(displayCode) {
  if (!displayCode || typeof displayCode !== 'string') {
    return 'Display code is required';
  }
  
  const trimmed = displayCode.trim();
  
  if (!/^[A-Za-z0-9]{2,4}$/.test(trimmed)) {
    return 'Display code must be 2-4 alphanumeric characters';
  }
  
  return null; // Valid
}
/**
 * Validates FI (Finance & Insurance) flag field
 * Accepts single uppercase letters (A-Z) or the special value "BD"
 * @param {string} fiFlag - FI flag to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidFIFlag(fiFlag) {
  if (!fiFlag || typeof fiFlag !== 'string') {
    return false;
  }
  
  const trimmed = fiFlag.trim().toUpperCase();
  
  // Accept single letters A-Z or special value "BD"
  return /^[A-Z]$/.test(trimmed) || trimmed === 'BD';
}


// ============================================================================
// COMBINED VALIDATOR
// ============================================================================

/**
 * Validates complete salesperson data object
 * Used by config_service.js for sidebar validation
 * 
 * @param {Object} data - Salesperson data {fullName, aliases, displayCode}
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
function validateSalesperson(data) {
  const errors = [];
  
  if (!data) {
    errors.push('Salesperson data is required');
    return errors;
  }
  
  // Validate full name
  const nameError = validateName(data.fullName);
  if (nameError) {
    errors.push(nameError);
  }
  
  // Validate aliases
  const aliasesError = validateAliases(data.aliases);
  if (aliasesError) {
    errors.push(aliasesError);
  }
  
  // Validate display code
  const displayCodeError = validateDisplayCode(data.displayCode);
  if (displayCodeError) {
    errors.push(displayCodeError);
  }
  
  return errors;
}

/**
 * Validates sheet row data with enhanced error context
 * Used by sync_service.js for sheet edit validation
 * 
 * @param {Array} rowData - [fullName, aliases, displayCode]
 * @returns {Object} {valid: boolean, errors: Array, isDelete: boolean}
 */
function validateSheetRowData(rowData) {
  const errors = [];
  const fullName = rowData[0] ? String(rowData[0]).trim() : '';
  const aliases = rowData[1] ? String(rowData[1]).trim() : '';
  const displayCode = rowData[2] ? String(rowData[2]).trim() : '';
  
  // Check if row is being deleted (all cells empty)
  if (!fullName && !aliases && !displayCode) {
    return {
      valid: true,
      isDelete: true,
      errors: []
    };
  }
  
  // Validate full name with column context
  const nameError = validateName(fullName);
  if (nameError) {
    errors.push({
      field: 'Full Name',
      message: nameError.replace('Full name ', '').replace('full name ', ''),
      value: fullName ? '"' + fullName + '"' : '(empty)',
      column: 'A'
    });
  }
  
  // Validate aliases with column context
  const aliasesError = validateAliases(aliases);
  if (aliasesError) {
    const value = aliases.length > 20 
      ? '"' + aliases.substring(0, 20) + '..." (' + aliases.length + ' chars)'
      : '"' + aliases + '"';
    errors.push({
      field: 'Aliases',
      message: aliasesError.replace('Aliases ', '').replace('aliases ', ''),
      value: value,
      column: 'B'
    });
  }
  
  // Validate display code with column context
  const displayCodeError = validateDisplayCode(displayCode);
  if (displayCodeError) {
    errors.push({
      field: 'Display Code',
      message: displayCodeError.replace('Display code ', '').replace('display code ', ''),
      value: displayCode ? '"' + displayCode + '"' : '(empty)',
      column: 'C'
    });
  }
  
  return {
    valid: errors.length === 0,
    isDelete: false,
    errors: errors
  };
}

// ============================================================================
// REGEX PATTERNS (EXPORTED FOR REFERENCE)
// ============================================================================

/**
 * Regex pattern for validating full names
 * Allows: letters, spaces, hyphens, apostrophes
 */
const FULLNAME_PATTERN = /^[A-Za-z\s\-']+$/;

/**
 * Regex pattern for validating aliases
 * Allows: letters, numbers, spaces, commas, hyphens, apostrophes
 */
const ALIASES_PATTERN = /^[A-Za-z0-9\s,\-']+$/;

/**
 * Regex pattern for validating display codes
 * Allows: 2-4 alphanumeric characters
 */
const DISPLAYCODE_PATTERN = /^[A-Za-z0-9]{2,4}$/;

// ============================================================================
// VALIDATION CONSTANTS
// ============================================================================

const VALIDATION_LIMITS = {
  FULLNAME_MIN_LENGTH: 2,
  FULLNAME_MAX_LENGTH: 100,
  ALIASES_MAX_LENGTH: 200,
  DISPLAYCODE_MIN_LENGTH: 2,
  DISPLAYCODE_MAX_LENGTH: 4
};

// ============================================================================
// ALIAS CONFLICT CHECKING
// ============================================================================

/**
 * Checks if aliases conflict with existing salespeople identifiers
 *
 * This function performs comprehensive conflict detection across three levels:
 * 1. Full Names: Aliases cannot match any salesperson's full name
 * 2. Display Codes: Aliases cannot match any salesperson's display code
 * 3. Existing Aliases: Aliases cannot duplicate aliases already assigned to other salespeople
 *
 * All comparisons are case-insensitive (converted to uppercase) to prevent
 * confusion and ensure consistent matching behavior.
 *
 * Used by both config_service.js (sidebar operations) and sync_service.js (sheet edits)
 * to maintain consistent alias validation across all data entry points.
 *
 * @param {string} aliasesStr - Comma-separated list of aliases to validate.
 *                               Can be empty/null (no aliases is valid).
 *                               Example: "JS, Johnny, John Smith"
 * @param {string|null} excludeFullName - Optional full name of salesperson to exclude
 *                                         from conflict checking. Used when updating an
 *                                         existing salesperson to prevent their own data
 *                                         from being flagged as a conflict.
 *                                         Pass null for new salesperson additions.
 *
 * @returns {string|null} Returns null if no conflicts found (valid).
 *                        Returns descriptive error message string if conflict detected:
 *                        - "Alias \"X\" conflicts with existing salesperson name"
 *                        - "Alias \"X\" conflicts with existing display code for Y"
 *                        - "Alias \"X\" is already used by Y"
 *
 * @example
 * // Check new aliases for a new salesperson (no exclusion)
 * const conflict = checkAliasConflict("JS, Johnny", null);
 * if (conflict) {
 *   console.log("Error: " + conflict);
 * }
 *
 * @example
 * // Check updated aliases for existing salesperson (exclude their current data)
 * const conflict = checkAliasConflict("JS, Johnny, John", "John Smith");
 * // Will not flag conflicts with "John Smith"'s own existing data
 */
function checkAliasConflict(aliasesStr, excludeFullName) {
  try {
    // Empty or null aliases are valid - nothing to check
    if (!aliasesStr || !aliasesStr.trim()) {
      return null;
    }
    
    // Parse and normalize aliases: split by comma, trim whitespace, convert to uppercase, remove empties
    const newAliases = aliasesStr.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
    
    // Get current configuration to access all salespeople
    const config = getConfiguration();
    const salespeople = config.salespeople || [];
    
    // Check each salesperson for conflicts with the new aliases
    for (const sp of salespeople) {
      // Skip the salesperson being updated (if excludeFullName is provided)
      // This prevents flagging their own data as a conflict
      if (excludeFullName && sp.fullName === excludeFullName) {
        continue;
      }
      
      // CONFLICT CHECK 1: Alias vs Full Name
      // Aliases cannot match any salesperson's full name
      if (newAliases.includes(sp.fullName.toUpperCase())) {
        return `Alias "${sp.fullName}" conflicts with existing salesperson name`;
      }
      
      // CONFLICT CHECK 2: Alias vs Display Code
      // Aliases cannot match any salesperson's display code
      if (newAliases.includes(sp.displayCode.toUpperCase())) {
        return `Alias "${sp.displayCode}" conflicts with existing display code for ${sp.fullName}`;
      }
      
      // CONFLICT CHECK 3: Alias vs Existing Aliases
      // Aliases cannot duplicate aliases already assigned to other salespeople
      const existingAliases = sp.aliases.split(',').map(a => a.trim().toUpperCase()).filter(a => a);
      for (const newAlias of newAliases) {
        if (existingAliases.includes(newAlias)) {
          return `Alias "${newAlias}" is already used by ${sp.fullName}`;
        }
      }
    }
    
    // No conflicts found - aliases are valid
    return null;
    
  } catch (error) {
    logError('checkAliasConflict', error, { aliases: aliasesStr });
    return `Error checking aliases: ${error.message}`;
  }
}