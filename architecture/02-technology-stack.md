# Technology Stack

## Overview

This document details the technology choices for the Excel Data Merge Tool, optimized for Google Apps Script environment and integration with the existing Sales Log Pro system.

## Core Technologies

### 1. Google Apps Script (GAS)

**Version**: V8 Runtime (Modern JavaScript ES6+)

**Primary Language**: Server-side JavaScript

**Key Capabilities**:
- Spreadsheet service for reading/writing Google Sheets
- Drive service for temporary file storage
- Utilities service for data parsing
- Properties Service for persistent configuration
- Cache Service for temporary data storage
- Lock Service for concurrency control
- HTML Service for custom UI

**Justification**:
- Native integration with Google Sheets
- No deployment complexity
- Automatic scaling and hosting
- Built-in authentication/authorization
- Consistent with existing Sales Log Pro codebase

### 2. Client-Side Technologies

#### HTML5
- Standard markup for sidebar interface
- File input elements for upload
- Drag-and-drop support for better UX

#### CSS3
- Modern styling matching existing Sales Log Pro UI
- Flexbox/Grid for responsive layouts
- CSS variables for theming consistency

#### Vanilla JavaScript (ES6+)
- No external libraries (Apps Script restrictions)
- Modern async/await patterns
- Modular code organization
- Event-driven architecture

**Why No Frameworks?**:
- Apps Script HtmlService has CSP restrictions
- No npm package support
- Vanilla JS is sufficient for UI complexity
- Reduces bundle size and load time
- Consistent with existing sidebar implementation

## Excel File Processing

### Option 1: XLSX Files (Primary)

**Method**: Google Drive API Conversion

```javascript
// Process flow:
1. Upload .xlsx to temp Drive location
2. Convert to Google Sheets format via Drive.Files.copy()
3. Read data using SpreadsheetApp
4. Delete temp files after processing
```

**Libraries**:
- Google Drive API (Advanced Service)
- SpreadsheetApp (built-in)
- Utilities service (built-in)

**Pros**:
- Native support via Drive conversion
- No external dependencies
- Handles all Excel formats (.xlsx, .xls)
- Preserves formulas and formatting metadata

**Cons**:
- Requires Drive API advanced service
- Temporary file creation overhead
- Quota limits (400 uploads per day per user)

### Option 2: CSV Files (Fallback)

**Method**: Built-in CSV Parser

```javascript
// Process flow:
1. Upload CSV content via HtmlService
2. Parse using Utilities.parseCsv()
3. Process in-memory (no temp files)
```

**Libraries**:
- Utilities.parseCsv() (built-in)

**Pros**:
- No Drive quota consumption
- Faster processing
- No temp file cleanup

**Cons**:
- Users must export from Excel manually
- Loss of formatting information
- Encoding issues possible

### Recommended Approach

**Hybrid Strategy**:
1. Primary: Accept .xlsx files, convert via Drive
2. Fallback: Accept .csv for users who prefer/need it
3. Detect file type from extension
4. Use appropriate processor

## Data Storage Architecture

### 1. Properties Service (Configuration)

**Purpose**: Persistent storage for user configurations

**Storage Structure**:
```javascript
{
  "EXCEL_MERGE_CONFIG": {
    "version": "1",
    "columnMappings": {
      "salesLog": {
        "newStockColumn": "E",
        "usedStockColumn": "L",
        "customerNameColumn": "B",
        "modelColumn": "C"
      },
      "cdkExport": {
        "stockColumn": "D",
        "stockTypeColumn": "J",
        "frontGPColumn": "K",
        "backGPColumn": "L",
        "totalGPColumn": "M"
      }
    },
    "matchingRules": {
      "caseSensitive": false,
      "trimWhitespace": true,
      "ignoreLeadingZeros": true,
      "partialMatchLength": 6
    },
    "outputSettings": {
      "sheetName": "MERGED_DATA",
      "includeUnmatched": true,
      "highlightMatches": true
    },
    "lastModified": "2025-01-15T10:30:00Z",
    "modifiedBy": "user@example.com"
  }
}
```

**Limits**: 9KB per property (adequate for config data)

### 2. Cache Service (Temporary Data)

