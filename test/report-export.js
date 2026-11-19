'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const formatCalendarJson = require('../gas-project/CalendarJson.js');

// These fixtures deliberately include URL special characters and recognizable
// markers so the tests can detect quoting errors and accidental disclosure.
const exportToken = 'fixture-only+/=&';
const html = '<html><meta name="csrf-token" content="private-page-marker"></html>';

function makeWriter(properties, fetch) {
  const stored = { ...properties };
  const publications = [];
  const alerts = [];
  const reads = [];
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({
      getProperty(key) {
        reads.push(key);
        return stored[key] || null;
      },
      getKeys: () => Object.keys(stored),
      deleteProperty: key => { delete stored[key]; }
    }) },
    UrlFetchApp: { fetch },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.invalid' }) },
    MailApp: { sendEmail: (_to, _subject, body) => alerts.push(body) },
    Logger: { log() {} }
  });
  for (const file of ['Code.js', 'ReportParse.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas-project', file), 'utf8'), context);
  }
  context.publishFiles_ = (files, pat) => {
    assert.equal(pat, 'test-publish');
    publications.push(files);
  };
  return { context, publications, alerts, reads, stored };
}

const configured = { PLSIS_EXPORT_TOKEN: exportToken, GITHUB_PAT: 'test-publish' };
const response = (code, body) => ({ getResponseCode: () => code, getContentText: () => body });

test('calendar JSON preserves empty arrays, quoted labels, and each dated record', () => {
  const data = { holidays: [], schoolDays: [{ date: '2026-11-19', type: 'A "quoted" label' }], today: null };
  const text = formatCalendarJson(data);
  assert.deepEqual(JSON.parse(text), data);
  assert.ok(text.split('\n').includes('    ' + JSON.stringify(data.schoolDays[0])));
});

test('requests only the saved calendar report using its export token and no session', () => {
  const csv = 'header\nvalue\n';
  const writer = makeWriter(configured, (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin + url.pathname, 'https://pacificcoast.plsis.com/mod.php/admin/dataexport.php');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      'action[RunReport]': '1', _nosession: 'true', _scope: 'pacificcoast',
      _export_token: exportToken, report_id: '2618'
    });
    assert.equal(options.followRedirects, false);
    return response(200, csv);
  });
  assert.equal(writer.context.fetchReport_(), csv);
  assert.deepEqual(writer.reads, ['PLSIS_EXPORT_TOKEN']);
});

for (const [label, fetch, expected] of [
  ['HTTP rejection', () => response(401, html), 'PLSIS report 2618 returned HTTP 401'],
  ['redirect', () => response(302, html), 'PLSIS report 2618 returned HTTP 302'],
  ['HTML with success status', () => response(200, html), 'PLSIS report 2618 returned HTML instead of calendar CSV.'],
  ['transport exception quoting the request', url => { throw Error(url); }, 'PLSIS report 2618 could not be reached.']
]) {
  test(label + ' publishes only a safe health message and keeps the calendar', () => {
    const writer = makeWriter(configured, fetch);
    assert.throws(() => writer.context.main(), { message: expected });
    assert.equal(writer.publications.length, 1);
    assert.equal(writer.publications[0].length, 1);
    const [file] = writer.publications[0];
    assert.equal(file.path, 'v1/health.json');
    const health = JSON.parse(file.content);
    assert.equal(health.lastRunOk, false);
    assert.equal(health.error, expected);
    assert.deepEqual(writer.alerts, [expected]);
  });
}

test('a missing export token still updates health without attempting a report request', () => {
  const writer = makeWriter({ GITHUB_PAT: 'test-publish' }, () => assert.fail('unexpected request'));
  const expected = 'Missing Script Property: PLSIS_EXPORT_TOKEN';
  assert.throws(() => writer.context.main(), { message: expected });
  assert.deepEqual(writer.reads, ['GITHUB_PAT', 'PLSIS_EXPORT_TOKEN']);
  assert.equal(JSON.parse(writer.publications[0][0].content).error, expected);
});

test('main retires only the old report credentials, even before a replacement token is set', () => {
  const writer = makeWriter({
    GITHUB_PAT: 'test-publish', PLSIS_PASSWORD: 'retired-fixture',
    PLSIS_LOGIN: 'report-fixture', PLSIS_USERNAME: 'report-fixture', KEEP: 'untouched'
  }, () => assert.fail('unexpected request'));
  for (let i = 0; i < 2; i++) {
    assert.throws(() => writer.context.main(), /Missing Script Property: PLSIS_EXPORT_TOKEN/);
    assert.deepEqual(writer.stored, { GITHUB_PAT: 'test-publish', KEEP: 'untouched' });
  }
  assert.ok(writer.reads.every(key => key === 'GITHUB_PAT' || key === 'PLSIS_EXPORT_TOKEN'));
});

test('a CSV parser exception cannot publish the original response', () => {
  const writer = makeWriter(configured, () => response(200, 'malformed fixture'));
  writer.context.Utilities = { parseCsv() { throw Error('private-page-marker'); } };
  const expected = 'PLSIS report 2618 returned invalid CSV.';
  assert.throws(() => writer.context.main(), { message: expected });
  assert.deepEqual(writer.alerts, [expected]);
  assert.equal(JSON.parse(writer.publications[0][0].content).error, expected);
});
