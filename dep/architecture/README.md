# Excel Data Merge Tool - Architecture Documentation

## Executive Summary

The **Excel Data Merge Tool** is a Google Apps Script extension for the existing Sales Log Pro system that automates the merging of financial data from two Excel sources: the SALES LOG MONTHLY sheet and CDK system exports. The tool uses stock numbers as the primary key to match records and append gross profit figures from CDK data to the sales log.

**Key Benefits**:
- ⏱️ **Time Savings**: 20 minutes → 3 minutes per merge (85% reduction)
- 🎯 **Accuracy**: >95% automated match rate with multi-phase matching algorithm
- 🔒 **Data Integrity**: Preserves original sales log data, atomic operations
- 👥 **User-Friendly**: Guided 5-step workflow for non-technical users
- 🔄 **Integrated**: Seamless integration with Sales Log Pro Google Sheets system

## Architecture at a Glance

**Technology**: Google Apps Script (JavaScript)
**Interface**: Google Sheets sidebar (HTML/CSS/JS)
**Storage**: Properties Service + Google Sheets
**Deployment**: Zero-config (built into spreadsheet)

**Core Algorithm**: Multi-phase stock number matching
1. **Phase 1**: Exact match (90% of records)
2. **Phase 2**: Numeric match (8% of records)
3. **Phase 3**: Partial match (2% of records)
4. **Manual Review**: Remaining records

## Document Structure

This architecture documentation is organized into 9 comprehensive documents:

### 1. [System Overview](./01-system-overview.md)
**Purpose**: High-level architecture and design decisions

**Contents**:
- System architecture diagram
- Integration with Sales Log Pro
- Technology choices and rationale
- Constraints and limitations
- Risk analysis
- Success criteria

**Read this if**: You need a broad understanding of the system

---

### 2. [Technology Stack](./02-technology-stack.md)
**Purpose**: Detailed technology selections and justifications

**Contents**:
- Google Apps Script capabilities
- Excel file processing options
- Storage architecture (Properties Service, Cache, Sheets)
- Performance optimization strategies
- Security considerations
- Browser compatibility
- Development tools

**Read this if**: You need to understand technology choices or set up development environment

---

### 3. [Data Flow](./03-data-flow.md)
**Purpose**: How data moves through the system

**Contents**:
- High-level data flow diagrams
- Detailed processing pipeline
- File upload sequence diagrams
- Stock matching flow
- Data merge and output flow
- State management
- Checkpoint and recovery
- Batch processing strategy

**Read this if**: You need to understand how data is processed from input to output

---

### 4. [Matching Algorithm](./04-matching-algorithm.md)
**Purpose**: Core stock number matching logic

**Contents**:
- Multi-phase matching strategy
- Normalization algorithms
- Index building and lookup
- Disambiguation logic
- Confidence scoring
- Performance optimization
- Edge case handling
- Test scenarios

**Read this if**: You need to understand or modify the matching algorithm

---

### 5. [Module Design](./05-module-design.md)
**Purpose**: Component structure and responsibilities

**Contents**:
- Module architecture
- Server-side modules (7 .js files)
- Client-side components (3 .html files)
- Function signatures and APIs
- Module dependencies
- Integration patterns
- Coding standards

**Read this if**: You're implementing or modifying code

---

### 6. [UI/UX Design](./06-ui-ux-design.md)
**Purpose**: User interface and experience design

**Contents**:
- Complete user workflow
- 5-step sidebar interface design
- Interactive component specifications
- Visual design (colors, typography, spacing)
- Error messages and guidance
- Loading and progress states
- Accessibility features
- Mockups and wireframes

**Read this if**: You're implementing the UI or improving user experience

---

### 7. [Storage & Error Handling](./07-storage-error-handling.md)
**Purpose**: Data persistence and error management

**Contents**:
- Multi-tier storage architecture
- Properties Service configuration schema
- Cache Service session management
- Sheet structures (MERGED_DATA, MERGE_LOG, UNMATCHED)
- Error classification system
- Validation framework (4 levels)
- Checkpoint and recovery system
- Atomic operations

**Read this if**: You need to understand data storage or error handling

---

### 8. [File Formats & Testing](./08-file-formats-testing.md)
**Purpose**: Input/output specifications and testing strategy

