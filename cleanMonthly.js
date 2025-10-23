 /*This is how to clean and normalize the MONTHLY sales data before merging with the CDK_DATA sheet.*/
function reformatDailySales() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("MONTHLY");
  const data = sheet.getRange("A:N").getValues();
  const output = [];
  let currentDate = "";

  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    // Detect a date row (merged date previously in A)
    if (row[0] instanceof Date) {
      currentDate = row[0];
      continue;
    }

    // Skip blank rows
    const isEmpty = row.join("").trim() === "";
    if (isEmpty) continue;

    // NEW sale block (columns B–G → indexes 1–6)
    const newData = row.slice(1, 7);
    // Filter out rows that do not have a valid FI initial
    const hasNewFI = newData[1] && /^[A-Za-z]$/.test(String(newData[1]));
    if (newData.join('').trim() !== '' && hasNewFI) {
      output.push([currentDate, 'NEW', ...newData]);
    }

    // USED sale block (columns I–N → indexes 8–13)
    const usedData = row.slice(8, 14);
    // Filter out rows that do not have a valid FI initial
    const hasUsedFI = usedData[1] && /^[A-Za-z]$/.test(String(usedData[1]));
    if (usedData.join('').trim() !== '' && hasUsedFI) {
      output.push([currentDate, 'USED', ...usedData]);
    }
  }

  // Create new sheet for clean data
  const cleaned = ss.getSheetByName("CLEANED") || ss.insertSheet("CLEANED");
  cleaned.clear();
  const headers = [
    "Date",
    "Type",
    "Customer",
    "FI",
    "Model",
    "StockNo",
    "Trade",
    "Sales Person",
    "Contract Date",
    "Customer",
    "VIN",
    "Stock No.",
    "Status",
    "PLC",
    "Sale Type",
    "Year",
    "Model",
    "StockType",
    "Front GP$",
    "Back GP$",
    "GP$",
    "Cash Price",
    "Trades",
    "Service Contract",
    "Finance Institution",
    "Salesperson",
    "FI Manager",
    "Term",
    "Deal No.",
  ];
  // Set header format
  cleaned.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("center");
  cleaned.appendRow(headers);
  cleaned.getRange(2, 1, output.length, output[0].length).setValues(output);

  // Merge CDK_DATA with CLEANED sheet
  mergeCDKData();

  SpreadsheetApp.getUi().alert('Reformat and merge complete. See "CLEANED" tab.');
}

/**
 * Merges CDK_DATA sheet with CLEANED sheet by matching Stock No. values
 * Uses dynamic header detection for flexibility and robustness
 *
 * @throws {Error} If required sheets or columns are not found
 * @returns {Object} Merge statistics {matchCount, noMatchCount, totalRows}
 */
