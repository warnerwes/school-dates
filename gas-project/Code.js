/**
 * Daily publisher for school calendar JSON derived from the PLSIS report.
 * Google Apps Script V8 runtime only.
 *
 * Runs on a daily time-driven trigger (3-4am America/Los_Angeles) in the
 * standalone "School Dates Writer" Apps Script project (clasp-managed from this
 * repo). Pulls PLSIS report 2618, parses it into a school calendar, computes
 * derived fields, and publishes the JSON files to github.com/warnerwes/school-dates
 * (served at https://dates.warner.click/v1/) as ONE commit per run (GitHub.js).
 *
 * Files: Code.js (entry points + calendar derivation), ReportParse.js (CSV parse),
 * GitHub.js (single-commit publish via the Git Data API).
 *
 * Secrets live in Script Properties, never in source:
 *   PLSIS_PASSWORD  - the PLSIS account password
 *   GITHUB_PAT      - fine-grained token, Contents: read+write on warnerwes/school-dates
 *                     (the Git Data endpoints are covered by the Contents permission)
 *
 * Run setup() once by hand to validate properties + fetch + GitHub auth without
 * publishing. Set the daily trigger on main().
 */

var PLSIS_LOGIN = 'dqx2618';
var PLSIS_REPORT_ID = '2618';
var PLSIS_SCOPE = 'pacificcoast';
var GITHUB_REPO = 'warnerwes/school-dates';
var GITHUB_BRANCH = 'main';
var OUTPUT_PREFIX = 'v1/';
var TIMEZONE = 'America/Los_Angeles';
var ADMIN_EMAIL = 'wesleymwarner@gmail.com';
var SOURCE_NAME = 'PLSIS report 2618 (Pacific Coast)';

var HEADERS = {
  setTitle: '(Time Period Sets1) Title',
  periodTitle: '(Time Periods1) Title',
  localId: '(Time Periods1) Local ID',
  startDate: '(Time Periods1) Start Date',
  finishDate: '(Time Periods1) Finish Date',
  parentPeriod: '(Time Periods1) Parent Period',
  track: '(Time Period Sets1) Track',
  dayDate: '(School Days1) Day',
  dayType: '(School Days1) Type',
  periodSet: '(Time Periods1) Period Set'
};

// Day-type vocabulary from the real report:
//   HOL       = holiday / non-instructional day (the authoritative "off" flag)
//   Schoolday = regular in-session day
//   ACA       = academic/extended-term in-session day (e.g. summer term)
// Anything NOT listed here counts as school in session.
var NON_SCHOOL_TYPES = { HOL: true, OTH: true };

/**
 * Trigger entry point. Fetches, parses, derives, and publishes JSON outputs.
 */
function main() {
  var isoTimestamp = new Date().toISOString();
  var alertEmail = getAlertEmail_();

  try {
    var secrets = getSecrets_();
    var csvText = fetchReport_(secrets.plsisPassword);
    var parsed = parseReportCsv_(csvText);
    var calendarPayload = buildCalendarPayload_(
      parsed.schoolYears,
      parsed.semesters,
      parsed.progressReports,
      parsed.learningPeriods,
      parsed.schoolDays,
      isoTimestamp
    );
    var outputs = buildOutputFiles_(calendarPayload, isoTimestamp);

    // One commit for all four files: one push -> one GitHub Pages build per run.
    publishFiles_([
      { path: OUTPUT_PREFIX + 'calendar.json', content: outputs.calendar },
      { path: OUTPUT_PREFIX + 'today.json', content: outputs.today },
      { path: OUTPUT_PREFIX + 'next-vacation.json', content: outputs.nextVacation },
      { path: OUTPUT_PREFIX + 'health.json', content: outputs.health }
    ], secrets.githubPat, 'publish v1 ' + isoTimestamp);
  } catch (err) {
    var errorMessage = buildErrorMessage_(err);

    try {
      var failureSecrets = getSecrets_();
      var failureHealth = JSON.stringify({
        version: 1,
        lastUpdated: isoTimestamp,
        lastRunOk: false,
        error: errorMessage,
        source: SOURCE_NAME
      }, null, 2);
      publishFiles_([{ path: OUTPUT_PREFIX + 'health.json', content: failureHealth }],
        failureSecrets.githubPat, 'publish v1/health.json (run FAILED) ' + isoTimestamp);
    } catch (publishErr) {
      Logger.log('Failed to publish failure health.json: ' + buildErrorMessage_(publishErr));
    }

    try {
      MailApp.sendEmail(alertEmail, 'school-dates publish FAILED', errorMessage);
    } catch (mailErr) {
      Logger.log('Failed to send alert email: ' + buildErrorMessage_(mailErr));
    }

    throw err;
  }
}

