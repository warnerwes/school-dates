const TIMEZONE = 'America/Los_Angeles';
const SOURCE_NAME = 'PLSIS report 2618 (Pacific Coast)';

// The report's day-type vocabulary (from the real export):
//   HOL       = holiday / non-instructional day (the authoritative "off" flag)
//   Schoolday = regular in-session day
//   ACA       = academic/extended-term in-session day (e.g. summer term)
// Anything NOT in NON_SCHOOL_TYPES counts as school in session.
const NON_SCHOOL_TYPES = { HOL: true };

const HEADERS = {
  setTitle: '(Time Period Sets1) Title',
  periodTitle: '(Time Periods1) Title',
  startDate: '(Time Periods1) Start Date',
  finishDate: '(Time Periods1) Finish Date',
  dayDate: '(School Days1) Day',
  dayType: '(School Days1) Type',
  periodSet: '(Time Periods1) Period Set'
};

function parseReportCsv(csvText) {
  csvText = csvText.replace(/^﻿/, '');
  const rows = splitCsv(csvText);
  if (!rows || rows.length < 2) {
    throw new Error('PLSIS CSV did not contain a header row plus data rows');
  }

  const headerMap = buildHeaderMap(rows[0]);
  assertRequiredHeadersPresent(headerMap);

  const learningPeriods = [];
  const schoolDays = [];
  const knownDates = {};

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const setTitle = getCellByHeader(row, headerMap, HEADERS.setTitle);
    const periodTitle = getCellByHeader(row, headerMap, HEADERS.periodTitle);
    const startDate = normalizeDate(getCellByHeader(row, headerMap, HEADERS.startDate));
    const finishDate = normalizeDate(getCellByHeader(row, headerMap, HEADERS.finishDate));
    const dayDate = normalizeDate(getCellByHeader(row, headerMap, HEADERS.dayDate));
    const dayType = getCellByHeader(row, headerMap, HEADERS.dayType);
    const periodSet = getCellByHeader(row, headerMap, HEADERS.periodSet);

    if (setTitle === 'Lpset' && periodTitle) {
      learningPeriods.push({ lp: periodTitle, start: startDate, end: finishDate });
    }

    if (dayDate && dayType) {
      schoolDays.push({ date: dayDate, type: dayType });
      knownDates[dayDate] = true;
    }

    if (
      setTitle === 'Schoolday' &&
      startDate &&
      !dayDate &&
      periodSet === 'Schoolday' &&
      !knownDates[startDate]
    ) {
      schoolDays.push({ date: startDate, type: 'Schoolday' });
      knownDates[startDate] = true;
    }
  }

  return {
    learningPeriods: dedupeLearningPeriods(learningPeriods),
    schoolDays: dedupeSchoolDays(schoolDays)
  };
}

function buildCalendarPayload(learningPeriods, schoolDays, isoTimestamp, todayDate) {
  const holidays = buildHolidays(schoolDays);
  const today = buildToday(todayDate, learningPeriods, schoolDays);
  const nextVacation = buildNextVacation(todayDate, learningPeriods, schoolDays);

  return {
    version: 1,
    lastUpdated: isoTimestamp,
    source: SOURCE_NAME,
    learningPeriods,
    schoolDays,
    holidays,
    today,
    nextVacation
  };
}

function buildOutputFiles(calendarPayload, isoTimestamp) {
  const nextVacation = calendarPayload.nextVacation || {
    name: null,
    start: null,
    end: null,
    daysUntil: null
  };

  return {
    calendar: JSON.stringify(calendarPayload, null, 2),
    today: JSON.stringify({
      version: 1,
      lastUpdated: isoTimestamp,
      date: calendarPayload.today.date,
      isSchoolDay: calendarPayload.today.isSchoolDay,
      currentLP: calendarPayload.today.currentLP,
      dayType: calendarPayload.today.dayType
    }, null, 2),
    nextVacation: JSON.stringify({
      version: 1,
      lastUpdated: isoTimestamp,
      name: nextVacation.name,
      start: nextVacation.start,
      end: nextVacation.end,
      daysUntil: nextVacation.daysUntil
    }, null, 2),
    health: JSON.stringify({
      version: 1,
      lastUpdated: isoTimestamp,
      lastRunOk: true,
      source: SOURCE_NAME,
      counts: {
        learningPeriods: calendarPayload.learningPeriods.length,
        schoolDays: calendarPayload.schoolDays.length,
        holidays: calendarPayload.holidays.length
      }
    }, null, 2)
  };
}

