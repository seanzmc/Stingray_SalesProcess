# CDK Data Processing Refactoring Plan

## Transitioning from Hardcoded Column Indices to Dynamic Header Detection

**Document Version:** 1.0
**Date:** 2025-10-20
**Status:** Planning Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Dynamic Header Detection & Mapping](#dynamic-header-detection--mapping)
4. [Function Design](#function-design)
5. [Merge Logic Restructuring](#merge-logic-restructuring)
6. [Comparison Operations](#comparison-operations)
7. [Error Handling](#error-handling)
8. [Data Validation](#data-validation)
9. [Migration Strategy](#migration-strategy)
10. [Implementation Roadmap](#implementation-roadmap)
11. [Performance Implications](#performance-implications)
12. [User-Facing Changes](#user-facing-changes)
13. [Additional Considerations](#additional-considerations)

---

## Executive Summary

### Current Problem

The CDK data processing system in [`merge_controller.js:1021-1072`](saleslog_files/merge_controller.js:1021-1072) relies on hardcoded array indices to extract data from CDK exports:

```javascript
// Current implementation - INFLEXIBLE
const record = {
  rowNumber: i,
  contractDate: row[0] || null,
  customerLastName: row[1] || '',
  stockNo: row[3] || '',           // Hardcoded index
  model: row[8] || '',
  stockType: row[9] || '',
  frontGP: parseFloat(row[10]) || 0,  // Must be column 11
  backGP: parseFloat(row[11]) || 0,
  totalGP: parseFloat(row[12]) || 0,
  // ... more hardcoded indices
};
```

**Issues:**

- Requires exact column order from CDK exports
- Breaks when CDK changes export format
- No flexibility for different dealership configurations
- Manual mapping UI exists but is ignored during processing

### Proposed Solution

Implement a **dynamic header detection and mapping system** that:

1. Reads column headers from the CDK_DATA sheet
2. Intelligently maps headers to expected field names
3. Handles header variations (case, spacing, synonyms)
4. Falls back to [`data_headers.json`](data_headers.json) for reference
5. Maintains backward compatibility with existing downstream modules

### Success Criteria

- ✅ System processes CDK data regardless of column order
- ✅ Handles common header name variations automatically
- ✅ Clear error messages for missing required columns
- ✅ No changes needed in stock_matcher.js, data_merger.js, output_generator.js
- ✅ Performance impact < 5% for typical datasets

---

## Architecture Overview

### Current Data Flow

```
[CDK File Upload]
    ↓
[uploadCDKFile()] → Stores raw data in cache
    ↓
[startMergeProcess()] → Retrieves cached data
    ↓
[processCDKData()] → Extracts using HARDCODED indices
    ↓
[CDK Records Array] → {stockNo, frontGP, backGP, ...}
    ↓
[matchStockNumbers()] → Unchanged
    ↓
[mergeMatchedRecords()] → Unchanged
    ↓
[generateMergedOutput()] → Unchanged
```

### New Data Flow (Target Architecture)

```
[Manual Sheet Import]
User: File > Import > As New Sheet → "CDK_DATA"
    ↓
[readCDKDataSheet()] ← NEW FUNCTION
    ↓ Reads sheet data
    ↓
[detectColumnMapping()] ← NEW FUNCTION
    ↓ Builds header-to-index map
    ↓ Matches variations
    ↓ Falls back to data_headers.json
    ↓
[validateCDKHeaders()] ← NEW FUNCTION
    ↓ Ensures required columns exist
    ↓
[processCDKData()] ← MODIFIED
Uses columnMap instead of hardcoded indices
    ↓
[CDK Records Array] → SAME FORMAT
    ↓
[matchStockNumbers()] → NO CHANGES
    ↓
[mergeMatchedRecords()] → NO CHANGES
    ↓
[generateMergedOutput()] → NO CHANGES
```

### Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Sheets UI                          │
│  User imports CDK file → Creates "CDK_DATA" sheet            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Merge Controller (merge_controller.js)          │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  startMergeProcess()                                 │   │
│  │    1. Calls readCDKDataSheet()                      │   │
│  │    2. Calls detectColumnMapping()                   │   │
│  │    3. Calls validateCDKHeaders()                    │   │
│  │    4. Calls processCDKData(data, columnMap)         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  NEW: readCDKDataSheet()                            │   │
│  │    - Opens CDK_DATA sheet                           │   │
│  │    - Reads all data as 2D array                     │   │
│  │    - Returns {data, headers}                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  NEW: detectColumnMapping(headers, fallbackHeaders) │   │
│  │    - Normalizes header names                        │   │
│  │    - Matches to expected fields                     │   │
│  │    - Uses data_headers.json as reference            │   │
│  │    - Returns {fieldName: columnIndex}               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  NEW: validateCDKHeaders(columnMap)                 │   │
│  │    - Checks for required fields                     │   │
│  │    - Returns {valid, missing, warnings}             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  MODIFIED: processCDKData(cdkData, columnMap)       │   │
│  │    - Uses columnMap for extraction                  │   │
│  │    - row[columnMap.stockNo] instead of row[3]       │   │
│  │    - Produces SAME record format                    │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────┬───────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│            Existing Modules (NO CHANGES)                     │
│                                                               │
│  • stock_matcher.js   - Works with record objects           │
│  • data_merger.js     - Merges record objects               │
│  • output_generator.js - Writes record objects              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Configuration/Reference Data                    │
│                                                               │
│  • data_headers.json - Fallback header names                │
│  • config_manager.js - User preferences (future)            │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

1. **Separation of Concerns**: Header detection is separate from data processing
2. **Backward Compatibility**: Downstream modules remain unchanged
3. **Fail-Safe Design**: Multiple fallback strategies for header matching
4. **Minimal State**: Column mapping computed once per merge operation
5. **Clear Boundaries**: New functions have single, well-defined responsibilities

---

## Dynamic Header Detection & Mapping

### Step-by-Step Process

#### Phase 1: Header Extraction

```javascript
// Input: CDK_DATA sheet
// Output: Array of header strings

const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CDK_DATA');
const headerRow = 1; // Configurable
const lastCol = sheet.getLastColumn();
const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

// Result: ["Deal No.", "Customer", "VIN", "Stock No.", ...]
```

#### Phase 2: Header Normalization

```javascript
// Purpose: Convert headers to consistent format for comparison

function normalizeHeaderName(header) {
  if (!header) return '';

  return String(header)
    .trim()                    // Remove whitespace
    .toLowerCase()             // Case-insensitive
    .replace(/[^a-z0-9]/g, '') // Remove special chars
    .replace(/\s+/g, '');      // Remove internal spaces
}

// Examples:
// "Stock No."    → "stockno"
// "Front GP$"    → "frontgp"
// "CUSTOMER"     → "customer"
// "Deal No"      → "dealno"
```

#### Phase 3: Field Name Matching Algorithm

```javascript
// Priority-based matching system

function matchHeaderName(normalizedHeader, expectedFields) {
  // Priority 1: Exact match after normalization
  if (expectedFields.hasOwnProperty(normalizedHeader)) {
    return { field: normalizedHeader, confidence: 100 };
  }

  // Priority 2: Synonym matching
  const synonyms = {
    'stockno': ['stocknumber', 'stocknum', 'stock', 'stk'],
    'frontgp': ['frontgross', 'frontprofit', 'frontgp'],
    'backgp': ['backgross', 'backprofit', 'backgp', 'fni'],
    'totalgp': ['totalgross', 'totalprofit', 'gptotal', 'gp'],
    'customer': ['customername', 'buyer', 'purchaser'],
    'dealno': ['dealnumber', 'dealnum', 'deal'],
    'vin': ['vehiclevin', 'vinnumber'],
    'stocktype': ['type', 'vehicletype', 'newused'],
    'contractdate': ['saledate', 'solddate', 'date'],
    'financeins': ['lender', 'bank', 'financeinstitution', 'fi'],
    'salesperson': ['salesman', 'salesrep', 'rep', 'seller']
  };

  for (const [field, alts] of Object.entries(synonyms)) {
    if (alts.includes(normalizedHeader)) {
      return { field: field, confidence: 90 };
    }
  }

  // Priority 3: Partial match (contains)
  for (const field of Object.keys(expectedFields)) {
    if (normalizedHeader.includes(field) || field.includes(normalizedHeader)) {
      return { field: field, confidence: 75 };
    }
  }

  // Priority 4: Levenshtein distance (fuzzy match)
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const field of Object.keys(expectedFields)) {
    const distance = levenshteinDistance(normalizedHeader, field);
    if (distance < bestDistance && distance <= 3) { // Max 3 char difference
      bestDistance = distance;
      bestMatch = field;
    }
  }

  if (bestMatch) {
    const confidence = Math.max(50, 100 - (bestDistance * 15));
    return { field: bestMatch, confidence: confidence };
  }

  return null; // No match found
}
```

#### Phase 4: Building Column Map

```javascript
function detectColumnMapping(headers, fallbackHeaders) {
  // Expected field definitions from data_headers.json
  const expectedFields = {
    'dealno': { required: false, type: 'string' },
    'customer': { required: true, type: 'string' },
    'vin': { required: false, type: 'string' },
    'stockno': { required: true, type: 'string' },
    'status': { required: false, type: 'string' },
    'contractdate': { required: true, type: 'date' },
    'year': { required: false, type: 'number' },
    'model': { required: true, type: 'string' },
    'stocktype': { required: true, type: 'string' },
    'frontgp': { required: true, type: 'number' },
    'backgp': { required: true, type: 'number' },
    'totalgp': { required: true, type: 'number' },
    'cashprice': { required: false, type: 'number' },
    'trades': { required: false, type: 'number' },
    'servicecontract': { required: false, type: 'number' },
    'financeins': { required: false, type: 'string' },
    'salesperson': { required: false, type: 'string' },
    'fimanager': { required: false, type: 'string' },
    'term': { required: false, type: 'number' }
  };

  const columnMap = {};
  const unmatchedHeaders = [];
  const lowConfidenceMatches = [];

  // Try to match each header
  headers.forEach((header, index) => {
    const normalized = normalizeHeaderName(header);
    const match = matchHeaderName(normalized, expectedFields);

    if (match) {
      if (match.confidence >= 80) {
        columnMap[match.field] = index;
      } else if (match.confidence >= 60) {
        lowConfidenceMatches.push({
          header: header,
          field: match.field,
          index: index,
          confidence: match.confidence
        });
      }
    } else {
      unmatchedHeaders.push({ header: header, index: index });
    }
  });

  // Use fallback headers from data_headers.json for missing fields
  if (fallbackHeaders && fallbackHeaders.CDK_DATA) {
    const fallback = fallbackHeaders.CDK_DATA.HEADERS;

    for (const [field, definition] of Object.entries(expectedFields)) {
      if (!columnMap[field] && definition.required) {
        // Try to find by position in fallback
        const fallbackIndex = fallback.findIndex(h =>
          normalizeHeaderName(h) === field
        );
        if (fallbackIndex !== -1 && fallbackIndex < headers.length) {
          columnMap[field] = fallbackIndex;
        }
      }
    }
  }

  return {
    columnMap: columnMap,
    unmatchedHeaders: unmatchedHeaders,
    lowConfidenceMatches: lowConfidenceMatches,
    coverage: Object.keys(columnMap).length / Object.keys(expectedFields).length
  };
}
```

#### Phase 5: Fallback to data_headers.json

When headers can't be matched confidently:

```javascript
// Load reference headers from data_headers.json
function loadFallbackHeaders() {
  try {
    const json = DriveApp.getFilesByName('data_headers.json').next();
    const content = json.getBlob().getDataAsString();
    return JSON.parse(content);
  } catch (error) {
    logError('loadFallbackHeaders', error);

    // Hardcoded fallback if file not found
    return {
      CDK_DATA: {
        HEADERS: [
          "Deal No.", "Customer", "VIN", "Stock No.", "Status", "PLC",
          "Contract Date", "Sale Type", "Year", "Model", "StockType",
          "Front GP$", "Back GP$", "GP$", "Cash Price", "Trades",
          "Service Contract", "Finance Institution", "Salesperson",
          "FI Manager", "Term"
        ]
      }
    };
  }
}
```

### Handling Header Variations

Common variations the system must handle:

| Standard Field | Possible Variations |
|---------------|---------------------|
| `stockNo` | Stock No., Stock Number, Stock #, StockNum, STK# |
| `frontGP` | Front GP$, Front Gross, F/E Gross Profit, Front |
| `backGP` | Back GP$, Back Gross, F&I Gross, Back, FNI |
| `totalGP` | Total GP$, GP$, Total Gross, Gross Profit, GP |
| `stockType` | Stock Type, Type, New/Used, N/U, Vehicle Type |
| `customer` | Customer, Customer Name, Buyer, Last Name |
| `contractDate` | Contract Date, Sale Date, Sold Date, Date |
| `financeInstitution` | Finance Institution, FI, Lender, Bank |
| `salesperson` | Salesperson, Sales Rep, Salesman, Rep, Seller |

### Missing or Unexpected Columns

**Missing Required Columns:**

```javascript
// Block processing and provide clear error message
const missing = ['stockNo', 'frontGP', 'totalGP'];
throw new Error(
  `Cannot process CDK data: Missing required columns: ${missing.join(', ')}\n` +
  `Please ensure your CDK export includes these fields or manually map them.`
);
```

**Unexpected Columns:**

```javascript
// Log but continue processing
if (unmatchedHeaders.length > 0) {
  logWarning('detectColumnMapping', 'Unmatched headers found', {
    headers: unmatchedHeaders.map(h => h.header),
    message: 'These columns will be ignored during processing'
  });
}
```

---

## Function Design

### New Functions to Create

#### 1. `readCDKDataSheet()`

**Location:** [`merge_controller.js`](saleslog_files/merge_controller.js) (new function after line 1012)

**Purpose:** Reads CDK data from the manually imported CDK_DATA sheet

**Signature:**

```javascript
/**
 * Reads CDK data from the CDK_DATA sheet
 *
 * @returns {Object} {data: Array<Array>, headers: Array<string>, sheetName: string}
 * @throws {Error} If CDK_DATA sheet not found or empty
 */
function readCDKDataSheet()
```

**Implementation:**

```javascript
function readCDKDataSheet() {
  try {
    logInfo('readCDKDataSheet', 'Reading CDK_DATA sheet');

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('CDK_DATA');

    // Validate sheet exists
    if (!sheet) {
      throw new Error(
        'CDK_DATA sheet not found. Please import your CDK export file:\n' +
        '1. Go to File > Import\n' +
        '2. Upload your CDK export file\n' +
        '3. Choose "Insert new sheet(s)"\n' +
        '4. Rename the new sheet to "CDK_DATA"'
      );
    }

    // Get sheet dimensions
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow < 2) {
      throw new Error(
        'CDK_DATA sheet appears to be empty or has no data rows.\n' +
        'Please ensure the sheet contains header row and at least one data row.'
      );
    }

    if (lastCol < 10) {
      throw new Error(
        'CDK_DATA sheet has too few columns (found ' + lastCol + ').\n' +
        'Expected at least 10 columns for CDK data.'
      );
    }

    // Read all data including headers
    const allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();

    // Extract headers (first row)
    const headers = allData[0];

    // Validate headers are not empty
    const nonEmptyHeaders = headers.filter(h => h && String(h).trim());
    if (nonEmptyHeaders.length < 5) {
      throw new Error(
        'CDK_DATA sheet has insufficient column headers.\n' +
        'Found only ' + nonEmptyHeaders.length + ' non-empty headers, expected at least 5.'
      );
    }

    logInfo('readCDKDataSheet', 'Successfully read CDK_DATA sheet', {
      totalRows: lastRow,
      dataRows: lastRow - 1,
      columns: lastCol,
      nonEmptyHeaders: nonEmptyHeaders.length
    });

    return {
      data: allData,
      headers: headers,
      sheetName: 'CDK_DATA',
      rowCount: lastRow - 1, // Excluding header
      columnCount: lastCol
    };

  } catch (error) {
    logError('readCDKDataSheet', error);
    throw error;
  }
}
```

#### 2. `detectColumnMapping()`

**Location:** [`merge_controller.js`](saleslog_files/merge_controller.js) (new function after readCDKDataSheet)

**Purpose:** Builds a mapping of field names to column indices

**Signature:**

```javascript
/**
 * Detects column mapping from headers
 *
 * @param {Array<string>} headers - Column headers from CDK data
 * @param {Object} fallbackHeaders - Reference headers from data_headers.json
 * @returns {Object} {columnMap, unmatchedHeaders, lowConfidenceMatches, coverage}
 */
function detectColumnMapping(headers, fallbackHeaders)
```

**Implementation:** (See Dynamic Header Detection section above for full implementation)

#### 3. `matchHeaderName()`

**Location:** [`merge_controller.js`](saleslog_files/merge_controller.js) (new helper function)

**Purpose:** Matches a single header to expected field names using fuzzy logic

**Signature:**

```javascript
/**
 * Matches a normalized header to expected field names
 *
 * @param {string} normalizedHeader - Normalized header string
 * @param {Object} expectedFields - Map of expected field names
 * @returns {Object|null} {field: string, confidence: number} or null
 */
function matchHeaderName(normalizedHeader, expectedFields)
```

#### 4. `validateCDKHeaders()`

**Location:** [`merge_controller.js`](saleslog_files/merge_controller.js) (new function)

**Purpose:** Validates that all required columns are present in the mapping

**Signature:**

```javascript
/**
 * Validates CDK header mapping has required fields
 *
 * @param {Object} columnMap - Mapping of field names to column indices
 * @returns {Object} {valid: boolean, missing: Array, warnings: Array}
 */
function validateCDKHeaders(columnMap)
```

**Implementation:**

```javascript
function validateCDKHeaders(columnMap) {
  try {
    // Define required fields
    const requiredFields = [
      'stockno',
      'customer',
      'model',
      'stocktype',
      'frontgp',
      'backgp',
      'totalgp'
    ];

    // Define recommended fields
    const recommendedFields = [
      'contractdate',
      'vin',
      'year',
      'dealno',
      'salesperson'
    ];

    const missing = [];
    const warnings = [];

    // Check required fields
    for (const field of requiredFields) {
      if (columnMap[field] === undefined) {
        missing.push(field);
      }
    }

    // Check recommended fields
    for (const field of recommendedFields) {
      if (columnMap[field] === undefined) {
        warnings.push(`Recommended field '${field}' not found`);
      }
    }

    const result = {
      valid: missing.length === 0,
      missing: missing,
      warnings: warnings,
      foundCount: Object.keys(columnMap).length,
      requiredCount: requiredFields.length
    };

    if (!result.valid) {
      logError('validateCDKHeaders', 'Missing required fields', {
        missing: missing
      });
    } else if (warnings.length > 0) {
      logWarning('validateCDKHeaders', 'Missing recommended fields', {
        warnings: warnings
      });
    } else {
      logInfo('validateCDKHeaders', 'All headers validated successfully');
    }

    return result;

  } catch (error) {
    logError('validateCDKHeaders', error);
    return {
      valid: false,
      missing: [],
      warnings: [],
      error: error.message
    };
  }
}
```

### Functions to Modify

#### 1. `processCDKData()` - CRITICAL MODIFICATION

**Location:** [`merge_controller.js:1021-1072`](saleslog_files/merge_controller.js:1021-1072)

**Current Implementation:**

```javascript
function processCDKData(cdkData) {
  // ... validation ...

  for (let i = 1; i < cdkData.length; i++) {
    const row = cdkData[i];

    const record = {
      rowNumber: i,
      contractDate: row[0] || null,        // HARDCODED
      customerLastName: row[1] || '',       // HARDCODED
      stockNo: row[3] || '',                // HARDCODED
      model: row[8] || '',                  // HARDCODED
      stockType: row[9] || '',              // HARDCODED
      frontGP: parseFloat(row[10]) || 0,    // HARDCODED
      backGP: parseFloat(row[11]) || 0,     // HARDCODED
      totalGP: parseFloat(row[12]) || 0,    // HARDCODED
      // ... more hardcoded indices
    };
  }
}
```

**New Implementation:**

```javascript
/**
 * Processes CDK data array and extracts records using dynamic column mapping
 *
 * @param {Array} cdkData - 2D array of CDK data
 * @param {Object} columnMap - Mapping of field names to column indices
 * @returns {Array} Array of CDK record objects
 */
function processCDKData(cdkData, columnMap) {
  try {
    if (!Array.isArray(cdkData) || cdkData.length < 2) {
      throw new Error('Invalid CDK data format');
    }

    if (!columnMap || typeof columnMap !== 'object') {
      throw new Error('Column mapping is required');
    }

    const records = [];

    // Process data rows (skip header row)
    for (let i = 1; i < cdkData.length; i++) {
      const row = cdkData[i];

      // DYNAMIC extraction using columnMap
      const record = {
        rowNumber: i,
        contractDate: extractValue(row, columnMap.contractdate, null),
        customerLastName: extractValue(row, columnMap.customer, ''),
        stockNo: extractValue(row, columnMap.stockno, ''),
        model: extractValue(row, columnMap.model, ''),
        stockType: extractValue(row, columnMap.stocktype, ''),
        frontGP: extractNumericValue(row, columnMap.frontgp, 0),
        backGP: extractNumericValue(row, columnMap.backgp, 0),
        totalGP: extractNumericValue(row, columnMap.totalgp, 0),
        cashPrice: extractNumericValue(row, columnMap.cashprice, 0),
        trades: extractNumericValue(row, columnMap.trades, 0),
        serviceContract: extractNumericValue(row, columnMap.servicecontract, 0),
        vin: extractValue(row, columnMap.vin, ''),
        year: extractIntValue(row, columnMap.year, null),
        financeInstitution: extractValue(row, columnMap.financeins, ''),
        fiManager: extractValue(row, columnMap.fimanager, ''),
        term: extractIntValue(row, columnMap.term, null),
        dealNo: extractValue(row, columnMap.dealno, ''),
        salesperson: extractValue(row, columnMap.salesperson, '')
      };

      // Only include records with stock number
      if (record.stockNo) {
        records.push(record);
      }
    }

    logInfo('processCDKData', 'Extracted CDK records using dynamic mapping', {
      recordCount: records.length,
      mappedFields: Object.keys(columnMap).length
    });

    return records;

  } catch (error) {
    logError('processCDKData', error);
    throw error;
  }
}

/**
 * Helper: Safely extracts a value from row using column index
 */
function extractValue(row, columnIndex, defaultValue) {
  if (columnIndex === undefined || columnIndex === null) {
    return defaultValue;
  }
  const value = row[columnIndex];
  return (value !== null && value !== undefined && value !== '') ? value : defaultValue;
}

/**
 * Helper: Extracts and parses numeric value
 */
function extractNumericValue(row, columnIndex, defaultValue) {
  const value = extractValue(row, columnIndex, null);
  if (value === null) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Helper: Extracts and parses integer value
 */
function extractIntValue(row, columnIndex, defaultValue) {
  const value = extractValue(row, columnIndex, null);
  if (value === null) return defaultValue;
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}
```

#### 2. `uploadCDKFile()` - OPTIONAL MODIFICATION

**Location:** [`merge_controller.js:49-191`](saleslog_files/merge_controller.js:49-191)

**Decision:** Keep for backward compatibility but mark as deprecated

**Modification:**

```javascript
/**
 * @deprecated Use manual sheet import instead
 * Uploads and processes CDK file (LEGACY)
 *
 * NOTE: This function is maintained for backward compatibility.
 * New workflow: Import CDK file directly as "CDK_DATA" sheet.
 *
 * @param {string} fileData - Base64 encoded file data
 * @param {string} fileName - Original filename
 * @param {string} sessionId - Unique session identifier
 * @returns {Object} {success, fileId, preview, rowCount, error}
 */
function uploadCDKFile(fileData, fileName, sessionId) {
  // Existing implementation unchanged
  // But add deprecation warning to logs
  logWarning('uploadCDKFile',
    'Using deprecated upload workflow. Consider switching to direct sheet import.'
  );

  // ... rest of existing code ...
}
```

#### 3. `startMergeProcess()` - MAJOR MODIFICATION

**Location:** [`merge_controller.js:204-399`](saleslog_files/merge_controller.js:204-399)

**Changes Required:**

```javascript
function startMergeProcess(config) {
  // ... existing validation code ...

  // Step 2: Read CDK data - MODIFIED SECTION
  updateProgress(sessionId, 25, 'Reading CDK export data...', {});

  let cdkData;
  let columnMap;

  // NEW: Try to read from CDK_DATA sheet first
  try {
    const sheetData = readCDKDataSheet();
    cdkData = sheetData.data;

    // NEW: Load fallback headers
    const fallbackHeaders = loadFallbackHeaders();

    // NEW: Detect column mapping
    const mappingResult = detectColumnMapping(sheetData.headers, fallbackHeaders);

    // NEW: Validate headers
    const validation = validateCDKHeaders(mappingResult.columnMap);

    if (!validation.valid) {
      return {
        success: false,
        error: 'CDK data has missing required columns: ' +
               validation.missing.join(', ') + '\n\n' +
               'Please ensure your CDK export includes these fields.'
      };
    }

    columnMap = mappingResult.columnMap;

    // Log any warnings
    if (validation.warnings.length > 0) {
      logWarning('startMergeProcess', 'CDK header validation warnings', {
        warnings: validation.warnings
      });
    }

    logInfo('startMergeProcess', 'CDK sheet read and mapped successfully', {
      rowCount: sheetData.rowCount,
      mappedFields: Object.keys(columnMap).length,
      coverage: (mappingResult.coverage * 100).toFixed(1) + '%'
    });

  } catch (sheetError) {
    // FALLBACK: Try legacy cache method
    logWarning('startMergeProcess', 'Could not read CDK_DATA sheet, trying cache', {
      error: sheetError.message
    });

    cdkData = getCachedData(sessionId, 'cdkData');

    if (!cdkData || !Array.isArray(cdkData)) {
      return {
        success: false,
        error: 'CDK data not found. Please import CDK file as a sheet named "CDK_DATA" or upload via the tool.'
      };
    }

    // For legacy cached data, use default column mapping
    columnMap = getDefaultColumnMapping();
  }

  // Process CDK data with column mapping - MODIFIED CALL
  let cdkRecords;
  try {
    cdkRecords = processCDKData(cdkData, columnMap);
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

  // ... rest of existing merge logic unchanged ...
}

/**
 * Returns default column mapping for legacy cached data
 */
function getDefaultColumnMapping() {
  return {
    contractdate: 0,
    customer: 1,
    stockno: 3,
    model: 8,
    stocktype: 9,
    frontgp: 10,
    backgp: 11,
    totalgp: 12,
    cashprice: 13,
    trades: 14,
    servicecontract: 15,
    vin: 16,
    year: 17,
    financeins: 18,
    fimanager: 19,
    term: 20,
    dealno: 21,
    salesperson: 22
  };
}
```

### Functions to Preserve (No Changes)

The following modules work with record objects and require **NO CHANGES**:

1. **[`stock_matcher.js`](saleslog_files/stock_matcher.js)** - Works with record objects containing `stockNo` field
2. **[`data_merger.js`](saleslog_files/data_merger.js)** - Merges record objects, agnostic to extraction method
3. **[`output_generator.js`](saleslog_files/output_generator.js)** - Writes record objects to sheets
4. **[`config_manager.js`](saleslog_files/config_manager.js)** - Manages configurations (may be extended later)

---

## Merge Logic Restructuring

### Pattern Transformation

#### Before (Hardcoded)

```javascript
const record = {
  stockNo: row[3],
  frontGP: parseFloat(row[10]) || 0,
  backGP: parseFloat(row[11]) || 0
};
```

#### After (Dynamic)

```javascript
const record = {
  stockNo: extractValue(row, columnMap.stockno, ''),
  frontGP: extractNumericValue(row, columnMap.frontgp, 0),
  backGP: extractNumericValue(row, columnMap.backgp, 0)
};
```

### Complete Before/After Comparison

**Before - [`merge_controller.js:1021-1072`](saleslog_files/merge_controller.js:1021-1072):**

```javascript
function processCDKData(cdkData) {
  try {
    if (!Array.isArray(cdkData) || cdkData.length < 2) {
      throw new Error('Invalid CDK data format');
    }

    // Assume first row is headers (BUT NOT USED!)
    const headers = cdkData[0];
    const records = [];

    // Process data rows
    for (let i = 1; i < cdkData.length; i++) {
      const row = cdkData[i];

      const record = {
        rowNumber: i,
        contractDate: row[0] || null,           // Index 0
        customerLastName: row[1] || '',          // Index 1
        stockNo: row[3] || '',                   // Index 3
        model: row[8] || '',                     // Index 8
        stockType: row[9] || '',                 // Index 9
        frontGP: parseFloat(row[10]) || 0,       // Index 10
        backGP: parseFloat(row[11]) || 0,        // Index 11
        totalGP: parseFloat(row[12]) || 0,       // Index 12
        cashPrice: parseFloat(row[13]) || 0,     // Index 13
        trades: parseFloat(row[14]) || 0,        // Index 14
        serviceContract: parseFloat(row[15]) || 0, // Index 15
        vin: row[16] || '',                      // Index 16
        year: parseInt(row[17]) || null,         // Index 17
        financeInstitution: row[18] || '',       // Index 18
        fiManager: row[19] || '',                // Index 19
        term: parseInt(row[20]) || null,         // Index 20
        dealNo: row[21] || '',                   // Index 21
        salesperson: row[22] || ''               // Index 22
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
```

**After - With Dynamic Mapping:**

```javascript
function processCDKData(cdkData, columnMap) {
  try {
    if (!Array.isArray(cdkData) || cdkData.length < 2) {
      throw new Error('Invalid CDK data format');
    }

    if (!columnMap || typeof columnMap !== 'object') {
      throw new Error('Column mapping is required');
    }

    const records = [];

    // Process data rows (skip header row at index 0)
    for (let i = 1; i < cdkData.length; i++) {
      const row = cdkData[i];

      const record = {
        rowNumber: i,
        // Use helper functions for safe extraction
        contractDate: extractValue(row, columnMap.contractdate, null),
        customerLastName: extractValue(row, columnMap.customer, ''),
        stockNo: extractValue(row, columnMap.stockno, ''),
        model: extractValue(row, columnMap.model, ''),
        stockType: extractValue(row, columnMap.stocktype, ''),
        frontGP: extractNumericValue(row, columnMap.frontgp, 0),
        backGP: extractNumericValue(row, columnMap.backgp, 0),
        totalGP: extractNumericValue(row, columnMap.totalgp, 0),
        cashPrice: extractNumericValue(row, columnMap.cashprice, 0),
        trades: extractNumericValue(row, columnMap.trades, 0),
        serviceContract: extractNumericValue(row, columnMap.servicecontract, 0),
        vin: extractValue(row, columnMap.vin, ''),
        year: extractIntValue(row, columnMap.year, null),
        financeInstitution: extractValue(row, columnMap.financeins, ''),
        fiManager: extractValue(row, columnMap.fimanager, ''),
        term: extractIntValue(row, columnMap.term, null),
        dealNo: extractValue(row, columnMap.dealno, ''),
        salesperson: extractValue(row, columnMap.salesperson, '')
      };

      // Only include records with stock number
      if (record.stockNo) {
        records.push(record);
      }
    }

    logInfo('processCDKData', 'Extracted CDK records using dynamic mapping', {
      recordCount: records.length,
      mappedFields: Object.keys(columnMap).length
    });

    return records;

  } catch (error) {
    logError('processCDKData', error);
    throw error;
  }
}
```

### Output Record Format Consistency

**CRITICAL:** The output record format MUST remain identical for downstream compatibility:

```javascript
// Record object structure (UNCHANGED)
{
  rowNumber: number,
  contractDate: Date | null,
  customerLastName: string,
  stockNo: string,
  model: string,
  stockType: string,
  frontGP: number,
  backGP: number,
  totalGP: number,
  cashPrice: number,
  trades: number,
  serviceContract: number,
  vin: string,
  year: number | null,
  financeInstitution: string,
  fiManager: string,
  term: number | null,
  dealNo: string,
  salesperson: string
}
```

This ensures:

- [`stock_matcher.js`](saleslog_files/stock_matcher.js) continues to match on `record.stockNo`
- [`data_merger.js`](saleslog_files/data_merger.js) continues to access `record.frontGP`, `record.backGP`, etc.
- [`output_generator.js`](saleslog_files/output_generator.js) continues to write the same columns

---

## Comparison Operations

### Current Comparison Logic (Unchanged)

The comparison operations in [`stock_matcher.js`](saleslog_files/stock_matcher.js) work with normalized record objects and require **NO CHANGES**:

```javascript
// From stock_matcher.js:191-220
function performExactMatch(salesRecord, cdkRecord, config) {
  const salesStock = normalizeStockNumber(salesRecord.stockNumber);
  const cdkStock = normalizeStockNumber(cdkRecord.stockNo);  // Uses record.stockNo

  if (config.validateStockType) {
    const salesType = normalizeStockType(salesRecord.stockType);
    const cdkType = normalizeStockType(cdkRecord.stockType);  // Uses record.stockType
    // ...
  }
  // ...
}
```

### Why No Changes Are Needed

1. **Abstraction Layer:** Stock matcher works with record objects, not raw data
2. **Field Names Consistent:** Record objects have standardized field names
3. **Data Types Preserved:** Numbers remain numbers, strings remain strings
4. **Structure Unchanged:** Record object structure is identical

### Validation of Comparison Operations

After refactoring, existing comparison operations will continue to work because:

**Before refactoring:**

```javascript
// processCDKData produces:
{ stockNo: "N12345", stockType: "NEW", frontGP: 2500, ... }

// stock_matcher receives:
cdkRecord.stockNo → "N12345"
cdkRecord.stockType → "NEW"
```

**After refactoring:**

```javascript
// processCDKData STILL produces:
{ stockNo: "N12345", stockType: "NEW", frontGP: 2500, ... }

// stock_matcher STILL receives:
cdkRecord.stockNo → "N12345"
cdkRecord.stockType → "NEW"
```

The extraction method changed, but the output format did not.

---

## Error Handling

### Error Categories

#### 1. Sheet Not Found Errors

**Scenario:** CDK_DATA sheet doesn't exist

**Error Message:**

```
CDK_DATA sheet not found. Please import your CDK export file:
1. Go to File > Import
2. Upload your CDK export file
3. Choose "Insert new sheet(s)"
4. Rename the new sheet to "CDK_DATA"
```

**Handling:**

```javascript
try {
  const sheet = spreadsheet.getSheetByName('CDK_DATA');
  if (!sheet) {
    throw new Error('CDK_DATA sheet not found...');
  }
} catch (error) {
  return {
    success: false,
    error: error.message,
    recoverable: true,
    action: 'import_sheet'
  };
}
```

#### 2. Missing Required Columns

**Scenario:** Required headers not found in mapping

**Error Message:**

```
Cannot process CDK data: Missing required columns: stockNo, frontGP, totalGP

Please ensure your CDK export includes these fields:
- Stock Number (Stock No., Stock #, or similar)
- Front Gross Profit (Front GP$, Front Gross, or similar)
- Total Gross Profit (Total GP$, GP$, or similar)

If these fields exist with different names, please contact support for custom mapping.
```

**Handling:**

```javascript
const validation = validateCDKHeaders(columnMap);
if (!validation.valid) {
  const fieldDescriptions = {
    'stockno': 'Stock Number (Stock No., Stock #)',
    'frontgp': 'Front Gross Profit (Front GP$, Front Gross)',
    'backgp': 'Back Gross Profit (Back GP$, Back Gross)',
    'totalgp': 'Total Gross Profit (Total GP$, GP$)',
    'customer': 'Customer Name',
    'model': 'Vehicle Model',
    'stocktype': 'Stock Type (New/Used)'
  };

  const missingDescriptions = validation.missing.map(
    field => fieldDescriptions[field] || field
  );

  throw new Error(
    'Cannot process CDK data: Missing required columns: ' +
    validation.missing.join(', ') + '\n\n' +
    'Please ensure your CDK export includes:\n' +
    missingDescriptions.map(d => '- ' + d).join('\n') + '\n\n' +
    'If these fields exist with different names, contact support for custom mapping.'
  );
}
```

#### 3. Malformed Headers

**Scenario:** Headers are empty, contain only special characters, or are nonsensical

**Error Message:**

```
CDK_DATA sheet has invalid or empty column headers.
Found only 2 non-empty headers, expected at least 5.

Please check that:
- The first row contains column headers
- Headers have meaningful names
- The data starts on row 2
```

**Handling:**

```javascript
const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
const nonEmptyHeaders = headers.filter(h => h && String(h).trim());

if (nonEmptyHeaders.length < 5) {
  throw new Error(
    'CDK_DATA sheet has invalid or empty column headers.\n' +
    'Found only ' + nonEmptyHeaders.length + ' non-empty headers, expected at least 5.\n\n' +
    'Please check that:\n' +
    '- The first row contains column headers\n' +
    '- Headers have meaningful names\n' +
    '- The data starts on row 2'
  );
}
```

#### 4. Data Type Mismatches

**Scenario:** Numeric fields contain text, dates are invalid

**Error Message:**

```
Warning: Row 15 has invalid data in 'Front GP$' column.
Expected numeric value, found "N/A". Using default value 0.

5 similar warnings found during processing.
```

**Handling:**

```javascript
function extractNumericValue(row, columnIndex, defaultValue) {
  if (columnIndex === undefined) return defaultValue;

  const value = row[columnIndex];

  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = parseFloat(value);

  if (isNaN(parsed)) {
    logWarning('extractNumericValue', 'Invalid numeric value', {
      columnIndex: columnIndex,
      value: value,
      type: typeof value,
      usingDefault: defaultValue
    });
    return defaultValue;
  }

  return parsed;
}
```

#### 5. Empty or Invalid Sheet

**Scenario:** Sheet exists but has no data rows

**Error Message:**

```
CDK_DATA sheet appears to be empty or has no data rows.
Please ensure the sheet contains:
- Header row (row 1)
- At least one data row (row 2+)
```

**Handling:**

```javascript
const lastRow = sheet.getLastRow();
if (lastRow < 2) {
  throw new Error(
    'CDK_DATA sheet appears to be empty or has no data rows.\n' +
    'Please ensure the sheet contains:\n' +
    '- Header row (row 1)\n' +
    '- At least one data row (row 2+)'
  );
}
```

#### 6. Sheet Not Found Scenarios

**Scenario A:** User hasn't imported CDK data yet

```javascript
if (!sheet) {
  return {
    success: false,
    error: 'CDK_DATA sheet not found. Import your CDK export first.',
    action: 'IMPORT_REQUIRED',
    instructions: [
      'Go to File > Import',
      'Upload your CDK export file',
      'Choose "Insert new sheet(s)"',
      'Rename the sheet to "CDK_DATA"',
      'Return here and click Start Merge'
    ]
  };
}
```

**Scenario B:** Sheet renamed or deleted

```javascript
const allSheets = spreadsheet.getSheets();
const sheetNames = allSheets.map(s => s.getName());

if (!sheetNames.includes('CDK_DATA')) {
  return {
    success: false,
    error: 'CDK_DATA sheet not found.',
    availableSheets: sheetNames,
    suggestion: 'Did you mean one of these sheets? ' + sheetNames.join(', ')
  };
}
```

### Error Recovery Strategies

1. **Graceful Degradation:** Fall back to cached data if sheet read fails
2. **Partial Processing:** Process rows with valid data, log skipped rows
3. **User Guidance:** Provide actionable error messages with step-by-step fixes
4. **Detailed Logging:** Log all errors for debugging but show user-friendly messages

---

## Data Validation

### Minimum Required Columns

**Blocking Errors** (prevent processing):

- `stockno` - Required for matching
- `frontgp` - Required for financial analysis
- `backgp` - Required for financial analysis
- `totalgp` - Required for financial analysis
- `customer` - Required for record identification
- `model` - Required for record identification
- `stocktype` - Required for matching validation

**Warning Level** (allow processing with warnings):

- `contractdate` - Recommended for reporting
- `vin` - Recommended for verification
- `year` - Recommended for analysis
- `dealno` - Recommended for reference
- `salesperson` - Recommended for attribution
- `financeins` - Optional
- `fimanager` - Optional
- `term` - Optional
- `cashprice` - Optional
- `trades` - Optional
- `servicecontract` - Optional

### Data Type Validation

#### Numeric Fields

```javascript
function validateNumericField(value, fieldName, rowNumber) {
  if (value === null || value === undefined || value === '') {
    return { valid: true, value: 0, warning: null };
  }

  const parsed = parseFloat(value);

  if (isNaN(parsed)) {
    return {
      valid: false,
      value: 0,
      warning: `Row ${rowNumber}: Invalid ${fieldName} "${value}" - using 0`
    };
  }

  return { valid: true, value: parsed, warning: null };
}
```

#### Date Validation

```javascript
function validateDateField(value, fieldName, rowNumber) {
  if (!value) {
    return { valid: true, value: null, warning: null };
  }

  let dateObj;

  if (value instanceof Date) {
    dateObj = value;
  } else {
    dateObj = new Date(value);
  }

  if (isNaN(dateObj.getTime())) {
    return {
      valid: false,
      value: null,
      warning: `Row ${rowNumber}: Invalid ${fieldName} date "${value}"`
    };
  }

  // Check for reasonable date range (1990 - current + 1 year)
  const minDate = new Date('1990-01-01');
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1);

  if (dateObj < minDate || dateObj > maxDate) {
    return {
      valid: false,
      value: dateObj,
      warning: `Row ${rowNumber}: ${fieldName} date "${value}" outside reasonable range`
    };
  }

  return { valid: true, value: dateObj, warning: null };
}
```

### Format Validation

#### Stock Number Format

```javascript
function validateStockNumber(stockNo, rowNumber) {
  if (!stockNo || String(stockNo).trim() === '') {
    return {
      valid: false,
      error: `Row ${rowNumber}: Stock number is empty`
    };
  }

  const normalized = String(stockNo).trim();

  // Check for reasonable length (3-15 characters)
  if (normalized.length < 3 || normalized.length > 15) {
    return {
      valid: false,
      warning: `Row ${rowNumber}: Stock number "${stockNo}" has unusual length`
    };
  }

  return { valid: true };
}
```

#### Stock Type Validation

```javascript
function validateStockType(stockType, rowNumber) {
  if (!stockType) {
    return {
      valid: false,
      error: `Row ${rowNumber}: Stock type is missing`
    };
  }

  const normalized = String(stockType).trim().toUpperCase();
  const validTypes = ['NEW', 'USED', 'N', 'U'];

  if (!validTypes.includes(normalized)) {
    return {
      valid: false,
      warning: `Row ${rowNumber}: Unusual stock type "${stockType}" - expected NEW or USED`
    };
  }

  return { valid: true, normalized: normalized };
}
```

### Validation Report

```javascript
function generateValidationReport(validationResults) {
  const report = {
    totalRows: validationResults.length,
    validRows: 0,
    errorRows: 0,
    warningRows: 0,
    errors: [],
    warnings: [],
    summary: ''
  };

  validationResults.forEach(result => {
    if (result.errors && result.errors.length > 0) {
      report.errorRows++;
      report.errors.push(...result.errors);
    } else if (result.warnings && result.warnings.length > 0) {
      report.warningRows++;
      report.warnings.push(...result.warnings);
    } else {
      report.validRows++;
    }
  });

  report.summary =
    `Validation Results:\n` +
    `- Valid rows: ${report.validRows}\n` +
    `- Rows with warnings: ${report.warningRows}\n` +
    `- Rows with errors: ${report.errorRows}\n\n`;

  if (report.errorRows > 0) {
    report.summary += `Errors (first 5):\n`;
    report.errors.slice(0, 5).forEach(err => {
      report.summary += `  - ${err}\n`;
    });
  }

  if (report.warningRows > 0) {
    report.summary += `\nWarnings (first 5):\n`;
    report.warnings.slice(0, 5).forEach(warn => {
      report.summary += `  - ${warn}\n`;
    });
  }

  return report;
}
```

### Warning vs. Blocking Errors

**Blocking Errors** - Stop processing:

- Missing required columns (stockno, frontgp, backgp, totalgp)
- Sheet not found or empty
- Invalid data structure (not an array, wrong dimensions)
- All rows missing stock numbers

**Warnings** - Log but continue:

- Missing recommended columns (contractdate, vin, year)
- Invalid numeric values (use default 0)
- Invalid dates (use null)
- Unusual stock type values
- Out-of-range values (e.g., negative GP when positive expected)

---

## Migration Strategy

### Step-by-Step Migration

#### Phase 1: Preparation (Week 1)

**Actions:**

1. Backup current system
2. Create feature branch for refactoring
3. Document current behavior with test cases
4. Set up test environment with sample data

**Deliverables:**

- Backup of current [`merge_controller.js`](saleslog_files/merge_controller.js)
- Test data files (3-5 CDK exports with varying formats)
- Baseline performance metrics

#### Phase 2: Core Implementation (Week 2-3)

**Day 1-3: Helper Functions**

- Implement `normalizeHeaderName()`
- Implement `matchHeaderName()` with synonym matching
- Implement extraction helpers (`extractValue`, `extractNumericValue`, `extractIntValue`)
- Unit test each function

**Day 4-7: Sheet Reading**

- Implement `readCDKDataSheet()`
- Test with various sheet formats
- Add comprehensive error handling

**Day 8-10: Column Mapping**

- Implement `detectColumnMapping()`
- Test with test data files
- Validate coverage and accuracy

**Day 11-14: Validation**

- Implement `validateCDKHeaders()`
- Test required field detection
- Test warning generation

**Day 15-21: Integration**

- Modify `processCDKData()` to use column mapping
- Modify `startMergeProcess()` to call new functions
- Integration testing

#### Phase 3: Testing & Validation (Week 4)

**Unit Testing:**

- Test each new function independently
- Test helper functions with edge cases
- Test normalization with various header formats

**Integration Testing:**

- Test complete merge workflow
- Test with real CDK exports from multiple sources
- Test backward compatibility with cached data

**User Acceptance Testing:**

- Test with actual users
- Collect feedback on error messages
- Validate performance with large datasets

#### Phase 4: Deployment (Week 5)

**Soft Launch:**

- Deploy to test spreadsheet
- Monitor for 3-5 days
- Collect user feedback

**Full Deployment:**

- Deploy to production
- Update user documentation
- Provide training materials

**Monitoring:**

- Watch error logs for issues
- Track success rates
- Monitor performance metrics

### Backward Compatibility

**Strategy 1: Dual-Path Support**

```javascript
// Support both new (sheet) and old (cache) workflows
function startMergeProcess(config) {
  let cdkData, columnMap;

  // Try NEW workflow first
  try {
    const sheetData = readCDKDataSheet();
    cdkData = sheetData.data;
    columnMap = detectColumnMapping(sheetData.headers);
  } catch (sheetError) {
    // Fall back to OLD workflow
    cdkData = getCachedData(sessionId, 'cdkData');
    columnMap = getDefaultColumnMapping(); // Hardcoded indices
  }

  // Both paths converge here
  const cdkRecords = processCDKData(cdkData, columnMap);
  // ...
}
```

**Strategy 2: Configuration Flag**

```javascript
// Allow users to opt-in to new workflow
const config = {
  useDynamicMapping: true, // Feature flag
  // ...
};

if (config.useDynamicMapping) {
  // New workflow
} else {
  // Legacy workflow
}
```

**Strategy 3: Deprecation Timeline**

- **Month 1:** New feature available, old method still default
- **Month 2:** New feature becomes default, old method deprecated
- **Month 3:** Old method shows warning message
- **Month 4:** Old method removed (optional)

### Testing Strategy

#### Test Cases

**Test Case 1: Standard CDK Export**

```
Headers: Deal No., Customer, VIN, Stock No., ..., Front GP$, Back GP$, GP$
Expected: All fields mapped correctly, 100% coverage
```

**Test Case 2: Reordered Columns**

```
Headers: Customer, Stock No., Front GP$, Deal No., Back GP$, ...
Expected: Correct mapping despite different order
```

**Test Case 3: Header Variations**

```
Headers: Stock Number, Front Gross, Back Gross, Total GP, ...
Expected: Synonyms matched, 100% required field coverage
```

**Test Case 4: Missing Optional Columns**

```
Headers: Stock No., Customer, Model, Front GP, Back GP, Total GP
Expected: Process successfully with warnings
```

**Test Case 5: Missing Required Columns**

```
Headers: Stock No., Customer, Model, (no GP columns)
Expected: Blocking error with clear message
```

**Test Case 6: Empty Sheet**

```
Sheet: Headers only, no data rows
Expected: Error "sheet appears to be empty"
```

**Test Case 7: Sheet Not Found**

```
No CDK_DATA sheet exists
Expected: Error with import instructions
```

**Test Case 8: Legacy Cached Data**

```
No sheet, but cached data exists
Expected: Fall back to cached data with default mapping
```

### Rollback Plan

**Trigger Conditions for Rollback:**

- Critical bug affecting > 50% of merge operations
- Data corruption detected
- Performance degradation > 20%
- Multiple user reports of incorrect results

**Rollback Procedure:**

1. Switch feature flag to disable new workflow
2. Revert `processCDKData()` to original implementation
3. Restore backup of `merge_controller.js`
4. Notify users of temporary reversion
5. Investigate and fix issues
6. Prepare for re-deployment

**Quick Rollback Script:**

```javascript
// Emergency rollback - set this to true to disable new features
const ENABLE_DYNAMIC_MAPPING = false; // Set to true to re-enable
```

---

## Implementation Roadmap

### Phase 1: Core Header Detection and Mapping (Week 1-2, 40 hours)

**Objective:** Build foundational header detection system

**Tasks:**

1. **Helper Function Development** (8 hours)
   - File: [`merge_controller.js`](saleslog_files/merge_controller.js)
   - Lines: After line 1072
   - Functions:
     - `normalizeHeaderName(header)` - 2 hours
     - `levenshteinDistance(str1, str2)` - 2 hours
     - `extractValue(row, columnIndex, defaultValue)` - 1 hour
     - `extractNumericValue(row, columnIndex, defaultValue)` - 1 hour
     - `extractIntValue(row, columnIndex, defaultValue)` - 1 hour
   - Unit tests for each function - 1 hour

2. **Fallback Headers Loading** (4 hours)
   - Function: `loadFallbackHeaders()`
   - Load [`data_headers.json`](data_headers.json)
   - Hardcoded fallback if file missing
   - Error handling and logging

3. **Header Matching Algorithm** (12 hours)
   - Function: `matchHeaderName(normalizedHeader, expectedFields)`
   - Implement exact matching - 2 hours
   - Implement synonym matching - 4 hours
   - Implement partial matching - 2 hours
   - Implement fuzzy matching (Levenshtein) - 2 hours
   - Comprehensive test suite - 2 hours

4. **Column Mapping Builder** (12 hours)
   - Function: `detectColumnMapping(headers, fallbackHeaders)`
   - Iterate through headers and match - 4 hours
   - Handle low confidence matches - 2 hours
   - Fallback to data_headers.json - 2 hours
   - Calculate coverage metrics - 2 hours
   - Test with sample data - 2 hours

5. **Integration with Error Logger** (4 hours)
   - Ensure all new functions use logging
   - Add appropriate log levels (info, warning, error)
   - Test logging output

**Deliverables:**

- ✅ All helper functions implemented and tested
- ✅ Header matching achieving >90% accuracy on test data
- ✅ Comprehensive logging for debugging

**Success Metrics:**

- 100% of standard CDK headers matched correctly
- 95%+ of header variations matched correctly
- Unit tests pass for all helper functions

---

### Phase 2: Sheet Reading Integration (Week 3, 20 hours)

**Objective:** Enable reading CDK data directly from sheets

**Tasks:**

1. **Sheet Reader Function** (8 hours)
   - Function: `readCDKDataSheet()`
   - File: [`merge_controller.js`](saleslog_files/merge_controller.js)
   - Lines: After line 1012
   - Validate sheet exists - 2 hours
   - Read sheet data efficiently - 2 hours
   - Extract headers - 1 hour
   - Validate data structure - 2 hours
   - Error handling - 1 hour

2. **Header Validation Function** (6 hours)
   - Function: `validateCDKHeaders(columnMap)`
   - Check for required fields - 2 hours
   - Check for recommended fields - 1 hour
   - Generate warnings - 1 hour
   - Create user-friendly error messages - 2 hours

3. **Integration Testing** (6 hours)
   - Test with various sheet formats
   - Test error conditions
   - Validate error messages
   - Performance testing

**Deliverables:**

- ✅ CDK_DATA sheet successfully read
- ✅ Clear error messages for common issues
- ✅ Validation catches all required field absences

**Success Metrics:**

- Sheet reading completes in <2 seconds for typical files
- All error scenarios have clear, actionable messages
- Validation catches 100% of missing required fields

---

### Phase 3: processCDKData() Refactoring (Week 4, 24 hours)

**Objective:** Modify core data processing to use dynamic mapping

**Tasks:**

1. **Refactor processCDKData()** (12 hours)
   - File: [`merge_controller.js:1021-1072`](saleslog_files/merge_controller.js:1021-1072)
   - Add columnMap parameter - 1 hour
   - Replace all hardcoded indices - 4 hours
   - Use extraction helper functions - 2 hours
   - Maintain output format - 2 hours
   - Update logging - 1 hour
   - Test with various mappings - 2 hours

2. **Modify startMergeProcess()** (8 hours)
   - File: [`merge_controller.js:204-399`](saleslog_files/merge_controller.js:204-399)
   - Integrate readCDKDataSheet() - 2 hours
   - Integrate detectColumnMapping() - 2 hours
   - Integrate validateCDKHeaders() - 2 hours
   - Add fallback to cached data - 1 hour
   - Update progress messages - 1 hour

3. **Create getDefaultColumnMapping()** (2 hours)
   - Function for legacy support
   - Returns hardcoded index mapping
   - Documentation

4. **Integration Testing** (2 hours)
   - End-to-end merge workflow
   - Test with real data
   - Verify downstream modules unchanged

**Deliverables:**

- ✅ processCDKData() uses dynamic mapping
- ✅ Backward compatibility maintained
- ✅ No changes needed in downstream modules

**Success Metrics:**

- All existing test cases pass
- Output record format identical to before
- Stock matching still works correctly

---

### Phase 4: UI Updates and Documentation (Week 5, 16 hours)

**Objective:** Update user interface and documentation

**Tasks:**

1. **Update Merge Sidebar** (4 hours)
   - File: [`merge_sidebar.html`](saleslog_files/merge_sidebar.html)
   - Add instructions for sheet import
   - Update help text
   - Add troubleshooting tips

2. **Deprecate Upload UI** (2 hours)
   - Mark uploadCDKFile() as deprecated
   - Add deprecation notice in UI
   - Update tooltips

3. **Create User Documentation** (6 hours)
   - Write step-by-step import guide
   - Create troubleshooting section
   - Add FAQ for common issues
   - Create video tutorial script

4. **Update CDK_MERGE_TOOL_GUIDE.md** (4 hours)
   - File: [`CDK_MERGE_TOOL_GUIDE.md`](CDK_MERGE_TOOL_GUIDE.md)
   - Document new import workflow
   - Update screenshots
   - Add header variation table
   - Add error message reference

**Deliverables:**

- ✅ Updated user interface
- ✅ Comprehensive documentation
- ✅ Training materials

**Success Metrics:**

- Users can complete import without assistance
- <5% support requests for import process
- Documentation covers 95% of error scenarios

---

### Phase 5: Testing and Validation (Week 6, 20 hours)

**Objective:** Comprehensive testing and bug fixes

**Tasks:**

1. **Unit Testing** (6 hours)
   - Test all new functions
   - Test edge cases
   - Test error conditions
   - Achieve >90% code coverage

2. **Integration Testing** (8 hours)
   - End-to-end workflow tests
   - Test with multiple CDK formats
   - Test legacy workflow
   - Performance testing

3. **User Acceptance Testing** (4 hours)
   - Test with real users
   - Collect feedback
   - Identify usability issues
   - Document findings

4. **Bug Fixes and Refinement** (2 hours)
   - Fix identified bugs
   - Improve error messages
   - Optimize performance

**Deliverables:**

- ✅ Comprehensive test suite
- ✅ All bugs fixed
- ✅ UAT sign-off

**Success Metrics:**
>
- >90% code coverage
- 0 critical bugs
- >90% user satisfaction

---

### Timeline Summary

```
Week 1-2: Core Header Detection      [████████████████████] 40h
Week 3:   Sheet Reading               [██████████] 20h
Week 4:   Data Processing Refactor    [████████████] 24h
Week 5:   UI & Documentation          [████████] 16h
Week 6:   Testing & Validation        [██████████] 20h
────────────────────────────────────────────────────
Total:                                120 hours (3 person-months @ 40h/week)
```

### Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Header matching fails for unusual formats | Medium | High | Extensive synonym list, manual mapping UI |
| Performance degradation | Low | Medium | Efficient algorithms, caching |
| User adoption resistance | Medium | Low | Clear documentation, training |
| Backward compatibility breaks | Low | High | Dual-path support, extensive testing |
| Complex error scenarios missed | Medium | Medium | Comprehensive error catalog, UAT |

---

## Performance Implications

### Baseline Performance

**Current System** (hardcoded indices):

- Header reading: 0ms (not used)
- Record extraction: ~0.1ms per row
- 1000 rows: ~100ms
- Memory: Minimal (direct array access)

### Expected Performance with Dynamic Mapping

**New System** (dynamic mapping):

- Header reading: ~5ms (one-time)
- Column mapping detection: ~10-20ms (one-time)
- Header validation: ~5ms (one-time)
- Record extraction: ~0.12ms per row (+20%)
- 1000 rows: ~120-140ms
- Memory: +~5KB for column map

**Total Overhead:**

- One-time setup: ~30-40ms
- Per-row overhead: +0.02ms
- **Overall impact: <5% for typical datasets**

### Performance Breakdown

```
Operation Timeline (1000-row file):
───────────────────────────────────────
Old System:
  [====================] 100ms

New System:
  Setup: [=] 30ms
  Processing: [======================] 120ms
  Total: [========================] 150ms (+50ms, +50%)

For 10,000-row file:
Old: [====================] 1000ms
New: [=====================] 1050ms (+5%)

For 100,000-row file:
Old: [====================] 10s
New: [====================] 10.3s (+3%)
```

**Conclusion:** Setup overhead is fixed, so percentage impact decreases with file size.

### Optimization Strategies

#### 1. Column Map Caching

```javascript
// Cache column map for session
const _columnMapCache = {};

function getColumnMap(headers, sessionId) {
  const cacheKey = headers.join('|');

  if (_columnMapCache[cacheKey]) {
    return _columnMapCache[cacheKey];
  }

  const map = detectColumnMapping(headers);
  _columnMapCache[cacheKey] = map;
  return map;
}
```

**Benefit:** Eliminates remapping if same file processed multiple times

#### 2. Lazy Header Normalization

```javascript
// Normalize headers only once
const normalizedHeadersCache = new Map();

function normalizeHeaderName(header) {
  if (normalizedHeadersCache.has(header)) {
    return normalizedHeadersCache.get(header);
  }

  const normalized = String(header).trim().toLowerCase()
    .replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');

  normalizedHeadersCache.set(header, normalized);
  return normalized;
}
```

**Benefit:** Reduces string operations by ~50% for duplicate headers

#### 3. Efficient Array Access

```javascript
// Pre-compute column indices for hot path
function processCDKData(cdkData, columnMap) {
  // Extract indices once
  const stockNoIdx = columnMap.stockno;
  const frontGPIdx = columnMap.frontgp;
  const backGPIdx = columnMap.backgp;
  // ...

  for (let i = 1; i < cdkData.length; i++) {
    const row = cdkData[i];
    const record = {
      stockNo: row[stockNoIdx] || '',
      frontGP: parseFloat(row[frontGPIdx]) || 0,
      // ... direct access, no map lookup in loop
    };
  }
}
```

**Benefit:** Eliminates map lookups in tight loop

### Memory Considerations

**Memory Usage:**

- Column map object: ~1-2KB
- Normalized headers cache: ~2-3KB
- Synonym map: ~1KB
- Total overhead: **~5KB** (negligible)

**For large datasets:**

- 100,000 rows × 20 columns = 2M cells
- Current: ~40MB in memory
- New: ~40MB + 5KB ≈ 40MB (no meaningful difference)

### Performance Testing Results (Projected)

| File Size | Rows | Current Time | New Time | Overhead | % Impact |
|-----------|------|--------------|----------|----------|----------|
| Small     | 100  | 10ms         | 15ms     | +5ms     | +50%     |
| Medium    | 1,000| 100ms        | 140ms    | +40ms    | +40%     |
| Large     | 10,000|1s           | 1.3s     | +0.3s    | +30%     |
| XLarge    |100,000|10s          | 10.3s    | +0.3s    | +3%      |

**Conclusion:** Performance impact decreases with file size and is acceptable for all use cases.

### Comparison with Alternatives

**Alternative 1: Runtime Column Detection**

- Detect columns for each row (no caching)
- Impact: +200ms per 1000 rows
- ❌ Too slow

**Alternative 2: UI-Based Manual Mapping**

- User maps every column via UI
- Impact: 0ms processing, +2-3 minutes user time
- ❌ Poor user experience

**Alternative 3: Hybrid (Current Approach)**

- One-time automatic detection with fallbacks
- Impact: +50ms per 1000 rows
- ✅ Best balance of performance and flexibility

---

## User-Facing Changes

### New Import Workflow

#### Before (File Upload)

```
1. Click "Upload CDK File" button
2. Select file from computer
3. Wait for upload (5-10 seconds)
4. Wait for processing
5. Click "Start Merge"
```

#### After (Sheet Import)

```
1. Go to File > Import
2. Upload CDK file
3. Choose "Insert new sheet(s)"
4. Rename sheet to "CDK_DATA"
5. Return to sidebar
6. Click "Start Merge" (automatically detects CDK_DATA)
```

**User Impact:**

- ➕ More control over imported data
- ➕ Can review/edit data before merging
- ➕ No upload size limits
- ➖ One extra step (sheet renaming)
- ➖ Requires understanding of sheet names

### Updated UI Elements

#### 1. Merge Sidebar - New Instructions

**Old:**

```
┌─────────────────────────┐
│ CDK Merge Tool          │
├─────────────────────────┤
│ 1. Upload CDK File      │
│    [Choose File...]     │
│                         │
│ 2. Start Merge          │
│    [Start Merge]        │
└─────────────────────────┘
```

**New:**

```
┌─────────────────────────────────────┐
│ CDK Merge Tool                      │
├─────────────────────────────────────┤
│ Step 1: Import CDK Data             │
│   • Go to File > Import             │
│   • Upload your CDK export          │
│   • Choose "Insert new sheet(s)"    │
│   • Rename sheet to "CDK_DATA"      │
│                                     │
│ Step 2: Verify Data                 │
│   ✓ CDK_DATA sheet found           │
│   ✓ 1,234 rows detected            │
│   ✓ All required columns present   │
│                                     │
│ Step 3: Start Merge                 │
│   [Start Merge Process]            │
│                                     │
│ [Legacy: Upload File Instead]      │
└─────────────────────────────────────┘
```

#### 2. Error Messages - More Helpful

**Old:**

```
Error: Invalid file format
```

**New:**

```
❌ Cannot process CDK data

Missing required columns:
  • Front GP$ (Front Gross Profit)
  • Total GP$ (Total Gross Profit)

Action required:
  1. Check your CDK export settings
  2. Ensure "Gross Profit" columns are included
  3. Re-export from CDK and import again

Need help? Click "Troubleshooting Guide"
```

#### 3. Progress Indicators - More Detailed

**Old:**

```
Processing CDK data... 50%
```

**New:**

```
Reading CDK_DATA sheet... ✓
Detecting column headers... ✓
Mapping columns... ✓ (95% coverage)
Validating data... ✓ (3 warnings)
Processing 1,234 rows... 50%
```

### Training Materials Needed

#### 1. Quick Start Guide

- **Format:** PDF + Video
- **Length:** 1 page / 2 minutes
- **Content:**
  - How to import CDK file
  - How to rename sheet
  - How to start merge
  - Common troubleshooting

#### 2. Troubleshooting Guide

- **Format:** Interactive web page
- **Content:**
  - Error message reference
  - Step-by-step fixes
  - Screenshots for each step
  - Contact support link

#### 3. Column Mapping Reference

- **Format:** Printable chart
- **Content:**
  - Standard column names
  - Common variations
  - Required vs optional
  - What to do if column missing

#### 4. Video Tutorial

- **Length:** 5 minutes
- **Sections:**
  - Introduction (30s)
  - Exporting from CDK (1m)
  - Importing to Sheets (1.5m)
  - Running merge (1.5m)
  - Reviewing results (30s)
  - Q&A (30s)

### Communication Plan

#### Phase 1: Pre-Launch (1 week before)

- Email announcement of upcoming change
- Highlight benefits (flexibility, reliability)
- Provide access to documentation
- Schedule optional training session

#### Phase 2: Launch Day

- Deploy new version
- Send "Now Available" email
- Post in team communication channel
- Offer live support hours

#### Phase 3: Post-Launch (2 weeks after)

- Collect user feedback
- Monitor support requests
- Address common issues
- Update documentation based on feedback

#### Phase 4: Full Adoption (1 month after)

- Deprecate old upload method
- Send final migration notice
- Provide 30-day transition period
- Remove legacy features

### Success Metrics for User Adoption

**Week 1:**

- 50% of users try new workflow
- <10 support requests
- >80% success rate

**Month 1:**

- 90% of users on new workflow
- <5 support requests per week
- >95% success rate

**Month 3:**

- 100% adoption
- <2 support requests per month
- Legacy feature removed

---

## Additional Considerations

### Supporting Multiple CDK Export Formats

**Challenge:** Different CDK versions or dealership configurations may produce different export formats.

**Solution:**

1. **Format Detection**

   ```javascript
   function detectCDKFormat(headers) {
     // Check for format identifiers
     if (headers.includes('PLC')) return 'format_v1';
     if (headers.includes('Deal Status')) return 'format_v2';
     return 'format_generic';
   }
   ```

2. **Format-Specific Synonym Maps**

   ```javascript
   const formatSynonyms = {
     format_v1: {
       'stockno': ['Stock No.', 'VIN#'],
       'frontgp': ['Front GP$', 'F/E Gross']
     },
     format_v2: {
       'stockno': ['Stock Number', 'Unit#'],
       'frontgp': ['Frontend Gross', 'Front Profit']
     }
   };
   ```

3. **User Override**
   - Allow users to manually specify format
   - Save format preference per dealership
   - Auto-detect but allow correction

### Future Extensibility for Other Data Sources

**Design for Future Data Sources:**

```javascript
// Generic data source interface
const dataSourceHandlers = {
  CDK: {
    read: readCDKDataSheet,
    detect: detectCDKColumnMapping,
    validate: validateCDKHeaders
  },
  DealerSocket: {
    read: readDealerSocketSheet,
    detect: detectDealerSocketMapping,
    validate: validateDealerSocketHeaders
  },
  Reynolds: {
    read: readReynoldsSheet,
    detect: detectReynoldsMapping,
    validate: validateReynoldsHeaders
  }
};

// Universal processor
function processDataSource(sourceType, sheetName) {
  const handler = dataSourceHandlers[sourceType];
  const data = handler.read(sheetName);
  const mapping = handler.detect(data.headers);
  const validation = handler.validate(mapping);
  return { data, mapping, validation };
}
```

**Benefits:**

- Easy to add new data sources
- Consistent interface
- Shared helper functions
- Modular architecture

### Configuration Management for Custom Mappings

**User-Defined Mappings:**

```javascript
// Allow users to save custom mappings
function saveCustomMapping(name, mapping) {
  const customMappings = PropertiesService.getUserProperties();
  customMappings.setProperty(
    `custom_mapping_${name}`,
    JSON.stringify(mapping)
  );
}

// Load and use custom mapping
function loadCustomMapping(name) {
  const customMappings = PropertiesService.getUserProperties();
  const mappingJson = customMappings.getProperty(`custom_mapping_${name}`);
  return mappingJson ? JSON.parse(mappingJson) : null;
}

// UI for managing mappings
function showMappingManager() {
  const html = HtmlService.createTemplateFromFile('mapping_manager')
    .evaluate()
    .setTitle('Column Mapping Manager');
  SpreadsheetApp.getUi().showSidebar(html);
}
```

**Features:**

- Save frequently-used mappings
- Share mappings across team
- Import/export mapping configurations
- Version control for mappings

### Audit Logging for Troubleshooting

**Enhanced Logging:**

```javascript
function logMappingOperation(operation, details) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    user: Session.getActiveUser().getEmail(),
    operation: operation,
    details: details,
    success: details.success || false
  };

  // Log to spreadsheet
  const logSheet = getOrCreateSheet('MAPPING_LOG');
  logSheet.appendRow([
    logEntry.timestamp,
    logEntry.user,
    logEntry.operation,
    JSON.stringify(logEntry.details),
    logEntry.success
  ]);

  // Also log to Apps Script logs
  console.log('[MAPPING]', operation, logEntry);
}

// Usage
logMappingOperation('detectColumnMapping', {
  headers: headers.length,
  mapped: Object.keys(columnMap).length,
  coverage: coverage,
  warnings: warnings,
  success: true
});
```

**Benefits:**

- Troubleshoot user issues faster
- Identify problematic export formats
- Track system reliability
- Improve synonym matching

### Internationalization Considerations

**Multi-Language Support:**

```javascript
// Header translations
const headerTranslations = {
  'en': {
    'stockno': ['Stock No.', 'Stock Number', 'Stock #'],
    'customer': ['Customer', 'Buyer', 'Purchaser']
  },
  'es': {
    'stockno': ['Número de Stock', 'No. de Unidad'],
    'customer': ['Cliente', 'Comprador']
  },
  'fr': {
    'stockno': ['Numéro de Stock', 'No. Stock'],
    'customer': ['Client', 'Acheteur']
  }
};

function detectLanguage(headers) {
  // Detect most likely language from headers
  const scores = {};
  for (const [lang, translations] of Object.entries(headerTranslations)) {
    scores[lang] = 0;
    for (const header of headers) {
      const normalized = normalizeHeaderName(header);
      for (const [field, variants] of Object.entries(translations)) {
        if (variants.some(v => normalizeHeaderName(v) === normalized)) {
          scores[lang]++;
        }
      }
    }
  }
  return Object.keys(scores).reduce((a, b) =>
    scores[a] > scores[b] ? a : b
  );
}
```

### Integration with External Systems

**API for Programmatic Access:**

```javascript
// Expose functions for external scripts
function API_detectColumnMapping(headers) {
  return detectColumnMapping(headers);
}

function API_validateMapping(columnMap) {
  return validateCDKHeaders(columnMap);
}

function API_processWith Mapping(data, columnMap) {
  return processCDKData(data, columnMap);
}

// Usage from external script
function externalScript() {
  const ss = SpreadsheetApp.openById('SPREADSHEET_ID');
  const sheet = ss.getSheetByName('CDK_DATA');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Call API
  const mapping = API_detectColumnMapping(headers);
  console.log('Detected mapping:', mapping);
}
```

### Version Control and Change Management

**Track Schema Changes:**

```javascript
// Schema version tracking
const SCHEMA_VERSION = {
  version: '2.0.0',
  changes: {
    '2.0.0': 'Added dynamic header detection',
    '1.0.0': 'Initial hardcoded implementation'
  },
  compatibleWith: ['1.0.0', '2.0.0']
};

function validateSchemaCompatibility(dataVersion) {
  if (!SCHEMA_VERSION.compatibleWith.includes(dataVersion)) {
    throw new Error(
      `Incompatible schema version. ` +
      `Expected ${SCHEMA_VERSION.compatibleWith.join(' or ')}, ` +
      `found ${dataVersion}`
    );
  }
}
```

### Security Considerations

**Data Privacy:**

1. **No External API Calls:** All processing happens within Google Sheets
2. **User Permissions:** Respect sheet sharing permissions
3. **Audit Trail:** Log who made changes when
4. **Data Sanitization:** Validate all input data

**Access Control:**

```javascript
function checkUserPermissions(operation) {
  const user = Session.getActiveUser().getEmail();
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  const protection = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0];

  if (protection && !protection.canEdit()) {
    throw new Error('Insufficient permissions for ' + operation);
  }
}
```

### Maintenance and Support Plan

**Ongoing Maintenance:**

1. **Monthly Reviews:**
   - Review error logs
   - Identify new header variations
   - Update synonym maps
   - Performance monitoring

2. **Quarterly Updates:**
   - Add new CDK format support
   - Improve matching algorithms
   - Update documentation
   - User feedback incorporation

3. **Annual Audits:**
   - Security review
   - Performance optimization
   - Code refactoring
   - Technology updates

**Support Channels:**

- Email: <support@dealership.com>
- Documentation: wiki.dealership.com/cdk-merge
- Training: Monthly webinars
- Emergency: 24/7 on-call for critical issues

---

## Conclusion

### Summary of Benefits

**For Users:**

- ✅ No need to maintain specific column order
- ✅ Flexibility to use different CDK export formats
- ✅ Better error messages and guidance
- ✅ More control over imported data
- ✅ Reduced manual configuration

**For Developers:**

- ✅ Maintainable, modular code
- ✅ Extensible to other data sources
- ✅ Comprehensive error handling
- ✅ Better debugging capabilities
- ✅ Future-proof architecture

**For the Business:**

- ✅ Reduced support burden
- ✅ Faster onboarding of new dealerships
- ✅ More reliable data processing
- ✅ Scalable solution
- ✅ Lower maintenance costs

### Next Steps

1. **Review and Approve Plan:** Stakeholder sign-off on approach
2. **Allocate Resources:** Assign developer(s) and timeline
3. **Begin Phase 1:** Start with core header detection
4. **Regular Check-ins:** Weekly progress reviews
5. **Iterative Deployment:** Release in phases with testing
6. **Continuous Improvement:** Monitor and refine based on feedback

### Sign-Off

**Document Prepared By:** Roo (AI Architect)
**Date:** 2025-10-20
**Status:** Ready for Review

**Stakeholders:**

- [ ] Development Lead - Approval
- [ ] Product Owner - Approval
- [ ] QA Lead - Approval
- [ ] End Users - Consultation

---

## Appendix A: File Modification Summary

### Files to Create

1. None (all changes in existing files)

### Files to Modify

| File | Lines | Complexity | Changes |
|------|-------|------------|---------|
| [`merge_controller.js`](saleslog_files/merge_controller.js) | 1021-1072, 204-399 | High | Major refactoring |

### Files Unchanged

| File | Reason |
|------|--------|
| [`stock_matcher.js`](saleslog_files/stock_matcher.js) | Works with record objects |
| [`data_merger.js`](saleslog_files/data_merger.js) | Works with record objects |
| [`output_generator.js`](saleslog_files/output_generator.js) | Works with record objects |
| [`config_manager.js`](saleslog_files/config_manager.js) | Configuration only |

---

## Appendix B: Test Data Requirements

### Test Files Needed

1. **Standard CDK Export** (standard_cdk.xlsx)
   - Expected column order
   - 100 rows
   - All columns present

2. **Reordered Columns** (reordered_cdk.xlsx)
   - Different column order
   - 50 rows
   - All required columns present

3. **Header Variations** (variations_cdk.xlsx)
   - Different header names
   - "Stock Number" instead of "Stock No."
   - "Front Gross" instead of "Front GP$"

4. **Missing Optional Columns** (minimal_cdk.xlsx)
   - Only required columns
   - No VIN, Year, Deal No.
   - Should process with warnings

5. **Missing Required Columns** (invalid_cdk.xlsx)
   - Missing Front GP
   - Should fail with error

6. **Empty Sheet** (empty_cdk.xlsx)
   - Headers only
   - Should fail with error

7. **Large File** (large_cdk.xlsx)
   - 10,000+ rows
   - Performance testing

---

**END OF DOCUMENT**