/**
 * Run manually once to validate Script Properties, report fetch, and GitHub auth.
 * Logs counts and derived data without publishing any files.
 */
function setup() {
  var secrets = getSecrets_();
  var csvText = fetchReport_(secrets.plsisPassword);
  var parsed = parseReportCsv_(csvText);
  var calendarPayload = buildCalendarPayload_(
    parsed.schoolYears,
    parsed.semesters,
    parsed.progressReports,
    parsed.learningPeriods,
    parsed.schoolDays,
    new Date().toISOString()
  );

  verifyGitHubAccess_(secrets.githubPat);

  Logger.log(JSON.stringify({
    source: SOURCE_NAME,
    schoolYears: calendarPayload.schoolYears.length,
    semesters: calendarPayload.semesters.length,
    progressReports: calendarPayload.progressReports.length,
    learningPeriods: calendarPayload.learningPeriods.length,
    schoolDays: calendarPayload.schoolDays.length,
    holidays: calendarPayload.holidays.length,
    today: calendarPayload.today,
    nextVacation: calendarPayload.nextVacation
  }, null, 2));
}

/**
 * One-off diagnostic: logs the distinct (School Days1) Type codes with counts,
 * the full learning-period list with date ranges, and which LP(s) contain today.
 * Run this by hand to discover the report's real vocabulary; publishes nothing.
 */
function inspect() {
  var secrets = getSecrets_();
  var csvText = fetchReport_(secrets.plsisPassword);
  var parsed = parseReportCsv_(csvText);

  var typeCounts = {};
  for (var i = 0; i < parsed.schoolDays.length; i += 1) {
    var t = parsed.schoolDays[i].type;
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var todayMatches = [];
  for (var j = 0; j < parsed.learningPeriods.length; j += 1) {
    var lp = parsed.learningPeriods[j];
    if (lp.start && lp.end && lp.start <= today && today <= lp.end) {
      todayMatches.push(lp);
    }
  }

  Logger.log('DAY TYPE COUNTS: ' + JSON.stringify(typeCounts));
  Logger.log('LEARNING PERIODS: ' + JSON.stringify(parsed.learningPeriods, null, 2));
  Logger.log('SAMPLE today=' + today + ' ; LP MATCHES: ' + JSON.stringify(todayMatches));
  Logger.log('SAMPLE schoolDays[0..4]: ' + JSON.stringify(parsed.schoolDays.slice(0, 5)));
}

/**
 * Reads required Script Properties and throws clear errors if missing.
 */
function getSecrets_() {
  var properties = PropertiesService.getScriptProperties();
  var plsisPassword = properties.getProperty('PLSIS_PASSWORD');
  var githubPat = properties.getProperty('GITHUB_PAT');

  if (!plsisPassword) {
    throw new Error('Missing Script Property: PLSIS_PASSWORD');
  }
  if (!githubPat) {
    throw new Error('Missing Script Property: GITHUB_PAT');
  }

  return {
    plsisPassword: plsisPassword,
    githubPat: githubPat
  };
}

/**
 * Returns the alert destination, preferring the effective user email.
 */
function getAlertEmail_() {
  try {
    var effectiveUserEmail = Session.getEffectiveUser().getEmail();
    return effectiveUserEmail || ADMIN_EMAIL;
  } catch (err) {
    Logger.log('Unable to read effective user email: ' + buildErrorMessage_(err));
    return ADMIN_EMAIL;
  }
}

/**
 * Fetches the PLSIS report CSV and throws on non-200 responses.
 */
function fetchReport_(password) {
  var url = 'https://pacificcoast.plsis.com/mod.php/admin/dataexport.php' +
    '?action%5BRunReport%5D=1' +
    '&_nosession=true' +
    '&_scope=' + encodeURIComponent(PLSIS_SCOPE) +
    '&_login=' + encodeURIComponent(PLSIS_LOGIN) +
    '&_password=' + encodeURIComponent(password) +
    '&report_id=' + encodeURIComponent(PLSIS_REPORT_ID);

  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status !== 200) {
    throw new Error('PLSIS fetch failed with HTTP ' + status + ': ' + truncate_(body, 500));
  }
  if (!body) {
    throw new Error('PLSIS fetch returned an empty body with HTTP ' + status);
  }

  return body;
}

/**
 * Builds the full calendar payload and derived fields.
 */
