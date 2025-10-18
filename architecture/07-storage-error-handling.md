# Storage Strategy and Error Handling

## Storage Architecture

### Overview

The Excel Data Merge Tool uses a multi-tier storage strategy leveraging Google Apps Script's built-in services.

### Storage Tiers

```
┌─────────────────────────────────────────────────────────┐
│  Tier 1: Properties Service (Permanent Configuration)   │
│  • Merge configurations                                 │
│  • Column mappings (saved presets)                      │
│  • User preferences                                     │
│  • Match rule defaults                                  │
│  Limit: 9KB per property, 500KB total                   │
└─────────────────────────────────────────────────────────┘
           ↓ Persistent across sessions
┌─────────────────────────────────────────────────────────┐
│  Tier 2: Cache Service (Temporary Session Data)         │
│  • Parsed file data (during merge session)              │
│  • Match indexes (10 min TTL)                           │
│  • Progress state (for polling)                         │
│  • Session metadata                                     │
│  Limit: 100KB per key, 1MB total per cache              │
└─────────────────────────────────────────────────────────┘
           ↓ Session lifetime (10 minutes)
┌─────────────────────────────────────────────────────────┐
│  Tier 3: Google Sheets (Permanent Results)              │
│  • MERGED_DATA sheet (merge output)                     │
│  • MERGE_LOG sheet (audit trail)                        │
│  • UNMATCHED sheet (records needing attention)          │
│  Limit: 5M cells per sheet, 400K cells recommended      │
└─────────────────────────────────────────────────────────┘
           ↓ Permanent, versioned
┌─────────────────────────────────────────────────────────┐
│  Tier 4: Google Drive (Temporary Files)                 │
│  • Uploaded Excel files (temp)                          │
│  • Converted Google Sheets (temp)                       │
│  • Deleted after processing                             │
│  Limit: 15GB free tier, usage quota 1GB/day             │
└─────────────────────────────────────────────────────────┘
```

## Properties Service Storage

### Configuration Schema

```javascript
// Key: EXCEL_MERGE_CONFIG
{
  "version": "1",
  "columnMappings": {
    "salesLog": {
      "customerColumn": "B",
      "modelColumn": "C",
      "newFIColumn": "D",
      "newStockColumn": "E",
      "newTradeColumn": "F",
      "newSalespersonColumn": "G",
      "usedFIColumn": "J",
      "usedStockColumn": "L",
      "usedTradeColumn": "M",
      "usedSalespersonColumn": "N",
      "autoDetect": true,
      "lastDetected": "2025-01-15T10:30:00Z"
    },
    "cdkExport": {
      "stockNoColumn": "D",
      "stockTypeColumn": "J",
      "frontGPColumn": "K",
      "backGPColumn": "L",
      "totalGPColumn": "M",
      "contractDateColumn": "A",
      "customerColumn": "B",
      "modelColumn": "I",
      "vinColumn": "C",
      "dealNoColumn": "U",
      "autoDetect": true,
      "lastDetected": "2025-01-15T10:30:00Z"
    }
  },
  "matchingRules": {
    "caseSensitive": false,
    "trimWhitespace": true,
    "ignoreLeadingZeros": true,
    "enablePartialMatch": false,
    "partialMatchLength": 6,
    "autoApproveThreshold": 0.95,
    "reviewThreshold": 0.70,
    "useModelValidation": true,
    "useCustomerValidation": false,
    "maxCandidatesPerPhase": 5
  },
  "outputSettings": {
    "outputSheetName": "MERGED_DATA",
    "unmatchedSheetName": "UNMATCHED",
    "logSheetName": "MERGE_LOG",
    "includeUnmatched": true,
    "highlightMatches": true,
    "includeCDKDate": true,
    "includeDealNumber": false,
    "createSummary": true,
    "preserveFormatting": true
  },
  "uiPreferences": {
    "showAdvancedOptions": false,
    "defaultExpandReview": true,
    "autoOpenOutput": true,
    "confirmBeforeMerge": true
  },
  "lastModified": "2025-01-15T10:30:00Z",
  "modifiedBy": "user@example.com"
}

// Key: EXCEL_MERGE_PRESETS (saved column mappings)
{
  "default_sales_log": { /* column mapping */ },
  "default_cdk_export": { /* column mapping */ },
  "custom_preset_1": { /* user-saved mapping */ }
}

// Key: EXCEL_MERGE_STATS (usage statistics)
{
  "totalMerges": 15,
  "lastMergeDate": "2025-01-15T10:30:00Z",
  "avgMatchRate": 0.96,
  "avgProcessingTime": 18.5,
  "commonErrors": {
    "low_match_rate": 2,
    "file_format_error": 1
  }
}
```

