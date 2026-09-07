/**
 * PLSIS report CSV parsing + dedupe helpers for the School Dates Writer.
 * Extracted verbatim from Code.js; shares the global scope (HEADERS, NON_SCHOOL_TYPES, normalizeDate, safeTrim_, compareStrings_).
 */

/**
 * Parses the CSV using verbose headers, dedupes, and sorts results.
 */
function parseReportCsv_(csvText) {
  // Strip a leading UTF-8 BOM so the first header name matches exactly.
  csvText = csvText.replace(/^﻿/, '');

  var rows = Utilities.parseCsv(csvText);
  if (!rows || rows.length < 2) {
    throw new Error('PLSIS CSV did not contain a header row plus data rows');
  }

  var headerMap = buildHeaderMap_(rows[0]);
  assertRequiredHeadersPresent_(headerMap);

  var schoolYears = [];
  var semesters = [];
  var progressReports = [];
  var learningPeriods = [];
  var schoolDays = [];
  var knownDates = {};

  for (var i = 1; i < rows.length; i += 1) {
    var row = rows[i];
    var setTitle = getCellByHeader_(row, headerMap, HEADERS.setTitle);
    var periodTitle = getCellByHeader_(row, headerMap, HEADERS.periodTitle);
    var localId = getCellByHeader_(row, headerMap, HEADERS.localId);
    var startDate = normalizeDate(getCellByHeader_(row, headerMap, HEADERS.startDate));
    var finishDate = normalizeDate(getCellByHeader_(row, headerMap, HEADERS.finishDate));
    var parentPeriod = getCellByHeader_(row, headerMap, HEADERS.parentPeriod);
    var track = getCellByHeader_(row, headerMap, HEADERS.track);
    var dayDate = normalizeDate(getCellByHeader_(row, headerMap, HEADERS.dayDate));
    var dayType = getCellByHeader_(row, headerMap, HEADERS.dayType);
    var periodSet = getCellByHeader_(row, headerMap, HEADERS.periodSet);

    if (setTitle === 'Schoolyear' && periodTitle && localId) {
      schoolYears.push({
        localId: localId,
        title: periodTitle,
        start: startDate,
        end: finishDate,
        track: track
      });
    }

    if (setTitle === 'Schoolperiod' && periodTitle && localId) {
      if (isSemesterTitle_(periodTitle)) {
        semesters.push({
          localId: localId,
          title: periodTitle,
          year: parentPeriod || null,
          start: startDate,
          end: finishDate
        });
      } else if (isProgressReportTitle_(periodTitle)) {
        progressReports.push({
          localId: localId,
          title: periodTitle,
          semester: parentPeriod || null,
          start: startDate,
          end: finishDate
        });
      }
    }

    if (setTitle === 'Lpset' && periodTitle) {
      learningPeriods.push({
        lp: periodTitle,
        localId: localId,
        start: startDate,
        end: finishDate
      });
    }

    if (dayDate && dayType) {
      schoolDays.push({
        date: dayDate,
        type: dayType
      });
      knownDates[dayDate] = true;
    }

    if (setTitle === 'Schoolday' && startDate && !dayDate && periodSet === 'Schoolday' && !knownDates[startDate]) {
      schoolDays.push({
        date: startDate,
        type: 'Schoolday'
      });
      knownDates[startDate] = true;
    }
  }

  var dedupedSchoolYears = dedupeByLocalId_(schoolYears);
  var dedupedSemesters = dedupeByLocalId_(semesters);

  return {
    schoolYears: dedupedSchoolYears,
    semesters: dedupedSemesters,
    progressReports: dedupeByLocalId_(progressReports),
    learningPeriods: dedupeLearningPeriods_(learningPeriods, dedupedSchoolYears, dedupedSemesters),
    schoolDays: dedupeSchoolDays_(schoolDays)
  };
}

function buildHeaderMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i += 1) {
    map[String(headerRow[i])] = i;
  }
  return map;
}