function buildCalendarPayload_(schoolYears, semesters, progressReports, learningPeriods, schoolDays, isoTimestamp) {
  var todayDate = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var holidays = buildHolidays_(schoolDays);
  var today = buildToday_(todayDate, schoolYears, semesters, progressReports, learningPeriods, schoolDays);
  var nextVacation = buildNextVacation_(todayDate, learningPeriods, schoolDays);

  return {
    version: 1,
    lastUpdated: isoTimestamp,
    source: SOURCE_NAME,
    schoolYears: schoolYears,
    semesters: semesters,
    progressReports: progressReports,
    learningPeriods: learningPeriods,
    schoolDays: schoolDays,
    holidays: holidays,
    today: today,
    nextVacation: nextVacation
  };
}

/**
 * Produces the four pretty-printed output file payloads.
 */
function buildOutputFiles_(calendarPayload, isoTimestamp) {
  var nextVacation = calendarPayload.nextVacation || {
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
      currentYear: calendarPayload.today.currentYear,
      currentSemester: calendarPayload.today.currentSemester,
      currentProgressReport: calendarPayload.today.currentProgressReport,
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
        schoolYears: calendarPayload.schoolYears.length,
        semesters: calendarPayload.semesters.length,
        progressReports: calendarPayload.progressReports.length,
        learningPeriods: calendarPayload.learningPeriods.length,
        schoolDays: calendarPayload.schoolDays.length,
        holidays: calendarPayload.holidays.length
      }
    }, null, 2)
  };
}

/**
 * Computes the holiday date list from non-school days.
 */
function buildHolidays_(schoolDays) {
  var seen = {};
  var holidays = [];

  for (var i = 0; i < schoolDays.length; i += 1) {
    var day = schoolDays[i];
    if (day.date && day.type === 'HOL' && !seen[day.date]) {
      seen[day.date] = true;
      holidays.push(day.date);
    }
  }

  holidays.sort();
  return holidays;
}

/**
 * Computes the today payload in Los Angeles time.
 */
function buildToday_(todayDate, schoolYears, semesters, progressReports, learningPeriods, schoolDays) {
  var schoolDayMap = buildSchoolDayMap_(schoolDays);
  var todayRecord = schoolDayMap[todayDate] || null;
  var currentLP = findCurrentLearningPeriod_(todayDate, learningPeriods);
  var currentYear = findCurrentPeriod_(todayDate, schoolYears);
  var currentSemester = findCurrentPeriod_(todayDate, semesters);
  var currentProgressReport = findCurrentPeriod_(todayDate, progressReports);
  var dayType = null;

  if (todayRecord) {
    dayType = todayRecord.type;
  } else if (isWeekend_(todayDate)) {
    dayType = 'Weekend';
  } else {
    dayType = 'Unscheduled';
  }

  return {
    date: todayDate,
    isSchoolDay: !!(todayRecord && !NON_SCHOOL_TYPES[todayRecord.type]),
    currentLP: currentLP ? currentLP.lp : null,
    currentYear: currentYear ? currentYear.title : null,
    currentSemester: currentSemester ? currentSemester.title : null,
    currentProgressReport: currentProgressReport ? currentProgressReport.title : null,
    dayType: dayType
  };
}

/**
 * Finds the next contiguous non-school span on or after today.
 * Assumption: a non-school date is either an explicit non-Schoolday entry,
 * a weekend not explicitly marked Schoolday, or a date outside all learning periods.
 */
function buildNextVacation_(todayDate, learningPeriods, schoolDays) {
  var schoolDayMap = buildSchoolDayMap_(schoolDays);
  var horizonEnd = findSearchHorizonEnd_(todayDate, learningPeriods, schoolDays);
  var cursor = todayDate;

  while (cursor <= horizonEnd) {
    if (isNonSchoolDate_(cursor, learningPeriods, schoolDayMap)) {
      var start = cursor;
      var end = cursor;

      while (true) {
        var nextDate = addDays_(end, 1);
        if (nextDate > horizonEnd || !isNonSchoolDate_(nextDate, learningPeriods, schoolDayMap)) {
          break;
        }
        end = nextDate;
      }

      // Only an extended break counts — a span that takes at least one weekday
      // (Mon-Fri) off. A bare Saturday+Sunday is a weekend, not a vacation.
      if (spanHasWeekdayOff_(start, end)) {
        return {
          name: chooseVacationName_(start, end, schoolDayMap),
          start: start,
          end: end,
          daysUntil: diffDays_(todayDate, start),
          weekdaysOff: countWeekdays_(start, end)
        };
      }
      cursor = addDays_(end, 1);
      continue;
    }

    cursor = addDays_(cursor, 1);
  }

  return null;
}

