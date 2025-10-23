# Stock Number Matching Algorithm

## Overview

The stock number matching algorithm is the core component that links Sales Log records with CDK export records. It must handle various format inconsistencies while maintaining high accuracy and performance.

## Problem Statement

### Format Variations Observed

From sample data analysis:

**Sales Log Stock Numbers** (Column E - New, Column L - Used):
- `T5102344` - Letter prefix + numbers
- `SG390950` - Two letter prefix + numbers  
- `SC252372` - Two letter prefix + numbers
- `90K001` - Numbers + letter + numbers
- Leading zeros may be present or stripped by Excel

**CDK Export Stock Numbers** (Column D):
- `T5102344` - Same format as Sales Log
- May have text vs numeric type differences
- Spaces may be present
- Case variations possible

### Challenges

1. **Format Inconsistency**
   - Leading zeros: `001234` vs `1234`
   - Spaces: `T 5102344` vs `T5102344`
   - Case: `t5102344` vs `T5102344`
   - Text vs Number type in Excel

2. **Ambiguity Resolution**
   - Multiple partial matches
   - Similar stock numbers (T5102344 vs T5102345)
   - Missing stock numbers

3. **Performance**
   - Must process 1000+ records in <30 seconds
   - Avoid O(n²) comparisons
   - Minimize memory usage

## Algorithm Design

### Multi-Phase Matching Strategy

The algorithm uses three sequential phases, each with decreasing strictness but increasing computational cost:

```
Phase 1: Exact Match (Fastest, Highest Confidence)
    ↓ (if no match)
Phase 2: Numeric Match (Fast, High Confidence)
    ↓ (if no match)
Phase 3: Partial Match (Slower, Medium Confidence)
    ↓ (if no match)
Result: Unmatched (Manual Review Required)
```

### Phase 1: Exact Match

**Goal**: Find perfect matches after basic normalization

**Normalization Steps**:
```javascript
function normalizeExact(stockNumber) {
  if (!stockNumber) return null;
  
  return String(stockNumber)
    .trim()                    // Remove leading/trailing spaces
    .toUpperCase()             // Standardize case
    .replace(/\s+/g, '');      // Remove internal spaces
}

// Examples:
normalizeExact("T5102344")    → "T5102344"
normalizeExact("t5102344")    → "T5102344"
normalizeExact("T 5102344")   → "T5102344"
normalizeExact(" T5102344 ")  → "T5102344"
```

**Index Structure**:
```javascript
const exactIndex = new Map();

// Build index from CDK data
cdkRecords.forEach(record => {
  const normalized = normalizeExact(record.stockNo);
  if (normalized) {
    exactIndex.set(normalized, record);
  }
});

// Lookup during matching
const normalized = normalizeExact(salesLogStock);
const match = exactIndex.get(normalized);
```

**Performance**: O(1) lookup, O(n) index build
**Expected Match Rate**: 85-90% of records

### Phase 2: Numeric Match

**Goal**: Match by numeric portion only (ignores letter prefixes)

**Normalization Steps**:
```javascript
function normalizeNumeric(stockNumber) {
  if (!stockNumber) return null;
  
  const str = String(stockNumber)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  
  // Extract numeric portion
  const numeric = str.replace(/^[A-Z]+/, '')  // Remove letter prefix
                     .replace(/[A-Z]+$/, '')  // Remove letter suffix
                     .replace(/^0+/, '');     // Remove leading zeros
  
  return numeric || null;
}

// Examples:
normalizeNumeric("T5102344")    → "5102344"
normalizeNumeric("5102344")     → "5102344"
normalizeNumeric("SG390950")    → "390950"
normalizeNumeric("001234")      → "1234"
normalizeNumeric("SC000123")    → "123"
```

**Index Structure**:
```javascript
const numericIndex = new Map();

// Build index - handle potential collisions
cdkRecords.forEach(record => {
  const numeric = normalizeNumeric(record.stockNo);
  if (numeric) {
    if (!numericIndex.has(numeric)) {
      numericIndex.set(numeric, []);
    }
    numericIndex.get(numeric).push(record);
  }
});

// Lookup with collision handling
const numeric = normalizeNumeric(salesLogStock);
const candidates = numericIndex.get(numeric) || [];

if (candidates.length === 1) {
  // Single match - confident
  return { match: candidates[0], confidence: 0.95 };
} else if (candidates.length > 1) {
  // Multiple matches - need disambiguation
  return disambiguateMatches(candidates, salesLogRecord);
}
```

