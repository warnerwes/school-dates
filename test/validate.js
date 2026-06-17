const fs = require('fs');
const path = require('path');
const {
  parseReportCsv,
  buildCalendarPayload,
  buildOutputFiles
} = require('./calendar-logic.js');

function assert(condition, message) {
  if (!condition) {
    console.error('ASSERTION FAILED:', message);
    process.exit(1);
  }
}

const csvText = fs.readFileSync(path.join(__dirname, 'sample-report.csv'), 'utf8');
const todayDate = '2025-10-07';
const isoTimestamp = '2025-10-07T12:00:00.000Z';

const parsed = parseReportCsv(csvText);
const payload = buildCalendarPayload(
  parsed.learningPeriods,
  parsed.schoolDays,
  isoTimestamp,
  todayDate
);
const outputs = buildOutputFiles(payload, isoTimestamp);

console.log('--- calendar.json ---');
console.log(outputs.calendar);
console.log('--- today.json ---');
console.log(outputs.today);
console.log('--- next-vacation.json ---');
console.log(outputs.nextVacation);
console.log('--- health.json ---');
console.log(outputs.health);

// Learning periods: 3 Lpset rows; LP1 spans Sept-Oct so today sits inside it.
assert(payload.learningPeriods.length === 3, 'learningPeriods length should be 3');
assert(payload.today.currentLP === 'LP1', 'currentLP should be LP1');

// Today (2025-10-07, a Tuesday) is listed as an in-session ACA day, not HOL.
assert(payload.today.date === todayDate, 'today.date should be the injected today');
assert(payload.today.isSchoolDay === true, 'isSchoolDay should be true for 10/07');
assert(payload.today.dayType === 'ACA', 'dayType should be ACA for 10/07');

// Holidays: the two HOL dates we planted (a weekday break + a later holiday).
assert(payload.holidays.length === 2, 'holidays should have 2 entries');
assert(payload.holidays.includes('2025-10-17'), 'holidays should include 2025-10-17');
assert(payload.holidays.includes('2025-11-11'), 'holidays should include 2025-11-11');

// nextVacation: the first EXTENDED break (contains a weekday off). It must
// skip the bare Sat/Sun weekend (10/11-10/12) and land on the Fri-HOL break.
assert(payload.nextVacation !== null, 'nextVacation should not be null');
assert(payload.nextVacation.name === 'Break', 'nextVacation name should be Break');
assert(payload.nextVacation.start === '2025-10-17', 'nextVacation start should be 2025-10-17');
assert(payload.nextVacation.end === '2025-10-19', 'nextVacation end should be 2025-10-19');
assert(payload.nextVacation.daysUntil === 10, 'nextVacation daysUntil should be 10');
assert(payload.nextVacation.weekdaysOff >= 1, 'nextVacation weekdaysOff should be >= 1');
assert(
  payload.nextVacation.start !== '2025-10-11',
  'nextVacation must skip the plain weekend (start should NOT be 2025-10-11)'
);
assert(payload.nextVacation.start <= payload.nextVacation.end, 'nextVacation start <= end');

// Every emitted date is normalized to YYYY-MM-DD.
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const allDates = [
  ...payload.learningPeriods.flatMap(lp => [lp.start, lp.end]),
  ...payload.schoolDays.map(sd => sd.date),
  ...payload.holidays,
  payload.today.date,
  payload.nextVacation.start,
  payload.nextVacation.end
];
allDates.forEach(d => assert(dateRe.test(d), `date ${d} should match YYYY-MM-DD`));

console.log('All assertions passed.');