// True if any date in [start,end] is a weekday (Mon-Fri).
function spanHasWeekdayOff_(start, end) {
  var cursor = start;
  while (cursor <= end) {
    if (!isWeekend_(cursor)) return true;
    cursor = addDays_(cursor, 1);
  }
  return false;
}

function countWeekdays_(start, end) {
  var cursor = start;
  var n = 0;
  while (cursor <= end) {
    if (!isWeekend_(cursor)) n += 1;
    cursor = addDays_(cursor, 1);
  }
  return n;
}

/**
 * Returns the current learning period containing the target date, if any.
 */
function findCurrentLearningPeriod_(dateString, learningPeriods) {
  for (var i = 0; i < learningPeriods.length; i += 1) {
    var lp = learningPeriods[i];
    if (lp.start && lp.end && lp.start <= dateString && dateString <= lp.end) {
      return lp;
    }
  }
  return null;
}

function findCurrentPeriod_(dateString, periods) {
  for (var i = 0; i < periods.length; i += 1) {
    var period = periods[i];
    if (period.start && period.end && period.start <= dateString && dateString <= period.end) {
      return period;
    }
  }
  return null;
}

/**
 * Normalizes common date formats to YYYY-MM-DD. Unparseable values pass through.
 */
function normalizeDate(value) {
  var raw = safeTrim_(value);
  if (!raw) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  var slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return [
      slashMatch[3],
      pad2_(slashMatch[1]),
      pad2_(slashMatch[2])
    ].join('-');
  }

  var dashMatch = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    return [
      dashMatch[3],
      pad2_(dashMatch[1]),
      pad2_(dashMatch[2])
    ].join('-');
  }

  var parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, TIMEZONE, 'yyyy-MM-dd');
  }

  Logger.log('Leaving unparseable date as-is: ' + raw);
  return raw;
}

function buildSchoolDayMap_(schoolDays) {
  var map = {};
  for (var i = 0; i < schoolDays.length; i += 1) {
    map[schoolDays[i].date] = schoolDays[i];
  }
  return map;
}

// Non-school if a listed HOL, or not listed at all (weekends and out-of-term
// gaps are simply absent from the enumerated days).
function isNonSchoolDate_(dateString, learningPeriods, schoolDayMap) {
  var schoolDay = schoolDayMap[dateString];
  if (schoolDay) {
    return !!NON_SCHOOL_TYPES[schoolDay.type];
  }
  return true;
}

function chooseVacationName_(start, end, schoolDayMap) {
  var cursor = start;
  while (cursor <= end) {
    var record = schoolDayMap[cursor];
    if (record && NON_SCHOOL_TYPES[record.type]) {
      return start === end ? 'Holiday' : 'Break';
    }
    cursor = addDays_(cursor, 1);
  }
  return 'Break';
}

function findSearchHorizonEnd_(todayDate, learningPeriods, schoolDays) {
  var lastDate = todayDate;

  for (var i = 0; i < learningPeriods.length; i += 1) {
    if (learningPeriods[i].end && learningPeriods[i].end > lastDate) {
      lastDate = learningPeriods[i].end;
    }
  }
  for (var j = 0; j < schoolDays.length; j += 1) {
    if (schoolDays[j].date && schoolDays[j].date > lastDate) {
      lastDate = schoolDays[j].date;
    }
  }

  return addDays_(lastDate, 60);
}

function addDays_(dateString, dayOffset) {
  var parts = dateString.split('-');
  var date = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
}

function diffDays_(fromDate, toDate) {
  var from = new Date(fromDate + 'T12:00:00Z');
  var to = new Date(toDate + 'T12:00:00Z');
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function isWeekend_(dateString) {
  var parts = dateString.split('-');
  var date = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0));
  var day = parseInt(Utilities.formatDate(date, TIMEZONE, 'u'), 10);
  return day === 6 || day === 7;
}

function compareStrings_(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function pad2_(value) {
  return ('0' + parseInt(value, 10)).slice(-2);
}

function safeTrim_(value) {
  return value == null ? '' : String(value).trim();
}

function truncate_(value, maxLength) {
  var text = value == null ? '' : String(value);
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
}

function buildErrorMessage_(err) {
  if (!err) {
    return 'Unknown error';
  }
  if (err.stack) {
    return String(err.stack);
  }
  if (err.message) {
    return String(err.message);
  }
  return String(err);
}
