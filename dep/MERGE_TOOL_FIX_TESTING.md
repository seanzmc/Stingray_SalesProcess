# Merge Tool Column Mapping Fix - Testing Guide

## Overview
This guide provides step-by-step instructions for testing the critical bug fix that ensures user-selected column mappings are now properly used instead of being bypassed by auto-detection.

**Bug Fixed:** User's manually selected column mappings were being ignored, causing:
- 0 matches in merge results
- Wrong data appearing in MERGED_DATA sheet (data from wrong columns)

**Fix Location:** [`merge_controller.js`](saleslog_files/merge_controller.js:266-301)

---

## Pre-Testing Setup

### 1. Deploy Fixed Code to Google Apps Script

1. **Open your Google Apps Script project:**
   - In Google Sheets, go to **Extensions** > **Apps Script**

2. **Update the code:**
   - Locate `merge_controller.js` in the file list
   - Copy the updated code from your local version
   - Paste it into the Apps Script editor
   - Press **Ctrl+S** (or **Cmd+S** on Mac) to save

3. **Verify the fix is present:**
   - Navigate to lines 266-301 in `merge_controller.js`
   - Confirm you see the section starting with:
     ```javascript
     // Check if user provided column mappings via UI
     const hasUserMapping = config.columnMapping &&
     ```

### 2. Refresh Spreadsheet to Use New Code

**Important:** The spreadsheet must be completely refreshed for code changes to take effect.

1. **Close the spreadsheet tab** (not just the sidebar)
2. **Reopen the spreadsheet** from Google Drive
3. **Wait 10-15 seconds** for Apps Script to initialize
4. **Open the merge tool:**
   - Go to **SalesLog Pro** menu > **Merge CDK Data**

---

## Test Scenario 1: User Column Selection (Primary Fix)

This scenario tests that user-selected columns are now properly used instead of being ignored.

### Setup

1. **Prepare your CDK_DATA sheet:**
   - Ensure you have a CDK_DATA sheet in your spreadsheet
   - Verify it contains at least these columns:
     - Stock No. (or Stock Number)
     - Stock Type (New/Used)
     - Front GP
     - Back GP
     - Total GP (or GP$)

2. **Note the column positions:**
   ```
   Example CDK_DATA headers:
   A: Deal No.
   B: Customer
   C: VIN
   D: Stock No.      ← Note this is column D (index 3)
   E: Status
   F: PLC
   G: Contract Date
   H: Sale Type
   I: Year
   J: Model
   K: StockType      ← Note this is column K (index 10)
   L: Front GP$      ← Note this is column L (index 11)
   M: Back GP$       ← Note this is column M (index 12)
   N: GP$            ← Note this is column N (index 13)
   ```

### Test Steps

1. **Open the Merge Tool:**
   - **SalesLog Pro** menu > **Merge CDK Data**

2. **Select columns manually:**
   - In the sidebar, find the "Column Mapping" section
   - For each field, select the **correct column** from the dropdown:
     - **Stock Number:** Select "Stock No." (column D)
     - **Stock Type:** Select "StockType" (column K)
     - **Front GP:** Select "Front GP$" (column L)
     - **Back GP:** Select "Back GP$" (column M)
     - **Total GP:** Select "GP$" (column N)

3. **Run the merge:**
   - Click **"Start Merge"** button
   - Wait for progress to complete

### Expected Results ✅

- [ ] **Merge completes successfully** (progress reaches 100%)
- [ ] **Match count > 0** (shows actual matches found)
- [ ] **Match rate displayed** (e.g., "85% match rate")
- [ ] **Results screen shows:**
  - Total Records processed
  - Matched Records (non-zero)
  - Match Rate percentage

### Verification Steps

1. **Check the console logs** (Apps Script execution log):
   ```
   Look for: "Using user-provided column mappings"
   Should show your selected columns:
     stockColumn: 3 (for column D)
     typeColumn: 10 (for column K)
     frontGPColumn: 11 (for column L)
     backGPColumn: 12 (for column M)
     totalGPColumn: 13 (for column N)
   ```

