/** A fresh, execution-local A:N read shared by derived sales reports only. */
function _readMonthlySalesSnapshot(sheet) {
  const upperRow = sheet.getLastRow();
  const values = upperRow ? sheet.getRange(1, 1, upperRow, 14).getValues() : [];
  // Side reports may extend getLastRow beyond the actual A:N sales data.
  while (values.length && values[values.length - 1].every(
    value => value === '' || value === null || value === undefined
  )) values.pop();
  return {sheetId: sheet.getSheetId(), values};
}

function _validateMonthlySalesSnapshot(sheet, snapshot) {
  if (!snapshot || snapshot.sheetId !== sheet.getSheetId() ||
      !Array.isArray(snapshot.values) ||
      !snapshot.values.every(row => Array.isArray(row) && row.length === 14)) {
    throw new Error('Invalid MONTHLY sales snapshot or mismatched sheet identity.');
  }
}
