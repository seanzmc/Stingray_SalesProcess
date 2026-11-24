/** Find review candidates without changing or rejecting entered sales. */
function _findDailyMonthlyDuplicates(values, startRow, rowCount, dateStr) {
  const normalize = value => String(value == null ? '' : value).trim().toUpperCase();
  const entries = [];
  const signatures = new Map();
  const stocks = new Map();
  let date = '';
  values.forEach((row, index) => {
    const header = row[0];
    if (header instanceof Date || /^\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?$/.test(String(header).trim())) {
      date = normalizeDealDateIso_(header);
    }
    for (const offset of [0, 7]) {
      const side = row.slice(offset + 1, offset + 7).map(normalize);
      if (!side.some(Boolean)) continue;
      const entry = {row: index + 1, column: offset + 2, date,
        customer: normalize(row[offset + 1]), stock: normalize(row[offset + 4]),
        signature: JSON.stringify(side)};
      entries.push(entry);
      if (!signatures.has(entry.signature)) signatures.set(entry.signature, []);
      signatures.get(entry.signature).push(entry);
      if (entry.stock) {
        const key = `${date}:${entry.stock}`;
        if (!stocks.has(key)) stocks.set(key, []);
        stocks.get(key).push(entry);
      }
    }
  });
  const targetDate = normalizeDealDateIso_(dateStr);
  return entries.filter(entry => entry.row >= startRow && entry.row < startRow + rowCount)
    .flatMap(entry => {
      const matches = [...new Set([...(signatures.get(entry.signature) || []),
        ...(entry.stock ? stocks.get(`${targetDate}:${entry.stock}`) || [] : [])])]
        .filter(other => other !== entry);
      return matches.length ? [{...entry, matches}] : [];
    });
}

/** Called under the daily script lock before TODAY is cleared; safe on resume. */
function _flagDailyMonthlyDuplicates(sheet, values, startRow, rowCount, dateStr) {
  const duplicates = _findDailyMonthlyDuplicates(values, startRow, rowCount, dateStr);
  if (!duplicates.length) return [];
  const range = sheet.getRange(startRow, 2, rowCount, 13);
  const notes = range.getNotes();
  const cells = [];
  const warnings = duplicates.map(entry => {
    const cell = `${entry.column === 2 ? 'B' : 'I'}${entry.row}`;
    const matches = entry.matches.map(other =>
      `MONTHLY!${other.column === 2 ? 'B' : 'I'}${other.row} (${other.date || 'date unavailable'}): ${other.customer}, stock ${other.stock || '(blank)'}`);
    const warning = `MONTHLY!${cell}: ${entry.customer}, stock ${entry.stock || '(blank)'} — matches ${matches.join('; ')}`;
    const marker = '[Possible duplicate sale]';
    const oldNote = notes[entry.row - startRow][entry.column - 2] || '';
    const original = oldNote.split(marker)[0].trimEnd();
    notes[entry.row - startRow][entry.column - 2] = (original ? original + '\n\n' : '') +
      marker + '\nLogged and included in totals. Review before removing any entry.\n' + warning;
    cells.push(cell);
    return warning;
  });
  range.setNotes(notes);
  sheet.getRangeList(cells).setBackground('#fff2cc').setFontColor('#000000');
  // Keep customer information in the sheet/result dialog, not execution logs.
  console.warn(JSON.stringify({context: 'processDaily', event: 'possible_duplicates_flagged',
    cells, count: duplicates.length}));
  return warnings;
}
