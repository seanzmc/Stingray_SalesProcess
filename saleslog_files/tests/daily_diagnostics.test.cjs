const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const events = [], dialogs = [];
  let released = false;
  const c = vm.createContext({
    console: {info: x => events.push(['info', x]), error: x => events.push(['error', x]), warn: x => events.push(['warn', x])},
    Logger: {log() {}},
    Utilities: {getUuid: () => 'test-run', formatDate: d => d.toISOString().slice(0,10)},
    Session: {getScriptTimeZone: () => 'UTC'},
    CacheService: {getScriptCache: () => ({})},
    SpreadsheetApp: {getActive: () => ({toast() {}}), getUi: () => ({
      alert() { throw new Error('Blocking alert must not be used'); },
      showModelessDialog(html, title) { assert(released); dialogs.push({html, title}); },
    })},
    HtmlService: {createHtmlOutput: html => ({html, setWidth() {return this;}, setHeight() {return this;}})},
  });
  for (const file of ['error_logger.js', 'core_saleslogPro.js', 'daily_diagnostics.js', 'daily_rollback.js', 'daily_recovery.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
  }
  c.acquireScriptLockWithRetry = () => ({success: true, attempts: 1, lock: {releaseLock() {released = true;}}});
  return {c, events, dialogs, released: () => released};
}
for (const options of [{}, {triggerUid: 'scheduled'}, {suppressAlert: true}]) {
  const t = setup();
  const failure = new Error('Injected Sheets failure');
  t.c.getSheets = () => {throw failure;};
  assert.throws(() => t.c.processDaily(options), e => e === failure);
  assert(t.released());
  assert.equal(t.dialogs.length, Object.keys(options).length ? 0 : 1);
  assert(t.events.some(([level, message]) => level === 'error' && message.includes('Injected Sheets failure')));
  assert(t.events.some(([, message]) => message.includes('"event":"failed"') && message.includes('checkpoint_recovery')));
}
{
  const t = setup();
  t.c.acquireScriptLockWithRetry = () => ({success: false, attempts: 1, totalTime: 10000});
  assert.throws(() => t.c.processDaily({triggerUid: 'scheduled'}), /Could not acquire script lock/);
  assert.equal(t.dialogs.length, 0);
  assert(t.events.some(([, message]) => message.includes('"stage":"lock_wait"')));
}
for (const success of [true, false]) {
  const t = setup();
  t.c.getSheets = () => ({monthly: {}});
  t.c.getOperationCheckpoint = () => ({phase: 'ANALYTICS_FAILED'});
  t.c.prepareLegacyMonthlyWrittenCheckpoint_ = (_, cp) => cp;
  t.c.completeLegacyMonthlyWrittenCheckpoint_ = (_, cp) => cp;
  t.c.assertCheckpointMonthlySheet_ = () => {};
  t.c.recoverAnalyticsForCheckpoint_ = () => success;
  if (success) assert.doesNotThrow(() => t.c.processDaily({triggerUid: 'scheduled'}));
  else assert.throws(() => t.c.processDaily({triggerUid: 'scheduled'}), /Analytics recovery failed/);
  assert(t.released());
}
{
  const t = setup();
  t.c.getSheets = () => {throw new Error('<script>unsafe</script> & text');};
  assert.throws(() => t.c.processDaily());
  assert(t.dialogs[0].html.html.includes('&lt;script&gt;unsafe&lt;/script&gt; &amp; text'));
  t.c.SpreadsheetApp.getUi = () => {throw new Error('UI unavailable');};
  const failure = new Error('original');
  t.c.getSheets = () => {throw failure;};
  assert.throws(() => t.c.processDaily(), e => e === failure);
}
for (const hasSales of [false, true]) {
  const t = setup();
  const row = Array(14).fill('');
  if (hasSales) row[1] = 'sale';
  const range = {getValues: () => [row], getFontColors: () => [row],
    getBackgrounds: () => [row], getRow: () => 2,
    setBackground() {return this;}, setFontColor() {return this;}};
  t.c.getSheets = () => ({today: {getRange: () => range}});
  t.c.getOperationCheckpoint = () => null;
  t.c.prepareLegacyMonthlyWrittenCheckpoint_ = (_, cp) => cp;
  t.c.completeLegacyMonthlyWrittenCheckpoint_ = (_, cp) => cp;
  t.c.shouldSkipSundays = () => false;
  t.c.dailyRowHasActivity_ = () => hasSales;
  t.c.generateDataHash = () => 'hash';
  t.c.createTimeoutManager = () => ({checkTime: () => false});
  t.c.createOperationCheckpoint = () => {throw new Error('Must not start writes');};
  if (hasSales) assert.throws(() => t.c.processDaily(), /time budget was exhausted/);
  else {
    assert.doesNotThrow(() => t.c.processDaily());
    assert.equal(t.dialogs[0].title, 'Process Complete');
    assert(t.events.some(([, message]) => message.includes('"event":"completed"')));
  }
  assert(t.released());
}
console.log('PASS: failure propagation, severity, lock release/contention, trigger suppression, recovery outcomes, HTML escaping, and notification failure isolation.');

