# Excel Data Merge Tool - System Overview

## Executive Summary

The Excel Data Merge Tool is a Google Apps Script extension that merges financial data from two Excel sources (SALES LOG MONTHLY sheet and CDK system exports) using stock numbers as the primary key. It integrates seamlessly with the existing Sales Log Pro Google Sheets application.

## Integration Context

This tool extends the existing Sales Log Pro system by adding a new "Data Merge" feature accessible via:
- Custom menu item: **Sales Tools > Merge CDK Data**
- Sidebar interface for file upload and configuration
- New sheet in the spreadsheet for merged output

## System Architecture Type

**Technology Stack**: Google Apps Script (Server-side JavaScript)
- **Runtime**: Google Apps Script V8 Engine
- **UI Framework**: HtmlService (HTML5 + CSS3 + Vanilla JavaScript)
- **Storage**: Properties Service (configuration) + Google Sheets (data)
- **File Processing**: Google Drive API + Utilities.parseCsv() / XLSX parsing

## Core Principles

Following the established patterns in Sales Log Pro:

1. **Modular Architecture**: Separate concerns into focused .js modules
2. **Sidebar-Based UI**: Consistent with existing configuration interface
3. **Server-Side Processing**: Heavy lifting in Apps Script, client handles UI only
4. **Progressive Enhancement**: Works with basic browsers, no external dependencies
5. **Defensive Programming**: Extensive validation, error handling, and recovery
6. **Performance Optimization**: Batch operations, caching, timeout management
7. **User-Friendly**: Clear feedback, progress indicators, helpful error messages

## High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                  Google Sheets Application                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Sales Log Pro (Existing)                  │  │
│  │  • TODAY sheet (daily entry)                           │  │
│  │  • MONTHLY sheet (historical records)                  │  │
│  │  • SALESPEOPLE sheet (team config)                     │  │
│  │  • Core modules (processing, analytics, config)        │  │
│  └────────────────────────────────────────────────────────┘  │
│                            ▲                                  │
│                            │ Integration                      │
│                            ▼                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         Excel Data Merge Tool (NEW)                    │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  UI Layer (HTML Sidebar)                         │  │  │
│  │  │  • File upload interface                         │  │  │
│  │  │  • Configuration panel                           │  │  │
│  │  │  • Progress tracking                             │  │  │
│  │  │  • Results display                               │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  Server Layer (Apps Script Modules)              │  │  │
│  │  │  • merge_controller.js (orchestration)           │  │  │
│  │  │  • file_processor.js (Excel parsing)             │  │  │
│  │  │  • stock_matcher.js (matching algorithm)         │  │  │
│  │  │  • data_merger.js (combine data)                 │  │  │
│  │  │  • output_generator.js (create result)           │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  Storage Layer                                   │  │  │
│  │  │  • Properties Service (merge configs)            │  │  │
│  │  │  • MERGED_DATA sheet (output)                    │  │  │
│  │  │  • MERGE_LOG sheet (audit trail)                 │  │  │
│  │  │  • Cache Service (temp data)                     │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

External Systems:
┌─────────────────┐
│  User's Computer│
│  • Sales Log    │ ──upload──> Google Drive ──> Apps Script
│    Excel file   │
│  • CDK Export   │ ──upload──> Google Drive ──> Apps Script
│    .xlsx file   │
└─────────────────┘
```

## Key Design Decisions

### 1. Google Apps Script vs. Standalone Application

**Decision**: Implement as Google Apps Script extension

**Rationale**:
- Seamless integration with existing Sales Log Pro system
- No separate deployment or hosting required
- Unified data storage (all in one Google Sheet)
- Single authentication/permission model
- Familiar UI patterns for users already using Sales Log Pro
- Automatic updates via script deployment

### 2. File Upload Strategy

**Decision**: Use Google Drive API temporary file storage

**Why Not Blob Upload**:
- Apps Script has 50MB memory limit (files might exceed this)
- Drive API allows streaming and chunked processing
- Better error recovery for large files

**Flow**:
1. User uploads file via HTML input element
2. Client-side converts to base64
3. Server receives in chunks (if >10MB)
4. Server writes to temporary Drive file
5. Process file from Drive
6. Delete temporary file after processing

### 3. Excel File Processing

**Decision**: Use Google Apps Script's built-in Utilities + Drive API

**Options Evaluated**:
- ✅ **Utilities.parseCsv()** - For CSV exports (fallback option)
- ✅ **Drive API + conversion** - Convert .xlsx to Google Sheets temporarily
- ❌ External XLSX library - Not available in Apps Script environment

**Chosen Approach**:
1. Accept both .xlsx and .csv files
2. For .xlsx: Convert to Google Sheets via Drive API
3. Read data using Sheets API
4. Delete temporary converted sheet

### 4. Stock Number Matching Strategy

**Decision**: Multi-phase normalization with fuzzy matching fallback

**Phases**:
1. **Exact Match**: Direct comparison after normalization
2. **Numeric Match**: Strip non-numeric, compare as numbers
3. **Partial Match**: Last N characters match (configurable)
4. **Manual Review**: Flag unmatched for user decision

### 5. Output Strategy

**Decision**: Write to new MERGED_DATA sheet in same spreadsheet

**Benefits**:
- No file download/upload cycle
- Preserved in spreadsheet history
- Can reference merged data in formulas
- Automatic backup via Google Sheets version history

## Constraints and Limitations

### Google Apps Script Limits

1. **Execution Time**: 6 minutes maximum
   - Solution: Chunked processing with progress checkpoints
   
2. **Memory**: 50MB heap limit
   - Solution: Stream processing, batch operations
   
3. **Concurrent Executions**: Limited to prevent race conditions
   - Solution: Use LockService (already implemented in existing code)

4. **File Size**: 50MB upload limit via HtmlService
   - Solution: Progress indicators, chunked uploads for large files

### Data Constraints

1. **Stock Numbers**: May have format variations
   - Leading zeros (001 vs 1)
   - Spaces or dashes
   - Text vs numeric types
   - Missing or corrupt data

2. **Column Mapping**: Users may have different column layouts
   - Solution: Configurable column mapping saved in Properties Service

## Success Criteria

1. **Accuracy**: 99%+ match rate for valid stock numbers
2. **Performance**: Process 1000 records in <30 seconds
3. **Reliability**: Handle corrupted files without data loss
4. **Usability**: Complete merge workflow in <5 clicks
5. **Integration**: Seamless experience with existing Sales Log Pro
6. **Audit Trail**: Complete record of all merge operations

## Risk Analysis

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Large file timeout | High | Medium | Chunked processing, progress checkpoints |
| Stock number mismatch | High | High | Multi-phase matching, manual review UI |
| Corrupted Excel files | Medium | Medium | Comprehensive validation, error recovery |
| Concurrent merge operations | Medium | Low | LockService prevents race conditions |
| User error (wrong files) | Low | Medium | Preview before merge, confirmation dialogs |
| Data loss | Critical | Low | Checkpoint system, never modify originals |

## Next Steps

The following architecture documents provide detailed specifications:

1. **02-technology-stack.md** - Detailed technology choices and justifications
2. **03-data-flow.md** - Data flow diagrams and processing pipeline
3. **04-module-design.md** - Component breakdown and responsibilities  
4. **05-matching-algorithm.md** - Stock number matching logic
5. **06-ui-ux-design.md** - User interface and workflow design
6. **07-storage-design.md** - Data persistence strategy
7. **08-error-handling.md** - Error handling and validation
8. **09-testing-strategy.md** - Testing approach and test cases
9. **10-implementation-plan.md** - Development roadmap and milestones