2. **Verify MERGED_DATA sheet:**
   - Click **"View Results"** or navigate to MERGED_DATA sheet
   - **Check stock numbers** in column match those from Sales Log
   - **Check GP values** are numeric and reasonable
   - **Verify data comes from correct columns:**
     - Pick a stock number from Sales Log (e.g., "24U2345")
     - Find it in CDK_DATA sheet
     - Compare the GP values to MERGED_DATA
     - They should match exactly

### Previous Buggy Behavior ❌

Before the fix, you would have seen:
- ❌ 0 matches despite having matching stock numbers
- ❌ Wrong GP values in MERGED_DATA (from wrong columns)
- ❌ Console logs showing "using auto-detection" even with user selections
- ❌ Data mismatch between CDK_DATA and MERGED_DATA

---

## Test Scenario 2: Auto-Detection Fallback

This scenario verifies that auto-detection still works when no user selections are provided (backward compatibility).

### Setup

1. **Start fresh:**
   - Close and reopen the spreadsheet
   - Open **SalesLog Pro** menu > **Merge CDK Data**

2. **Verify CDK_DATA has standard column names:**
   - The sheet should have headers that match CDK's standard format
   - Example: "Stock No.", "StockType", "Front GP$", etc.

### Test Steps

1. **Do NOT select any columns manually:**
   - Leave all column dropdowns empty or at default "Select column..."
   - Skip the column mapping section entirely

2. **Run the merge:**
   - Click **"Start Merge"** button
   - Wait for progress to complete

### Expected Results ✅

- [ ] **Merge completes successfully**
- [ ] **Auto-detection activates** (check console for "using auto-detection")
- [ ] **Match count > 0** (if columns are standard CDK format)
- [ ] **Results appear in MERGED_DATA sheet**

### Verification Steps

1. **Check console logs:**
   ```
   Look for: "No user mappings found, using auto-detection"
   Should also see: "Column detection complete"
   ```

2. **Verify auto-detection worked:**
   - Check MERGED_DATA sheet has populated data
   - Verify stock numbers match between sheets
   - Confirm GP values are reasonable

---

## Verification Checklist

Use this checklist after completing both test scenarios:

### User Selection Test (Primary Fix)
- [ ] User can manually select columns from dropdowns
- [ ] Selected columns are stored in configuration
- [ ] Console logs confirm "Using user-provided column mappings"
- [ ] Match count > 0 when correct columns selected
- [ ] MERGED_DATA sheet contains correct data from user-selected columns
- [ ] Stock numbers in MERGED_DATA match Sales Log exactly
- [ ] GP values in MERGED_DATA match the source columns in CDK_DATA
- [ ] No data appears from wrong columns

### Auto-Detection Test (Backward Compatibility)
- [ ] Auto-detection works when no user selections provided
- [ ] Console logs show "using auto-detection"
- [ ] Match count > 0 for standard CDK format
- [ ] MERGED_DATA sheet is populated correctly

### Cross-Verification
- [ ] Pick 3 random stock numbers from Sales Log
- [ ] For each stock number:
  - [ ] Find it in CDK_DATA sheet
  - [ ] Note the row and column values for GP fields
  - [ ] Find the same stock number in MERGED_DATA
  - [ ] Verify GP values match exactly
  - [ ] Confirm data came from correct columns (not adjacent columns)

---

## Troubleshooting

### Issue: Still getting 0 matches

**Possible Causes:**
1. Code not deployed or spreadsheet not refreshed
2. Column selections not saved
3. Stock number format mismatch

**Solutions:**
1. **Verify code is deployed:**
   - Check Apps Script editor shows the fix at lines 266-301
   - Close and reopen spreadsheet completely
   
2. **Check column selections:**
   - View browser console (F12) when selecting columns
   - Look for JavaScript errors
   - Re-select columns one at a time
   