function buildHolidays(schoolDays) {
  const seen = {};
  const holidays = [];

  for (let i = 0; i < schoolDays.length; i += 1) {
    const day = schoolDays[i];
    if (day.date && NON_SCHOOL_TYPES[day.type] && !seen[day.date]) {
      seen[day.date] = true;
      holidays.push(day.date);
    }
  }

  holidays.sort();
  return holidays;
}

function buildToday(todayDate, learningPeriods, schoolDays) {
  const schoolDayMap = buildSchoolDayMap(schoolDays);
  const todayRecord = schoolDayMap[todayDate] || null;
  const currentLP = findCurrentLearningPeriod(todayDate, learningPeriods);
  let dayType = null;

  if (todayRecord) {
    dayType = todayRecord.type;
  } else if (isWeekend(todayDate)) {
    dayType = 'Weekend';
  } else {
    dayType = 'Unscheduled';
  }

  // In session = a listed day whose type is not a non-school type (HOL).
  return {
    date: todayDate,
    isSchoolDay: !!(todayRecord && !NON_SCHOOL_TYPES[todayRecord.type]),
    currentLP: currentLP ? currentLP.lp : null,
    dayType
  };
}

// The next *extended break* on or after today — deliberately skipping plain
// weekends. A non-school run counts as a break only if it takes at least one
// weekday (Mon-Fri) off; a bare Saturday+Sunday does not. So a 3-day holiday
// weekend or a week-long break surfaces, but a normal weekend never does.
function buildNextVacation(todayDate, learningPeriods, schoolDays) {
  const schoolDayMap = buildSchoolDayMap(schoolDays);
  const horizonEnd = findSearchHorizonEnd(todayDate, learningPeriods, schoolDays);
  let cursor = todayDate;

  while (cursor <= horizonEnd) {
    if (isNonSchoolDate(cursor, learningPeriods, schoolDayMap)) {
      let start = cursor;
      let end = cursor;
      while (true) {
        const nextDate = addDays(end, 1);
        if (nextDate > horizonEnd || !isNonSchoolDate(nextDate, learningPeriods, schoolDayMap)) {
          break;
        }
        end = nextDate;
      }

      if (spanHasWeekdayOff(start, end)) {
        return {
          name: chooseVacationName(start, end, schoolDayMap),
          start,
          end,
          daysUntil: diffDays(todayDate, start),
          weekdaysOff: countWeekdays(start, end)
        };
      }
      // Plain weekend (no weekday off) — skip it and keep looking.
      cursor = addDays(end, 1);
      continue;
    }
    cursor = addDays(cursor, 1);
  }

  return null;
}

// True if any date in [start,end] is a weekday (Mon-Fri).
function spanHasWeekdayOff(start, end) {
  let cursor = start;
  while (cursor <= end) {
    if (!isWeekend(cursor)) return true;
    cursor = addDays(cursor, 1);
  }
  return false;
}

function countWeekdays(start, end) {
  let cursor = start;
  let n = 0;
  while (cursor <= end) {
    if (!isWeekend(cursor)) n += 1;
    cursor = addDays(cursor, 1);
  }
  return n;
}

function findCurrentLearningPeriod(dateString, learningPeriods) {
  for (let i = 0; i < learningPeriods.length; i += 1) {
    const lp = learningPeriods[i];
    if (lp.start && lp.end && lp.start <= dateString && dateString <= lp.end) {
      return lp;
    }
  }
  return null;
}

// A date is "non-school" if it's a listed HOL, or it's not listed at all
// (weekends and out-of-term gaps are simply absent from the enumerated days).
function isNonSchoolDate(dateString, learningPeriods, schoolDayMap) {
  const schoolDay = schoolDayMap[dateString];
  if (schoolDay) {
    return !!NON_SCHOOL_TYPES[schoolDay.type];
  }
  return true;
}

function chooseVacationName(start, end, schoolDayMap) {
  let cursor = start;
  while (cursor <= end) {
    const record = schoolDayMap[cursor];
    if (record && NON_SCHOOL_TYPES[record.type]) {
      return start === end ? 'Holiday' : 'Break';
    }
    cursor = addDays(cursor, 1);
  }
  return 'Break';
}

function findSearchHorizonEnd(todayDate, learningPeriods, schoolDays) {
  let lastDate = todayDate;

  for (let i = 0; i < learningPeriods.length; i += 1) {
    if (learningPeriods[i].end && learningPeriods[i].end > lastDate) {
      lastDate = learningPeriods[i].end;
    }
  }
  for (let j = 0; j < schoolDays.length; j += 1) {
    if (schoolDays[j].date && schoolDays[j].date > lastDate) {
      lastDate = schoolDays[j].date;
    }
  }

  return addDays(lastDate, 60);
}

