function mergeCDKDataIntoCleaned() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cleanedSheet = ss.getSheetByName('CDK_MERGED');
  const cdkSheet = ss.getSheetByName('CDK_DATA');

  if (!cleanedSheet || !cdkSheet) {
    throw new Error('Required sheets not found.');
  }

  // Identify headers
  const cleanedHeaders = cleanedSheet.getRange(1, 1, 1, cleanedSheet.getLastColumn()).getValues()[0];
  const cdkHeaders = cdkSheet.getRange(1, 1, 1, cdkSheet.getLastColumn()).getValues()[0];

  // Identify key columns
  const cleanedKeyIndex = cleanedHeaders.indexOf('StockNo');
  const cdkKeyIndex = cdkHeaders.indexOf('Stock No.');

  if (cleanedKeyIndex === -1 || cdkKeyIndex === -1) {
    throw new Error('Key columns not found in one or both sheets.');
  }

  // Get all data
  const cleanedData = cleanedSheet.getRange(2, 1, cleanedSheet.getLastRow() - 1, cleanedSheet.getLastColumn()).getValues();
  const cdkData = cdkSheet.getRange(2, 1, cdkSheet.getLastRow() - 1, cdkSheet.getLastColumn()).getValues();

  // Build a map for quick lookup of CDK rows by Stock No.
  const cdkMap = new Map();
  for (let row of cdkData) {
    const key = String(row[cdkKeyIndex]).trim();
    if (key) cdkMap.set(key, row);
  }

  // Build merged data output
  const mergedData = cleanedData.map(cleanedRow => {
    const key = String(cleanedRow[cleanedKeyIndex]).trim();
    const cdkRow = cdkMap.get(key);
    return cdkRow ? [...cleanedRow, ...cdkRow] : cleanedRow;
  });

  // Clear old data below headers and write merged data
  cleanedSheet.getRange(2, 1, cleanedSheet.getLastRow() - 1, cleanedSheet.getLastColumn()).clearContent();
  cleanedSheet.getRange(2, 1, mergedData.length, mergedData[0].length).setValues(mergedData);

  Logger.log(`Merged ${mergedData.length} rows from CDK_DATA into CDK_MERGED.`);
}
