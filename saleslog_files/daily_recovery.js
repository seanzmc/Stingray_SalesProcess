/** Automatic reconciliation of saved progress with the visible sales sheets. */
/** Rebuild reports from visible MONTHLY data before retiring obsolete progress. */
function _rebuildDailyReports(sheets, snapshot) {
  const {aliasMap} = getSalespersonMaps();
  const rows = collectMonthlyRowsWithDates_(sheets.monthly, snapshot).map(entry => entry.row);
  const counts = tallyCounts(rows, aliasMap, [{fiIdx:2,saleIdx:6},{fiIdx:9,saleIdx:13}]).counts;
  updateLeaderboardFromCounts_(sheets.today.getRange(RANGES.leaderboard), counts, {mode:'set'});
  reapplyCF({throwOnError:true});
  invalidateAnalyticsCache();
  const analytics = calculateMonthlyAnalytics(snapshot);
  if (!analytics) throw new Error('Sales reports could not finish rebuilding. Daily processing will retry recovery on its next run.');
  writeAnalyticsToMonthly(analytics, sheets.monthly);
}

/** Pure decision: only exact saved rows can be cleared, never a replacement row. */
function _planDailyReconciliation(checkpoint, today, monthlyRows, hasBlock, markerRows, nextDate) {
  const saved = checkpoint.sourceRows;
  const unchanged = saved.every(source => today[source.sheetRow - 2] &&
    generateDataHash([today[source.sheetRow - 2]]) === source.dataHash);
  const hasAdditionalRows = today.some((row,index) => dailyRowHasActivity_(row) && !saved.some(source => source.sheetRow === index+2));
  if (hasBlock && unchanged && !hasAdditionalRows) return {action:'resume', clearRows:[]};
  if (!hasBlock && unchanged && !monthlyRows.length) return {action:'restart', clearRows:[]};
  const monthlyCounts = new Map();
  monthlyRows.forEach(row => {
    const hash=generateDataHash([row]);
    monthlyCounts.set(hash, (monthlyCounts.get(hash)||0)+1);
  });
  const monthlyHashes = new Set(monthlyCounts.keys());
  const backed = new Set(saved.filter(source => monthlyHashes.has(source.dataHash)).map(source => source.dataHash));
  if (!hasBlock && unchanged && !backed.size) return {action:'restart', clearRows:[]};
  const clearRows = [];
  const originalStillWaiting = [];
  today.forEach((row, index) => {
    if (!dailyRowHasActivity_(row)) return;
    const hash = generateDataHash([row]);
    if (backed.has(hash) && monthlyCounts.get(hash)>0) {
      clearRows.push(index + 2);
      monthlyCounts.set(hash,monthlyCounts.get(hash)-1);
    }
    else if (saved.some(source => source.dataHash === hash)) originalStillWaiting.push(index + 2);
  });
  // Do not assign yesterday's date to older original sales mixed with replacements.
  if (originalStillWaiting.length && normalizeDealDateIso_(checkpoint.dateProcessed) !== normalizeDealDateIso_(nextDate)) {
    const replacementRows = today.some((row,index) => dailyRowHasActivity_(row) &&
      !clearRows.includes(index+2) && !originalStillWaiting.includes(index+2));
    return {action:replacementRows ? 'conflict' : 'rebase', clearRows:replacementRows ? [] : clearRows, rows:originalStillWaiting};
  }
  return {action:'retire', clearRows};
}

/** Runs inside processDaily's sales lock, without prompts or user overrides. */
function _reconcileDailyCheckpoint(sheets, checkpoint) {
  if (!checkpoint || !Array.isArray(checkpoint.sourceRows) || !checkpoint.sourceRows.length) return checkpoint;
  const range = sheets.today.getRange(RANGES.dailyData);
  const today = range.getValues();
  const snapshot = _readMonthlySalesSnapshot(sheets.monthly);
  const monthlyRows = collectMonthlyRowsWithDates_(sheets.monthly, snapshot).map(entry => entry.row);
  const block = findMonthlyCheckpointBlock_(sheets.monthly, checkpoint);
  const markers = block ? [] : findMonthlyCheckpointMarkerRows_(sheets.monthly, checkpoint);
  const nextDate = formatDateOffset(1);
  const plan = _planDailyReconciliation(checkpoint, today, monthlyRows, !!block, markers, nextDate);
  if (plan.action === 'resume') return checkpoint;
  if (plan.action === 'conflict') throw new Error(
    `TODAY rows ${plan.rows.join(', ')} still contain unlogged sales from ${checkpoint.dateProcessed}, mixed with changed entries. ` +
    'Their sales date cannot be determined safely. Sales were preserved.'
  );
  if (plan.action === 'restart') {
    if (markers.length) sheets.monthly.getRangeList(markers.map(row => `A${row}`)).setNote('');
    // No copy exists, and the original source is intact: keep its original date.
    if (!updateCheckpoint('PRE_MONTHLY_WRITE')) throw new Error('Could not resume the original sales transfer.');
    console.info('DAILY_AUTO_RECOVERY: missing MONTHLY copy; restarting original sales with their saved date.');
    return getOperationCheckpoint();
  }
  // Service work can take seconds. Verify both sources again before clearing.
  if (JSON.stringify(range.getValues()) !== JSON.stringify(today) ||
      JSON.stringify(_readMonthlySalesSnapshot(sheets.monthly)) !== JSON.stringify(snapshot)) {
    throw new Error('Sales changed during automatic recovery. No entries were cleared; the next daily run will retry.');
  }
  if (plan.clearRows.length) {
    sheets.today.getRangeList(plan.clearRows.map(row => `B${row}:N${row}`)).clearContent();
  }
  _rebuildDailyReports(sheets, snapshot);
  if (JSON.stringify(_readMonthlySalesSnapshot(sheets.monthly)) !== JSON.stringify(snapshot)) {
    throw new Error('MONTHLY changed during report rebuilding. Daily recovery will retry against the updated sheet.');
  }
  if (plan.action === 'rebase') {
    const current = range.getValues();
    const sourceRows = plan.rows.map(sheetRow => ({sheetRow, dataHash:generateDataHash([current[sheetRow-2]])}));
    if (JSON.stringify(current) !== JSON.stringify(remaining.map((row,index) => plan.clearRows.includes(index+2) ? [today[index][0], ...Array(13).fill('')] : row))) {
      throw new Error('TODAY changed during automatic recovery. The next daily run will retry.');
    }
    if (!createOperationCheckpoint({dateStr:checkpoint.dateProcessed, dateIso:checkpoint.dateIso,
      rowCount:sourceRows.length, rows:plan.rows.map(row=>current[row-2]), sourceRows,
      monthlySheetId:sheets.monthly.getSheetId()})) throw new Error('Could not resume relocated original sales.');
    return getOperationCheckpoint();
  }
  // Keep the prior checkpoint intact until report rebuilding has succeeded.
  if (!clearOperationCheckpoint()) throw new Error('Could not finish automatic daily recovery.');
  console.info(JSON.stringify({event:'DAILY_AUTO_RECOVERY_COMPLETED',
    clearedSavedRows:plan.clearRows.length, date:checkpoint.dateProcessed}));
  return null;
}