**Purpose**: Short-term caching of processing results

**Use Cases**:
- Parsed file data (during processing session)
- Match results cache (between steps)
- Progress state (for resume capability)

**TTL**: 600 seconds (10 minutes) typical

### 3. Google Sheets (Data Storage)

**New Sheets to Create**:

#### MERGED_DATA
- Stores final merged output
- Preserves all original Sales Log columns
- Appends CDK gross profit columns
- Includes match metadata

#### MERGE_LOG
- Audit trail of all merge operations
- Timestamp, user, file names, match statistics
- Error logs for troubleshooting

#### CDK_STAGING (Optional)
- Temporary staging area for CDK data
- Allows preview before merge
- Deleted after successful merge

## Excel Parsing Libraries

### For Apps Script Environment

**Available Options**:

1. **Drive API + Sheets Conversion** (Recommended)
   - Native Google solution
   - Handles all Excel formats
   - Full feature support

2. **Utilities.parseCsv()** (Fallback)
   - Built-in function
   - CSV only
   - Simple and fast

3. **Custom XLSX Parser** (Not Recommended)
   - Would need pure JavaScript implementation
   - Complex (ZIP + XML parsing)
   - Performance concerns
   - Maintenance burden

**Selected**: Drive API conversion for primary workflow

## Data Processing Pipeline

### Batch Processing Strategy

```javascript
const BATCH_SIZE = 100; // Process 100 rows at a time
const CHECKPOINT_INTERVAL = 500; // Save progress every 500 rows

// Prevents timeout on large datasets
// Allows resume on failure
// Provides user feedback
```

### Memory Management

```javascript
// Avoid loading entire dataset into memory
// Use range-based reading:
const CHUNK_SIZE = 1000;
for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
  const chunk = sheet.getRange(i + 1, 1, 
                  Math.min(CHUNK_SIZE, totalRows - i), 
                  numColumns).getValues();
  processChunk(chunk);
  SpreadsheetApp.flush(); // Free memory
}
```

## Security Considerations

### 1. Input Validation

**File Validation**:
- File type checking (MIME type + extension)
- File size limits (50MB max)
- Virus scanning (automatic via Drive)
- Content validation before processing

**Data Validation**:
- Column existence checks
- Data type validation
- Range validation (no formulas in data cells)
- XSS prevention in user inputs

### 2. Access Control

**Permissions Required**:
- `https://www.googleapis.com/auth/spreadsheets` (read/write sheets)
- `https://www.googleapis.com/auth/drive.file` (temp file storage)
- `https://www.googleapis.com/auth/script.container.ui` (sidebar)

**Authorization**:
- OAuth 2.0 via Google
- Scoped to current spreadsheet only
- No external API calls
- User consent on first run

### 3. Data Privacy

**Principles**:
- Temporary files deleted immediately after processing
- No data sent to external servers
- All processing happens in user's Google environment
- Audit logs stored in user's spreadsheet only

## Performance Targets

| Operation | Target | Measured |
|-----------|--------|----------|
| File upload | <5s | Per 10MB |
| XLSX parsing | <10s | Per 1000 rows |
| Stock matching | <30s | Per 1000 records |
| Data merge | <20s | Per 1000 rows |
| Output generation | <10s | Per 1000 rows |
| **Total (1000 records)** | **<90s** | **Full pipeline** |

## Error Handling Framework

### Existing Patterns (Reuse)

From Sales Log Pro codebase:

1. **error_logger.js**
   - `logError(context, error, additionalData)`
   - `logWarning(context, message, data)`
   - Standardized logging format

2. **utilities_locks.js**
   - `acquireScriptLockWithRetry()`
   - Exponential backoff
   - Prevents concurrent operations

3. **Validation Patterns**
   - Pre-validation before operations
   - Defensive null checking
   - Clear error messages

### New Extensions

**Merge-Specific Error Types**:
```javascript
const MERGE_ERRORS = {
  FILE_UPLOAD_FAILED: 'File upload failed',
  INVALID_FILE_FORMAT: 'Invalid file format',
  COLUMN_NOT_FOUND: 'Required column not found',
  NO_STOCK_NUMBERS: 'No stock numbers found',
  MATCHING_FAILED: 'Stock number matching failed',
  MERGE_TIMEOUT: 'Processing timeout',
  INSUFFICIENT_MATCHES: 'Too few matches found'
};
```

