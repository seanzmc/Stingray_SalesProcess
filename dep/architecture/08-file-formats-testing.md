# File Format Specifications and Testing Strategy

## Part 1: File Format Specifications

### Input File Formats

#### Sales Log Excel File (MONTHLY Sheet Export)

**Format**: Excel (.xlsx, .xls) or CSV (.csv)

**Expected Structure**:

```
Row 1: Headers (or data if no headers)
Row 2+: Data rows

Columns (14 minimum):
A: Row number (optional, may be regenerated)
B: Customer Last Name
C: Model
D: FI Flag (New) - Single letter A-Z or blank
E: Stock # (New) - Primary key for new vehicles
F: Trade Stock # (New)
G: Salesperson (New)
H: (blank/spacing)
I: (blank/spacing)
J: FI Flag (Used) - Single letter A-Z or blank
K: (blank/spacing)
L: Stock # (Used) - Primary key for used vehicles
M: Trade Stock # (Used)
N: Salesperson (Used)
```

**Data Types**:
- Text columns: B, C, D, E, F, G, J, L, M, N
- Numeric columns: A
- May contain formulas (will be evaluated to values)

**Special Considerations**:
- Stock numbers may be text or numeric type
- Leading zeros may be preserved or lost
- FI flags must be exactly 1 character (A-Z)
- Salesperson may contain "/" for split sales
- Empty rows between data are acceptable

**Sample Row**:
```csv
1,"Cain, Cornel","CORV","C","T5102344","NT","JOHNSON,DAVID","","","","","","",""
```

**Validation Rules**:
- Must have at least column E or L with data (stock numbers)
- Customer name (col B) should not be empty for matched records
- Model (col C) recommended but not required
- If FI flag is A-Z, stock number in same section must not be empty

---

#### CDK Export Excel File

**Format**: Excel (.xlsx) - System export format

**Expected Structure**:

```
Row 1: Headers
Row 2+: Data rows

Columns (21 minimum, A-U):
A: Contract Date
B: Customer
C: VIN
D: Stock No. - Primary key for matching
E: Status
F: PLC
G: Sale Type
H: Year
I: Model
J: StockType - NEW or USED (determines column E vs L match)
K: Front GP$ - Data to extract
L: Back GP$ - Data to extract
M: GP$ (Total) - Data to extract
N: Cash Price
O: Trades
P: Service Contract
Q: Finance Institution
R: Salesperson
S: FI Manager
T: Term
U: Deal No.
```

**Data Types**:
- Date columns: A
- Text columns: B, C, D, E, F, G, I, J, Q, R, S, T
- Numeric columns: H, K, L, M, N, O, P, U
- Currency formatted: K, L, M, N, O, P

**Special Considerations**:
- Stock No. (col D) is critical - must not be empty
- StockType (col J) must be "NEW" or "USED" (or N/U)
- GP columns may be negative (losses)
- Customer format: "Last, First" or "Last, First Middle"

**Sample Row**:
```csv
"2025-09-26","Cain, Cornel","1G1YB3D49T5102344","T5102344","F","P","Retail",2026,"CORV","NEW",4689.00,411.00,5100.00,107085.00,"","","CASH","6587 - JOHNSON,DAVID","6471 - GERTS,ERIC","Cash",73154
```

**Validation Rules**:
- Stock No. (col D) must not be empty
- StockType (col J) must be valid value
- At least one GP column (K, L, or M) should have data
- Contract Date (col A) should be valid date
- Deal No. (col U) should be unique

### Output File Formats

#### MERGED_DATA Sheet

**Structure**: Google Sheet with 20 columns (A-T)

**Columns**:

```
A-N: Original Sales Log columns (preserved exactly)
  A: # (row number, regenerated)
  B: Customer
  C: Model
  D: FI (New)
  E: Stock # (New)
  F: Trade (New)
  G: Salesperson (New)
  H-I: (blank)
  J: FI (Used)
  K: (blank)
  L: Stock # (Used)
  M: Trade (Used)
  N: Salesperson (Used)

O-T: Appended CDK data (new columns)
  O: Front GP$ (from CDK col K)
  P: Back GP$ (from CDK col L)
  Q: Total GP$ (from CDK col M)
  R: Match Type (exact/numeric/partial/unmatched)
  S: Matched Stock # (from CDK col D)
  T: CDK Contract Date (from CDK col A)
```

**Formatting**:

```javascript
const OUTPUT_FORMATTING = {
  headers: {
    row: 1,
    fontWeight: 'bold',
    fontSize: 11,
    backgroundColor: '#4285f4',
    fontColor: '#ffffff',
    horizontalAlignment: 'center',
    border: true
  },
  data: {
    startRow: 2,
    fontFamily: 'Calibri',
    fontSize: 10,
    horizontalAlignment: 'center',
    border: true
  },
  columns: {
    A: { numberFormat: '0', width: 40 },
    B: { horizontalAlignment: 'left', width: 120 },
    C: { width: 80 },
    D: { width: 40 },
    E: { width: 100 },
    F: { width: 80 },
    G: { horizontalAlignment: 'left', width: 120 },
    O: { numberFormat: '$#,##0.00', width: 90 },
    P: { numberFormat: '$#,##0.00', width: 90 },
    Q: { numberFormat: '$#,##0.00', width: 90 },
    R: { width: 80 },
    S: { width: 100 },
    T: { numberFormat: 'M/d/yyyy', width: 90 }
  },
  conditionalFormatting: {
    matchType: {
      exact: { background: '#d4edda', fontColor: '#155724' },
      numeric: { background: '#fff3cd', fontColor: '#856404' },
      partial: { background: '#f8d7da', fontColor: '#721c24' },
      unmatched: { background: '#f5c6cb', fontColor: '#721c24' }
    }
  }
};
```

**Sample Output Row**:
```
1 | Cain, Cornel | CORV | C | T5102344 | NT | JOHNSON,DAVID | | | | | | | | $4,689.00 | $411.00 | $5,100.00 | exact | T5102344 | 9/26/2025
```

#### UNMATCHED Sheet

**Structure**: Records that couldn't be matched

**Columns** (A-H):

```
A: Original Row # (from Sales Log)
B: Stock Number (attempted match)
C: Customer
D: Model
E: Type (NEW or USED)
F: Salesperson
G: Reason (why no match)
H: Suggestions (potential fixes)
```

**Formatting**:
- Red header row
- Alternating row colors for readability
- Stock numbers in bold
- Suggestions in smaller font

**Sample Row**:
```
15 | ABC123 | Smith, John | TRAV | NEW | JOHNSON,DAVID | Stock not found in CDK | Verify stock number spelling; Check if deal in CDK export
```

#### MERGE_LOG Sheet

**Structure**: Audit trail of all merge operations

**Columns** (A-J):

```
A: Timestamp
B: User Email
C: Session ID
D: Sales Log File
E: CDK File
F: Records Processed
G: Matched
H: Match Rate
I: Processing Time (sec)
J: Status
```

**Sample Entries**:
```
2025-01-15 10:35:00 | user@example.com | uuid-123 | september.xlsx | cdk_sept.xlsx | 250 | 247 | 98.8% | 23.4 | Success
2025-01-14 14:20:15 | user@example.com | uuid-456 | august.xlsx | cdk_aug.xlsx | 235 | 180 | 76.6% | 18.2 | Low Match Rate
2025-01-13 09:15:30 | user@example.com | uuid-789 | july.csv | cdk_july.xlsx | 0 | 0 | 0% | 0.5 | Error: Missing columns
```

### Export Formats

#### Excel Export (Future Enhancement)

**Option**: Download MERGED_DATA as Excel file