function addDays(dateString, dayOffset) {
  const parts = dateString.split('-');
  const date = new Date(Date.UTC(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10),
    12, 0, 0
  ));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return formatDate(date);
}

function diffDays(fromDate, toDate) {
  const from = new Date(fromDate + 'T12:00:00Z');
  const to = new Date(toDate + 'T12:00:00Z');
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function isWeekend(dateString) {
  const parts = dateString.split('-');
  const date = new Date(Date.UTC(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10),
    12, 0, 0
  ));
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function normalizeDate(value) {
  const raw = safeTrim(value);
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return [slashMatch[3], pad2(slashMatch[1]), pad2(slashMatch[2])].join('-');
  }

  const dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    return [dashMatch[3], pad2(dashMatch[1]), pad2(dashMatch[2])].join('-');
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return formatDateInLa(parsed);
  }

  return raw;
}

function formatDateInLa(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(date);
}

function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Quote-aware CSV parse (RFC4180-ish): handles "quoted" fields, embedded commas,
// and "" escapes. The real PLSIS export quotes every field.
function splitCsv(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') { field += '"'; i += 1; }
        else { inQuotes = false; }
      } else { field += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (ch === '\r') {
      // ignore; handled at \n
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 0 && r.some(cell => cell !== ''));
}

function buildHeaderMap(headerRow) {
  const map = {};
  for (let i = 0; i < headerRow.length; i += 1) {
    map[String(headerRow[i])] = i;
  }
  return map;
}

function assertRequiredHeadersPresent(headerMap) {
  const required = [
    HEADERS.setTitle,
    HEADERS.periodTitle,
    HEADERS.startDate,
    HEADERS.finishDate,
    HEADERS.dayDate,
    HEADERS.dayType,
    HEADERS.periodSet
  ];
  const missing = required.filter(h => typeof headerMap[h] === 'undefined');
  if (missing.length) {
    throw new Error('PLSIS CSV missing required headers: ' + missing.join(', '));
  }
}

function getCellByHeader(row, headerMap, headerName) {
  const index = headerMap[headerName];
  if (typeof index === 'undefined' || index >= row.length) return '';
  return safeTrim(row[index]);
}

function dedupeLearningPeriods(learningPeriods) {
  const seen = {};
  const deduped = [];
  for (let i = 0; i < learningPeriods.length; i += 1) {
    const item = learningPeriods[i];
    const key = `${item.lp}-${item.start}`;
    if (!seen[key]) {
      seen[key] = true;
      deduped.push(item);
    }
  }
  return deduped.sort((a, b) => compareStrings(a.start, b.start));
}

// Dedupe by date with type precedence: HOL wins (a date flagged off in ANY row is
// off), else a regular Schoolday, else whatever else (e.g. ACA). This matters
// because the report lists each date under multiple sets with different types.
function typeRank(type) {
  if (NON_SCHOOL_TYPES[type]) return 3; // HOL
  if (type === 'Schoolday') return 2;
  return 1;                              // ACA / other in-session
}

function dedupeSchoolDays(schoolDays) {
  const byDate = {};
  for (let i = 0; i < schoolDays.length; i += 1) {
    const item = schoolDays[i];
    if (!item.date) continue;
    const existing = byDate[item.date];
    if (!existing || typeRank(item.type) > typeRank(existing.type)) {
      byDate[item.date] = { date: item.date, type: item.type };
    }
  }
  return Object.keys(byDate)
    .map(d => byDate[d])
    .sort((a, b) => compareStrings(a.date, b.date));
}

function buildSchoolDayMap(schoolDays) {
  const map = {};
  for (let i = 0; i < schoolDays.length; i += 1) {
    map[schoolDays[i].date] = schoolDays[i];
  }
  return map;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function pad2(value) {
  return ('0' + parseInt(value, 10)).slice(-2);
}

function safeTrim(value) {
  return value == null ? '' : String(value).trim();
}

module.exports = {
  parseReportCsv,
  buildCalendarPayload,
  buildOutputFiles,
  buildHolidays,
  buildToday,
  buildNextVacation,
  isNonSchoolDate,
  chooseVacationName,
  findSearchHorizonEnd,
  addDays,
  diffDays,
  isWeekend,
  normalizeDate,
  dedupeLearningPeriods,
  dedupeSchoolDays,
  findCurrentLearningPeriod,
  buildSchoolDayMap
};
