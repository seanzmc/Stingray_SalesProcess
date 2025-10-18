# CDK Merge Tool - User Guide

**A Complete Guide to Merging CDK Financial Data with Your Sales Log**

---

## 📋 Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Getting Started](#3-getting-started)
4. [Step-by-Step Guide](#4-step-by-step-guide)
5. [Understanding the Output](#5-understanding-the-output)
6. [Configuration Management](#6-configuration-management)
7. [Common Scenarios](#7-common-scenarios)
8. [Troubleshooting](#8-troubleshooting)
9. [Best Practices](#9-best-practices)
10. [FAQ](#10-faq)
11. [Appendices](#11-appendices)

---

## 1. Overview

### What is the CDK Merge Tool?

The CDK Merge Tool is a Google Sheets add-on that automatically combines financial data from your CDK system exports with your Sales Log MONTHLY sheet. It matches records using stock numbers and enriches your sales data with detailed financial information like Front GP, Back GP, and Total GP.

### Who Should Use It?

This tool is designed for:
- **Sales Managers** who need to reconcile CDK data with sales logs
- **Finance Personnel** preparing monthly reports
- **Dealership Staff** tracking vehicle sales performance
- **Anyone** who regularly merges CDK exports with sales data

### What Problem Does It Solve?

**Before:** Manual data entry is time-consuming, error-prone, and tedious. Matching hundreds of records by stock number takes hours.

**After:** The tool automatically matches and merges data in minutes, with built-in validation to ensure accuracy.

### Key Benefits

✅ **Save Time** - Process hundreds of records in under a minute  
✅ **Reduce Errors** - Automated matching eliminates manual entry mistakes  
✅ **Increase Accuracy** - Smart matching handles format variations  
✅ **Audit Trail** - Complete history of all merge operations  
✅ **Easy Review** - Color-coded results highlight records needing attention  
✅ **No Training Needed** - Simple 5-step process anyone can follow

---

## 2. Prerequisites

### What You Need Before Starting

#### Required Files

📄 **Sales Log MONTHLY Sheet**
- Your current Google Sheets with sales log data
- Must have stock numbers in columns E (New) or L (Used)
- Customer names in column B

📄 **CDK Export File**
- Downloaded from your CDK system
- Must contain stock numbers and financial data
- Supported formats: `.xlsx`, `.xls`, or `.csv`

#### File Format Requirements

Your CDK export should include these columns:
- Stock Number
- Customer Last Name
- Total GP (Gross Profit)
- Front GP
- Back GP
- Contract Date
- VIN
- Model
- Year
- Salesperson

💡 **Tip:** The tool can auto-detect most common CDK export formats.

#### Access Permissions

✅ You need **edit access** to the Google Sheet  
✅ The sheet must have the Sales Tools add-on installed  
✅ Your CDK export file should be ready on your computer

#### System Requirements

- Modern web browser (Chrome, Firefox, Safari, or Edge)
- Internet connection
- Google account with access to the spreadsheet
- File size limit: 50MB maximum

⚠️ **Note:** Processing large files (>10MB) may take a few minutes.

---

## 3. Getting Started

### How to Access the Tool

1. **Open your Sales Log Google Sheet**
2. **Click the "Sales Tools" menu** at the top
3. **Select "Merge CDK Data"**

[📸 *Screenshot would show: Menu bar with Sales Tools > Merge CDK Data option highlighted*]

A sidebar will appear on the right side of your screen. This is your CDK Merge Tool interface.

### First-Time Setup

The first time you use the tool, you may see a permission request:

1. Click **"Continue"** when prompted
2. Select your **Google account**
3. Click **"Allow"** to grant necessary permissions

These permissions allow the tool to:
- Read your Sales Log data
- Upload and process your CDK file
- Write merged results to a new sheet

### Understanding the Interface

The sidebar has **5 steps** shown at the top:

```
[1] → [2] → [3] → [4] → [5]
Upload  Config  Match  Review  Complete
```

**Current step is highlighted in blue**. Each step must be completed before moving to the next.

---

## 4. Step-by-Step Guide

### Step 1: Upload CDK File

This step prepares your CDK export for merging.

#### How to Prepare Your CDK Export

Before uploading:
1. Download the export from your CDK system
2. Save it somewhere easy to find (Desktop or Downloads folder)
3. Make sure the file name makes sense (e.g., "CDK_September_2024.xlsx")

💡 **Tip:** Keep your original file as a backup. The tool won't modify it.

#### Upload Methods

**Method 1: Drag and Drop** (Easiest)
1. Locate your CDK file on your computer
2. Drag it into the upload area in the sidebar
3. Release to upload

**Method 2: Browse and Select**
1. Click anywhere in the upload area
2. Browse to find your file
3. Click "Open"

[📸 *Screenshot would show: Upload area with file icon and "Drop file here" text*]

#### What Happens During Upload

You'll see:
- ⏳ **"Uploading..."** - File is being transferred
- 🔍 **"Validating..."** - Checking file format
- 📊 **"Processing..."** - Reading file contents
- ✅ **Success message** with row count

**File Preview**

Once uploaded, you'll see:
- File name and size
- Number of rows detected
- First 5 rows as a preview

Review the preview to confirm:
- ✅ Headers look correct
- ✅ Stock numbers are present
- ✅ Data appears complete

#### What to Do If Upload Fails

**Error: "Unsupported file format"**
- ✔️ Convert to .xlsx, .xls, or .csv
- ✔️ Re-save from Excel or export again from CDK

**Error: "File too large"**
- ✔️ Split into smaller files
- ✔️ Remove unnecessary columns
- ✔️ Process in batches

**Error: "Upload failed"**
- ✔️ Check your internet connection
- ✔️ Try a smaller file first
- ✔️ Refresh the page and try again

#### Removing a File

Made a mistake? Click the **"Remove"** button to start over.

---

### Step 2: Configure Settings

Fine-tune how records are matched to ensure accuracy.

#### Section A: Column Mapping

The tool automatically detects columns from your CDK export.

**Auto-Detected Columns** ✓

Most CDK exports follow a standard format, so columns are usually correct. You'll see:

[📸 *Screenshot would show: Dropdown menus with auto-detected column selections*]

- **Stock Number Column** → Detected
- **Stock Type Column** → Detected
- **Front GP Column** → Detected
- **Back GP Column** → Detected
- **Total GP Column** → Detected

**Manual Override** (If Needed)

If auto-detection is wrong:
1. Click the dropdown for the incorrect column
2. Select the correct column name from your file
3. The tool will adjust automatically

💡 **Tip:** Column headers are shown exactly as they appear in your file.

#### Section B: Matching Options

These settings control how stock numbers are compared.

**Ignore Leading Zeros** ☑️ (Recommended: ON)

```
Sales Log: "001234"
CDK:       "1234"
Result:    ✅ MATCH
```

**Why:** CDK often removes leading zeros that exist in your Sales Log.

**Case Insensitive Matching** ☑️ (Recommended: ON)

```
Sales Log: "N1234"
CDK:       "n1234"
Result:    ✅ MATCH
```

**Why:** Different systems may use different capitalization.

**Enable Partial Matching** ☐ (Use with caution)

```
Sales Log: "N1234A"
CDK:       "N1234B"
Result:    ⚠️ POSSIBLE MATCH (if confidence high enough)
```

**When to use:**
- ✔️ When stock numbers have varying suffixes
- ✔️ When exact matching fails to find most records
- ✔️ When you plan to review results carefully

**When NOT to use:**
- ✖️ When stock numbers are very similar (risk of wrong matches)
- ✖️ For your first merge (start strict, then adjust)

#### Section C: Match Quality

**Confidence Threshold Slider** (70% - 100%)

```
[-------|--------] 70%  ← Loose (more matches, less certain)
[-------------|--] 85%  ← Balanced (recommended)
[--------------|-] 95%  ← Strict (fewer matches, more certain)
```

**What It Means:**
- **70%:** Accepts fuzzy matches if they're somewhat similar
- **85%:** Good balance of accuracy and coverage (DEFAULT)
- **95%+:** Only near-perfect matches accepted

**How to Choose:**

| Set to | When to Use |
|--------|-------------|
| **70-80%** | First time using tool, want to see what matches |
| **85%** | Normal monthly processing |
| **95-100%** | High-value vehicles, need absolute certainty |

**Show Records Needing Review** ☑️ (Recommended: ON)

This highlights matches that meet your threshold but have potential issues:
- Stock types don't match (New vs. Used)
- Customer names are very different
- GP values are unusually high or negative

---

### Step 3: Match Records

The tool now processes your data. This step is fully automated.

#### What's Happening

The tool performs a **3-phase matching algorithm**:

**Phase 1: Exact Match** (Fastest, most certain)
```
Sales Log: "N1234"
CDK:       "N1234"
→ Exact Match (100% confidence)
```

**Phase 2: Numeric Match** (Handles formatting differences)
```
Sales Log: "N-001234-A"
CDK:       "1234"
→ Numeric Match (95% confidence)
```

**Phase 3: Partial Match** (If enabled, handles variations)
```
Sales Log: "N1234AB"
CDK:       "N1234AC"
→ Partial Match (85% confidence if similar enough)
```

#### Progress Indicators

You'll see real-time updates:

```
Status: Matching stock numbers...
Progress: [████████░░░░] 65%
Time remaining: ~30 seconds

Statistics So Far:
✓ Exact Matches:    142
✓ Numeric Matches:   28
✓ Partial Matches:    5
⚠ Unmatched:         12
```

#### Estimated Time

Typical processing times:
- **100 records:** 5-10 seconds
- **500 records:** 20-30 seconds
- **1,000 records:** 40-60 seconds
- **2,000+ records:** 1-2 minutes

⏱️ **Note:** First-time matches may take slightly longer.

#### Can I Cancel?

Yes! Click **"Cancel Operation"** if:
- Processing is taking too long
- You realize you uploaded the wrong file
- You want to adjust settings

Canceling is safe - no data is changed until you complete the merge in Step 5.

---

### Step 4: Review Results

Before finalizing, review the match statistics and check for issues.

#### Match Summary Card

[📸 *Screenshot would show: Summary card with key statistics*]

```
┌─────────────────────────────┐
│     Match Summary           │
├─────────────────────────────┤
│ Total Records:        187   │
│ Matched Records:      175   │
│ Match Rate:           94%   │
│ Total GP Amount:  $245,330  │
└─────────────────────────────┘
```

**What's a Good Match Rate?**
- ✅ **90-100%:** Excellent - most records matched
- ⚠️ **80-89%:** Good - some unmatched, review carefully
- ❌ **Below 80%:** Poor - check settings or file format

#### Records Needing Review

This section shows matches that were found but have validation warnings.

[📸 *Screenshot would show: List of flagged records with reasons*]

**Example:**

```
⚠️ 3 Records Need Review

Stock #N1234
Customer: Smith vs. Smyth
Reason: Customer names differ significantly
→ This might be correct (spelling variation) or a mismatch

Stock #U5678
Type: NEW vs. USED
Reason: Stock types do not match
→ Check if stock number was entered correctly

Stock #N9999
Total GP: $52,000
Reason: Total GP exceeds reasonable threshold ($50,000)
→ Verify this is not a data entry error
```

**What Should I Do?**

For each flagged record:
1. **Review the reason** - Is this a real problem?
2. **Check your source data** - Look at both files
3. **Decide:**
   - ✅ **Proceed** if it's a false alarm (like spelling variations)
   - 🔄 **Adjust settings** if many records have issues
   - ✏️ **Fix source data** if there are real errors

💡 **Tip:** Most flagged records are fine - the tool is just being cautious.

#### Unmatched Records

This section lists records from your Sales Log that couldn't be matched to CDK data.

**Common Reasons:**

| Reason | Explanation | What to Do |
|--------|-------------|------------|
| No match found | Stock number doesn't exist in CDK file | Verify stock number is correct |
| Wrong stock type | Marked as NEW but CDK shows USED (or vice versa) | Correct the stock type |
| Not in CDK export | Sale might not be processed in CDK yet | Wait for CDK processing or add manually |
| Typo in stock number | Stock number entered incorrectly | Fix in Sales Log |

**Should I Proceed?**

Ask yourself:
- ❓ Is the match rate acceptable for my needs?
- ❓ Are the unmatched records explainable?
- ❓ Can I handle unmatched records manually?

If yes to all, click **"Proceed to Merge"**  
If no, click **"← Adjust Settings"** to try again

---

### Step 5: Complete Merge

Final step - writing the merged data to your spreadsheet.

#### What Happens Now

When you click "Proceed to Merge":

1. ✍️ **Creates MERGED_DATA sheet** (or updates if it exists)
2. 📊 **Writes matched records** with all financial data
3. 📝 **Adds summary statistics** section
4. 📋 **Lists unmatched records** for your review
5. 📜 **Creates log entry** in MERGE_LOG sheet
6. 🗑️ **Cleans up** temporary files

This takes 10-30 seconds depending on record count.

#### Success Screen

[📸 *Screenshot would show: Completion screen with checkmark*]

```
✓ Merge Completed Successfully!

Operation Summary
─────────────────
Processed:    187 records
Matched:      175 records
Merged:       175 records
Processing Time: 24 seconds

📄 View Results:
→ MERGED_DATA sheet (Click to open)
→ 12 unmatched records in UNMATCHED tab
```

#### Next Steps

Three things you should do now:

1. **Review the merged data**
   - Click "View Merged Data" button
   - Scroll through and spot-check a few records
   - Look for the red-highlighted rows (need review)

2. **Check unmatched records**
   - Click the unmatched records link
   - Investigate why they didn't match
   - Consider adding them manually if needed

3. **Update your Sales Log** (if necessary)
   - Copy needed data from MERGED_DATA
   - Correct any stock number errors found
   - Re-run merge if you made corrections

---

## 5. Understanding the Output

### The MERGED_DATA Sheet

This is where all your results live.

#### Sheet Structure

```
┌─────────────────────────────────────────────────────────┐
│ MERGED_DATA                                              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ [HEADER ROW - Blue background]                          │
│ Customer | Model | Stock# | Type | ... | Total GP$ | ... │
│                                                          │
│ [DATA ROWS - Alternating white]                         │
│ Johnson  | F-150 | N1234  | NEW  | ... | $2,450.00 | ✓  │
│ Smith    | Civic | U5678  | USED | ... | $1,823.00 | ✓  │
│ Brown    | CR-V  | N9999  | NEW  | ... | $52,000   | ⚠  │ ← Red
│ ...                                                      │
│                                                          │
│ [SUMMARY STATISTICS - Gray background]                  │
│ Total Records:     187                                   │
│ Matched:          175                                    │
│ Match Rate:       94%                                    │
│ ...                                                      │
│                                                          │
│ [UNMATCHED RECORDS - Yellow background]                 │
│ Stock# | Customer | Reason                               │
│ N4567  | Davis    | No match found                       │
│ U8901  | Wilson   | Not in CDK export                    │
│ ...                                                      │
└─────────────────────────────────────────────────────────┘
```

#### Column Descriptions

**From Sales Log (Original Data):**
- **Customer Last Name** - Buyer's last name
- **Model** - Vehicle model
- **Stock Number** - Primary matching key
- **Stock Type** - NEW or USED
- **Trade Stock #** - Trade-in vehicle stock number
- **Salesperson** - Sales representative name

**From CDK (Added Financial Data):**
- **Contract Date** - When deal was finalized
- **VIN** - Vehicle Identification Number
- **Year** - Vehicle year
- **Front GP$** - Front gross profit (vehicle sale)
- **Back GP$** - Back gross profit (F&I products)
- **Total GP$** - Combined gross profit
- **Cash Price** - Vehicle selling price
- **Trades** - Trade-in value
- **Service Contract** - Service contract amount
- **Finance Institution** - Lender name
- **FI Manager** - F&I manager who handled deal
- **Term** - Loan term in months
- **Deal No.** - CDK deal number

**Merge Metadata:**
- **Match Type** - exact, numeric, or partial
- **Match Confidence** - Percentage (85.00% = 85% certain)
- **Needs Review** - YES or NO flag
- **Review Reason** - Why it's flagged (if applicable)

#### Color Coding

🔵 **Blue Header** - Column headers  
⚪ **White Rows** - Normal matched records  
🔴 **Red Rows** - Records needing review  
🟡 **Gray Sections** - Summary statistics  
🟠 **Yellow Sections** - Unmatched records

#### How to Read the Data

**Example Row:**

```
Customer: Johnson
Model: F-150
Stock#: N1234
Front GP: $2,450.00
Back GP: $823.00
Total GP: $3,273.00
Match Type: exact
Confidence: 100.00%
Needs Review: NO
```

**This means:**
- ✅ Record matched perfectly (100% confidence)
- ✅ No validation issues (Needs Review = NO)
- 💰 Total profit was $3,273 ($2,450 front + $823 back)
- ✔️ Safe to use this data

**Example Flagged Row:**

```
Customer: Brown
Model: CR-V
Stock#: N9999
Total GP: $52,000.00
Match Type: exact
Confidence: 100.00%
Needs Review: YES
Reason: Total GP exceeds reasonable threshold ($50,000)
```

**This means:**
- ⚠️ Match was exact BUT GP is suspiciously high
- 🔍 You should verify this is not a data entry error
- 💡 Might be legitimate (e.g., luxury vehicle) or might be typo

### Summary Statistics Section

Located below your data, this provides aggregate metrics.

#### Overall Statistics

```
Total Records:          187
Merged Records:         175
Unmatched Sales Log:     12
Unmatched CDK:            5
Match Rate:             94%
```

**What This Tells You:**
- Started with 187 sales log entries
- Successfully matched 175 (94%)
- 12 couldn't be matched
- 5 CDK records were extra (not in sales log)

#### By Stock Type

```
Type          Count    Avg GP
────────────────────────────
New Vehicles   142    $3,245
Used Vehicles   33    $2,187
```

**Insights:**
- Most of your sales are new vehicles (142 vs. 33)
- New vehicles average higher profit ($3,245 vs. $2,187)

#### By Match Type

```
Exact Match:     142
Numeric Match:    28
Partial Match:     5
```

**Quality Indicator:**
- Higher exact matches = better data consistency
- Many partial matches = might need to review settings

#### Financial Summary

```
Total Front GP:    $245,330
Total Back GP:      $89,452
Total GP:         $334,782
Avg Front GP:       $1,402
Avg Back GP:          $511
Avg Total GP:       $1,913
```

**Business Insights:**
- Total profit from all matched deals: $334,782
- Average profit per deal: $1,913
- Front profit is 73% of total, back is 27%

#### Review Flags

```
Records Needing Review: 8

Grouped by Reason:
─────────────────────────────────────
Stock types do not match          3
Customer names differ              2
Total GP exceeds threshold         2
Front GP or Back GP is negative    1
```

**Action Items:**
- 3 records have stock type mismatches (check these)
- 2 have name differences (probably okay)
- 2 have high GP (verify these)
- 1 has negative GP (investigate this)

### Unmatched Records Section

Shows records that couldn't be matched.

#### Unmatched Sales Log Records

```
Stock#  Customer  Model    Type   Reason
─────────────────────────────────────────
N4567   Davis     Camry    NEW    No match found
U8901   Wilson    Accord   USED   Not in CDK export
N2222   Taylor    Civic    NEW    No match found
```

**Why This Matters:**
- These sales won't have financial data in your merged sheet
- You may need to add this data manually
- Could indicate data entry errors

**What to Do:**
1. Check if stock numbers are correct
2. Verify deals were processed in CDK
3. Consider re-running merge after fixing issues

#### Unmatched CDK Records

```
Stock#  Customer  Model    Type   Total GP   Reason
──────────────────────────────────────────────────
N7777   Anderson  F-150    NEW    $2,450    Not in Sales Log
U3333   Roberts   Civic    USED   $1,800    Not in Sales Log
```

**Possible Explanations:**
- Deals in CDK but not yet entered in Sales Log
- Stock numbers entered differently in each system
- Deals from a different time period

**What to Do:**
- Check if these should be in your Sales Log
- Add them if missing
- Or ignore if they're from outside your date range

### The MERGE_LOG Sheet

This sheet tracks every merge operation for accountability.

#### Log Columns

```
Timestamp            User              Sales Log    CDK File           Total   Matched
─────────────────────────────────────────────────────────────────────────────────────
2024-10-18 14:23:45  user@dealer.com  Current      CDK_Oct_2024.xlsx   187     175
2024-10-15 10:15:22  user@dealer.com  Current      CDK_Sep_2024.xlsx   201     198
2024-09-18 09:42:11  user@dealer.com  Current      CDK_Aug_2024.xlsx   193     189
```

**Why It's Important:**
- 📜 **Audit trail** for compliance
- 🔍 **Troubleshooting** - see what settings were used
- 📊 **Trend analysis** - track match rates over time
- 👥 **Accountability** - who ran which merge

---

## 6. Configuration Management

Save and reuse your settings for faster monthly processing.

### Why Save Configurations?

If you process CDK exports monthly:
- ✅ Same file format every time
- ✅ Same column mappings needed
- ✅ Same matching preferences
- ✅ Don't want to reconfigure each month

**Solution:** Save your configuration once, load it each time.

### Saving a Configuration

1. Complete steps 1-2 (upload file and configure settings)
2. Before starting the merge, look for **"Save Configuration"**
3. Enter a name: e.g., "Monthly CDK Merge - Standard Settings"
4. Click **Save**
5. Confirmation: "Configuration saved successfully"

💡 **Tip:** Create multiple configurations if you have different CDK export formats.

### Loading a Saved Configuration

1. Open the merge tool sidebar
2. Click **"Load Configuration"**
3. Select from your saved configurations
4. Settings automatically populate
5. Review and adjust if needed

**Example Configurations:**

```
📋 Monthly Standard Merge
   - 85% confidence threshold
   - Partial matching: OFF
   - Used for routine monthly processing

📋 Quarterly Detailed Merge
   - 95% confidence threshold
   - Partial matching: OFF
   - Used for quarter-end reconciliation

📋 Quick Match - High Volume
   - 75% confidence threshold
   - Partial matching: ON
   - Used when processing large batches
```

### When to Use Saved Configs

✅ **DO use for:**
- Regular monthly merges
- Same CDK export format
- Consistent data structure

❌ **DON'T use for:**
- Different CDK format than usual
- One-time special reports
- Testing different settings

### Exporting/Importing Configurations

**Export** (for backup or sharing):
1. Click **"Export Config"**
2. Saves as JSON file
3. Store in safe location

**Import** (restore from backup):
1. Click **"Import Config"**
2. Select your JSON file
3. Configuration restored

💡 **Use Case:** Share configuration with other team members so they use identical settings.

---

## 7. Common Scenarios

### Scenario 1: Monthly Processing Workflow

**Your Situation:**  
You process CDK data every month-end to update sales records.

**Recommended Workflow:**

1. **Day 1 of Month:**
   - Export CDK data for previous month
   - Save as "CDK_[Month]_[Year].xlsx"

2. **Open Sales Log Google Sheet**

3. **Run Merge:**
   - Sales Tools > Merge CDK Data
   - Upload CDK file
   - Load saved "Monthly Standard Merge" configuration
   - Review match rate (should be 90%+)
   - Complete merge

4. **Review Output:**
   - Spot-check 5-10 records
   - Investigate any red-flagged rows
   - Check unmatched records

5. **Update Records:**
   - Copy needed data to main sales log
   - Archive MERGED_DATA to separate sheet
   - Document any issues in notes

6. **Time Required:** 5-10 minutes

✅ **Pro Tips:**
- Run at same time each month
- Use consistent file naming
- Keep previous month's MERGED_DATA as backup
- Review match rate trends (declining rate = investigate)

---

### Scenario 2: Handling Unmatched Records

**Your Situation:**  
Merge completed but 15 records didn't match.

**Investigation Steps:**

**Step 1: Check the Unmatched Section**
```
Stock#  Customer  Reason
N1234   Smith     No match found
```

**Step 2: Look Up Stock Number**
- Check in Sales Log MONTHLY
- Check in CDK export file
- Are they spelled the same?

**Common Issues & Fixes:**

| Issue | Example | Fix |
|-------|---------|-----|
| **Leading zeros** | SL: "001234" vs CDK: "1234" | Turn on "Ignore leading zeros" |
| **Letter prefix** | SL: "N1234" vs CDK: "1234" | Enable numeric matching |
| **Typo** | SL: "N1234" vs CDK: "N1243" | Correct in Sales Log |
| **Missing from CDK** | Stock# in SL only | Deal not yet processed in CDK |
| **Date range** | Deal outside export period | Use correct CDK export |

**Step 3: Resolution Options**

**Option A: Fix and Re-merge**
1. Correct stock numbers in Sales Log
2. Run merge again
3. Most records will match this time

**Option B: Manual Entry**
1. Leave unmatched as-is
2. Manually copy CDK data for these records
3. Document why they were unmatched

**Option C: Investigate Later**
1. Save list of unmatched records
2. Follow up with CDK team
3. Re-merge after clarification

⚠️ **Warning:** If >20% unmatched, don't proceed. Check for systematic issue.

---

### Scenario 3: Dealing with Duplicate Stock Numbers

**Your Situation:**  
Warning appears: "Duplicate stock numbers detected."

**Why This Happens:**

1. **Trade-ins reused:** Used vehicle traded in, sold again
2. **Data entry error:** Same stock number entered twice
3. **Multi-location:** Same number used at different stores
4. **System issue:** CDK glitch created duplicate

**How the Tool Handles It:**

The tool uses **first-match priority:**
```
Sales Log:  N1234
CDK Match:  N1234 (Deal #12345) ← Used
CDK Match:  N1234 (Deal #12399) ← Ignored
```

**What You Should Do:**

1. **Identify Duplicates:**
   ```
   Filter MERGED_DATA by Stock Number
   Look for multiple rows with same number
   ```

2. **Determine Correct Match:**
   - Check contract dates
   - Compare customer names
   - Review deal numbers
   - Verify VINs (they should differ)

3. **Resolution:**
   - **If different deals:** Both are correct, keep both
   - **If data error:** Remove duplicate from source
   - **If trade-in:** Distinguish with suffix (N1234-1, N1234-2)

💡 **Best Practice:** Use unique stock numbers for each vehicle, even trade-ins.

---

## 8. Troubleshooting

### Common Issues

#### Issue: "File Upload Failed"

**Symptoms:**
- Upload progress stops at 0%
- Error message appears
- File doesn't process

**Possible Causes & Solutions:**

1. **File too large (>50MB)**
   ```
   ✓ Split file into smaller pieces
   ✓ Remove unnecessary columns
   ✓ Export as CSV instead of XLSX
   ```

2. **Internet connection issue**
   ```
   ✓ Check your WiFi/network
   ✓ Try again in a few minutes
   ✓ Use wired connection if available
   ```

3. **Browser problem**
   ```
   ✓ Refresh the page (F5)
   ✓ Clear browser cache
   ✓ Try different browser (Chrome recommended)
   ```

4. **File is corrupted**
   ```
   ✓ Re-export from CDK
   ✓ Try opening file in Excel first
   ✓ Save as new file
   ```

---

#### Issue: "No Matches Found"

**Symptoms:**
- 0% match rate
- All records unmatched
- Empty MERGED_DATA sheet

**Diagnostic Steps:**

1. **Check Stock Number Columns**
   ```
   Are they in the expected columns?
   ✓ Sales Log: Column E (new) or L (used)
   ✓ CDK Export: Verify in column mapping
   ```

2. **Verify Data Format**
   ```
   Sales Log:  "N1234"
   CDK:        "NewVehicle1234"
   Problem:    Formats don't align
   ```

3. **Check Settings**
   ```
   ✓ Confidence threshold not too high (try 70%)
   ✓ Enable "Ignore leading zeros"
   ✓ Enable "Case insensitive"
   ✓ Try enabling "Partial matching"
   ```

4. **Validate File Contents**
   ```
   ✓ Look at preview - are stock numbers present?
   ✓ Check if file has data (not just headers)
   ✓ Verify this is the correct CDK export
   ```

**Quick Fix:**
```
1. Cancel current merge
2. Go back to Step 2
3. Lower confidence to 70%
4. Enable all matching options
5. Try again
```

---

#### Issue: "Column Not Found" Errors

**Symptoms:**
- Error during configuration
- Can't find expected columns
- Merge fails to start

**Solutions:**

1. **Check CDK Export Format**
   ```
   Your export might use different column names
   ✓ Look at file preview
   ✓ Note actual column names
   ✓ Manually select correct columns
   ```

2. **Common Column Name Variations:**
   ```
   Standard:     Your File Might Say:
   Stock No   →  Stock Number, StockNo, Stock#
   Total GP   →  Gross Profit, Total_GP, GP Total
   Front GP   →  Front Gross, FrontGP, Front_GP
   ```

3. **Manual Mapping:**
   ```
   1. In column mapping section
   2. Click each dropdown
   3. Select your actual column names
   4. Save configuration for reuse
   ```

---

#### Issue: "Timeout" Errors

**Symptoms:**
- Processing stops mid-way
- "Script timeout" message
- Merge incomplete

**Causes:**
- File is very large (2000+ records)
- Complex matching enabled
- Server busy

**Solutions:**

1. **Reduce File Size:**
   ```
   ✓ Process in batches (500-1000 records)
   ✓ Split by date range or stock type
   ✓ Remove unnecessary columns
   ```

2. **Simplify Matching:**
   ```
   ✓ Disable partial matching
   ✓ Increase confidence threshold
   ✓ Fewer records = faster processing
   ```

3. **Retry:**
   ```
   ✓ Wait 5 minutes
   ✓ Try again (server might be less busy)
   ✓ Try during off-peak hours
   ```

---

#### Issue: Performance is Slow

**Symptoms:**
- Processing takes very long
- Browser becomes unresponsive
- Frequent "script running" warnings

**Optimization:**

1. **File Size:**
   ```
   Optimal:    <1,000 records → <30 seconds
   Acceptable: 1,000-2,000   → 1-2 minutes
   Slow:       >2,000        → 3+ minutes
   ```

2. **Browser Performance:**
   ```
   ✓ Close other tabs
   ✓ Use Chrome (fastest for Google Sheets)
   ✓ Disable browser extensions
   ✓ Restart browser
   ```

3. **Network:**
   ```
   ✓ Use wired connection (faster than WiFi)
   ✓ Avoid peak usage times
   ✓ Check internet speed
   ```

4. **Complexity:**
   ```
   ✓ Disable partial matching (if not needed)
   ✓ Use saved configurations (faster loading)
   ✓ Process in smaller batches
   ```

---

### Error Messages Explained

#### "File format validation failed"
**Meaning:** File is not .xlsx, .xls, or .csv  
**Fix:** Convert to supported format or re-export

#### "Missing required column: Stock Number"
**Meaning:** CDK file doesn't have stock number column  
**Fix:** Verify export includes stock numbers, or manually map column

#### "Match confidence threshold must be between 70-100"
**Meaning:** Invalid setting entered  
**Fix:** Use slider or enter value between 70 and 100

#### "Unable to access Sales Log sheet"
**Meaning:** Permissions issue or sheet not found  
**Fix:** Ensure you have edit access and sheet exists

#### "Merge operation cancelled by user"
**Meaning:** You clicked "Cancel" during processing  
**Fix:** This is intentional - restart if needed

#### "Cache expired, please re-upload file"
**Meaning:** Session timed out (>6 hours)  
**Fix:** Upload file again and complete merge

---

## 9. Best Practices

### When to Run Merges

**Timing Recommendations:**

✅ **Best Times:**
- **Early morning** (7-9 AM) - Servers less busy
- **Mid-day** (12-2 PM) - After rush, before afternoon peak
- **End of month** - When CDK data is finalized

❌ **Avoid:**
- **Peak business hours** (10-11 AM, 3-4 PM)
- **During other heavy spreadsheet operations**
- **While others are editing the sheet**

**Frequency:**
- **Monthly:** Standard practice for most dealerships
- **Quarterly:** For detailed reconciliation
- **Ad-hoc:** For special reports or corrections

---

### File Organization Tips

**Naming Convention:**
```
Good:  "CDK_Export_October_2024.xlsx"
Bad:   "export.xlsx"

Good:  "SalesLog_Monthly_2024-10.xlsx"
Bad:   "Sheet1.xlsx"
```

**Structure:**
```
Google Drive Folder Structure:
├── CDK_Exports/
│   ├── 2024/
│   │   ├── CDK_January_2024.xlsx
│   │   ├── CDK_February_2024.xlsx
│   │   └── ...
│   └── Archive/
│       └── (older files)
└── Merged_Results/
    ├── MERGED_October_2024/
    └── ...
```

**Archive Policy:**
- Keep source files for 3-6 months
- Archive old MERGED_DATA sheets monthly
- Backup configurations quarterly
- Document any special one-off merges

---

### Data Quality Checks Before Merging

**Pre-Flight Checklist:**

1. ☑️ **Sales Log Review**
   ```
   ✓ All stock numbers filled in
   ✓ No obvious typos (12345 vs 1234)
   ✓ Stock types correct (NEW vs USED)
   ✓ Customer names present
   ✓ No duplicate rows
   ```

2. ☑️ **CDK Export Validation**
   ```
   ✓ Correct date range exported
   ✓ All expected columns present
   ✓ File opens correctly in Excel
   ✓ Row count seems reasonable
   ✓ No blank rows in middle of data
   ```

3. ☑️ **Quick Spot Check**
   ```
   Sample 5 stock numbers from Sales Log
   Verify they exist in CDK export
   If not found → investigate before merging
   ```

4. ☑️ **Previous Merge Comparison**
   ```
   Compare record counts to last month
   Big difference? → investigate why
   Match rate similar? → good sign
   ```

---

### Backup Recommendations

**What to Backup:**

1. **Before Every Merge:**
   ```
   ✓ Make copy of entire Google Sheet
   ✓ Name: "Backup_Before_Merge_[Date]"
   ✓ Move to backup folder
   ```

2. **After Successful Merge:**
   ```
   ✓ Copy MERGED_DATA to new sheet
   ✓ Name: "MERGED_[Month]_[Year]_Archive"
   ✓ Hide sheet (don't delete)
   ```

3. **Monthly:**
   ```
   ✓ Download copy of sheet to local drive
   ✓ Export configurations as JSON
   ✓ Document any issues/exceptions
   ```

**Backup Schedule:**
```
Daily:     No backup needed
Weekly:    No backup needed
Monthly:   Full backup after merge
Quarterly: Archive old merged sheets
Yearly:    Save final year-end state
```

**Recovery Plan:**

If something goes wrong:
1. Don't panic - Google Sheets has version history
2. File > Version history > See version history
3. Restore to version before merge
4. Re-run merge with corrections

---

### Quality Assurance Process

**After Each Merge:**

1. **Spot Check (5 minutes)**
   ```
   ✓ Review 5 random records
   ✓ Verify GP amounts look reasonable
   ✓ Check customer names match
   ✓ Confirm stock types are correct
   ```

2. **Statistical Validation**
   ```
   ✓ Total GP should be similar to CDK system totals
   ✓ Match rate should be >90%
   ✓ Average GP should be in normal range
   ✓ New vs Used ratio should match expectations
   ```

3. **Exception Review**
   ```
   ✓ All red-flagged records reviewed?
   ✓ Unmatched records documented?
   ✓ Any unusual patterns explained?
   ```

4. **Documentation**
   ```
   ✓ Add note to MERGE_LOG if needed
   ✓ Document any corrections made
   ✓ Note for future reference
   ```

**Red Flags to Watch For:**
- Match rate drops >10% from usual
- Unusually high or low average GP
- Many duplicate stock numbers
- Large number of one type of error

---

## 10. FAQ

### General Questions

#### How accurate is the matching?

**Exact matches: 100% accurate** - Stock numbers match perfectly  
**Numeric matches: 95-98% accurate** - Very high confidence  
**Partial matches: 75-95% accurate** - Review recommended

Overall, with default settings (85% threshold), accuracy is typically >98%.

#### Can I undo a merge?

**Not directly**, but you have options:

1. **Use Version History:**
   - File > Version history
   - Restore to before merge
   - Re-run with corrections

2. **Delete MERGED_DATA Sheet:**
   - Right-click sheet tab
   - Delete
   - Start fresh

3. **Prevention:**
   - Always review in Step 4 before proceeding
   - Make backup copy first

💡 **Best Practice:** The merge doesn't modify your original sheets (TODAY, MONTHLY), so your source data is safe.

#### What happens to my original data?

**It's completely safe.** The tool:
- ✅ Only reads from Sales Log MONTHLY
- ✅ Never modifies original sheets
- ✅ Creates new MERGED_DATA sheet for output
- ✅ Keeps CDK file in temporary Drive storage only

Your source data cannot be changed by the merge tool.

#### How long does a merge take?

**Typical Times:**
- Small (1-100 records): 5-15 seconds
- Medium (100-500 records): 15-30 seconds
- Large (500-1,000 records): 30-60 seconds
- Very Large (1,000-2,000 records): 1-2 minutes

**Plus:**
- Upload: 5-15 seconds (depending on file size)
- Configuration: 30 seconds (first time) or instant (saved config)
- Review: 1-2 minutes (your decision time)

**Total workflow:** 5-10 minutes for typical monthly merge.

#### What file formats are supported?

**Supported:**
- ✅ `.xlsx` (Excel 2007+) - **Recommended**
- ✅ `.xls` (Excel 97-2003)
- ✅ `.csv` (Comma-separated values)

**Not Supported:**
- ❌ `.xlsm` (Excel with macros) - Security restriction
- ❌ `.pdf` - Cannot parse
- ❌ `.txt` - Use .csv instead
- ❌ Google Sheets links - Export as .xlsx first

💡 **Tip:** If in doubt, export as .xlsx from your CDK system.

#### Can I merge multiple files at once?

**No** - The tool processes one CDK file per merge operation.

**Workaround for multiple files:**

**Option A: Combine Before Upload**
1. Open all CDK files in Excel
2. Copy all data to one file
3. Upload the combined file

**Option B: Sequential Merges**
1. Merge first file
2. Rename MERGED_DATA to "MERGED_File1"
3. Merge second file
4. Combine manually

**Option C: Batch Processing**
1. Process each file separately
2. Export results
3. Combine in separate analysis sheet

**Best Practice:** Request single comprehensive export from CDK covering your entire date range.

#### How do I get help?

**Built-in Help:**
1. Hover over ⓘ icons in the tool for tooltips
2. Review this guide
3. Check error message suggestions

**Technical Support:**
1. Contact your dealership's IT support
2. Share specific error messages
3. Provide screenshots if possible
4. Note: Date, time, and file name used

**Community Resources:**
- Internal dealership wiki (if available)
- Sales manager training sessions
- Team member who's used tool successfully

---

### Technical Questions

#### What is "confidence threshold"?

**Simple Explanation:**  
A slider from 70-100% that controls how certain the tool must be before accepting a match.

**Lower (70%):**
- More matches found
- Some might be wrong
- Review carefully

**Higher (95%):**
- Fewer matches found
- Very certain of matches
- Fewer to review

**Default (85%):** Good balance for most situations.

**Technical:** Uses Levenshtein distance algorithm to calculate string similarity percentage.

#### Why do I see "partial match" vs "exact match"?

**Match Types Explained:**

1. **Exact Match (100% confidence)**
   ```
   Sales Log: "N1234"
   CDK:       "N1234"
   → Identical after normalization
   ```

2. **Numeric Match (95% confidence)**
   ```
   Sales Log: "N-001234"
   CDK:       "1234"
   → Same numbers, different format
   ```

3. **Partial Match (75-95% confidence)**
   ```
   Sales Log: "N1234AB"
   CDK:       "N1234AC"
   → Very similar, but not identical
   ```

**Which is Best?**  
Exact > Numeric > Partial (in terms of certainty)

#### What does "normalization" mean?

**Normalization** = Making stock numbers comparable

**The tool automatically:**
- Converts to UPPERCASE ("n1234" → "N1234")
- Removes spaces ("N 1234" → "N1234")
- Removes dashes ("N-1234" → "N1234")
- Removes dots ("N.1234" → "N1234")
- (Optional) Removes leading zeros ("001234" → "1234")

**Why?** Different systems format stock numbers differently. Normalization finds matches despite format differences.

#### How does the tool handle empty cells?

**Empty Stock Numbers:**
- Skipped entirely (not counted as unmatched)
- Warning shown if many empty

**Empty Financial Fields:**
- Treated as $0.00 or null
- No error generated
- Record still merged

**Empty Customer Names:**
- Warning shown
- Match might still succeed on stock number
- Flagged for review

#### Can I customize the matching algorithm?

**Yes, through configuration settings:**

You can adjust:
- ✓ Confidence threshold (70-100%)
- ✓ Enable/disable leading zeros
- ✓ Case sensitivity on/off
- ✓ Partial matching on/off
- ✓ Stock type validation on/off

**You cannot:**
- ✗ Change normalization rules (hard-coded)
- ✗ Add custom matching phases
- ✗ Modify confidence scoring formula
- ✗ Change column requirements

💡 **For advanced customization:** Contact your IT team about modifying the script.

---

## 11. Appendices

### Appendix A: Column Mapping Reference

#### Sales Log Columns (Input)

| Column | Letter | Field Name | Description |
|--------|--------|------------|-------------|
| A | Date | Date of sale |
| B | Customer Last Name | Buyer's surname |
| C | Model | Vehicle model name |
| D | FI (New) | Finance info for new vehicles |
| E | **Stock Number (New)** | **Primary key for new vehicles** |
| F | Trade Stock # (New) | Trade-in stock number |
| G | Salesperson (New) | Sales rep name |
| H | FI (Used) | Finance info for used vehicles |
| I-K | *(reserved)* | Various fields |
| L | **Stock Number (Used)** | **Primary key for used vehicles** |
| M | Trade Stock # (Used) | Trade-in stock number |
| N | Salesperson (Used) | Sales rep name |

#### CDK Export Columns (Input)

| Position | Field Name | Data Type | Required | Description |
|----------|------------|-----------|----------|-------------|
| 1 | Contract Date | Date | Yes | Deal date |
| 2 | Customer Last Name | Text | Yes | Buyer surname |
| 3 | *(varies)* | Text | No | Additional info |
| 4 | **Stock No** | **Text** | **Yes** | **Matching key** |
| 5-8 | Vehicle Info | Text | No | Make, model, etc. |
| 9 | Stock Type | Text | Yes | NEW or USED |
| 10 | **Front GP** | **Number** | **Yes** | Front gross profit |
| 11 | **Back GP** | **Number** | **Yes** | Back gross profit |
| 12 | **Total GP** | **Number** | **Yes** | Total gross profit |
| 13 | Cash Price | Number | No | Vehicle price |
| 14 | Trades | Number | No | Trade-in value |
| 15 | Service Contract | Number | No | Service contract amount |
| 16 | VIN | Text | No | Vehicle ID number |
| 17 | Year | Number | No | Vehicle year |
| 18 | Finance Institution | Text | No | Lender name |
| 19 | FI Manager | Text | No | F&I manager |
| 20 | Term | Number | No | Loan term (months) |
| 21 | Deal No | Text | No | CDK deal number |
| 22 | Salesperson | Text | No | Sales rep |

#### MERGED_DATA Columns (Output)

All input columns plus:
- Match Type (exact/numeric/partial)
- Match Confidence (percentage)
- Needs Review (YES/NO)
- Review Reason (if flagged)

---

### Appendix B: Match Confidence Scoring

#### How Confidence is Calculated

**Exact Match = 100%**
```
Strings identical after normalization
"N1234" = "N1234"
```

**Numeric Match = 95%**
```
Numeric portions identical
"N-001234-A" → "1234"
"U1234" → "1234"
Both extract to "1234" → 95% confidence
```

**Partial Match = Variable (75-95%)**
```
Uses Levenshtein distance algorithm:
1. Count character differences
2. Calculate similarity ratio
3. Convert to percentage

Example:
"N1234AB" vs "N1234AC"
Distance = 1 (one character different)
Length = 7
Similarity = (7-1)/7 = 85.7%
Confidence = 86%
```

#### What Different Scores Mean

| Confidence | Meaning | Action |
|------------|---------|--------|
| **100%** | Perfect match | ✅ Safe to proceed |
| **95-99%** | Near-perfect (format differences only) | ✅ Very reliable |
| **90-94%** | High confidence (minor variations) | ⚠️ Spot check recommended |
| **85-89%** | Good confidence | ⚠️ Review if multiple fields differ |
| **80-84%** | Moderate confidence | ⚠️ Verify before using |
| **75-79%** | Low confidence | ⛔ Requires review |
| **<75%** | Very low confidence | ⛔ Not matched by default |

#### When to Trust Low-Confidence Matches

**Trust 80-85% if:**
- ✅ Customer names match
- ✅ Stock types match (both NEW or both USED)
- ✅ Only minor stock number differences
- ✅ GP values seem reasonable

**Don't trust 80-85% if:**
- ❌ Customer names very different
- ❌ Stock types don't match
- ❌ GP values unusually high/low
- ❌ Multiple validation warnings

**Never trust <80% without verification**

---

### Appendix C: Technical Details

#### Stock Number Normalization Rules

**Applied in order:**

1. **Convert to string**: `Number → String`
   ```
   1234 → "1234"
   ```

2. **Trim whitespace**: `Remove leading/trailing spaces`
   ```
   " N1234 " → "N1234"
   ```

3. **Uppercase**: `All letters to uppercase`
   ```
   "n1234" → "N1234"
   ```

4. **Remove separators**: `Delete spaces, dashes, dots`
   ```
   "N-12 34" → "N1234"
   "N.12.34" → "N1234"
   ```

5. **Remove special characters**: `Keep only A-Z and 0-9`
   ```
   "N-1234!" → "N1234"
   ```

6. **(Optional) Remove leading zeros**: `If option enabled`
   ```
   "N001234" → "N1234"
   "001234" → "1234"
   ```

**Examples:**

| Original | After Normalization | Notes |
|----------|---------------------|-------|
| "n-001234" | "N1234" | All rules applied |
| " N 1234 " | "N1234" | Spaces removed |
| "N.12.34" | "N1234" | Dots removed |
| "001234" | "1234" | Leading zeros removed |
| "#N1234!" | "N1234" | Special chars removed |

#### Matching Algorithm Phases

**Phase 1: Exact Match (O(n×m) complexity)**
```javascript
For each Sales Log record:
  For each CDK record:
    If normalized_sales_stock === normalized_cdk_stock:
      If stock_types_match (optional):
        → MATCH (confidence: 100%)
        → Remove CDK record from pool
        → Continue to next Sales Log record
```

**Phase 2: Numeric Match (O(n×m) remaining)**
```javascript
For each unmatched Sales Log record:
  For each remaining CDK record:
    Extract numeric portions:
      sales_numeric = extract_numbers(sales_stock)
      cdk_numeric = extract_numbers(cdk_stock)
    If sales_numeric === cdk_numeric:
      If stock_types_match (optional):
        → MATCH (confidence: 95%)
        → Remove CDK record from pool
        → Continue to next Sales Log record
```

**Phase 3: Partial Match (O(n×m) remaining)**
```javascript
For each still-unmatched Sales Log record:
  best_match = null
  best_confidence = minimum_threshold
  
  For each remaining CDK record:
    similarity = calculate_levenshtein_similarity(
      sales_stock,
      cdk_stock
    )
    confidence = similarity × 100
    
    If confidence > best_confidence:
      If stock_types_match (optional):
        best_match = cdk_record
        best_confidence = confidence
  
  If best_match found:
    → MATCH (confidence: best_confidence)
    → Remove CDK record from pool
```

#### Performance Characteristics

**Time Complexity:**
- Best case: O(n) - all exact matches on first try
- Average case: O(n×m) - mix of match types
- Worst case: O(n×m) - all partial matching

**Where:**
- n = number of Sales Log records
- m = number of CDK records

**Space Complexity:** O(n+m)
- Linear space for storing records
- Constant space for matching operations

**Optimization Strategies:**
1. **Early termination**: Stop checking CDK records after match found
2. **Pool reduction**: Remove matched CDK records from subsequent searches
3. **Phase priority**: Faster exact matching attempted first
4. **Batch operations**: Process multiple records in parallel (where possible)

**Practical Performance:**
- 100 records: ~5 seconds
- 500 records: ~25 seconds
- 1,000 records: ~50 seconds
- 2,000 records: ~100 seconds (1.6 minutes)

**Performance Limits:**
- Google Apps Script: 6-minute execution timeout
- Practical limit: ~5,000 records per merge
- Recommendation: Process in batches if >2,000 records

---

## 📞 Support & Resources

### Quick Reference Card

**🚀 Quick Start:**
1. Sales Tools > Merge CDK Data
2. Upload CDK file
3. Review auto-detected settings
4. Click "Start Matching"
5. Review results
6. Complete merge

**⚙️ Default Settings:**
- Confidence: 85%
- Ignore zeros: ON
- Case insensitive: ON
- Partial matching: OFF

**📊 Good Results:**
- Match rate: >90%
- Exact matches: >80%
- Flagged for review: <10%

**❓ Need Help?**
- Re-read relevant section of this guide
- Check error message suggestions
- Contact dealership IT support

---

### Document Information

**Version:** 1.0  
**Last Updated:** October 2024  
**Applies to:** CDK Merge Tool v1.0  
**Audience:** Dealership staff (non-technical)

**Feedback:**  
Found something unclear? Have suggestions? Contact your sales manager or IT team to improve this guide.

---

**End of Guide** ✓