**Contents**:
- Sales Log Excel format specification
- CDK export format specification
- Output sheet structures and formatting
- Unit testing framework
- Integration testing scenarios
- Performance benchmarks
- Edge case testing
- Manual testing checklist

**Read this if**: You're working with file formats, testing, or quality assurance

---

### 9. [Implementation Roadmap](./09-implementation-roadmap.md)
**Purpose**: Development plan and timeline

**Contents**:
- 6-week phased implementation plan
- Detailed task breakdown by week/day
- Resource requirements (260 hours)
- Risk mitigation strategies
- Success metrics and KPIs
- Training and documentation plan
- Deployment strategy
- Maintenance and support plan
- Budget estimate ($39K development)

**Read this if**: You're planning, managing, or budgeting the project

## Quick Reference

### Key Technical Specifications

| Aspect | Specification |
|--------|---------------|
| **Language** | JavaScript (Google Apps Script V8) |
| **UI** | HTML5 sidebar (350px width) |
| **Storage** | Properties Service (config) + Sheets (data) |
| **File Formats** | Input: .xlsx, .xls, .csv / Output: Google Sheets |
| **Performance** | <30s for 1000 records, <2min typical (250 records) |
| **Match Rate** | >95% target accuracy |
| **Capacity** | Up to 5,000 records per merge |
| **Memory** | ~3MB for 1000 records (well under 50MB limit) |

### Module Overview

**Server-Side** (Apps Script .js files):
- `merge_controller.js` - Main orchestration (400-500 LOC)
- `file_processor.js` - Excel parsing (300-400 LOC)
- `stock_matcher.js` - Matching algorithm (400-500 LOC)
- `data_merger.js` - Data combination (200-300 LOC)
- `output_generator.js` - Output creation (300-400 LOC)
- `merge_config_service.js` - Configuration (200-300 LOC)
- `merge_validator.js` - Validation rules (250-350 LOC)

**Client-Side** (HTML files):
- `merge_sidebar.html` - UI template (300-400 LOC)
- `merge_sidebar.css.html` - Styles (200-300 LOC)
- `merge_sidebar.js.html` - Client logic (400-500 LOC)

**Reused** (Existing Sales Log Pro):
- `error_logger.js` - Error handling
- `utilities_locks.js` - Concurrency control
- `config_service.js` - Configuration patterns

**Total Estimated Code**: 3,050-3,950 lines

### Workflow Summary

```
1. Upload Files (30s)
   ↓
2. Verify Columns (10s)
   ↓
3. Match Records (20s)
   ↓
4. Review Results (30s)
   ↓
5. Complete Merge (10s)

Total: ~2 minutes
```

## Getting Started

### For Developers

1. **Review Documents in Order**:
   - Start with System Overview
   - Read Technology Stack for setup
   - Study Module Design for implementation
   - Reference others as needed

2. **Set Up Development Environment**:
   ```bash
   # Clone repository
   git clone [repo-url]
   
   # Install clasp
   npm install -g @google/clasp
   
   # Login to Google
   clasp login
   
   # Create test spreadsheet
   # Copy Sales Log Pro structure
   # Bind new Apps Script project
   ```

3. **Start Development**:
   - Begin with Phase 1 (Foundation)
   - Follow implementation roadmap
   - Run tests continuously
   - Review code against module design

### For Project Managers

1. **Review**:
   - System Overview (understand scope)
   - Implementation Roadmap (timeline and budget)
   - Module Design (effort estimation)

2. **Plan**:
   - Allocate resources per roadmap
   - Schedule stakeholder reviews
   - Plan user training
   - Set up monitoring

3. **Track**:
   - Weekly progress against roadmap
   - Risk register updates
   - Budget tracking
   - User feedback collection

### For Stakeholders

1. **Key Documents**:
   - System Overview (what and why)
   - Implementation Roadmap (when and how much)
   - UI/UX Design (user experience)

2. **Decision Points**:
   - Pre-Phase 2: Approve continued development
   - Pre-Production: Approve deployment
   - Post-Launch: Approve enhancements

## Architecture Highlights

### Innovation Points

1. **Multi-Phase Matching Algorithm**
   - Handles format variations intelligently
   - Balances accuracy with performance
   - Provides confidence scoring for review