**Method**:
```javascript
function exportMergedDataAsExcel() {
  // Convert MERGED_DATA sheet to Excel
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('MERGED_DATA');
  
  const url = 'https://docs.google.com/spreadsheets/d/' + 
              SpreadsheetApp.getActiveSpreadsheet().getId() + 
              '/export?format=xlsx&gid=' + sheet.getSheetId();
  
  return {
    success: true,
    downloadUrl: url,
    fileName: `merged_data_${new Date().toISOString().split('T')[0]}.xlsx`
  };
}
```

---

## Part 2: Testing Strategy

### Testing Pyramid

```
              ┌──────────────┐
              │   Manual     │  10% - Final validation
              │   Testing    │
              ├──────────────┤
              │ Integration  │  20% - Module interaction
              │   Testing    │
              ├──────────────┤
              │     Unit     │  70% - Function-level
              │   Testing    │
              └──────────────┘
```

### Unit Testing

#### Test Framework Setup

**Use QUnit for Apps Script**:

```javascript
// test_runner.js
function runAllTests() {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    errors: []
  };
  
  // Run test suites
  runNormalizationTests(results);
  runMatchingTests(results);
  runValidationTests(results);
  runMergeTests(results);
  
  // Display results
  displayTestResults(results);
  
  return results;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error('Assertion failed: ' + message);
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: Expected ${expected}, got ${actual}`);
  }
}
```

#### Test Suites

**1. Stock Number Normalization Tests**:

```javascript
function runNormalizationTests(results) {
  const tests = [
    {
      name: 'normalizeExact - removes spaces',
      fn: () => {
        assertEquals(
          normalizeExact('T 5102344'),
          'T5102344',
          'Should remove internal spaces'
        );
      }
    },
    {
      name: 'normalizeExact - uppercases',
      fn: () => {
        assertEquals(
          normalizeExact('t5102344'),
          'T5102344',
          'Should convert to uppercase'
        );
      }
    },
    {
      name: 'normalizeNumeric - removes prefix',
      fn: () => {
        assertEquals(
          normalizeNumeric('T5102344'),
          '5102344',
          'Should remove letter prefix'
        );
      }
    },
    {
      name: 'normalizeNumeric - removes leading zeros',
      fn: () => {
        assertEquals(
          normalizeNumeric('T001234'),
          '1234',
          'Should remove leading zeros'
        );
      }
    },
    {
      name: 'normalizePartial - gets suffix',
      fn: () => {
        assertEquals(
          normalizePartial('T5102344', 6),
          '102344',
          'Should return last 6 characters'
        );
      }
    }
  ];
  
  runTestSuite('Normalization', tests, results);
}

/**
 * 2. Matching Algorithm Tests
 */
function runMatchingTests(results) {
  const tests = [
    {
      name: 'exactMatch - finds perfect match',
      fn: () => {
        const cdkData = [{ stockNo: 'T5102344', stockType: 'NEW' }];
        const indexes = buildStockIndexes(cdkData, {});
        
        const salesRecord = { 
          stockNumberNew: 'T5102344',
          stockNumberUsed: '' 
        };
        
        const result = matchRecord(salesRecord, indexes, {});
        
        assert(result.matched, 'Should find exact match');
        assertEquals(result.matchType, 'exact', 'Should be exact match type');
        assertEquals(result.confidence, 1.0, 'Should have 100% confidence');
      }
    },
    {
      name: 'numericMatch - handles leading zeros',
      fn: () => {
        const cdkData = [{ stockNo: '1234', stockType: 'NEW' }];
        const indexes = buildStockIndexes(cdkData, {});
        
        const salesRecord = { 
          stockNumberNew: '001234',
          stockNumberUsed: '' 
        };
        
        const result = matchRecord(salesRecord, indexes, {});
        
        assert(result.matched, 'Should match despite leading zeros');
        assertEquals(result.matchType, 'numeric', 'Should be numeric match');
      }
    },
    {
      name: 'stockTypeValidation - rejects type mismatch',
      fn: () => {
        const cdkData = [{ stockNo: 'T5102344', stockType: 'USED' }];
        const indexes = buildStockIndexes(cdkData, {});
        
        const salesRecord = { 
          stockNumberNew: 'T5102344',  // NEW position
          stockNumberUsed: '' 
        };
        
        const result = matchRecord(salesRecord, indexes, {});
        
        // Should either not match or flag for review
        if (result.matched) {
          assert(result.requiresReview, 'Should flag type mismatch for review');
        }
      }
    }
  ];
  
  runTestSuite('Matching Algorithm', tests, results);
}