**Disambiguation Strategy**:
When multiple CDK records have same numeric portion:
1. Compare StockType (NEW vs USED) with column position
2. Compare Model if available
3. Compare Customer name (fuzzy)
4. If still ambiguous, flag for manual review

**Performance**: O(1) lookup average, O(k) for collisions
**Expected Match Rate**: 5-10% additional matches

### Phase 3: Partial Match

**Goal**: Match by last N characters (configurable)

**Use Case**: Handle prefix variations
- Sales Log: `NEW-5102344`
- CDK: `T5102344`
- Match on: `5102344` (last 7 chars)

**Normalization Steps**:
```javascript
function normalizePartial(stockNumber, length = 6) {
  if (!stockNumber) return null;
  
  const normalized = normalizeExact(stockNumber);
  if (!normalized || normalized.length < length) {
    return normalized; // Too short for partial match
  }
  
  // Take last N characters
  return normalized.slice(-length);
}

// Examples (length=6):
normalizePartial("T5102344", 6)     → "102344"
normalizePartial("NEW5102344", 6)   → "102344"
normalizePartial("ABC123", 6)       → "ABC123" (too short)
```

**Index Structure**:
```javascript
const partialIndex = new Map();

// Build suffix-based index
cdkRecords.forEach(record => {
  const partial = normalizePartial(record.stockNo, PARTIAL_MATCH_LENGTH);
  if (partial) {
    if (!partialIndex.has(partial)) {
      partialIndex.set(partial, []);
    }
    partialIndex.get(partial).push(record);
  }
});
```

**Confidence Scoring**:
```javascript
function calculatePartialMatchConfidence(salesStock, cdkStock) {
  const salesNorm = normalizeExact(salesStock);
  const cdkNorm = normalizeExact(cdkStock);
  
  // Calculate similarity ratio
  const matchLength = PARTIAL_MATCH_LENGTH;
  const totalLength = Math.max(salesNorm.length, cdkNorm.length);
  
  const confidence = matchLength / totalLength;
  
  // Penalize if lengths differ significantly
  const lengthDiff = Math.abs(salesNorm.length - cdkNorm.length);
  const penalty = lengthDiff * 0.05; // 5% penalty per character difference
  
  return Math.max(0.5, confidence - penalty); // Minimum 0.5 confidence
}
```

**Performance**: O(1) average, O(k²) worst case for disambiguation
**Expected Match Rate**: 2-5% additional matches
**Flag for Review**: All partial matches (confidence < 1.0)

## Complete Matching Algorithm

### Main Matching Function

