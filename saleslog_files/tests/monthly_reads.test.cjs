const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const row = () => Array(14).fill('');
const data = Array.from({length: 180}, row);
data[0][0] = 'Title';
data[1][0] = '9/7';
data[2][0] = 1; data[2][2] = 'A'; data[2][6] = 'AL/BO';
data[3][0] = 2; data[3][9] = 'B'; data[3][13] = 'UNKNOWN';
data[4][0] = '9/8';
data[5][0] = 1; data[5][2] = 'pending'; data[5][6] = 'AL';
data[6][0] = 2; data[6][2] = 'C'; data[6][6] = 'BO';
let reads = 0;
const sheet = {getSheetId: () => 42, getLastRow: () => data.length, getMaxColumns: () => 26,
  getRange(r,c,n,w) {return {
    getValues() {reads++; assert.equal(w,14); return data.slice(r-1,r-1+n).map(x=>x.slice());},
    getMergedRanges: () => [2,5].map(r => ({getRow:()=>r,getColumn:()=>1,getWidth:()=>14}))
  };}};
const c = vm.createContext({Logger:{log(){}}, console,
  SpreadsheetApp:{getActive:()=>({})}, CacheService:{getScriptCache:()=>({get:()=>null,put(){}})}});
for (const f of ['core_saleslogPro.js','sales_analytics.js','monthly_reads.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);
}
c.getSheets = () => ({monthly:sheet});
c.getSalespersonMaps = () => ({aliasMap:{AL:'Alice',BO:'Bob'},displayCodeMap:{}});
c.formatAnalyticsForDisplay = x => x;
c.validateAnalyticsData = () => [];
c.logError = (_,e) => {throw e;};
c.logWarning = () => {};
const standalone = JSON.stringify(c.calculateMonthlyAnalytics());
assert.equal(reads, 3, 'Standalone reads tail chunks then sales rows');
reads = 0;
const snapshot = c._readMonthlySalesSnapshot(sheet);
assert.equal(snapshot.values.length,7);
const dated = c.collectMonthlyRowsWithDates_(sheet,snapshot);
assert.deepEqual(Array.from(dated, x=>x.dateDisplay), ['9/7','9/7','9/8','9/8']);
assert.equal(JSON.stringify(c.calculateMonthlyAnalytics(snapshot)),standalone);
assert.equal(reads,1,'Leaderboard and analytics share exactly one values read');
assert.throws(()=>c._validateMonthlySalesSnapshot(sheet,{sheetId:99,values:[]}),/mismatched/);
assert.throws(()=>c._validateMonthlySalesSnapshot(sheet,{sheetId:42,values:[[1]]}),/Invalid/);
// A supplied snapshot must bypass an older analytics cache.
vm.runInContext('CACHE.get = () => JSON.stringify({stale:true})',c);
assert.equal(JSON.stringify(c.calculateMonthlyAnalytics(snapshot)),standalone);
const emptySheet = {...sheet,getLastRow:()=>0};
assert.equal(c._readMonthlySalesSnapshot(emptySheet).values.length,0);
assert.equal(c.collectMonthlyRowsWithDates_(emptySheet).length,0);
console.log('PASS: shared single A:N read, standalone parity, split/unknown/undelivered sales, side-report tail, cache bypass, empty sheet and sheet identity.');