/**
 * 3. Validation Tests
 */
function runValidationTests(results) {
  const tests = [
    {
      name: 'validateFile - rejects invalid type',
      fn: () => {
        const file = { name: 'test.pdf', size: 1000 };
        const result = validateFileClient(file);
        
        assert(!result.valid, 'Should reject PDF files');
        assert(result.errors.length > 0, 'Should have error messages');
      }
    },
    {
      name: 'validateFile - rejects oversized',
      fn: () => {
        const file = { name: 'test.xlsx', size: 60 * 1024 * 1024 };
        const result = validateFileClient(file);
        
        assert(!result.valid, 'Should reject >50MB files');
      }
    },
    {
      name: 'validateStructure - checks required columns',
      fn: () => {
        const data = [
          ['Customer', 'Model'], // Missing Stock # column
          ['Smith', 'CORV']
        ];
        
        const result = validateSalesLogStructure(data, {});
        
        assert(!result.valid, 'Should detect missing Stock # column');
      }
    }
  ];
  
  runTestSuite('Validation', tests, results);
}

/**
 * 4. Data Merge Tests
 */
function runMergeTests(results) {
  const tests = [
    {
      name: 'createMergedRecord - preserves original data',
      fn: () => {
        const salesRecord = {
          customerLastName: 'Smith',
          model: 'CORV',
          stockNumberNew: 'T5102344'
        };
        
        const cdkRecord = {
          frontGP: 4689.00,
          backGP: 411.00,
          totalGP: 5100.00
        };
        
        const merged = createMergedRecord(salesRecord, cdkRecord, {});
        
        assertEquals(merged[1], 'Smith', 'Should preserve customer');
        assertEquals(merged[2], 'CORV', 'Should preserve model');
        assertEquals(merged[14], 4689.00, 'Should append front GP');
      }
    },
    {
      name: 'createUnmatchedRecord - fills with nulls',
      fn: () => {
        const salesRecord = { stockNumberNew: 'ABC123' };
        const unmatched = createUnmatchedSalesRecord(salesRecord);
        
        assert(unmatched[14] === null || unmatched[14] === '', 
               'GP columns should be empty for unmatched');
        assertEquals(unmatched[17], 'unmatched', 'Match type should be unmatched');
      }
    }
  ];
  
  runTestSuite('Data Merge', tests, results);
}

/**
 * Test suite runner
 */