```javascript
/**
 * Matches a single Sales Log record against CDK data
 * 
 * @param {Object} salesLogRecord - Sales log record with stock number
 * @param {Object} cdkIndexes - Pre-built indexes {exact, numeric, partial}
 * @param {Object} config - Matching configuration
 * @returns {Object} Match result with confidence score
 */
function matchRecord(salesLogRecord, cdkIndexes, config) {
  // Determine if new or used vehicle
  const isNew = salesLogRecord.stockNumberNew && 
                salesLogRecord.stockNumberNew.trim();
  const stockNumber = isNew ? 
                      salesLogRecord.stockNumberNew : 
                      salesLogRecord.stockNumberUsed;
  
  if (!stockNumber || !stockNumber.trim()) {
    return {
      matched: false,
      reason: "no_stock_number",
      confidence: 0
    };
  }
  
  // Phase 1: Exact Match
  const exactNorm = normalizeExact(stockNumber);
  if (exactNorm && cdkIndexes.exact.has(exactNorm)) {
    const cdkRecord = cdkIndexes.exact.get(exactNorm);
    
    // Verify stock type matches (NEW in col E, USED in col L)
    if (validateStockType(cdkRecord, isNew)) {
      return {
        matched: true,
        cdkRecord: cdkRecord,
        matchType: "exact",
        confidence: 1.0,
        stockNumber: stockNumber,
        normalizedStock: exactNorm
      };
    }
  }
  
  // Phase 2: Numeric Match
  const numericNorm = normalizeNumeric(stockNumber);
  if (numericNorm && cdkIndexes.numeric.has(numericNorm)) {
    const candidates = cdkIndexes.numeric.get(numericNorm);
    
    // Filter by stock type
    const validCandidates = candidates.filter(c => 
      validateStockType(c, isNew)
    );
    
    if (validCandidates.length === 1) {
      return {
        matched: true,
        cdkRecord: validCandidates[0],
        matchType: "numeric",
        confidence: 0.95,
        stockNumber: stockNumber,
        normalizedStock: numericNorm
      };
    } else if (validCandidates.length > 1) {
      // Disambiguate
      const best = disambiguate(salesLogRecord, validCandidates);
      if (best.confidence >= 0.85) {
        return {
          matched: true,
          cdkRecord: best.record,
          matchType: "numeric_disambiguated",
          confidence: best.confidence,
          stockNumber: stockNumber,
          normalizedStock: numericNorm,
          alternatives: validCandidates.length
        };
      }
    }
  }
  
  // Phase 3: Partial Match (if enabled)
  if (config.enablePartialMatch) {
    const partialNorm = normalizePartial(stockNumber, config.partialMatchLength);
    if (partialNorm && cdkIndexes.partial.has(partialNorm)) {
      const candidates = cdkIndexes.partial.get(partialNorm);
      
      // Filter and score
      const scored = candidates
        .filter(c => validateStockType(c, isNew))
        .map(c => ({
          record: c,
          confidence: calculatePartialMatchConfidence(stockNumber, c.stockNo)
        }))
        .filter(s => s.confidence >= 0.7)
        .sort((a, b) => b.confidence - a.confidence);
      
      if (scored.length > 0) {
        return {
          matched: true,
          cdkRecord: scored[0].record,
          matchType: "partial",
          confidence: scored[0].confidence,
          stockNumber: stockNumber,
          normalizedStock: partialNorm,
          requiresReview: true,
          alternatives: scored.slice(1, 3) // Show top alternatives
        };
      }
    }
  }
  
  // No match found
  return {
    matched: false,
    reason: "no_match_found",
    confidence: 0,
    stockNumber: stockNumber,
    attemptedNormalizations: {
      exact: exactNorm,
      numeric: numericNorm,
      partial: config.enablePartialMatch ? 
               normalizePartial(stockNumber, config.partialMatchLength) : 
               null
    }
  };
}
```

### Stock Type Validation

```javascript
/**
 * Validates that CDK stock type matches Sales Log column position
 * 
 * @param {Object} cdkRecord - CDK record with stockType field
 * @param {boolean} isNew - True if from Sales Log column E (New), false if column L (Used)
 * @returns {boolean} True if types match
 */
function validateStockType(cdkRecord, isNew) {
  if (!cdkRecord.stockType) {
    // No type info in CDK - allow match but flag for review
    return true;
  }
  
  const cdkType = String(cdkRecord.stockType).toUpperCase();
  
  if (isNew) {
    return cdkType === "NEW" || cdkType === "N" || cdkType === "S"; // S for demo
  } else {
    return cdkType === "USED" || cdkType === "U";
  }
}
```

### Disambiguation Logic

```javascript
/**
 * Disambiguates between multiple CDK records with same numeric portion
 * Uses multiple signals to find best match
 * 
 * @param {Object} salesLogRecord - Sales log record
 * @param {Array} candidates - Array of potential CDK matches
 * @returns {Object} {record: bestMatch, confidence: score}
 */
function disambiguate(salesLogRecord, candidates) {
  const scores = candidates.map(candidate => {
    let score = 0.85; // Base confidence for numeric match
    
    // Signal 1: Model match (+0.1)
    if (salesLogRecord.model && candidate.model) {
      const salesModel = normalizeModel(salesLogRecord.model);
      const cdkModel = normalizeModel(candidate.model);
      if (salesModel === cdkModel) {
        score += 0.1;
      }
    }
    
    // Signal 2: Customer name similarity (+0.05)
    if (salesLogRecord.customerLastName && candidate.customer) {
      const similarity = calculateNameSimilarity(
        salesLogRecord.customerLastName, 
        candidate.customer
      );
      score += similarity * 0.05;
    }
    
    // Signal 3: Exact prefix match (+0.05)
    if (extractPrefix(salesLogRecord.stockNumber) === 
        extractPrefix(candidate.stockNo)) {
      score += 0.05;
    }
    
    return {
      record: candidate,
      confidence: Math.min(score, 1.0) // Cap at 1.0
    };
  });
  
  // Return highest scoring match
  scores.sort((a, b) => b.confidence - a.confidence);
  return scores[0];
}
```

