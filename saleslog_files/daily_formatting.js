/** Daily MONTHLY formatting; preserve the same colors, number formats and borders. */
function _formatDailyMonthlyRows(sheet, rows, startRow, aliasMap, fontColors, sourceBackgrounds) {
  if (!rows.length) return [];
  const range = sheet.getRange(startRow, 1, rows.length, 14);
  range.setFontFamily('Calibri').setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('0');
  const endRow = startRow + rows.length - 1;
  sheet.getRangeList([`F${startRow}:F${endRow}`, `M${startRow}:M${endRow}`]).setFontSize(7);
  if (fontColors.length) range.setFontColors(fontColors);
  // E/L source colors are merged in memory before applying delivery/error highlights.
  return applyMonthlyRowFormatting(sheet, rows, startRow, aliasMap, sourceBackgrounds);
}