function runTestSuite(suiteName, tests, results) {
  Logger.log(`\n=== Running ${suiteName} Tests ===`);
  
  tests.forEach(test => {
    results.total++;
    try {
      test.fn();
      results.passed++;
      Logger.log(`✓ ${test.name}`);
    } catch (error) {
      results.failed++;
      results.errors.push({
        suite: suiteName,
        test: test.name,
        error: error.message
      });
      Logger.log(`✗ ${test.name}: ${error.message}`);
    }
  });
}
```

### Integration Testing

#### Test Scenarios

**Scenario 1: Complete Happy Path**

```javascript
function testCompleteWorkflow() {
  const sessionId = 'test_session_' + Date.now();
  
  try {
    // 1. Upload Sales Log
    const salesResult = uploadSalesLogFile(
      getSampleSalesLogData(),
      'test_saleslog.csv',
      sessionId
    );
    assert(salesResult.success, 'Sales log upload should succeed');
    
    // 2. Upload CDK
    const cdkResult = uploadCDKFile(
      getSampleCDKData(),
      'test_cdk.csv',
      sessionId
    );
    assert(cdkResult.success, 'CDK upload should succeed');
    
    // 3. Execute merge
    const mergeResult = executeMerge(sessionId, {
      enablePartialMatch: false,
      autoApproveThreshold: 0.95
    });
    assert(mergeResult.success, 'Merge should succeed');
    assert(mergeResult.matchReport.stats.matchRate > 0.9, 
           'Match rate should be >90%');
    
    // 4. Verify output
    const outputSheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName('MERGED_DATA');
    assert(outputSheet !== null, 'Output sheet should be created');
    
    const outputData = outputSheet.getDataRange().getValues();
    assert(outputData.length > 1, 'Should have data rows');
    
    // 5. Verify merge log
    const logSheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName('MERGE_LOG');
    assert(logSheet !== null, 'Log sheet should exist');
    
    return { success: true, message: 'Complete workflow test passed' };
    
  } finally {
    // Cleanup
    cleanupSessionCache(sessionId);
  }
}
```

**Scenario 2: Error Recovery**

```javascript
function testErrorRecovery() {
  const sessionId = 'test_error_' + Date.now();
  
  // Test 1: Invalid file type
  const invalidResult = uploadSalesLogFile(
    'not-base64-data',
    'test.pdf',
    sessionId
  );
  assert(!invalidResult.success, 'Should reject invalid file type');
  assert(invalidResult.error.includes('format'), 'Should mention format error');
  
  // Test 2: Missing columns
  const incompleteData = [
    ['Customer'], // Missing other required columns
    ['Smith']
  ];
  const structureResult = validateSalesLogStructure(incompleteData, {});
  assert(!structureResult.valid, 'Should detect missing columns');
  
  // Test 3: Timeout recovery
  // (Simulate by creating checkpoint and resuming)
  const checkpoint = {
    sessionId: sessionId,
    processedRecords: 100,
    totalRecords: 250,
    results: { matched: 95, unmatched: 5 }
  };
  createMergeCheckpoint(sessionId, checkpoint);
  
  const resumeResult = resumeFromCheckpoint(sessionId);
  assert(resumeResult !== null, 'Should be able to resume from checkpoint');
  
  return { success: true };
}
```

### Performance Testing

#### Load Testing

```javascript
/**
 * Tests performance with various dataset sizes
 */
function testPerformance() {
  const testCases = [
    { records: 100, expectedTime: 5 },
    { records: 250, expectedTime: 10 },
    { records: 500, expectedTime: 20 },
    { records: 1000, expectedTime: 40 }
  ];
  
  const results = [];
  
  testCases.forEach(testCase => {
    const startTime = Date.now();
    
    // Generate test data
    const salesLog = generateTestSalesLog(testCase.records);
    const cdk = generateTestCDK(testCase.records);
    
    // Build indexes
    const indexes = buildStockIndexes(cdk, {});
    
    // Execute matching
    const matchResults = matchRecords(salesLog, indexes, {});
    
    const elapsedTime = (Date.now() - startTime) / 1000;
    
    results.push({
      records: testCase.records,
      expectedTime: testCase.expectedTime,
      actualTime: elapsedTime,
      passed: elapsedTime <= testCase.expectedTime,
      matchRate: matchResults.stats.matchRate
    });
    
    Logger.log(`Performance test - ${testCase.records} records: ${elapsedTime}s (expected: ${testCase.expectedTime}s)`);
  });
  
  return results;
}
```

#### Memory Testing

```javascript
/**
 * Tests memory efficiency with large datasets
 */