### Helper Functions

#### Model Normalization

```javascript
function normalizeModel(model) {
  if (!model) return "";
  
  return String(model)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, ''); // Remove special chars
}

// Examples:
normalizeModel("CORV")     → "CORV"
normalizeModel("Corvette") → "CORVETTE"
normalizeModel("TRAV")     → "TRAV"
```

#### Name Similarity (Levenshtein Distance)

```javascript
/**
 * Calculates similarity between two customer names
 * Uses simplified Levenshtein distance
 * 
 * @param {string} name1 - First name
 * @param {string} name2 - Second name
 * @returns {number} Similarity score 0.0-1.0
 */
function calculateNameSimilarity(name1, name2) {
  if (!name1 || !name2) return 0;
  
  // Normalize names
  const n1 = name1.trim().toUpperCase();
  const n2 = name2.trim().toUpperCase();
  
  // Quick exact match
  if (n1 === n2) return 1.0;
  
  // Check if one contains the other
  if (n1.includes(n2) || n2.includes(n1)) return 0.8;
  
  // Levenshtein distance
  const distance = levenshteinDistance(n1, n2);
  const maxLength = Math.max(n1.length, n2.length);
  
  if (maxLength === 0) return 0;
  
  return 1 - (distance / maxLength);
}

/**
 * Calculates Levenshtein distance between two strings
 * Optimized implementation for Apps Script
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  
  // Create distance matrix (use single array for memory efficiency)
  const matrix = new Array((len1 + 1) * (len2 + 1));
  
  // Initialize first row and column
  for (let i = 0; i <= len1; i++) matrix[i] = i;
  for (let j = 0; j <= len2; j++) matrix[j * (len1 + 1)] = j;
  
  // Fill matrix
  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const idx = j * (len1 + 1) + i;
      const idxLeft = idx - 1;
      const idxUp = idx - (len1 + 1);
      const idxDiag = idxUp - 1;
      
      matrix[idx] = Math.min(
        matrix[idxLeft] + 1,      // Deletion
        matrix[idxUp] + 1,        // Insertion
        matrix[idxDiag] + cost    // Substitution
      );
    }
  }
  
  return matrix[(len1 + 1) * (len2 + 1) - 1];
}
```

#### Prefix Extraction

```javascript
function extractPrefix(stockNumber) {
  if (!stockNumber) return "";
  
  const match = String(stockNumber)
    .trim()
    .toUpperCase()
    .match(/^[A-Z]+/);
  
  return match ? match[0] : "";
}

// Examples:
extractPrefix("T5102344")   → "T"
extractPrefix("SG390950")   → "SG"
extractPrefix("5102344")    → ""
```

## Index Building Strategy

### Pre-Processing Phase

Before matching begins, build all indexes from CDK data:

```javascript
/**
 * Builds all matching indexes from CDK export data
 * Called once before processing Sales Log records
 * 
 * @param {Array} cdkRecords - All CDK records
 * @param {Object} config - Matching configuration
 * @returns {Object} Index collection
 */
function buildMatchingIndexes(cdkRecords, config) {
  const startTime = Date.now();
  
  const indexes = {
    exact: new Map(),
    numeric: new Map(),
    partial: new Map(),
    stats: {
      totalRecords: cdkRecords.length,
      exactIndexSize: 0,
      numericIndexSize: 0,
      partialIndexSize: 0,
      collisions: {
        numeric: 0,
        partial: 0
      }
    }
  };
  
  cdkRecords.forEach((record, idx) => {
    try {
      // Build exact index
      const exact = normalizeExact(record.stockNo);
      if (exact) {
        if (indexes.exact.has(exact)) {
          Logger.log(`Warning: Duplicate stock in CDK data: ${exact}`);
        }
        indexes.exact.set(exact, record);
        indexes.stats.exactIndexSize++;
      }
      
      // Build numeric index
      const numeric = normalizeNumeric(record.stockNo);
      if (numeric) {
        if (!indexes.numeric.has(numeric)) {
          indexes.numeric.set(numeric, []);
        } else {
          indexes.stats.collisions.numeric++;
        }
        indexes.numeric.get(numeric).push(record);
        indexes.stats.numericIndexSize++;
      }
      
      // Build partial index (if enabled)
      if (config.enablePartialMatch) {
        const partial = normalizePartial(record.stockNo, config.partialMatchLength);
        if (partial) {
          if (!indexes.partial.has(partial)) {
            indexes.partial.set(partial, []);
          } else {
            indexes.stats.collisions.partial++;
          }
          indexes.partial.get(partial).push(record);
          indexes.stats.partialIndexSize++;
        }
      }
      
    } catch (e) {
      logError('buildMatchingIndexes', e, { 
        recordIndex: idx, 
        stockNo: record.stockNo 
      });
    }
  });
  
  const buildTime = Date.now() - startTime;
  Logger.log(`Indexes built in ${buildTime}ms: ${JSON.stringify(indexes.stats)}`);
  
  return indexes;
}
```

## Batch Processing for Performance

```javascript
/**
 * Processes Sales Log records in batches to avoid timeout
 * Provides progress updates and checkpoint capability
 * 
 * @param {Array} salesLogRecords - All sales log records
 * @param {Object} cdkIndexes - Pre-built CDK indexes
 * @param {Object} config - Configuration
 * @returns {Object} Match results with statistics
 */
function batchMatchRecords(salesLogRecords, cdkIndexes, config) {
  const BATCH_SIZE = 100;
  const CHECKPOINT_INTERVAL = 500;
  
  const results = {
    matched: [],
    unmatched: [],
    requiresReview: [],
    stats: {
      total: salesLogRecords.length,
      exactMatches: 0,
      numericMatches: 0,
      partialMatches: 0,
      unmatched: 0,
      matchRate: 0
    }
  };
  
  for (let i = 0; i < salesLogRecords.length; i += BATCH_SIZE) {
    const batch = salesLogRecords.slice(i, i + BATCH_SIZE);
    
    batch.forEach((record, batchIdx) => {
      const globalIdx = i + batchIdx;
      
      // Match the record
      const matchResult = matchRecord(record, cdkIndexes, config);
      
      // Categorize result
      if (matchResult.matched) {
        const mergedRecord = {
          ...record,
          cdkData: matchResult.cdkRecord,
          matchType: matchResult.matchType,
          confidence: matchResult.confidence
        };
        
        if (matchResult.requiresReview) {
          results.requiresReview.push(mergedRecord);
        } else {
          results.matched.push(mergedRecord);
        }
        
        // Update stats
        if (matchResult.matchType === "exact") {
          results.stats.exactMatches++;
        } else if (matchResult.matchType.startsWith("numeric")) {
          results.stats.numericMatches++;
        } else if (matchResult.matchType === "partial") {
          results.stats.partialMatches++;
        }
      } else {
        results.unmatched.push({
          ...record,
          reason: matchResult.reason,
          attemptedNormalizations: matchResult.attemptedNormalizations
        });
        results.stats.unmatched++;
      }
    });
    
    // Checkpoint every 500 records
    if ((i + BATCH_SIZE) % CHECKPOINT_INTERVAL === 0) {
      saveMatchCheckpoint({
        processedCount: i + BATCH_SIZE,
        results: results
      });
      
      // Update progress
      updateProgressUI({
        processed: i + BATCH_SIZE,
        total: salesLogRecords.length,
        percentage: Math.round(((i + BATCH_SIZE) / salesLogRecords.length) * 100)
      });
    }
  }
  
  // Calculate final match rate
  results.stats.matchRate = 
    (results.matched.length + results.requiresReview.length) / 
    results.stats.total;
  
  return results;
}
```

## Match Quality Assurance

### Confidence Thresholds

