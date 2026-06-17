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

assert(payload.learningPeriods.length === 3, 'learningPeriods length should be 3');
assert(payload.holidays.includes('2025-10-14'), 'holidays should include 2025-10-14');
assert(payload.today.currentLP === 'LP1', 'currentLP should be LP1');
assert(payload.today.isSchoolDay === true, 'isSchoolDay should be true');
assert(payload.today.dayType === 'Schoolday', 'dayType should be Schoolday');
assert(payload.nextVacation !== null, 'nextVacation should not be null');
assert(payload.nextVacation.start <= payload.nextVacation.end, 'nextVacation start <= end');
assert(payload.nextVacation.daysUntil >= 0, 'nextVacation daysUntil >= 0');
assert(
  payload.nextVacation.start === '2025-10-11',
  'nextVacation start should be 2025-10-11 (the next non-school date after today)'
);

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