// A saved post-clear checkpoint from the previous script must only finish analytics.
for (const analyticsAvailable of [true, false]) {
  const t = setup();
  const phases = [];
  let checkpoint = {version: 2, phase: 'RECON_PENDING', monthlySheetId: 42,
    dateProcessed: '9/7/2026', sourceRows: [{sheetRow: 2, dataHash: 'previous-sale'}]};
  t.c.PropertiesService = {getScriptProperties: () => ({
    getProperty: () => checkpoint ? JSON.stringify(checkpoint) : null,
    setProperty: (key, value) => {
      assert.equal(key, 'DAILY_OPERATION_CHECKPOINT');
      checkpoint = JSON.parse(value);
      phases.push(checkpoint.phase);
    },
    deleteProperty: key => {
      assert.equal(key, 'DAILY_OPERATION_CHECKPOINT');
      checkpoint = null;
    },
  })};
  // Any attempt to reprocess TODAY or append to MONTHLY would fail on these sheet mocks.
  t.c.getSheets = () => ({monthly: {getSheetId: () => 42}});
  t.c.invalidateAnalyticsCache = () => {};
  t.c.calculateMonthlyAnalytics = () => analyticsAvailable ? {count: 1} : null;
  let reportsWritten = 0;
  t.c.writeAnalyticsToMonthly = () => { reportsWritten++; };

  if (analyticsAvailable) {
    t.c.processDaily({triggerUid: 'scheduled'});
    assert.deepEqual(phases, ['ANALYTICS_PENDING']);
    assert.equal(checkpoint, null);
    assert.equal(reportsWritten, 1);
  } else {
    assert.throws(() => t.c.processDaily({triggerUid: 'scheduled'}), /Analytics recovery failed/);
    assert.deepEqual(phases, ['ANALYTICS_PENDING', 'ANALYTICS_FAILED']);
    assert.equal(checkpoint.phase, 'ANALYTICS_FAILED');
    assert.equal(reportsWritten, 0);
  }
  assert(t.released());
}
console.log('PASS: a previously cleared day resumes analytics and retains failed work for retry.');

for (const state of ['safe','edited','committed','interrupted']) {
  const t = setup();
  let phase = state === 'committed' ? 'ANALYTICS_FAILED' : state === 'interrupted' ? 'ROLLBACK_PENDING' : 'TODAY_CLEAR_PENDING';
  let cleared = false, deleted = false, rebuilt = false;
  t.c.getOperationCheckpoint = () => ({phase,headerInsertRow:10,rowCount:1,sourceRows:[{sheetRow:2,dataHash:'same'}]});
  t.c.assertCheckpointMonthlySheet_ = () => {};
  const range = {clearContent() {cleared=true;return this;},setNote(){return this;},breakApart(){return this;},
    getValues:()=>[['']],getNotes:()=>[['']]};
  t.c.getSheets = () => ({monthly:{getRange:()=>range},today:{getRange:()=>({getValues:()=>[['current']]})}});
  t.c.generateDataHash = () => state === 'edited' ? 'different' : 'same';
  t.c.findMonthlyCheckpointBlock_ = () => state === 'interrupted' ? null : {headerRow:10};
  t.c.findLastRowInCols = () => 11;
  t.c.updateCheckpoint = next => {phase=next;return true;};
  t.c.SpreadsheetApp.flush = () => {};
  t.c.getSalespersonMaps = () => ({aliasMap:{}});
  t.c.collectMonthlyRowsWithDates_ = () => [];
  t.c.tallyCounts = () => ({counts:{}});
  t.c.updateLeaderboardFromCounts_ = () => {rebuilt=true;};
  t.c.getDynamicLeaderboardRanges = () => ({leaderboard:'P2:R3'});
  t.c.reapplyCF = () => {};
  t.c.clearOperationCheckpoint = () => {deleted=true;return true;};
  const result=t.c._rollbackUnclearedDaily();
  if (state === 'safe' || state === 'interrupted') {assert(deleted);assert(rebuilt);assert(result.includes('rolled back'));}
  else {assert(!cleared);assert(!deleted);assert(!rebuilt);}
}
console.log('PASS: safe rollback, interrupted rollback completion, edited TODAY protection, and post-clear checkpoint retention.');