```javascript
const CONFIDENCE_LEVELS = {
  AUTO_APPROVE: 0.95,      // Automatically merge without review
  NEEDS_REVIEW: 0.70,      // Flag for manual review
  REJECT: 0.70             // Below this, treat as unmatched
};

function categorizeMatch(matchResult) {
  if (!matchResult.matched) {
    return "unmatched";
  }
  
  if (matchResult.confidence >= CONFIDENCE_LEVELS.AUTO_APPROVE) {
    return "auto_approved";
  } else if (matchResult.confidence >= CONFIDENCE_LEVELS.NEEDS_REVIEW) {
    return "needs_review";
  } else {
    return "rejected";
  }
}
```

### Validation Checks

```javascript
/**
 * Validates a match result for data integrity
 * 
 * @param {Object} matchResult - Match result to validate
 * @param {Object} salesLogRecord - Original sales log record
 * @returns {Object} Validation result with warnings
 */
function validateMatch(matchResult, salesLogRecord) {
  const warnings = [];
  
  if (!matchResult.matched) {
    return { valid: true, warnings: [] };
  }
  
  const cdk = matchResult.cdkRecord;
  
  // Check 1: Model consistency
  if (salesLogRecord.model && cdk.model) {
    const salesModel = normalizeModel(salesLogRecord.model);
    const cdkModel = normalizeModel(cdk.model);
    
    if (salesModel !== cdkModel) {
      warnings.push({
        type: "model_mismatch",
        severity: "medium",
        message: `Model mismatch: Sales Log "${salesLogRecord.model}" vs CDK "${cdk.model}"`,
        impact: "May indicate wrong match"
      });
    }
  }
  
  // Check 2: Customer name consistency
  if (salesLogRecord.customerLastName && cdk.customer) {
    const similarity = calculateNameSimilarity(
      salesLogRecord.customerLastName,
      cdk.customer
    );
    
    if (similarity < 0.5) {
      warnings.push({
        type: "customer_mismatch",
        severity: "low",
        message: `Low customer name similarity: "${salesLogRecord.customerLastName}" vs "${cdk.customer}"`,
        impact: "May indicate wrong match or name variation"
      });
    }
  }
  
  // Check 3: Gross profit sanity check
  if (cdk.totalGP !== undefined) {
    if (cdk.totalGP < -50000 || cdk.totalGP > 50000) {
      warnings.push({
        type: "extreme_gp",
        severity: "low",
        message: `Unusual total GP value: ${cdk.totalGP}`,
        impact: "May indicate data entry error in CDK"
      });
    }
  }
  
  // Check 4: Date proximity (if available)
  if (salesLogRecord.contractDate && cdk.contractDate) {
    const daysDiff = Math.abs(
      (new Date(salesLogRecord.contractDate) - new Date(cdk.contractDate)) / 
      (1000 * 60 * 60 * 24)
    );
    
    if (daysDiff > 7) {
      warnings.push({
        type: "date_mismatch",
        severity: "medium",
        message: `Contract dates differ by ${daysDiff} days`,
        impact: "May indicate wrong match"
      });
    }
  }
  
  return {
    valid: warnings.length === 0 || 
           warnings.every(w => w.severity !== "high"),
    warnings: warnings
  };
}
```

## Match Statistics and Reporting

### Match Report Structure

```javascript
const matchReport = {
  timestamp: new Date().toISOString(),
  summary: {
    totalSalesLogRecords: 250,
    totalCDKRecords: 250,
    matched: 238,
    requiresReview: 8,
    unmatched: 4,
    matchRate: 0.952,
    processingTime: 15.3 // seconds
  },
  breakdown: {
    exactMatches: 225,
    numericMatches: 10,
    partialMatches: 3,
    newVehicles: {
      matched: 120,
      unmatched: 2
    },
    usedVehicles: {
      matched: 118,
      unmatched: 2
    }
  },
  unmatchedDetails: [
    {
      rowNumber: 15,
      stockNumber: "ABC123",
      customer: "Smith, John",
      model: "UNKNOWN",
      reason: "Stock number not found in CDK data",
      suggestions: []
    }
  ],
  reviewRequired: [
    {
      rowNumber: 42,
      stockNumber: "T5102344",
      matchType: "partial",
      confidence: 0.75,
      warnings: ["model_mismatch"],
      alternatives: 2
    }
  ]
};
```

