/** Called under the sales script lock. Never restores over user input. */
function _rollbackUnclearedDaily() {
  const cp = getOperationCheckpoint();
  if (!cp) return '';
  if (!['PRE_MONTHLY_WRITE', 'MONTHLY_WRITE_STARTED', 'MONTHLY_WRITTEN',
    'TODAY_CLEAR_PENDING', 'ROLLBACK_PENDING'].includes(cp.phase)) {
    return 'Sales are saved. Checkpoint retained; run Process Daily again to finish the remaining steps.';
  }
  const sheets = getSheets();
  assertCheckpointMonthlySheet_(sheets.monthly, cp);
  const today = sheets.today.getRange(RANGES.dailyData).getValues();
  if (!cp.sourceRows || !cp.sourceRows.every(source => {
    const row = today[source.sheetRow - 2];
    return row && generateDataHash([row]) === source.dataHash;
  })) {
    return 'TODAY has changed or was partially cleared. No rollback was applied to avoid losing edits. Checkpoint retained for review.';
  }
  if (cp.phase === 'PRE_MONTHLY_WRITE') {
    if (!clearOperationCheckpoint()) throw new Error('Could not clear unstarted checkpoint.');
    return 'No sales were written. TODAY is unchanged; retry when ready.';
  }
  const block = findMonthlyCheckpointBlock_(sheets.monthly, cp);
  const headerRow = cp.headerInsertRow;
  if (!Number.isInteger(headerRow) || !Number.isInteger(cp.rowCount)) {
    return 'Checkpoint retained: automatic rollback cannot identify the exact write range.';
  }
  const range = sheets.monthly.getRange(headerRow, 1, cp.rowCount + 1, 14);
  const alreadyCleared = cp.phase === 'ROLLBACK_PENDING' &&
    range.getValues().every(row => row.every(value => value === '' || value == null)) &&
    range.getNotes().every(row => row.every(note => !note));
  if (!alreadyCleared && (!block || block.headerRow !== headerRow ||
      findLastRowInCols(sheets.monthly, 1, 14) !== headerRow + cp.rowCount)) {
    return 'Checkpoint retained: MONTHLY was edited or the write is incomplete. Automatic rollback requires review.';
  }
  if (cp.phase !== 'ROLLBACK_PENDING' && !updateCheckpoint('ROLLBACK_PENDING')) {
    throw new Error('Could not save rollback checkpoint.');
  }
  if (!alreadyCleared) range.clearContent().setNote('').breakApart();
  SpreadsheetApp.flush();
  const {aliasMap} = getSalespersonMaps();
  const rows = collectMonthlyRowsWithDates_(sheets.monthly).map(entry => entry.row);
  const counts = tallyCounts(rows, aliasMap, [{fiIdx:2,saleIdx:6},{fiIdx:9,saleIdx:13}]).counts;
  updateLeaderboardFromCounts_(sheets.today.getRange(RANGES.leaderboard), counts, {mode:'set'});
  reapplyCF({throwOnError:true});
  if (!clearOperationCheckpoint()) throw new Error('Could not clear completed rollback checkpoint.');
  console.info('DAILY_ROLLBACK_COMPLETED: verified new MONTHLY block removed; TODAY preserved; leaderboard rebuilt.');
  return 'This run was rolled back. TODAY is unchanged, its new MONTHLY block was removed, and the leaderboard was rebuilt. You can retry.';
}