### CRUD Operations

```javascript
/**
 * Gets merge configuration from Properties Service
 * Uses caching for performance
 */
function getMergeConfiguration() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('merge_config_cache');
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  const props = PropertiesService.getDocumentProperties();
  const configJson = props.getProperty('EXCEL_MERGE_CONFIG');
  
  if (configJson) {
    const config = JSON.parse(configJson);
    cache.put('merge_config_cache', configJson, 600);
    return config;
  }
  
  // Return defaults
  return getDefaultMergeConfig();
}

/**
 * Updates merge configuration
 * Validates before saving
 */
function updateMergeConfiguration(updates) {
  const lockResult = acquireScriptLockWithRetry();
  if (!lockResult.success) {
    throw new Error('Could not acquire lock: ' + lockResult.error);
  }
  
  try {
    const current = getMergeConfiguration();
    const updated = deepMerge(current, updates);
    
    // Validate
    const validation = validateMergeConfig(updated);
    if (!validation.valid) {
      throw new Error('Invalid configuration: ' + validation.errors.join(', '));
    }
    
    // Update metadata
    updated.lastModified = new Date().toISOString();
    updated.modifiedBy = Session.getActiveUser().getEmail();
    updated.version = String(parseInt(updated.version) + 1);
    
    // Save
    const props = PropertiesService.getDocumentProperties();
    props.setProperty('EXCEL_MERGE_CONFIG', JSON.stringify(updated));
    
    // Invalidate cache
    CacheService.getScriptCache().remove('merge_config_cache');
    
    return updated;
  } finally {
    lockResult.lock.releaseLock();
  }
}
```

## Cache Service Storage

### Session Data Structure

```javascript
// Cache key pattern: merge_{dataType}_{sessionId}
const CACHE_KEYS = {
  salesLogData: `merge_saleslog_${sessionId}`,
  cdkData: `merge_cdk_${sessionId}`,
  matchIndexes: `merge_indexes_${sessionId}`,
  matchResults: `merge_results_${sessionId}`,
  progress: `merge_progress_${sessionId}`,
  sessionMeta: `merge_session_${sessionId}`
};

// Session metadata
{
  sessionId: "uuid-here",
  startTime: "2025-01-15T10:30:00Z",
  userId: "user@example.com",
  status: "matching", // idle, uploading, matching, reviewing, merging, complete
  salesLogFile: {
    fileName: "september.xlsx",
    rowCount: 250,
    uploadTime: "2025-01-15T10:30:15Z"
  },
  cdkFile: {
    fileName: "cdk_september.xlsx",
    rowCount: 250,
    uploadTime: "2025-01-15T10:30:30Z"
  },
  lastActivity: "2025-01-15T10:35:00Z"
}
```

### Cache Management

```javascript
/**
 * Saves data to session cache with size checking
 * Automatically handles large data by chunking
 */
function cacheSessionData(sessionId, dataType, data) {
  const cache = CacheService.getUserCache();
  const key = `merge_${dataType}_${sessionId}`;
  const dataJson = JSON.stringify(data);
  
  // Check size (100KB limit per key)
  if (dataJson.length > 100000) {
    // Chunk large data
    const chunks = chunkData(dataJson, 95000); // Leave margin
    chunks.forEach((chunk, index) => {
      cache.put(`${key}_chunk_${index}`, chunk, 600);
    });
    // Store chunk metadata
    cache.put(`${key}_meta`, JSON.stringify({
      chunked: true,
      chunkCount: chunks.length,
      totalSize: dataJson.length
    }), 600);
  } else {
    // Store directly
    cache.put(key, dataJson, 600);
  }
}

/**
 * Retrieves data from session cache
 * Handles chunked data automatically
 */
function getCachedSessionData(sessionId, dataType) {
  const cache = CacheService.getUserCache();
  const key = `merge_${dataType}_${sessionId}`;
  
  // Check for chunk metadata
  const metaJson = cache.get(`${key}_meta`);
  if (metaJson) {
    const meta = JSON.parse(metaJson);
    if (meta.chunked) {
      // Reconstruct from chunks
      let reconstructed = '';
      for (let i = 0; i < meta.chunkCount; i++) {
        const chunk = cache.get(`${key}_chunk_${i}`);
        if (!chunk) {
          throw new Error(`Missing chunk ${i} of ${meta.chunkCount}`);
        }
        reconstructed += chunk;
      }
      return JSON.parse(reconstructed);
    }
  }
  
  // Regular retrieval
  const dataJson = cache.get(key);
  return dataJson ? JSON.parse(dataJson) : null;
}

/**
 * Cleans up session cache
 */
function cleanupSessionCache(sessionId) {
  const cache = CacheService.getUserCache();
  const keys = [
    `merge_saleslog_${sessionId}`,
    `merge_cdk_${sessionId}`,
    `merge_indexes_${sessionId}`,
    `merge_results_${sessionId}`,
    `merge_progress_${sessionId}`,
    `merge_session_${sessionId}`
  ];
  
  keys.forEach(key => {
    cache.remove(key);
    // Also remove any chunks
    for (let i = 0; i < 10; i++) {
      cache.remove(`${key}_chunk_${i}`);
    }
    cache.remove(`${key}_meta`);
  });
}
```