3. **Verify data format:**
   - Check stock numbers in both sheets are similar format
   - Look for leading zeros, spaces, or extra characters

### Issue: Wrong data still appearing in MERGED_DATA

**Diagnosis Steps:**

1. **Check which code path was used:**
   ```
   Open Apps Script execution log:
   - Go to Apps Script editor
   - Click "Executions" (clock icon)
   - Find your recent merge execution
   - Look for either:
     - "Using user-provided column mappings" ✓ (should see this)
     - "using auto-detection" ✗ (should NOT see this if you selected columns)
   ```

2. **Verify column indices:**
   - In console logs, check the actual column numbers used
   - Compare to your intended selections
   - Remember: Column A = index 0, Column B = index 1, etc.

3. **Manual verification:**
   - Pick one stock number
   - Manually trace it through:
     1. Sales Log → note stock number and row
     2. CDK_DATA → find stock number, note GP values
     3. MERGED_DATA → find stock number, check GP values match

### Issue: Console logs not showing

**How to view console logs:**

1. **Apps Script execution logs:**
   - Open Apps Script editor
   - Click **"Executions"** icon (clock) in left sidebar
   - Click on your recent merge execution
   - View the detailed log output

2. **Browser console (for UI issues):**
   - In spreadsheet, press **F12** (Windows) or **Cmd+Option+I** (Mac)
   - Go to **Console** tab
   - Look for errors or warnings

### Issue: Dropdowns not showing columns

**Solutions:**
1. Verify CDK_DATA sheet exists
2. Check sheet has headers in row 1
3. Refresh sidebar:
   - Close sidebar
   - Reopen via **SalesLog Pro** menu > **Merge CDK Data**

### Common Pitfalls

1. **Not refreshing after code deployment:**
   - Must close and reopen spreadsheet completely
   - Wait 10-15 seconds for initialization

2. **Selecting wrong columns:**
   - Double-check column headers in CDK_DATA
   - Match dropdown text exactly to CDK_DATA headers

3. **Mixed data formats:**
   - Stock numbers must be comparable (both text or both numbers)
   - Leading zeros can cause mismatches

4. **Old cache data:**
   - If issues persist, try:
     - Clear browser cache
     - Use incognito/private window
     - Try different browser

---

## Test Results Template

Use this template to document your test results:

```
Test Date: ______________
Tester: __________________
Spreadsheet: _____________

### Test Scenario 1: User Column Selection
Status: [ ] PASS  [ ] FAIL

Selected Columns:
- Stock Number: ___________
- Stock Type: _____________
- Front GP: _______________
- Back GP: ________________
- Total GP: _______________

Results:
- Match Count: ___________
- Match Rate: ____________%
- Data Verification: [ ] PASS  [ ] FAIL

Issues Found:
_________________________________
_________________________________

### Test Scenario 2: Auto-Detection
Status: [ ] PASS  [ ] FAIL

Results:
- Auto-detection activated: [ ] YES  [ ] NO
- Match Count: ___________
- Match Rate: ____________%

Issues Found:
_________________________________
_________________________________

### Overall Result
- [ ] Fix working as expected
- [ ] Issues remaining (describe below)

_________________________________
_________________________________
```

---

## Success Criteria

The fix is working correctly when:

✅ User-selected columns are used instead of being ignored  
✅ Match count > 0 when correct columns are selected  
✅ MERGED_DATA contains data from correct columns only  
✅ Console logs confirm "Using user-provided column mappings"  
✅ Auto-detection still works as fallback  
✅ No data corruption or column mismatches  

---

## Support

If you encounter issues not covered in this guide:

1. **Check the execution logs** in Apps Script editor
2. **Take screenshots** of the issue
3. **Document:**
   - What you were trying to do
   - What happened vs. what you expected
   - Any error messages
   - Console log output

---

*Last Updated: Testing guide created for merge tool column mapping fix*