function testMemoryUsage() {
  const testSizes = [100, 500, 1000, 2000];
  const results = [];
  
  testSizes.forEach(size => {
    try {
      const salesLog = generateTestSalesLog(size);
      const cdk = generateTestCDK(size);
      
      // Attempt to build indexes
      const indexes = buildStockIndexes(cdk, {});
      
      // Attempt matching
      const matches = matchRecords(salesLog, indexes, {});
      
      results.push({
        size: size,
        success: true,
        message: `Successfully processed ${size} records`
      });
    } catch (error) {
      results.push({
        size: size,
        success: false,
        error: error.message
      });
      
      // If we hit memory limit, don't test larger sizes
      if (error.message.includes('memory')) {
        Logger.log(`Memory limit reached at ${size} records`);
        return results;
      }
    }
  });
  
  return results;
}
```

### Test Data Generation

```javascript
/**
 * Generates realistic test data for Sales Log
 */
function generateTestSalesLog(count) {
  const customers = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'];
  const models = ['CORV', 'TRAV', 'SILV15', 'EQUIN', 'TAHO'];
  const salespeople = ['JOHNSON,DAVID', 'RODRIGUEZ,FERMIN', 'ALLEN,MICHAEL'];
  
  const data = [SALES_LOG_HEADERS];
  
  for (let i = 0; i < count; i++) {
    const isNew = i % 2 === 0;
    const stockPrefix = isNew ? 'T' : 'K';
    const stockNumber = stockPrefix + (5100000 + i);
    
    const row = [
      i + 1,                                    // Row #
      customers[i % customers.length],          // Customer
      models[i % models.length],                // Model
      isNew ? 'F' : '',                         // FI (New)
      isNew ? stockNumber : '',                 // Stock (New)
      'NT',                                     // Trade
      isNew ? salespeople[i % salespeople.length] : '', // Salesperson
      '', '', '',                               // Blanks
      !isNew ? 'F' : '',                        // FI (Used)
      '',                                       // Blank
      !isNew ? stockNumber : '',                // Stock (Used)
      'NT',                                     // Trade
      !isNew ? salespeople[i % salespeople.length] : '' // Salesperson
    ];
    
    data.push(row);
  }
  
  return data;
}

/**
 * Generates realistic test data for CDK Export
 */
function generateTestCDK(count) {
  const data = [CDK_HEADERS];
  
  for (let i = 0; i < count; i++) {
    const isNew = i % 2 === 0;
    const stockPrefix = isNew ? 'T' : 'K';
    const stockNumber = stockPrefix + (5100000 + i);
    
    const row = [
      '2025-09-26',                             // Contract Date
      'Customer ' + i,                          // Customer
      'VIN' + i,                                // VIN
      stockNumber,                              // Stock No.
      'F',                                      // Status
      'P',                                      // PLC
      'Retail',                                 // Sale Type
      2025,                                     // Year
      'CORV',                                   // Model
      isNew ? 'NEW' : 'USED',                   // StockType
      1000 + (i * 10),                          // Front GP$
      500 + (i * 5),                            // Back GP$
      1500 + (i * 15),                          // Total GP$
      50000 + (i * 100),                        // Cash Price
      '',                                       // Trades
      '',                                       // Service Contract
      'CASH',                                   // Finance
      'SALESPERSON',                            // Salesperson
      'MANAGER',                                // FI Manager
      'Cash',                                   // Term
      70000 + i                                 // Deal No.
    ];
    
    data.push(row);
  }
  
  return data;
}
```

### Edge Case Testing

```javascript
/**
 * Tests edge cases and error conditions
 */