## Sheet Storage Design

### MERGED_DATA Sheet Structure

**Columns** (A-T):

| Col | Name | Source | Type | Description |
|-----|------|--------|------|-------------|
| A | # | Generated | Number | Sequential row number |
| B | Customer | Sales Log | Text | Customer last name |
| C | Model | Sales Log | Text | Vehicle model |
| D | FI (New) | Sales Log | Text | F&I flag (A-Z or blank) |
| E | Stock # (New) | Sales Log | Text | Stock number for new vehicle |
| F | Trade (New) | Sales Log | Text | Trade stock number |
| G | Salesperson (New) | Sales Log | Text | Salesperson name/code |
| H-I | (blank) | - | - | Spacing columns |
| J | FI (Used) | Sales Log | Text | F&I flag (A-Z or blank) |
| K | (blank) | - | - | Spacing column |
| L | Stock # (Used) | Sales Log | Text | Stock number for used vehicle |
| M | Trade (Used) | Sales Log | Text | Trade stock number |
| N | Salesperson (Used) | Sales Log | Text | Salesperson name/code |
| O | Front GP$ | CDK | Currency | Front gross profit |
| P | Back GP$ | CDK | Currency | Back gross profit |
| Q | Total GP$ | CDK | Currency | Total gross profit |
| R | Match Type | Generated | Text | exact/numeric/partial/unmatched |
| S | Matched Stock | CDK | Text | Stock number from CDK |
| T | CDK Date | CDK | Date | Contract date from CDK |

**Format Specifications**:
- Row 1: Headers (bold, centered, blue background)
- Row 2+: Data rows
- Currency columns: Number format with $ and 2 decimals
- Date column: Short date format (M/D/YYYY)
- Borders: Solid black, all cells

### MERGE_LOG Sheet Structure

**Columns** (A-J):

| Col | Name | Type | Description |
|-----|------|------|-------------|
| A | Timestamp | DateTime | When merge occurred |
| B | User | Text | Who performed merge |
| C | Sales Log File | Text | Original filename |
| D | CDK File | Text | Original filename |
| E | Records Processed | Number | Total sales log records |
| F | Matched | Number | Successfully matched |
| G | Unmatched | Number | Not matched |
| H | Match Rate | Percentage | Matched / Total |
| I | Processing Time | Number | Seconds |
| J | Status | Text | Success/Failed/Partial |

**Sample Entry**:
```
2025-01-15 10:35:00 | user@example.com | september.xlsx | cdk_sept.xlsx | 
250 | 247 | 3 | 98.8% | 23.4 | Success
```

### UNMATCHED Sheet Structure

Stores records that couldn't be matched for manual resolution:

**Columns** (A-H):

| Col | Name | Source | Description |
|-----|------|--------|-------------|
| A | Row # | Sales Log | Original row number |
| B | Stock Number | Sales Log | Stock number that failed to match |
| C | Customer | Sales Log | Customer name |
| D | Model | Sales Log | Vehicle model |
| E | Type | Sales Log | NEW or USED |
| F | Salesperson | Sales Log | Salesperson name |
| G | Reason | Generated | Why it didn't match |
| H | Suggestions | Generated | Possible fixes |

**Conditional Formatting**:
- Red background for "no match found"
- Yellow background for "duplicate stock number"
- Orange background for "corrupted stock number"

## Error Handling Strategy

### Error Classification