2. **Checkpoint Recovery System**
   - Prevents data loss on timeout
   - Allows resume from interruption
   - Atomic merge operations

3. **Seamless Integration**
   - Minimal changes to existing codebase
   - Reuses proven utilities
   - Consistent UI patterns

4. **User-Centric Design**
   - Guided workflow prevents errors
   - Clear feedback at every step
   - Intelligent defaults reduce configuration

### Technical Excellence

**Performance Optimizations**:
- Batch processing prevents timeout
- Indexed lookups for O(1) matching
- Caching for repeated operations
- Streaming to minimize memory

**Reliability Features**:
- Comprehensive validation (4 levels)
- Checkpoint system for recovery
- Atomic operations for data integrity
- Extensive error handling

**Maintainability**:
- Modular architecture
- Clear separation of concerns
- Comprehensive documentation
- Consistent coding standards
- Reusable components

## Known Limitations

### Current Scope

**Not Included in Phase 1**:
- Automatic scheduled merges
- Direct CDK API integration
- Multi-source merging (only CDK + Sales Log)
- Advanced analytics on merged data
- Mobile interface optimization
- Bulk historical data processing

**Workarounds**:
- Users manually trigger merges monthly
- Export CDK data to Excel first
- Process one month at a time
- Use Google Sheets built-in analytics
- Desktop browser required

### Technical Constraints

**Google Apps Script Limits**:
- 6-minute execution time (handled via checkpoints)
- 50MB memory (handled via streaming)
- 50MB file upload (adequate for use case)
- Drive API quota: 400 calls/day (sufficient for monthly use)

**Scaling Limits**:
- Optimal: <1,000 records per merge
- Maximum: 5,000 records per merge
- Beyond 5,000: Requires architecture changes (Cloud Functions)

## Support and Maintenance

### Documentation

**For Users**:
- User guide (in documentation)
- Video tutorials (to be created)
- FAQ and troubleshooting
- Quick reference card

**For Developers**:
- Architecture documentation (this)
- Inline code comments
- API documentation
- Testing guide

### Getting Help

**During Development**:
- Technical questions: Review architecture docs
- Implementation questions: See module design
- Algorithm questions: See matching algorithm doc

**Post-Deployment**:
- User questions: User guide and FAQ
- Bug reports: MERGE_LOG sheet + error logs
- Feature requests: Submit to product backlog

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2025-01-15 | Initial architecture design |

## Contributors

**Architecture Design**: AI Assistant (Claude)
**Technical Review**: [To be assigned]
**Product Owner**: [To be assigned]

## Approval Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Technical Lead | | | |
| QA Lead | | | |
| Security Review | | | |

---

## Document Index

Full documentation set:

1. **[01-system-overview.md](./01-system-overview.md)** - Architecture overview and design decisions
2. **[02-technology-stack.md](./02-technology-stack.md)** - Technology selections and justifications
3. **[03-data-flow.md](./03-data-flow.md)** - Data flow diagrams and processing pipeline
4. **[04-matching-algorithm.md](./04-matching-algorithm.md)** - Stock number matching logic
5. **[05-module-design.md](./05-module-design.md)** - Component breakdown and APIs
6. **[06-ui-ux-design.md](./06-ui-ux-design.md)** - User interface design
7. **[07-storage-error-handling.md](./07-storage-error-handling.md)** - Storage and error strategies
8. **[08-file-formats-testing.md](./08-file-formats-testing.md)** - File specifications and testing
9. **[09-implementation-roadmap.md](./09-implementation-roadmap.md)** - Development plan and timeline

**Total Pages**: ~150 pages of comprehensive technical architecture

---

## Next Steps

### Immediate Actions

1. **Review**: Stakeholder review of architecture documents
2. **Approve**: Sign-off on technical approach
3. **Resource**: Allocate development team
4. **Plan**: Detailed sprint planning for Phase 1
5. **Start**: Kickoff development

### Questions Before Starting

1. **Approval**: Is the architecture approved as-is?
2. **Resources**: Is development team allocated?
3. **Timeline**: Is 6-week timeline acceptable?
4. **Budget**: Is $39K development budget approved?
5. **Scope**: Any changes to requirements?

---

**Architecture Status**: ✅ Complete and ready for implementation

**Recommended Next Mode**: Switch to **Code** mode to begin implementation