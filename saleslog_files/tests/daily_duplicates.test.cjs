const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({console: {warn() {}}, normalizeDealDateIso_: value => String(value)});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../daily_duplicates.js'), 'utf8'), context);
const row = (stock, offset = 0, customer = 'CUSTOMER') => {
  const values = Array(14).fill('');
  values.splice(offset + 1, 6, customer, 'K', 'MODEL', stock, '12345', 'REP');
  return values;
};
const header = date => [date, ...Array(13).fill('')];
const values = [header('9/7'), row('00123'), header('9/10'), row('00123'), row('OTHER', 7)];
let matches = context._findDailyMonthlyDuplicates(values, 4, 2, '9/10');
assert.equal(matches.length, 1);
assert.equal(matches[0].row, 4);
assert.equal(matches[0].matches[0].row, 2);
assert.equal(matches[0].matches[0].date, '9/7');
assert.equal(matches[0].stock, '00123');
assert.equal(context._findDailyMonthlyDuplicates([header('9/10'), row('SOLO')], 2, 1, '9/10').length, 0);
assert.equal(context._findDailyMonthlyDuplicates([header('9/10'), row(123), row('123', 7, 'CHANGED')], 3, 1, '9/10').length, 1);
assert.equal(context._findDailyMonthlyDuplicates([header('9/7'), row('ABC'), header('9/10'), row('ABC', 0, 'DIFFERENT')], 4, 1, '9/10').length, 0);
let notes = Array.from({length: 2}, () => Array(13).fill(''));
notes[0][0] = 'Existing note';
notes[0][3] = 'Preserve stock note';
const calls = [];
const sheet = {
  getRange(...args) {
    calls.push(['range', ...args]);
    return {getNotes: () => notes, setNotes: value => {notes = value;}};
  },
  getRangeList(cells) {
    calls.push(['cells', ...cells]);
    return {setBackground(color) {assert.equal(color, '#fff2cc'); return this;}, setFontColor() {return this;}};
  },
};
const before = JSON.stringify(values);
const warnings = context._flagDailyMonthlyDuplicates(sheet, values, 4, 2, '9/10');
assert.equal(warnings.length, 1);
assert.match(warnings[0], /MONTHLY!B4.*MONTHLY!B2 \(9\/7\)/);
assert.match(notes[0][0], /^Existing note\n\n\[Possible duplicate sale\]/);
assert.equal(notes[0][3], 'Preserve stock note');
assert.equal(JSON.stringify(values), before);
context._flagDailyMonthlyDuplicates(sheet, values, 4, 2, '9/10');
assert.equal(notes[0][0].split('[Possible duplicate sale]').length, 2);
assert.equal(calls.filter(call => call[0] === 'range').length, 2);
assert.equal(context._flagDailyMonthlyDuplicates({}, [header('9/10'), row('SOLO')], 2, 1, '9/10').length, 0);
console.log('PASS: duplicate details, dates, new/used sides, numeric stocks, self exclusion, warning-only values, preserved notes, bounded writes and idempotent notes.');