function testEdgeCases() {
  const tests = [
    {
      name: 'Empty file handling',
      fn: () => {
        const result = validateFileStructure([], 'salesLog');
        assert(!result.valid, 'Should reject empty file');
      }
    },
    {
      name: 'Single row file',
      fn: () => {
        const data = [['Header1', 'Header2']]; // Only headers
        const result = validateFileStructure(data, 'salesLog');
        assert(!result.valid, 'Should reject file with no data rows');
      }
    },
    {
      name: 'Blank stock numbers',
      fn: () => {
        const salesRecord = { 
          stockNumberNew: '',
          stockNumberUsed: ''
        };
        const result = matchRecord(salesRecord, {}, {});
        assert(!result.matched, 'Should not match blank stocks');
        assertEquals(result.reason, 'no_stock_number');
      }
    },
    {
      name: 'Duplicate stock numbers in CDK',
      fn: () => {
        const cdkData = [
          { stockNo: 'T5102344', stockType: 'NEW' },
          { stockNo: 'T5102344', stockType: 'NEW' }
        ];
        const indexes = buildStockIndexes(cdkData, {});
        
        // Should log warning about duplicate
        // Should use first occurrence
        assert(indexes.exact.size === 1, 'Should deduplicate in exact index');
      }
    },
    {
      name: 'Special characters in stock number',
      fn: () => {
        const invalid = normalizeExact('T-5102-344');
        const valid = normalizeExact('T5102344');
        
        // Normalization should handle dashes
        assertEquals(invalid, 'T5102344', 'Should remove dashes');
      }
    },
    {
      name: 'Very long stock numbers',
      fn: () => {
        const longStock = 'ABCDEFGHIJ1234567890';
        const normalized = normalizeExact(longStock);
        
        assert(normalized.length === longStock.length, 'Should preserve full length');
      }
    },
    {
      name: 'Mixed case variations',
      fn: () => {
        const variations = ['t5102344', 'T5102344', 'T5102344'];
        const normalized = variations.map(v => normalizeExact(v));
        
        assert(normalized.every(n => n === 'T5102344'), 'All should normalize to same value');
      }
    }
  ];
  
  runTestSuite('Edge Cases', tests, { total: 0, passed: 0, failed: 0, errors: [] });
}
```

### Manual Testing Checklist

#### Pre-Release Testing

**Functional Testing**:
- [ ] Upload .xlsx file successfully
- [ ] Upload .xls file successfully
- [ ] Upload .csv file successfully
- [ ] Reject invalid file types (.pdf, .txt)
- [ ] Reject oversized files (>50MB)
- [ ] Auto-detect columns correctly
- [ ] Manual column mapping works
- [ ] Save configuration persists
- [ ] Exact matching works
- [ ] Numeric matching works
- [ ] Partial matching works (if enabled)
- [ ] Review UI displays correctly
- [ ] Approve/reject actions work
- [ ] Merge completes successfully
- [ ] Output sheet formatted correctly
- [ ] Unmatched sheet created
- [ ] Merge log updated
- [ ] Error messages are clear
- [ ] Cancel operation works
- [ ] Session cleanup works

**Data Integrity Testing**:
- [ ] All Sales Log columns preserved
- [ ] CDK data appended correctly
- [ ] GP values match CDK source
- [ ] Match types labeled accurately
- [ ] Row numbers sequential
- [ ] No data corruption
- [ ] Formatting preserved
- [ ] Formulas not included (values only)

**Performance Testing**:
- [ ] 100 records: <10 seconds
- [ ] 250 records: <20 seconds
- [ ] 500 records: <40 seconds
- [ ] 1000 records: <90 seconds
- [ ] Progress updates smoothly
- [ ] No timeout on typical datasets
- [ ] Memory usage acceptable

**Error Handling Testing**:
- [ ] Wrong file: Clear error message
- [ ] Missing columns: Helpful guidance
- [ ] Corrupted Excel: Suggests CSV
- [ ] Low match rate: Offers adjustments
- [ ] Timeout: Shows checkpoint recovery
- [ ] Concurrent operation: Shows lock message

### User Acceptance Testing

#### Test Users and Scenarios

**User Type 1: Non-Technical User**
- Upload files for first time
- Use all auto-detected settings
- Complete merge without help
- Success criteria: <5 minutes, no errors

**User Type 2: Power User**
- Upload files with custom column mapping
- Adjust matching thresholds
- Review and manually resolve ambiguous matches
- Success criteria: Achieves >99% accuracy

**User Type 3: Error Recovery User**
- Intentionally upload wrong files
- Trigger various error conditions
- Follow recovery instructions
- Success criteria: Recovers without data loss

### Regression Testing

**Compatibility Testing**:

```javascript
/**
 * Tests compatibility with existing Sales Log Pro
 * Ensures merge tool doesn't break existing functionality
 */