## Browser Compatibility

**Target Browsers** (via Google Apps Script HtmlService):
- Chrome 90+ (primary)
- Firefox 88+ (supported)
- Safari 14+ (supported)
- Edge 90+ (supported)

**Features Used**:
- File API for uploads
- Fetch API for communication
- Promise/async-await
- ES6 modules (limited)
- CSS Grid/Flexbox

**Not Available**:
- WebSockets
- IndexedDB
- Service Workers
- External CDN resources (CSP restrictions)

## Development Tools

### Recommended IDE

**Option 1**: clasp (Command Line Apps Script)
```bash
# Push local files to Apps Script
clasp push
# Pull from Apps Script
clasp pull
```

**Option 2**: Apps Script Web Editor
- Built-in IDE at script.google.com
- Version history
- Autocomplete

**Option 3**: VS Code (Current)
- Local development
- Better code organization
- Git integration
- Use clasp for deployment

### Testing Tools

1. **Apps Script Logger**
   - `Logger.log()` for debug output
   - View in Executions tab

2. **Manual Testing**
   - Test spreadsheet with sample data
   - Multiple user accounts for concurrency testing

3. **Unit Testing Framework**
   - QUnit for Apps Script (minimal framework)
   - Test runner in separate script file

## Deployment Strategy

### Development Environment

1. Create test spreadsheet copy
2. Bind Apps Script project
3. Enable Drive API advanced service
4. Test with sample data

### Production Deployment

1. **Version Control**: Use Git + clasp
2. **Deployment Process**:
   - Test in dev spreadsheet
   - Create versioned deployment
   - Add to production spreadsheet
   - Monitor error logs

3. **Rollback Plan**:
   - Keep previous version deployments
   - Can revert via Manage Deployments

## Dependencies Summary

### External Dependencies

**None** - All functionality uses Google Apps Script built-in services

### Google APIs (Advanced Services)

Required to enable:
1. **Drive API** - For file conversion and temporary storage

Optional:
2. **Sheets API** - Alternative to SpreadsheetApp (not needed)

### Internal Dependencies

Existing Sales Log Pro modules to leverage:
- `error_logger.js` - Error handling
- `utilities_locks.js` - Concurrency control  
- `config_service.js` - Configuration patterns
- `validation_rules.js` - Validation patterns

## Scalability Considerations

### Current Scope

**Expected Volume**:
- Monthly merges: ~250 records (based on sample data)
- Maximum supported: 5,000 records per merge
- File size: Typically <5MB

### Growth Plan

If volumes increase beyond Apps Script limits:

**Phase 1** (0-5,000 records):
- Current Apps Script implementation
- No changes needed

**Phase 2** (5,000-50,000 records):
- Implement background processing
- Use time-driven triggers
- Multi-session processing

**Phase 3** (50,000+ records):
- Consider migration to Cloud Functions
- Apps Script may not be suitable
- Would require significant re-architecture

## Integration Points

### With Existing Sales Log Pro

**Menu Integration**:
```javascript
// Add to onOpen() in core_saleslogPro.js
function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu("Sales Tools");
  // ... existing items ...
  menu.addSeparator()
      .addItem("📊 Merge CDK Data", "openMergeSidebar")
      .addToUi();
}
```

**Shared Utilities**:
- Error logging framework
- Lock acquisition
- Toast notifications
- Alert dialogs
- Sheet validation patterns

**Data Access**:
- Read from MONTHLY sheet (source)
- Write to MERGED_DATA sheet (output)
- No modification of TODAY or SALESPEOPLE sheets

## Version Control Strategy

### File Organization

```
/
├── merge_controller.js       # Main orchestration
├── file_processor.js          # Excel parsing
├── stock_matcher.js           # Matching algorithm
├── data_merger.js             # Data combination
├── output_generator.js        # Result creation
├── merge_sidebar.html         # UI template
├── merge_sidebar.css.html     # Styles
├── merge_sidebar.js.html      # Client scripts
├── merge_config_service.js    # Configuration
└── appsscript.json           # Manifest (update existing)
```

