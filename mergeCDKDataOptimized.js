/**
 * Merges CDK_DATA sheet with CLEANED sheet by matching Stock No. values
 * Uses dynamic header detection for flexibility and robustness
 *
 * @throws {Error} If required sheets or columns are not found
 * @returns {Object} Merge statistics {matchCount, noMatchCount, totalRows}
 */
function mergeCDKDataOptimized() {
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

  const mergedData = cleanedData.map(cleanedRow => {
    const key = String(cleanedRow[cleanedKeyIndex]).trim().toUpperCase(); // Case insensitive
    const cdkRow = cdkMap.get(key);

    if (cdkRow) {
      matchCount++;
      // FIX: Only take first 8 columns from CLEANED (A-H), then append CDK data (I-AC)
      // This prevents CDK data from being appended after empty columns 9-29
      return [...cleanedRow.slice(0, 8), ...cdkRow];
    } else {
      noMatchCount++;
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
