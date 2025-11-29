# Saleslog Data Flow Analysis

## 1. Execution Flow Logic Map

### **Step 1: Daily Input & Processing (`processDaily`)**
*   **Input:** User enters data in `TODAY` sheet, range `A2:N51`.
*   **Lock:** Acquires Script Lock.
*   **Read:** Reads `TODAY` data into memory (`allDailyData`).
*   **Filter:** Filters for rows with activity (New/Used).
*   **Checkpoint:** Creates 'PRE_MONTHLY_WRITE' checkpoint.
*   **Write to Monthly:**
    *   Inserts rows into `MONTHLY` sheet (Columns A-N).
    *   **Flush:** `SpreadsheetApp.flush()` is called to ensure data is written.
    *   Applies formatting and font colors.
*   **Tally (In-Memory):**
    *   Tallies sales counts using the *in-memory* array `rowsToLogToMonthly` (does NOT re-read from `MONTHLY`).
    *   *Note: This avoids a race condition where `MONTHLY` might be modified externally, but relies on `rowsToLogToMonthly` being accurate.*
*   **Update Leaderboard:** Updates `TODAY` leaderboard with new counts.
*   **Clear:** Clears `TODAY` input range (`B2:N51`).
*   **Analytics:** Calculates and writes analytics to `MONTHLY` (Columns S-X).

### **Step 2: Normalization & Merge (`reformatDailySales`)**
*   **Trigger:** Manual Menu Item ("Merge Monthly data with CDK").
*   **Lock:** Acquires Script Lock.
*   **Read:** Reads `MONTHLY` sheet (Columns A:N).
*   **Normalize:** Splits New/Used sales into separate rows.
*   **Write:** Overwrites `CDK_MERGED` sheet (Columns A-H).
*   **Merge (`mergeCDKData`):**
    *   Reads `CDK_MERGED` (A-H) and `CDK_DATA`.
    *   Matches rows by "Stock No." (Case-insensitive).
    *   Appends CDK data (Columns I-Y) and Age (Column Z from `VSALES`) to `CDK_MERGED`.

### **Step 3: Dashboard Refresh (`refreshDashboard`)**
*   **Trigger:** Manual Menu Item ("Refresh Dashboard").
*   **Read:** Reads `CDK_MERGED` sheet (Columns A-Z).
*   **Filter:** Skips rows with yellow background (unmatched in Merge step).
*   **Map:** Maps `CDK_MERGED` columns to `DASHBOARD` format (Columns A-Q).
*   **Write:** Clears and rewrites `DASHBOARD` data (Rows 7+).

### **Step 4: Month Rollover (`rolloverMonth`)**
*   **Trigger:** Manual Menu Item ("Start New Month").
*   **Lock:** Acquires Script Lock.
*   **Archive Monthly:** Copies `MONTHLY` to new sheet `M/YY`.
*   **Archive Leaderboard:** Copies **`TODAY` Leaderboard** (`RANGES.leaderboard`) to the archive sheet.
    *   *Critical Flag:* It copies the leaderboard from `TODAY`, not a recalculation from `MONTHLY`.
*   **Reset:**
    *   Clears `MONTHLY` sheet.
    *   Clears MTD on `TODAY`.
    *   Recalculates 3-Month Averages.

---

## 2. Flagged Issues & Checks

### **Check 1: `SpreadsheetApp.flush()` before tally?**
*   **Status:** **NO**, but acceptable.
*   **Analysis:** `processDaily` does not `flush()` before tallying. However, it tallies using the `rowsToLogToMonthly` array which is already in memory (derived from the initial read of `TODAY`). It does *not* read back from the sheet for the tally, so a `flush()` is not strictly necessary for the tally's accuracy relative to the input.
*   **Note:** It *does* `flush()` after writing to `MONTHLY` and before applying formatting, which is good practice.