### Performance Metrics

**Target Performance** (1000 records):

| Phase | Time Budget | Operations |
|-------|-------------|------------|
| Index Building | 5s | Build 3 indexes from CDK data |
| Phase 1 (Exact) | 10s | 1000 Map lookups |
| Phase 2 (Numeric) | 10s | ~100 lookups + disambiguation |
| Phase 3 (Partial) | 5s | ~10 lookups + scoring |
| **Total** | **30s** | **Complete matching** |

**Actual Complexity**:
- Index build: O(n) where n = CDK records
- Exact match: O(1) per lookup
- Numeric match: O(k) where k = collision count (typically 1-3)
- Partial match: O(k²) worst case for disambiguation

**Memory Usage**:
- CDK Index: ~1KB per record × 1000 = ~1MB
- Match results: ~2KB per record × 1000 = ~2MB
- Total: ~3MB (well under 50MB limit)

## Configuration Options

### User-Configurable Matching Rules

```javascript
const matchingConfig = {
  // Basic rules
  caseSensitive: false,           // Default: false
  trimWhitespace: true,           // Default: true
  ignoreLeadingZeros: true,       // Default: true
  
  // Partial matching
  enablePartialMatch: false,      // Default: false (too risky)
  partialMatchLength: 6,          // Default: 6 characters
  
  // Disambiguation
  useModelValidation: true,       // Default: true
  useCustomerValidation: false,   // Default: false (names vary)
  
  // Confidence thresholds
  autoApproveThreshold: 0.95,    // Default: 0.95
  reviewThreshold: 0.70,          // Default: 0.70
  
  // Performance
  maxCandidatesPerPhase: 5,      // Limit disambiguation candidates
  enableProgressUpdates: true     // UI progress updates
};
```

### Saved Configuration in Properties Service

```javascript
// Structure stored in Properties Service
{
  "EXCEL_MERGE_CONFIG": {
    "matchingRules": {
      "caseSensitive": false,
      "trimWhitespace": true,
      "ignoreLeadingZeros": true,
      "enablePartialMatch": false,
      "partialMatchLength": 6,
      "autoApproveThreshold": 0.95,
      "reviewThreshold": 0.70
    },
    "lastUsed": "2025-01-15T10:30:00Z"
  }
}
```

## Edge Cases and Handling

### 1. Duplicate Stock Numbers in Sales Log

**Scenario**: Same stock number appears twice in Sales Log

**Detection**:
```javascript
const stockCounts = new Map();
salesLogRecords.forEach((record, idx) => {
  const stock = record.stockNumberNew || record.stockNumberUsed;
  if (stock) {
    if (!stockCounts.has(stock)) {
      stockCounts.set(stock, []);
    }
    stockCounts.get(stock).push(idx);
  }
});

const duplicates = Array.from(stockCounts.entries())
  .filter(([stock, indices]) => indices.length > 1);
```

**Resolution**:
- Flag all instances for manual review
- Show duplicate list to user
- Allow user to select which record to match
- Mark others as "duplicate_stock"

### 2. Missing Stock Numbers

**Scenario**: Sales Log record has blank stock number

**Handling**:
```javascript
if (!stockNumber || stockNumber.trim() === "") {
  return {
    matched: false,
    reason: "blank_stock_number",
    confidence: 0,
    requiresManualEntry: true
  };
}
```

**User Action**: Offer to manually enter stock number or skip record

### 3. Corrupted Stock Numbers

**Scenario**: Stock number contains invalid characters

**Detection**:
```javascript
function isValidStockNumber(stock) {
  // Valid formats: Letters + Numbers, or Numbers only
  // Invalid: Special chars (!@#$%), emoji, etc.
  return /^[A-Z0-9\s-]+$/i.test(stock);
}
```

**Handling**:
- Attempt to clean (remove special chars)
- If still invalid, flag for manual review
- Show original vs cleaned version to user

### 4. Multiple CDK Records Per Stock

**Scenario**: CDK has duplicate stock numbers (rare but possible)

**Detection**: During index build (logged as warning)

**Resolution**:
1. Keep first occurrence in exact index
2. Add all to numeric/partial indexes
3. Disambiguation logic chooses best match
4. Flag for review if confidence < 0.95