### Git Integration

**Repository Structure**:
```
Stingray_SalesProcess/
├── saleslog_files/           # Existing Sales Log Pro
│   └── ...
├── merge_tool/               # NEW: Merge tool modules
│   ├── server/
│   │   ├── merge_controller.js
│   │   ├── file_processor.js
│   │   └── ...
│   └── client/
│       ├── merge_sidebar.html
│       └── ...
└── architecture/             # Documentation
    └── ...
```

**Deployment via clasp**:
```json
// .clasp.json
{
  "scriptId": "your-script-id",
  "rootDir": "./saleslog_files"
}
```

## Performance Optimization

### Caching Strategy

```javascript
// Multi-level caching
const CACHE_LEVELS = {
  // Script cache - 10 minutes, 100KB limit
  scriptCache: CacheService.getScriptCache(),
  
  // Document cache - Shared across users, same limits
  documentCache: CacheService.getDocumentCache(),
  
  // User cache - Per user, private
  userCache: CacheService.getUserCache()
};

// Usage:
const matchCache = CACHE_LEVELS.userCache;
matchCache.put('stock_matches_' + sessionId, 
               JSON.stringify(matches), 
               600); // 10 min TTL
```

### Batch Operations

**Principles**:
1. Read in batches of 100-1000 rows
2. Process in chunks to avoid memory issues
3. Write in batches using setValues() (faster than setValue())
4. Flush after each batch to free memory

**Example**:
```javascript
// Bad - 1000 individual writes
for (let i = 0; i < 1000; i++) {
  sheet.getRange(i + 1, 1).setValue(data[i]);
}

// Good - Single batch write
sheet.getRange(1, 1, 1000, 1).setValues(data);
```

## Quota and Limits

### Google Apps Script Quotas

| Resource | Free Tier | G Workspace |
|----------|-----------|-------------|
| Execution time | 6 min | 6 min |
| Triggers per day | 20 | 20 |
| Email sends | 100/day | 1500/day |
| Drive API calls | 400/day | 1000/day |
| Script runtime | 90 min/day | 90 min/day |
| Simultaneous executions | 30 | 30 |

### Mitigation Strategies

**For Execution Time**:
- Checkpoint system (save progress every 30s)
- Resume capability
- Progress indicators

**For Drive API Calls**:
- Minimize temp file creation
- Reuse converted files within session
- Cache parsed data

**For Memory**:
- Stream processing
- Batch operations
- Explicit garbage collection hints
- Clear ranges after processing

## External Services Integration

### None Required

All functionality provided by Google Apps Script ecosystem:
- ✅ File storage: Google Drive
- ✅ Database: Google Sheets
- ✅ Configuration: Properties Service
- ✅ Caching: Cache Service
- ✅ Authentication: Google OAuth
- ✅ UI: HtmlService

**Benefits**:
- No API keys to manage
- No external service dependencies
- No additional costs
- Simplified deployment

## Development Environment Setup

### Prerequisites

1. **Google Account** with access to spreadsheet
2. **Node.js** (for clasp CLI tool)
3. **Git** for version control
4. **VS Code** or preferred editor

### Setup Steps

```bash
# Install clasp
npm install -g @google/clasp

# Login to Google
clasp login

# Clone existing project
clasp clone [SCRIPT_ID]

# Enable Drive API
# In Apps Script editor: Resources > Advanced Google Services > Drive API
```

### Local Development Workflow

```bash
# Make changes locally
# Push to Apps Script
clasp push

# Test in spreadsheet
# Pull any web editor changes
clasp pull

# Deploy new version
clasp deploy --description "Merge tool v1.0"
```

## Monitoring and Observability

### Logging Strategy

**Levels**:
1. **ERROR**: Critical failures, user notification required
2. **WARNING**: Non-critical issues, operation continues
3. **INFO**: Progress milestones, successful operations
4. **DEBUG**: Detailed diagnostic information