```javascript
const ERROR_TYPES = {
  // User errors (recoverable)
  USER_INPUT: {
    INVALID_FILE_TYPE: {
      severity: 'medium',
      recoverable: true,
      userMessage: 'Please upload an Excel (.xlsx, .xls) or CSV (.csv) file',
      technicalMessage: 'File type {type} not supported',
      suggestedAction: 'Select a different file'
    },
    FILE_TOO_LARGE: {
      severity: 'medium',
      recoverable: true,
      userMessage: 'File size exceeds 50MB limit',
      technicalMessage: 'File size: {size}MB, limit: 50MB',
      suggestedAction: 'Export as CSV or split the file'
    },
    MISSING_COLUMNS: {
      severity: 'high',
      recoverable: true,
      userMessage: 'Required columns not found in file',
      technicalMessage: 'Missing columns: {columns}',
      suggestedAction: 'Check column mapping or upload correct file'
    }
  },
  
  // Processing errors (may be recoverable)
  PROCESSING: {
    PARSE_ERROR: {
      severity: 'high',
      recoverable: true,
      userMessage: 'Could not read Excel file',
      technicalMessage: 'Excel parsing failed: {error}',
      suggestedAction: 'Try exporting as CSV instead'
    },
    MATCH_TIMEOUT: {
      severity: 'high',
      recoverable: true,
      userMessage: 'Matching process took too long',
      technicalMessage: 'Timeout after {seconds}s',
      suggestedAction: 'Reduce data size or try again later'
    },
    LOW_MATCH_RATE: {
      severity: 'medium',
      recoverable: true,
      userMessage: 'Very few records matched ({rate}%)',
      technicalMessage: 'Match rate below threshold: {rate}% < {threshold}%',
      suggestedAction: 'Verify files are from same time period'
    }
  },
  
  // System errors (generally not recoverable)
  SYSTEM: {
    QUOTA_EXCEEDED: {
      severity: 'critical',
      recoverable: false,
      userMessage: 'Daily quota exceeded. Please try again tomorrow.',
      technicalMessage: 'Drive API quota exceeded: {quota}',
      suggestedAction: 'Wait 24 hours for quota reset'
    },
    LOCK_TIMEOUT: {
      severity: 'high',
      recoverable: true,
      userMessage: 'Another operation is in progress',
      technicalMessage: 'Could not acquire lock after {attempts} attempts',
      suggestedAction: 'Wait a moment and try again'
    },
    SHEET_WRITE_ERROR: {
      severity: 'critical',
      recoverable: false,
      userMessage: 'Could not write results to sheet',
      technicalMessage: 'Sheet write failed: {error}',
      suggestedAction: 'Check sheet permissions'
    }
  }
};
```

### Error Handling Functions

```javascript
/**
 * Centralized error handler
 * Classifies error, logs it, and returns user-friendly response
 */
function handleMergeError(error, context) {
  // Classify error
  const classification = classifyError(error);
  
  // Log with full context
  logError('handleMergeError', error, {
    context: context,
    classification: classification,
    timestamp: new Date().toISOString()
  });
  
  // Log to MERGE_LOG sheet if context available
  if (context.sessionId) {
    logMergeOperationError(context.sessionId, error, classification);
  }
  
  // Return structured error response
  return {
    success: false,
    error: {
      type: classification.type,
      severity: classification.severity,
      userMessage: classification.userMessage,
      technicalMessage: classification.technicalMessage,
      suggestedAction: classification.suggestedAction,
      recoverable: classification.recoverable,
      errorCode: classification.code,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Classifies error into predefined categories
 */
function classifyError(error) {
  const message = error.message || error.toString();
  
  // Check against known error patterns
  if (message.includes('file type') || message.includes('format')) {
    return ERROR_TYPES.USER_INPUT.INVALID_FILE_TYPE;
  }
  
  if (message.includes('size') || message.includes('50MB')) {
    return ERROR_TYPES.USER_INPUT.FILE_TOO_LARGE;
  }
  
  if (message.includes('column') || message.includes('not found')) {
    return ERROR_TYPES.USER_INPUT.MISSING_COLUMNS;
  }
  
  if (message.includes('parse') || message.includes('Excel')) {
    return ERROR_TYPES.PROCESSING.PARSE_ERROR;
  }
  
  if (message.includes('timeout') || message.includes('time limit')) {
    return ERROR_TYPES.PROCESSING.MATCH_TIMEOUT;
  }
  
  if (message.includes('quota')) {
    return ERROR_TYPES.SYSTEM.QUOTA_EXCEEDED;
  }
  
  if (message.includes('lock')) {
    return ERROR_TYPES.SYSTEM.LOCK_TIMEOUT;
  }
  
  // Unknown error
  return {
    severity: 'high',
    recoverable: false,
    userMessage: 'An unexpected error occurred',
    technicalMessage: message,
    suggestedAction: 'Please try again or contact support',
    code: 'UNKNOWN_ERROR'
  };
}
```