function mergeCDKData() {
  // === VALIDATION (from Function 2) ===
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cleanedSheet = ss.getSheetByName('CLEANED');
  const cdkSheet = ss.getSheetByName('CDK_DATA');

  if (!cleanedSheet || !cdkSheet) {
    throw new Error('Required sheets not found: ' +
      (!cleanedSheet ? 'CLEANED ' : '') + (!cdkSheet ? 'CDK_DATA' : ''));
  }

  // === DYNAMIC HEADER DETECTION (from Function 1) ===
  const cleanedHeaders = cleanedSheet.getRange(1, 1, 1, cleanedSheet.getLastColumn()).getValues()[0];
  const cdkHeaders = cdkSheet.getRange(1, 1, 1, cdkSheet.getLastColumn()).getValues()[0];

  const cleanedKeyIndex = cleanedHeaders.indexOf('StockNo');
  const cdkKeyIndex = cdkHeaders.indexOf('Stock No.');

  if (cleanedKeyIndex === -1 || cdkKeyIndex === -1) {
    throw new Error('Key columns not found: ' +
      (cleanedKeyIndex === -1 ? 'StockNo in CLEANED ' : '') +
      (cdkKeyIndex === -1 ? 'Stock No. in CDK_DATA' : ''));
  }

  // === DATA READING (optimized) ===
  const cleanedData = cleanedSheet.getDataRange().getValues().slice(1); // Skip header
  const cdkData = cdkSheet.getDataRange().getValues().slice(1); // Skip header

  // Early return for empty sheets (from Function 2)
  if (cleanedData.length === 0) {
    Logger.log('Warning: CLEANED sheet is empty. No merge needed.');
    return { matchCount: 0, noMatchCount: 0, totalRows: 0 };
  }

  if (cdkData.length === 0) {
    Logger.log('Warning: CDK_DATA sheet is empty. Skipping merge.');
    return { matchCount: 0, noMatchCount: cleanedData.length, totalRows: cleanedData.length };
  }

  // === MAP BUILDING with CASE-INSENSITIVE keys (from Function 2) ===
  const cdkMap = new Map();
  for (let row of cdkData) {
    const key = String(row[cdkKeyIndex]).trim().toUpperCase(); // Case insensitive
    if (key) cdkMap.set(key, row);
  }

  // === MERGE LOGIC with TRACKING (hybrid) ===
  let matchCount = 0;
  let noMatchCount = 0;
  const unmatchedCleanedRows = []; // Track unmatched CLEANED row indices (1-based, accounting for header)
  const matchedCDKKeys = new Set(); // Track which CDK Stock No. values were matched

  const mergedData = cleanedData.map((cleanedRow, index) => {
    const key = String(cleanedRow[cleanedKeyIndex]).trim().toUpperCase(); // Case insensitive
    const cdkRow = cdkMap.get(key);

    if (cdkRow) {
      matchCount++;
      matchedCDKKeys.add(key); // Track this CDK key as matched
      // FIX: Only take first 8 columns from CLEANED (A-H), then append CDK data (I-AC)
      // This prevents CDK data from being appended after empty columns 9-29
      return [...cleanedRow.slice(0, 8), ...cdkRow];
    } else {
      noMatchCount++;
      unmatchedCleanedRows.push(index + 2); // +2 because: +1 for 0-based to 1-based, +1 for header row
      if (key) Logger.log(`No match found for Stock No: ${key}`);
      // For unmatched rows, also only keep first 8 columns to maintain consistency
      return cleanedRow.slice(0, 8);
    }
  });

  // === ROW PADDING (from Function 2) ===
  if (mergedData.length > 0) {
    const maxCols = Math.max(...mergedData.map(row => row.length));
    const paddedData = mergedData.map(row => {
      const padded = [...row];
      while (padded.length < maxCols) {
        padded.push('');
      }
      return padded;
    });

    // === WRITE BACK (batch operation) ===
    cleanedSheet.getRange(2, 1, paddedData.length, maxCols).setValues(paddedData);
    SpreadsheetApp.flush(); // Ensure write completion

    // === CLEAR EXISTING BACKGROUND COLORS ===
    // Clear backgrounds from CLEANED sheet (data rows only, preserve header)
    const cleanedLastRow = cleanedSheet.getLastRow();
    const cleanedLastCol = cleanedSheet.getLastColumn();
    if (cleanedLastRow > 1 && cleanedLastCol > 0) {
      cleanedSheet.getRange(2, 1, cleanedLastRow - 1, cleanedLastCol).setBackground(null);
    }

    // Clear backgrounds from CDK_DATA sheet (data rows only, preserve header)
    const cdkLastRow = cdkSheet.getLastRow();
    const cdkLastCol = cdkSheet.getLastColumn();
    if (cdkLastRow > 1 && cdkLastCol > 0) {
      cdkSheet.getRange(2, 1, cdkLastRow - 1, cdkLastCol).setBackground(null);
    }

    Logger.log('Cleared existing background colors from both sheets');

    // === CONDITIONAL FORMATTING for unmatched rows ===
    // Format unmatched rows in CLEANED sheet with light yellow background
    if (unmatchedCleanedRows.length > 0) {
      const cleanedRanges = unmatchedCleanedRows.map(rowIndex =>
        cleanedSheet.getRange(rowIndex, 1, 1, maxCols)
      );
      const cleanedRangeList = cleanedSheet.getRangeList(cleanedRanges.map(r => r.getA1Notation()));
      cleanedRangeList.setBackground('#FFFFE0');
      Logger.log(`Highlighted ${unmatchedCleanedRows.length} unmatched rows in CLEANED sheet`);
    }

    // Format unmatched rows in CDK_DATA sheet
    const unmatchedCDKRows = [];
    cdkData.forEach((row, index) => {
      const key = String(row[cdkKeyIndex]).trim().toUpperCase();
      if (key && !matchedCDKKeys.has(key)) {
        unmatchedCDKRows.push(index + 2); // +2 for 0-based to 1-based, +1 for header
      }
    });

    if (unmatchedCDKRows.length > 0) {
      const cdkMaxCols = cdkSheet.getLastColumn();
      const cdkRanges = unmatchedCDKRows.map(rowIndex =>
        cdkSheet.getRange(rowIndex, 1, 1, cdkMaxCols)
      );
      const cdkRangeList = cdkSheet.getRangeList(cdkRanges.map(r => r.getA1Notation()));
      cdkRangeList.setBackground('#FFFFE0');
      Logger.log(`Highlighted ${unmatchedCDKRows.length} unmatched rows in CDK_DATA sheet`);
    }
  }

  // === COMPREHENSIVE LOGGING (from Function 2) ===
  const stats = {
    matchCount: matchCount,
    noMatchCount: noMatchCount,
    totalRows: mergedData.length
  };

  Logger.log(`Merge complete: ${matchCount} matches found, ${noMatchCount} rows without matches (${((matchCount/mergedData.length)*100).toFixed(1)}% match rate).`);

  return stats;
}
/*The resulting output will be in a new sheet named CLEANED. This is the data that will be merged with the CDK_DATA sheet.
The column that will have the most congruency is the StockNo column. It will ALWAYS be column F in the CLEANED sheet. For the purpose of getting this to work, hardcode the StockNo column in CDK_DATA to D. */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Data Tools')
    .addItem('Normalize Sales Log', 'reformatDailySales')
    .addToUi();
}