**Implementation**:
```javascript
// Reuse existing error_logger.js
logError('mergeController', error, {
  operation: 'match_stocks',
  recordCount: 1000,
  matchRate: 0.95
});

// Custom merge-specific logging
function logMergeOperation(operation, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    operation: operation,
    user: Session.getActiveUser().getEmail(),
    ...data
  };
  
  // Write to MERGE_LOG sheet
  appendToMergeLog(entry);
  
  // Also log to Apps Script logger
  Logger.log('[Merge] ' + JSON.stringify(entry));
}
```

### Error Tracking

**Sources**:
1. Apps Script Executions log (automatic)
2. MERGE_LOG sheet (custom)
3. Error count in Properties Service

**Metrics to Track**:
- Success rate (successful merges / attempts)
- Average match rate (matched / total records)
- Average processing time
- Error frequency by type
- Unknown stock numbers rate

## Technology Comparison Matrix

### Why Google Apps Script vs. Alternatives

| Criteria | Apps Script | Python + Flask | Standalone Desktop |
|----------|-------------|----------------|-------------------|
| Integration | ⭐⭐⭐⭐⭐ Native | ⭐⭐ API calls | ⭐ Export/Import |
| Deployment | ⭐⭐⭐⭐⭐ Zero config | ⭐⭐ Server needed | ⭐⭐⭐ User install |
| User Experience | ⭐⭐⭐⭐⭐ Seamless | ⭐⭐⭐ Web UI | ⭐⭐⭐ Desktop GUI |
| Maintenance | ⭐⭐⭐⭐ Auto-update | ⭐⭐ Manual deploy | ⭐ User updates |
| Cost | ⭐⭐⭐⭐⭐ Free | ⭐⭐⭐ Hosting cost | ⭐⭐⭐⭐ Free |
| Performance | ⭐⭐⭐ Quotas apply | ⭐⭐⭐⭐ Scalable | ⭐⭐⭐⭐⭐ Fast |
| Excel Support | ⭐⭐⭐⭐ Via Drive | ⭐⭐⭐⭐⭐ openpyxl | ⭐⭐⭐⭐⭐ Native |

**Winner**: Google Apps Script - Best fit for this use case

## Future Technology Considerations

### Potential Enhancements

1. **Google Cloud Functions Integration**
   - If processing time exceeds 6 minutes
   - Asynchronous background jobs
   - Webhook callbacks

2. **BigQuery Integration**
   - For analytical queries on merged data
   - Historical trend analysis
   - Advanced reporting

3. **Apps Script Add-on**
   - Package as installable add-on
   - Distribute to other dealerships
   - Marketplace distribution

### Migration Path

If volume grows beyond Apps Script capabilities:

**Phase 1**: Apps Script (current design)
- Up to 5,000 records per merge
- Monthly processing

**Phase 2**: Apps Script + Cloud Functions
- Apps Script handles UI
- Cloud Functions handle heavy processing
- Up to 50,000 records

**Phase 3**: Full Cloud Platform
- Cloud Functions + Cloud Storage
- BigQuery for analytics
- Firestore for configuration
- Apps Script as thin client

## Summary

**Selected Technology Stack**:

| Layer | Technology | Justification |
|-------|------------|---------------|
| Runtime | Google Apps Script V8 | Native integration, zero deployment |
| Language | JavaScript (ES6+) | Required by Apps Script |
| UI Framework | HTML5 + CSS3 + Vanilla JS | Apps Script HtmlService compatible |
| Excel Processing | Drive API conversion | Native, supports all formats |
| Storage | Properties Service + Sheets | Built-in, no external dependencies |
| Caching | Cache Service | Built-in, adequate for use case |
| Security | Google OAuth 2.0 | Automatic, enterprise-grade |
| Error Handling | Existing error_logger.js | Proven, consistent patterns |

**Key Strengths**:
- Zero external dependencies
- Seamless integration with Sales Log Pro
- No deployment complexity
- Enterprise-grade security
- Automatic scaling
- Free hosting

**Known Limitations**:
- 6-minute execution time limit (mitigated via checkpoints)
- 50MB memory limit (mitigated via streaming)
- Drive API quotas (adequate for monthly processing)

This stack provides the optimal balance of integration, usability, and maintainability for the Excel Data Merge Tool.