function assertRequiredHeadersPresent_(headerMap) {
  var required = [
    HEADERS.setTitle,
    HEADERS.periodTitle,
    HEADERS.localId,
    HEADERS.startDate,
    HEADERS.finishDate,
    HEADERS.parentPeriod,
    HEADERS.track,
    HEADERS.dayDate,
    HEADERS.dayType,
    HEADERS.periodSet
  ];
  var missing = [];

  for (var i = 0; i < required.length; i += 1) {
    if (typeof headerMap[required[i]] === 'undefined') {
      missing.push(required[i]);
    }
  }

  if (missing.length) {
    throw new Error('PLSIS CSV missing required headers: ' + missing.join(', '));
  }
}

function getCellByHeader_(row, headerMap, headerName) {
  var index = headerMap[headerName];
  if (typeof index === 'undefined' || index >= row.length) {
    return '';
  }
  return safeTrim_(row[index]);
}

function dedupeLearningPeriods_(learningPeriods, schoolYears, semesters) {
  var seen = {};
  var deduped = [];

  for (var i = 0; i < learningPeriods.length; i += 1) {
    var item = learningPeriods[i];
    var key = item.localId || (item.lp + '-' + item.start);
    if (!seen[key]) {
      seen[key] = true;
      deduped.push({
        lp: item.lp,
        localId: item.localId || null,
        year: findYearForLp_(item.start, semesters, schoolYears),
        start: item.start,
        end: item.end
      });
    }
  }

  deduped.sort(function(a, b) {
    return compareStrings_(a.start, b.start);
  });

  return deduped;
}

function dedupeByLocalId_(items) {
  var seen = {};
  var deduped = [];

  for (var i = 0; i < items.length; i += 1) {
    var item = items[i];
    if (!item.localId || seen[item.localId]) continue;
    seen[item.localId] = true;
    deduped.push(item);
  }

  deduped.sort(function(a, b) {
    return compareStrings_(a.start, b.start);
  });

  return deduped;
}

function findContainingSchoolYearTitle_(dateString, schoolYears) {
  for (var i = 0; i < schoolYears.length; i += 1) {
    var year = schoolYears[i];
    if (year.start && year.end && year.start <= dateString && dateString <= year.end) {
      return year.title;
    }
  }
  return null;
}

// LP -> academic year: prefer the semester containing the LP (semesters always
// carry a year); fall back to the containing Schoolyear. Handles years present
// only via their semesters (no Schoolyear period in the report).
function findYearForLp_(dateString, semesters, schoolYears) {
  var sems = semesters || [];
  for (var i = 0; i < sems.length; i += 1) {
    var s = sems[i];
    if (s.start && s.end && s.year && s.start <= dateString && dateString <= s.end) {
      return s.year;
    }
  }
  return findContainingSchoolYearTitle_(dateString, schoolYears);
}

function isSemesterTitle_(periodTitle) {
  return periodTitle.indexOf('Semester') === 0 || periodTitle === 'Summer Session';
}

function isProgressReportTitle_(periodTitle) {
  return periodTitle.indexOf('Progress Report') === 0;
}

// Dedupe by date with type precedence: HOL wins (a date flagged off in ANY row
// is off), else a regular Schoolday, else other in-session types (ACA). The
// report lists each date under multiple sets with differing types.
function typeRank_(type) {
  if (NON_SCHOOL_TYPES[type]) return 3;
  if (type === 'Schoolday') return 2;
  return 1;
}

function dedupeSchoolDays_(schoolDays) {
  var byDate = {};

  for (var i = 0; i < schoolDays.length; i += 1) {
    var item = schoolDays[i];
    if (!item.date) continue;
    var existing = byDate[item.date];
    if (!existing || typeRank_(item.type) > typeRank_(existing.type)) {
      byDate[item.date] = { date: item.date, type: item.type };
    }
  }

  var deduped = Object.keys(byDate).map(function(d) { return byDate[d]; });
  deduped.sort(function(a, b) {
    return compareStrings_(a.date, b.date);
  });

  return deduped;
}