// A missing or modified durable copy must never allow a TODAY clear.
{
  const t = setup();
  let touched = false;
  t.c.findMonthlyCheckpointBlock_ = () => null;
  assert.throws(() => t.c.reconcileTodayClear_({getRange() {touched=true;}}, {}, {}), /no verified MONTHLY copy/);
  assert.equal(touched, false);
}
// Recovery decisions depend on saved rows and current sheet contents, not row positions alone.
{
  const t=setup();
  t.c.generateDataHash=rows=>JSON.stringify(rows[0].slice(1));
  const old=Array(14).fill(''); old[1]='old'; old[4]='1234567';
  const newer=Array(14).fill(''); newer[1]='new'; newer[4]='7654321';
  const blank=Array(14).fill('');
  const cp={dateProcessed:'9/7/2026',sourceRows:[{sheetRow:2,dataHash:t.c.generateDataHash([old])}]};
  const plan=(today,monthly,block=false,date='9/7/2026',markers=[])=>t.c._planDailyReconciliation(cp,today,monthly,block,markers,date);
  assert.equal(plan([old],[old],true).action,'resume');
  assert.equal(plan([old],[]).action,'restart');
  assert.equal(plan([old],[],false,'9/8/2026',[10]).action,'restart');
  assert.equal(plan([newer],[]).action,'retire');
  assert.equal(plan([newer],[],false,'9/7/2026',[10]).action,'retire');
  assert.equal(plan([newer],[old],true).clearRows.length,0);
  assert.deepEqual(Array.from(plan([newer,old],[old],true).clearRows),[3]);
  assert.deepEqual(Array.from(plan([old],[old]).clearRows),[2]);
  assert.equal(plan([blank],[]).action,'retire');
  assert.equal(plan([newer,old],[],false,'9/8/2026').action,'conflict');
  assert.equal(plan([blank,old],[],false,'9/8/2026').action,'rebase');
  assert.equal(plan([old,newer],[old],true).action,'retire');
}
for (const mode of ['success','edit','reports_fail']) {
  const t=setup();
  const row=Array(14).fill(''); row[1]='new';
  const cp={dateProcessed:'9/7',sourceRows:[{sheetRow:2,dataHash:'old'}]};
  let cleared=false, sourceCleared=false, reads=0;
  const snapshot={sheetId:1,values:[]};
  const sheets={today:{getRange:()=>({getValues:()=>mode==='edit'&&reads++>0?[]:[row]}),
    getRangeList:()=>({clearContent(){sourceCleared=true;}})},monthly:{}};
  t.c.generateDataHash=()=> 'new';
  t.c._readMonthlySalesSnapshot=()=>snapshot;
  t.c.collectMonthlyRowsWithDates_=()=>[];
  t.c.findMonthlyCheckpointBlock_=()=>null;
  t.c.findMonthlyCheckpointMarkerRows_=()=>[];
  t.c.formatDateOffset=()=> '9/7';
  t.c._rebuildDailyReports=()=>{if(mode==='reports_fail')throw new Error('reports failed');};
  t.c.clearOperationCheckpoint=()=>{cleared=true;return true;};
  if(mode==='success') {assert.equal(t.c._reconcileDailyCheckpoint(sheets,cp),null);assert(cleared);}
  else {assert.throws(()=>t.c._reconcileDailyCheckpoint(sheets,cp));assert(!cleared);}
  assert(!sourceCleared);
}
console.log('PASS: automatic recovery of replaced/moved/removed sales, saved dates, concurrent edits, and report failures without user overrides.');
// On resuming a pending TODAY clear, persist the analytics checkpoint immediately after the clear.
{
  const t = setup();
  const steps = [];
  const checkpoint = {version: 2, phase: 'TODAY_CLEAR_PENDING', monthlySheetId: 42};
  const range = {getValues: () => [], getFontColors: () => [], getBackgrounds: () => [], getRow: () => 2};
  t.c.getSheets = () => ({today: {getRange: () => range}, monthly: {getSheetId: () => 42}});
  t.c.getOperationCheckpoint = () => ({...checkpoint});
  t.c.findMonthlyCheckpointBlock_ = () => null;
  t.c.reconcileTodayClear_ = () => steps.push('clear');
  t.c.updateCheckpoint = phase => { steps.push(phase); checkpoint.phase = phase; return true; };
  t.c.recoverAnalyticsForCheckpoint_ = saved => {
    assert.equal(saved.phase, 'ANALYTICS_PENDING');
    steps.push('analytics');
    return true;
  };
  t.c.processDaily({triggerUid: 'scheduled'});
  assert.deepEqual(steps, ['clear', 'ANALYTICS_PENDING', 'analytics']);
  assert(t.released());
}
console.log('PASS: a resumed TODAY clear goes directly to analytics.');

{
  const t = setup();
  const menus = [];
  const handlers = [];
  let attached = false;
  t.c.SpreadsheetApp.getActiveSpreadsheet = () => ({getSheetByName: () => ({})});
  t.c.SpreadsheetApp.getUi = () => ({
    createMenu: name => {
      menus.push(name);
      return {
        addItem(label, handler) { handlers.push(handler); return this; },
        addSeparator() { return this; },
        addSubMenu() { return this; },
        addToUi() { attached = true; },
      };
    },
  });
  t.c.onOpen();
  assert(attached);
  assert.deepEqual(menus, ['SalesLog Tools', 'Sales Tools']);
  assert.deepEqual(handlers, ['processDaily', 'recalcMtdFromMonthly', 'rolloverMonth', 'manualRefreshLeaderboard']);
  for (const handler of handlers) assert.equal(typeof t.c[handler], 'function');
}
console.log('PASS: the spreadsheet menu exposes the four working sales commands.');
