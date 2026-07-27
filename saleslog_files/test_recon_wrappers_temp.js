// TEMPORARY test scaffolding for Recon export append-position verification.
// NOT committed to git. Removed (with clasp push) after the test completes.
// All functions are zero-arg so they can run from the Apps Script editor toolbar.

const __TEST_RECON = {
  APPEND_ROW: 0, // baked between phases: expected append start row
  COUNT: 0, // baked between phases: rows the real export will append
  PAD: 25, // extra rows included in the backup as insurance
  PRE_LAST_ROW: 0, // baked between phases: Recon sheet lastRow before the real export
  BACKUP_TAB: '__test_backup__',
};

function __testLog_(label, obj) {
  Logger.log(label + ': ' + JSON.stringify(obj));
}

function __testReconDryRun() {
  const r = exportTradesToReconLog({ scanMonthly: true, dryRun: true });
  __testLog_('DRYRUN_RESULT', r);
}

function __testReconExport() {
  const r = exportTradesToReconLog({ scanMonthly: true, dryRun: false });
  __testLog_('EXPORT_RESULT', r);
}

function __testReconCols_() {
  const ss = SpreadsheetApp.openById(RECON_SPREADSHEET_ID);
  const sheet = getReconSheet_(ss);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headerRow = findReconHeaderRow_(sheet, [
    'Deal Date',
    'Stock #',
    'Salesperson',
    'Location',
    RECON_SOURCEKEY_HEADER,
  ]);
  const headerMap = getHeaderMap_(sheet, headerRow);
  const sourceKeyCol = detectSourceKeyCol_(sheet, lastRow, lastCol, headerMap);
  const headers =
    sheet.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0] || [];
  let stockCol = 0;
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === 'stock #') {
      stockCol = i + 1;
      break;
    }
  }
  return {
    sheet: sheet,
    lastRow: lastRow,
    lastCol: lastCol,
    sourceKeyCol: sourceKeyCol,
    stockCol: stockCol,
  };
}

function __scanFromBottom_(sheet, col, lastRow) {
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, col, lastRow - 1, 1).getDisplayValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]).trim()) return i + 2;
  }
  return 0;
}

function __testReconTail() {
  const c = __testReconCols_();
  __testLog_('TAIL', {
    lastRow: c.lastRow,
    lastCol: c.lastCol,
    stockCol: c.stockCol,
    sourceKeyCol: c.sourceKeyCol,
    stockLastRow: __scanFromBottom_(c.sheet, c.stockCol, c.lastRow),
    sourceKeyLastRow: __scanFromBottom_(c.sheet, c.sourceKeyCol, c.lastRow),
  });
}

function __testReconBackup() {
  const c = __testReconCols_();
  const ss = c.sheet.getParent();
  const old = ss.getSheetByName(__TEST_RECON.BACKUP_TAB);
  if (old) ss.deleteSheet(old);
  const tab = ss.insertSheet(__TEST_RECON.BACKUP_TAB);
  const start = __TEST_RECON.APPEND_ROW;
  const count = __TEST_RECON.COUNT + __TEST_RECON.PAD;
  const values = c.sheet.getRange(start, 1, count, c.lastCol).getValues();
  tab.getRange(1, 1, count, c.lastCol).setValues(values);
  __testLog_('BACKUP_OK', { start: start, count: count, lastCol: c.lastCol });
}

function __testReconRevert() {
  const c = __testReconCols_();
  const ss = c.sheet.getParent();
  const start = __TEST_RECON.APPEND_ROW;
  const count = __TEST_RECON.COUNT;
  const pre = __TEST_RECON.PRE_LAST_ROW;

  // Safety: every target row must currently hold a test-export row (non-empty SourceKey).
  const keys = c.sheet
    .getRange(start, c.sourceKeyCol, count, 1)
    .getDisplayValues();
  const empties = [];
  keys.forEach((row, i) => {
    if (!String(row[0]).trim()) empties.push(start + i);
  });
  if (empties.length) {
    __testLog_('REVERT_ABORT', { reason: 'empty SourceKey rows', rows: empties });
    return;
  }

  const nowLast = c.sheet.getLastRow();
  if (start > pre) {
    // Pure append below all previous content: rows start..start+count-1 are new.
    // Refuse if anything else grew the sheet below pre (concurrent writer).
    const belowPre = Math.max(0, nowLast - pre);
    if (belowPre !== count) {
      __testLog_('REVERT_ABORT', {
        reason: 'rows below preLastRow mismatch',
        belowPre: belowPre,
        expected: count,
        nowLast: nowLast,
        pre: pre,
      });
      return;
    }
    c.sheet.deleteRows(start, count);
    __testLog_('REVERT_OK', {
      mode: 'delete',
      deleted: count,
      lastRowAfter: c.sheet.getLastRow(),
    });
  } else {
    // Export overlapped pre-existing rows: restore the backup over the written
    // block, then trim any rows that extend beyond the pre-test lastRow.
    const tab = ss.getSheetByName(__TEST_RECON.BACKUP_TAB);
    if (!tab) {
      __testLog_('REVERT_ABORT', { reason: 'backup tab missing' });
      return;
    }
    const backup = tab.getRange(1, 1, count, c.lastCol).getValues();
    c.sheet.getRange(start, 1, count, c.lastCol).setValues(backup);
    let trimmed = 0;
    const afterRestore = c.sheet.getLastRow();
    if (afterRestore > pre) {
      trimmed = afterRestore - pre;
      c.sheet.deleteRows(pre + 1, trimmed);
    }
    __testLog_('REVERT_OK', {
      mode: 'restore',
      restored: count,
      trimmedBelowPre: trimmed,
      lastRowAfter: c.sheet.getLastRow(),
    });
  }

  const tab = ss.getSheetByName(__TEST_RECON.BACKUP_TAB);
  if (tab) ss.deleteSheet(tab);
}