### Validation Framework

```javascript
/**
 * Multi-level validation strategy
 */

// Level 1: Client-side (immediate feedback)
function validateFileClient(file) {
  const errors = [];
  
  // Check file type
  const validExtensions = ['.xlsx', '.xls', '.csv'];
  const extension = file.name.toLowerCase().match(/\.[^.]+$/);
  if (!extension || !validExtensions.includes(extension[0])) {
    errors.push({
      field: 'fileType',
      message: `Invalid file type. Expected: ${validExtensions.join(', ')}`
    });
  }
  
  // Check file size
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    errors.push({
      field: 'fileSize',
      message: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max: 50MB)`
    });
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// Level 2: Server-side file validation
function validateUploadedFile(fileData, fileName, fileType) {
  const errors = [];
  
  // Validate base64 encoding
  if (!fileData || !isValidBase64(fileData)) {
    errors.push('Invalid file data encoding');
  }
  
  // Validate file type matches content
  const detectedType = detectFileType(fileData);
  const expectedTypes = ['xlsx', 'xls', 'csv'];
  if (!expectedTypes.includes(detectedType)) {
    errors.push(`File content doesn't match extension. Detected: ${detectedType}`);
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
    detectedType: detectedType
  };
}

// Level 3: Data structure validation
function validateFileStructure(parsedData, fileType) {
  const errors = [];
  const warnings = [];
  
  // Check minimum data
  if (!parsedData || parsedData.length === 0) {
    errors.push('File contains no data');
    return { valid: false, errors, warnings };
  }
  
  // Check header row
  const headers = parsedData[0];
  if (!headers || headers.length === 0) {
    errors.push('No column headers found');
    return { valid: false, errors, warnings };
  }
  
  // Check for required columns based on file type
  const requiredColumns = getRequiredColumns(fileType);
  const missingColumns = requiredColumns.filter(col => 
    !headers.some(h => normalizeColumnName(h) === normalizeColumnName(col))
  );
  
  if (missingColumns.length > 0) {
    errors.push(`Missing required columns: ${missingColumns.join(', ')}`);
  }
  
  // Check data rows
  const dataRows = parsedData.slice(1);
  if (dataRows.length === 0) {
    errors.push('File has headers but no data rows');
  }
  
  // Check for excessive blank rows
  const blankRows = dataRows.filter(row => 
    row.every(cell => !cell || cell.toString().trim() === '')
  );
  
  if (blankRows.length > dataRows.length * 0.5) {
    warnings.push(`File contains ${blankRows.length} blank rows (${Math.round(blankRows.length/dataRows.length*100)}%)`);
  }
  
  // Check for duplicate stock numbers (warning only)
  if (fileType === 'cdkExport') {
    const stockNumbers = new Set();
    const duplicates = [];
    
    dataRows.forEach((row, idx) => {
      const stock = row[3]; // Column D (stock number)
      if (stock && stock.toString().trim()) {
        if (stockNumbers.has(stock)) {
          duplicates.push({ row: idx + 2, stock: stock });
        }
        stockNumbers.add(stock);
      }
    });
    
    if (duplicates.length > 0) {
      warnings.push(`Found ${duplicates.length} duplicate stock numbers in CDK data`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    stats: {
      headerCount: headers.length,
      dataRowCount: dataRows.length,
      blankRowCount: blankRows.length
    }
  };
}

// Level 4: Data integrity validation
function validateDataIntegrity(salesLogData, cdkData) {
  const issues = [];
  
  // Check for stock number coverage
  const salesStocks = extractStockNumbers(salesLogData);
  const cdkStocks = new Set(cdkData.map(r => r.stockNo));
  
  const coverageRate = salesStocks.filter(s => cdkStocks.has(s)).length / 
                       salesStocks.length;
  
  if (coverageRate < 0.5) {
    issues.push({
      severity: 'high',
      message: `Low stock number coverage: ${Math.round(coverageRate * 100)}%`,
      suggestion: 'Verify CDK export contains data for same time period'
    });
  }
  
  // Check for data type consistency
  const gpValues = cdkData
    .map(r => r.totalGP)
    .filter(gp => gp !== undefined && gp !== null);
  
  const invalidGP = gpValues.filter(gp => 
    typeof gp !== 'number' || isNaN(gp)
  );
  
  if (invalidGP.length > 0) {
    issues.push({
      severity: 'medium',
      message: `${invalidGP.length} records have invalid GP values`,
      suggestion: 'These records will be flagged in output'
    });
  }
  
  return {
    valid: issues.filter(i => i.severity === 'high').length === 0,
    issues: issues
  };
}
```

### Checkpoint System

```javascript
/**
 * Checkpoint system for long-running operations
 * Allows resume on timeout or failure
 */

const CHECKPOINT_KEY_PREFIX = 'MERGE_CHECKPOINT_';

/**
 * Creates operation checkpoint
 */
function createMergeCheckpoint(sessionId, state) {
  try {
    const checkpoint = {
      sessionId: sessionId,
      timestamp: new Date().toISOString(),
      state: state,
      phase: state.currentPhase,
      progress: {
        total: state.totalRecords,
        processed: state.processedRecords,
        percentage: Math.round((state.processedRecords / state.totalRecords) * 100)
      },
      partialResults: state.results,
      resumeFrom: state.processedRecords
    };
    
    // Save to Properties (more reliable than cache for recovery)
    const props = PropertiesService.getDocumentProperties();
    props.setProperty(
      CHECKPOINT_KEY_PREFIX + sessionId,
      JSON.stringify(checkpoint)
    );
    
    Logger.log(`Checkpoint created: ${state.processedRecords}/${state.totalRecords}`);
    return true;
  } catch (e) {
    logWarning('createMergeCheckpoint', 'Checkpoint creation failed', { error: e.toString() });
    return false; // Non-fatal
  }
}

/**
 * Retrieves checkpoint for session
 */
function getMergeCheckpoint(sessionId) {
  try {
    const props = PropertiesService.getDocumentProperties();
    const checkpointJson = props.getProperty(CHECKPOINT_KEY_PREFIX + sessionId);
    
    if (!checkpointJson) {
      return null;
    }
    
    const checkpoint = JSON.parse(checkpointJson);
    
    // Check if checkpoint is too old (>1 hour)
    const age = Date.now() - new Date(checkpoint.timestamp).getTime();
    if (age > 3600000) {
      Logger.log('Checkpoint too old, discarding');
      clearMergeCheckpoint(sessionId);
      return null;
    }
    
    return checkpoint;
  } catch (e) {
    logWarning('getMergeCheckpoint', 'Error retrieving checkpoint', { error: e.toString() });
    return null;
  }
}

/**
 * Resumes from checkpoint
 */
function resumeFromCheckpoint(sessionId) {
  const checkpoint = getMergeCheckpoint(sessionId);
  
  if (!checkpoint) {
    return {
      success: false,
      error: 'No valid checkpoint found'
    };
  }
  
  try {
    // Resume operation from saved state
    Logger.log(`Resuming from checkpoint: ${checkpoint.progress.percentage}% complete`);
    
    // Continue processing from resumeFrom index
    const result = continueMatching(
      checkpoint.sessionId,
      checkpoint.resumeFrom,
      checkpoint.partialResults
    );
    
    // Clear checkpoint on success
    if (result.success) {
      clearMergeCheckpoint(sessionId);
    }
    
    return result;
  } catch (e) {
    logError('resumeFromCheckpoint', e, { sessionId });
    return {
      success: false,
      error: 'Resume failed: ' + e.message
    };
  }
}

/**
 * Clears checkpoint
 */
function clearMergeCheckpoint(sessionId) {
  try {
    const props = PropertiesService.getDocumentProperties();
    props.deleteProperty(CHECKPOINT_KEY_PREFIX + sessionId);
  } catch (e) {
    logWarning('clearMergeCheckpoint', 'Error clearing checkpoint', { error: e.toString() });
  }
}
```

### Error Recovery Strategies

```javascript
/**
 * Determines recovery strategy based on error type
 */
function getRecoveryStrategy(error, context) {
  const classification = classifyError(error);
  
  switch (classification.code) {
    case 'INVALID_FILE_TYPE':
    case 'FILE_TOO_LARGE':
      return {
        action: 'RETRY_WITH_DIFFERENT_FILE',
        message: classification.userMessage,
        suggestions: [
          'Try exporting as CSV format',
          'Reduce file size by removing extra data',
          'Split into multiple smaller files'
        ]
      };
    
    case 'MISSING_COLUMNS':
      return {
        action: 'ADJUST_COLUMN_MAPPING',
        message: classification.userMessage,
        suggestions: [
          'Verify column mapping configuration',
          'Check if file structure changed',
          'Use manual column selection'
        ]
      };
    
    case 'PARSE_ERROR':
      return {
        action: 'RETRY_WITH_CSV',
        message: 'Excel file appears corrupted. Try CSV export instead.',
        suggestions: [
          'Open file in Excel and export as CSV',
          'Try uploading from different location',
          'Check if file is password protected'
        ]
      };
    
    case 'MATCH_TIMEOUT':
      // Check if checkpoint exists
      const checkpoint = getMergeCheckpoint(context.sessionId);
      if (checkpoint) {
        return {
          action: 'RESUME_FROM_CHECKPOINT',
          message: 'Operation timed out but progress was saved.',
          suggestions: [
            `Resume from ${checkpoint.progress.percentage}% complete`,
            'Or start over with smaller dataset'
          ]
        };
      } else {
        return {
          action: 'RETRY',
          message: 'Operation timed out. Try again with smaller dataset.',
          suggestions: [
            'Reduce number of records',
            'Try during off-peak hours'
          ]
        };
      }
    
    case 'LOW_MATCH_RATE':
      return {
        action: 'ADJUST_SETTINGS',
        message: classification.userMessage,
        suggestions: [
          'Enable partial matching',
          'Verify files are from same month',
          'Check column mappings',
          'Continue anyway (you can review unmatched later)'
        ]
      };
    
    case 'QUOTA_EXCEEDED':
      return {
        action: 'WAIT',
        message: classification.userMessage,
        suggestions: [
          'Quotas reset at midnight Pacific Time',
          'Alternatively, export files as CSV (no quota usage)',
          'Contact administrator to upgrade to Google Workspace'
        ]
      };
    
    default:
      return {
        action: 'LOG_AND_REPORT',
        message: 'An unexpected error occurred',
        suggestions: [
          'Try again in a few minutes',
          'Check error log for details',
          'Contact support if problem persists'
        ]
      };
  }
}
```

### Atomic Operations

Ensure data integrity with atomic merge operations:

```javascript
/**
 * Executes merge as atomic operation
 * Either all data is written or none
 */
function executeMergeAtomic(mergedData, metadata) {
  const lockResult = acquireScriptLockWithRetry();
  if (!lockResult.success) {
    throw new Error('Could not acquire lock');
  }
  
  try {
    // Phase 1: Validate everything first
    const validation = validateMergedData(mergedData);
    if (!validation.valid) {
      throw new Error('Data validation failed: ' + validation.errors.join(', '));
    }
    
    // Phase 2: Prepare sheet (but don't write yet)
    const sheet = getOrCreateMergedDataSheet();
    const backupData = backupCurrentData(sheet); // Save for rollback
    
    // Phase 3: Write all data in single transaction
    try {
      clearMergedDataSheet(sheet);
      writeHeaders(sheet, MERGED_DATA_HEADERS);
      writeBatchData(sheet, mergedData, 2); // Start at row 2
      applyFormatting(sheet);
      SpreadsheetApp.flush(); // Commit all changes
      
      // Phase 4: Update audit log
      logMergeOperation(metadata);
      
      // Success - clear backup
      clearBackup(backupData.backupId);
      
      return {
        success: true,
        sheetName: sheet.getName(),
        recordCount: mergedData.length
      };
      
    } catch (writeError) {
      // Rollback on write failure
      logError('executeMergeAtomic', writeError, { phase: 'write' });
      
      // Restore from backup
      if (backupData) {
        restoreFromBackup(sheet, backupData);
      }
      
      throw new Error('Write failed and rolled back: ' + writeError.message);
    }
    
  } finally {
    lockResult.lock.releaseLock();
  }
}

/**
 * Creates backup of current sheet data
 */
function backupCurrentData(sheet) {
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow > 0) {
      const data = sheet.getRange(1, 1, lastRow, sheet.getMaxColumns()).getValues();
      const backupId = Utilities.getUuid();
      
      // Store in cache temporarily
      const cache = CacheService.getScriptCache();
      cache.put(`backup_${backupId}`, JSON.stringify(data), 600);
      
      return {
        backupId: backupId,
        rowCount: lastRow,
        timestamp: new Date().toISOString()
      };
    }
  } catch (e) {
    logWarning('backupCurrentData', 'Backup creation failed', { error: e.toString() });
  }
  
  return null;
}
```

## Data Retention Policy

### Temporary Data

**Cache Service**:
- TTL: 10 minutes (600 seconds)
- Auto-cleanup on expiration
- Manual cleanup on session end

**Temp Drive Files**:
- Deleted immediately after processing
- Cleanup job runs hourly to catch orphans
- Max age: 1 hour before force delete

### Permanent Data

**MERGED_DATA Sheet**:
- Overwritten on each new merge
- Previous version in Sheet history (Google Sheets versioning)
- Manual deletion by user if needed

**MERGE_LOG Sheet**:
- Append-only (never deleted)
- Recommended: Archive monthly to separate sheet
- Can trim old entries (>6 months) manually

**Configuration**:
- Permanent in Properties Service
- Updated on configuration changes
- Can export/import for backup

## Storage Optimization

### Compression for Large Data

```javascript
/**
 * Compresses data before caching
 * Uses simple string compression for Apps Script
 */