function testSalesLogProCompatibility() {
  const tests = [
    {
      name: 'Does not modify MONTHLY sheet',
      fn: () => {
        const monthlyBefore = readMonthlySheet();
        executeSampleMerge();
        const monthlyAfter = readMonthlySheet();
        
        assertEquals(
          JSON.stringify(monthlyBefore),
          JSON.stringify(monthlyAfter),
          'MONTHLY sheet should not be modified'
        );
      }
    },
    {
      name: 'Does not modify TODAY sheet',
      fn: () => {
        const todayBefore = readTodaySheet();
        executeSampleMerge();
        const todayAfter = readTodaySheet();
        
        assertEquals(
          JSON.stringify(todayBefore),
          JSON.stringify(todayAfter),
          'TODAY sheet should not be modified'
        );
      }
    },
    {
      name: 'Existing menu items still work',
      fn: () => {
        // Verify processDaily still works
        // (This would be tested manually or with mock data)
        assert(typeof processDaily === 'function', 'processDaily should exist');
      }
    }
  ];
  
  runTestSuite('Sales Log Pro Compatibility', tests, {});
}
```

## Test Automation

### Continuous Testing Setup

```javascript
/**
 * Runs automated test suite
 * Can be triggered manually or via time-based trigger
 */
function runAutomatedTests() {
  const results = {
    timestamp: new Date().toISOString(),
    suites: []
  };
  
  // Run all test suites
  results.suites.push(runNormalizationTests({}));
  results.suites.push(runMatchingTests({}));
  results.suites.push(runValidationTests({}));
  results.suites.push(runMergeTests({}));
  
  // Generate report
  const totalTests = results.suites.reduce((sum, s) => sum + s.total, 0);
  const totalPassed = results.suites.reduce((sum, s) => sum + s.passed, 0);
  const totalFailed = results.suites.reduce((sum, s) => sum + s.failed, 0);
  
  const report = {
    timestamp: results.timestamp,
    total: totalTests,
    passed: totalPassed,
    failed: totalFailed,
    passRate: totalPassed / totalTests,
    suites: results.suites.map(s => ({
      name: s.name,
      passed: s.passed,
      failed: s.failed
    }))
  };
  
  // Log report
  Logger.log('=== Test Report ===');
  Logger.log(JSON.stringify(report, null, 2));
  
  // Optionally email report
  if (totalFailed > 0) {
    notifyTestFailures(report);
  }
  
  return report;
}
```

### Test Coverage Goals

**Target Coverage**:
- Unit tests: 80% code coverage
- Integration tests: All critical paths
- Manual tests: All user workflows
- Performance tests: All expected dataset sizes
- Error tests: All error types

**Priority Areas** (must have 100% coverage):
- Stock number normalization functions
- Matching algorithm phases
- Data validation functions
- Error classification and handling
- Atomic merge operations

## Summary

**File Formats**:
- ✅ Input: Excel (.xlsx, .xls) or CSV from Sales Log and CDK
- ✅ Output: Google Sheets (MERGED_DATA, UNMATCHED, MERGE_LOG)
- ✅ Structure: Well-defined columns with clear data types
- ✅ Validation: Multi-level checks from client to data integrity

**Testing Strategy**:
- ✅ Unit tests: 70% of testing effort (individual functions)
- ✅ Integration tests: 20% (module interactions)
- ✅ Manual tests: 10% (user workflows)
- ✅ Performance benchmarks: All dataset sizes
- ✅ Edge case coverage: Comprehensive error scenarios
- ✅ Regression tests: Compatibility with Sales Log Pro

**Quality Assurance**:
- Automated test suite for core functionality
- Manual checklist for user workflows
- Performance benchmarks for all operations
- Data integrity validation at every stage
- Clear acceptance criteria for each feature