### 5. StockType Mismatch

**Scenario**: 
- Sales Log has stock in "New" column (E)
- CDK has stockType = "USED"

**Handling**:
```javascript
if (!validateStockType(cdkRecord, isNew)) {
  return {
    matched: true, // Stock numbers matched
    cdkRecord: cdkRecord,
    matchType: "exact_type_mismatch",
    confidence: 0.80, // Lower confidence
    requiresReview: true,
    warnings: [{
      type: "stock_type_mismatch",
      message: `Sales Log indicates ${isNew ? 'NEW' : 'USED'} but CDK shows ${cdkRecord.stockType}`,
      severity: "medium"
    }]
  };
}
```

## Algorithm Testing Scenarios

### Test Case Matrix

| Test Case | Sales Log Stock | CDK Stock | Expected Match | Match Type |
|-----------|-----------------|-----------|----------------|------------|
| 1. Exact match | T5102344 | T5102344 | ✓ | exact |
| 2. Case difference | t5102344 | T5102344 | ✓ | exact |
| 3. Leading zeros | 001234 | 1234 | ✓ | numeric |
| 4. Spaces | T 5102 344 | T5102344 | ✓ | exact |
| 5. Prefix variation | NEW5102344 | T5102344 | ✓ | numeric |
| 6. Partial suffix | XY5102344 | T5102344 | ✓ | partial |
| 7. No match | ZZZ999 | (not in CDK) | ✗ | unmatched |
| 8. Blank | (empty) | (any) | ✗ | blank_stock |
| 9. Type mismatch | T5102344 (col E) | T5102344 (USED) | ⚠ | needs_review |
| 10. Duplicate CDK | ABC123 | ABC123, ABC123 | ⚠ | needs_review |

### Performance Benchmarks

**Dataset Sizes**:

| Records | Index Build | Matching | Total | Target |
|---------|-------------|----------|-------|--------|
| 100 | 0.5s | 1s | 1.5s | 5s |
| 250 | 1s | 2.5s | 3.5s | 10s |
| 500 | 2s | 5s | 7s | 15s |
| 1000 | 5s | 10s | 15s | 30s |
| 2000 | 10s | 20s | 30s | 60s |

## Algorithm Optimization Notes

### Memory Optimization

**Index Size Reduction**:
```javascript
// Instead of storing full record in each index:
indexes.exact.set(key, fullRecord); // ~1KB per record

// Store index reference only:
indexes.exact.set(key, recordIndex); // ~8 bytes per record
// Then lookup: cdkRecords[recordIndex]

// Memory savings: ~125x for large datasets
```

### Lookup Optimization

**Fast Path for Common Cases**:
```javascript
function matchRecordOptimized(salesLogRecord, indexes, config) {
  // Fast path: Exact match (90% of cases)
  const exactNorm = normalizeExact(stockNumber);
  if (exactNorm && indexes.exact.has(exactNorm)) {
    // Inline type check (avoid function call overhead)
    const idx = indexes.exact.get(exactNorm);
    const cdk = cdkRecords[idx];
    if (validateStockTypeInline(cdk.stockType, isNew)) {
      return createExactMatch(cdk);
    }
  }
  
  // Slow path: Numeric and partial matching
  return matchRecordFull(salesLogRecord, indexes, config);
}
```

## Summary

**Algorithm Characteristics**:

| Aspect | Specification |
|--------|--------------|
| Match Rate Target | >95% for valid stock numbers |
| Performance | <30s for 1000 records |
| Phases | 3 (Exact → Numeric → Partial) |
| Confidence Scoring | 0.0-1.0 scale |
| Auto-Approval | Confidence ≥ 0.95 |
| Manual Review | 0.70 ≤ Confidence < 0.95 |
| Rejection | Confidence < 0.70 |

**Key Features**:
- Multi-phase matching with fallback
- Format normalization handles common variations
- Disambiguation for ambiguous cases
- Confidence scoring for review prioritization
- Batch processing prevents timeout
- Comprehensive validation and quality checks

**Extensibility**:
- Configurable via Properties Service
- Can add new normalization rules
- Can adjust confidence thresholds
- Can enable/disable phases
- Supports future ML-based matching