function compressForCache(data) {
  const json = JSON.stringify(data);
  
  // For very large data, use simple compression
  if (json.length > 50000) {
    // Replace repeated patterns
    const compressed = json
      .replace(/"stockNumber":/g, '"sn":')
      .replace(/"customer":/g, '"c":')
      .replace(/"model":/g, '"m":')
      .replace(/null/g, 'n')
      .replace(/false/g, 'f')
      .replace(/true/g, 't');
    
    return {
      compressed: true,
      data: compressed,
      originalSize: json.length,
      compressedSize: compressed.length,
      ratio: (compressed.length / json.length).toFixed(2)
    };
  }
  
  return {
    compressed: false,
    data: json
  };
}

/**
 * Decompresses cached data
 */
function decompressFromCache(cachedData) {
  if (!cachedData.compressed) {
    return JSON.parse(cachedData.data);
  }
  
  // Reverse compression
  const decompressed = cachedData.data
    .replace(/"sn":/g, '"stockNumber":')
    .replace(/"c":/g, '"customer":')
    .replace(/"m":/g, '"model":')
    .replace(/n/g, 'null')
    .replace(/f/g, 'false')
    .replace(/t/g, 'true');
  
  return JSON.parse(decompressed);
}
```

## Error Logging to Sheet

### MERGE_LOG Error Format

For failed operations:

```javascript
function logMergeOperationError(sessionId, error, classification) {
  try {
    const sheet = getOrCreateMergeLogSheet();
    const errorEntry = [
      new Date(),                           // Timestamp
      Session.getActiveUser().getEmail(),   // User
      sessionId,                            // Session ID
      'ERROR',                              // Status
      classification.code || 'UNKNOWN',     // Error code
      classification.userMessage,           // User message
      classification.technicalMessage,      // Technical details
      classification.suggestedAction,       // Suggested fix
      classification.recoverable ? 'Yes' : 'No', // Recoverable
      error.stack || 'N/A'                  // Stack trace
    ];
    
    sheet.appendRow(errorEntry);
    
    // Apply error formatting (red text)
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, 10)
      .setFontColor('#c62828')
      .setBackground('#ffebee');
    
  } catch (logError) {
    // Fallback to Logger if sheet write fails
    Logger.log('Failed to write error to MERGE_LOG: ' + logError.toString());
    Logger.log('Original error: ' + error.toString());
  }
}
```

## Summary

**Storage Strategy**:

| Data Type | Storage | Duration | Size Limit |
|-----------|---------|----------|------------|
| Configuration | Properties Service | Permanent | 9KB |
| Session data | Cache Service | 10 minutes | 100KB/key |
| Merge results | Google Sheets | Permanent | 5M cells |
| Temp files | Google Drive | <1 hour | 50MB |

**Error Handling Principles**:

1. **Fail Fast**: Validate early, before expensive operations
2. **Clear Messages**: Non-technical language with actionable fixes
3. **Graceful Degradation**: Continue with partial success when possible
4. **Audit Trail**: Log all errors for troubleshooting
5. **Recovery**: Checkpoints and rollback for reliability
6. **User Control**: Let users decide on ambiguous cases

**Validation Levels**:

1. **Client-side**: Immediate feedback (file type, size)
2. **Server upload**: Format verification
3. **Structure**: Column and data validation
4. **Integrity**: Cross-file consistency checks
5. **Pre-merge**: Final quality checks

**Key Features**:
- Multi-tier storage optimized for each data type
- Atomic merge operations with rollback capability
- Comprehensive checkpoint system for recovery
- Structured error classification and handling
- Clear user-facing error messages with solutions
- Complete audit trail in MERGE_LOG sheet