### **Check 2: Are we archiving data that hasn't been tallied yet?**
*   **Status:** **POTENTIAL RISK**.
*   **Analysis:** The `rolloverMonth` function archives the `MONTHLY` sheet and the `TODAY` leaderboard.
    *   If `processDaily` completes successfully, `TODAY` leaderboard is in sync with `MONTHLY`.
    *   **Risk:** If `processDaily` crashes *after* writing to `MONTHLY` but *before* updating the leaderboard (or if `MONTHLY` is manually edited), the `TODAY` leaderboard will be out of sync. `rolloverMonth` will then archive the **stale/incorrect** leaderboard alongside the correct `MONTHLY` data.
*   **Recommendation:** Force a leaderboard refresh (using logic similar to `recalcMtdFromMonthly`) inside `rolloverMonth` *before* archiving to ensure consistency.

### **Check 3: Dashboard vs. Log Range Alignment**
*   **Status:** **ALIGNED** (assuming Log = `CDK_MERGED`).
*   **Analysis:**
    *   `refreshDashboard` reads from `CDK_MERGED`.
    *   The column mapping in `mapRowToDashboard` correctly matches the structure produced by `reformatDailySales` + `mergeCDKData`.
    *   *Example:* `CDK_MERGED` Col Y (Index 24) is RDR Date. `mapRowToDashboard` reads `sourceRow[24]`. Correct.
    *   *Example:* `CDK_MERGED` Col J (Index 9) is Deal #. `mapRowToDashboard` reads `sourceRow[9]`. Correct.

### **Additional Findings**
*   **Duplicate Logic:** There is a `vsaleslog_refresh.js` file that contains `processVSalesLogComplete`. This seems to be an alternative/older workflow that merges `CDK_DATA` + `VSALES` directly to `V-SALESLOG` and appends to `DASHBOARD`. The `dashboard_refresh.js` logic seems to supersede this, but both exist.
*   **Checkpoint Recovery:** A checkpoint system exists in `processDaily`, but there is no automatic recovery trigger (e.g., in `onOpen`) to resume interrupted jobs.

---

## 3. Proposed Fix

### **Fix for Archiving Risk**
Modify `rolloverMonth` to ensure the leaderboard is up-to-date before archiving.

**File:** `saleslog_files/core_saleslogPro.js`

```javascript
function rolloverMonth() {
  withScriptLock(() => {
    // ... (existing confirmation dialog) ...

    toastInfo("Starting month rollover...", "Working (1/6)"); // Update step count

    // STEP 0: Sync Leaderboard with MONTHLY data to ensure archive is accurate
    // This prevents archiving a stale leaderboard if previous daily processes failed/drifted
    try {
       Logger.log("Synchronizing leaderboard with MONTHLY data before archive...");

       const sheets = getSheets();
       const monthlySheet = sheets.monthly;
       const lastRowMonthly = monthlySheet.getLastRow();

       if (lastRowMonthly > 1) {
         // Recalculate counts from MONTHLY
         // We can reuse the logic from recalcMtdFromMonthly or just call it if we refactor it to be silent.
         // For safety, we can implement a lightweight sync here:

         const { aliasMap } = getSalespersonMaps();
         // Read all data (assuming max 14 cols)
         const monthlyValues = monthlySheet.getRange(2, 1, lastRowMonthly - 1, 14).getValues();

         const sidesToTally = [
            { fiIdx: 2, saleIdx: 6 },
            { fiIdx: 9, saleIdx: 13 },
         ];
         const { counts: countsByFullName } = tallyCounts(monthlyValues, aliasMap, sidesToTally);

         const lbRange = sheets.today.getRange(RANGES.leaderboard);
         const lbValues = lbRange.getValues();
         lbValues.forEach((r) => {
            r[1] = countsByFullName[r[0]] || 0;
         });
         // Sort
         lbValues.sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0) || (Number(b[2]) || 0) - (Number(a[2]) || 0));
         lbRange.setValues(lbValues);
         SpreadsheetApp.flush(); // Ensure leaderboard is updated before archiving
         Logger.log("Leaderboard synchronized successfully.");
       }
    } catch (e) {
       logWarning('rolloverMonth', 'Pre-archive leaderboard sync failed', { error: e.toString() });
       alertError("Failed to synchronize leaderboard. Aborting rollover to prevent data loss.");
       return;
    }

    // ... (rest of rolloverMonth) ...
  });
}
```
