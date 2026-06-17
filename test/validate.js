const fs = require('fs');
const path = require('path');
const {
  parseReportCsv,
  buildCalendarPayload,
  buildOutputFiles,
  buildToday
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
  parsed.schoolYears,
  parsed.semesters,
  parsed.progressReports,
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

// Extracted structures: 2 school years, 2 semesters, 2 progress reports, 3 LPs.
assert(payload.schoolYears.length === 2, 'schoolYears length should be 2');
assert(payload.schoolYears[0].localId === '1001', 'first schoolYear localId should be 1001');
assert(payload.schoolYears[1].track === 'B', 'summer schoolYear should keep track B');
assert(payload.semesters.length === 2, 'semesters length should be 2');
assert(payload.semesters[0].localId === '2001', 'first semester localId should be 2001');
assert(payload.progressReports.length === 2, 'progressReports length should be 2');
assert(payload.progressReports[0].localId === '3001', 'first progress report localId should be 3001');

// Learning periods: 3 Lpset rows; LP1 spans Sept-Oct so today sits inside it.
assert(payload.learningPeriods.length === 3, 'learningPeriods length should be 3');
assert(payload.learningPeriods[0].localId === '4001', 'first LP localId should be 4001');
assert(payload.learningPeriods[0].year === '2025-2026', 'LP1 should derive year from containment');
assert(payload.today.currentLP === 'LP1', 'currentLP should be LP1');

// Today (2025-10-07, a Tuesday) is inside the academic year, Semester 1, PR1.
assert(payload.today.date === todayDate, 'today.date should be the injected today');
assert(payload.today.isSchoolDay === true, 'isSchoolDay should be true for 10/07');
assert(payload.today.dayType === 'ACA', 'dayType should be ACA for 10/07');
assert(payload.today.currentYear === '2025-2026', 'currentYear should be 2025-2026');
assert(payload.today.currentSemester === 'Semester 1', 'currentSemester should be Semester 1');
assert(payload.today.currentProgressReport === 'Progress Report 1', 'currentProgressReport should be Progress Report 1');

// Holidays: HOL-only. OTH is non-school but should not appear in holidays[].
assert(payload.holidays.length === 2, 'holidays should have 2 entries');
assert(payload.holidays.includes('2025-10-17'), 'holidays should include 2025-10-17');
assert(payload.holidays.includes('2025-11-11'), 'holidays should include 2025-11-11');
assert(!payload.holidays.includes('2025-10-21'), 'holidays should not include the OTH date');

const othToday = buildToday(
  '2025-10-21',
  payload.schoolYears,
  payload.semesters,
  payload.progressReports,
  payload.learningPeriods,
  payload.schoolDays
);
assert(othToday.isSchoolDay === false, 'OTH date should not be a school day');
assert(othToday.dayType === 'OTH', 'OTH date should preserve dayType OTH');

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
  ...payload.schoolYears.flatMap(year => [year.start, year.end]),
  ...payload.semesters.flatMap(semester => [semester.start, semester.end]),
  ...payload.progressReports.flatMap(report => [report.start, report.end]),
  ...payload.learningPeriods.flatMap(lp => [lp.start, lp.end]),
  ...payload.schoolDays.map(sd => sd.date),
  ...payload.holidays,
  payload.today.date,
  payload.nextVacation.start,
  payload.nextVacation.end
];
allDates.forEach(d => assert(dateRe.test(d), `date ${d} should match YYYY-MM-DD`));

const todayOutput = JSON.parse(outputs.today);
assert(todayOutput.currentYear === '2025-2026', 'today.json should include currentYear');
assert(todayOutput.currentSemester === 'Semester 1', 'today.json should include currentSemester');
assert(todayOutput.currentProgressReport === 'Progress Report 1', 'today.json should include currentProgressReport');

const healthOutput = JSON.parse(outputs.health);
assert(healthOutput.counts.schoolYears === 2, 'health should count schoolYears');
assert(healthOutput.counts.semesters === 2, 'health should count semesters');
assert(healthOutput.counts.progressReports === 2, 'health should count progressReports');

console.log('All assertions passed.');
