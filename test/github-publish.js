'use strict';
// Proves gas-project/GitHub.js publishes N files as exactly ONE commit via the
// Git Data API: GET ref -> GET commit -> POST tree -> POST commit -> PATCH ref.
// Runs in Node with a fake UrlFetchApp; no network. Usage: node test/github-publish.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const calls = [];
const responses = {
  'GET /git/ref/heads/main': { object: { sha: 'HEAD_SHA' } },
  'GET /git/commits/HEAD_SHA': { tree: { sha: 'BASE_TREE' } },
  'POST /git/trees': { sha: 'NEW_TREE' },
  'POST /git/commits': { sha: 'NEW_COMMIT' },
  'PATCH /git/refs/heads/main': { object: { sha: 'NEW_COMMIT' } }
};

function fakeFetch(url, options) {
  const key = options.method.toUpperCase() + ' ' + url.replace('https://api.github.com/repos/warnerwes/school-dates', '');
  calls.push({ key, options });
  if (!responses[key]) return { getResponseCode: () => 404, getContentText: () => '{"message":"Not Found"}' };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(responses[key]) };
}

const sandbox = {
  GITHUB_REPO: 'warnerwes/school-dates',
  GITHUB_BRANCH: 'main',
  truncate_: (v, n) => String(v).slice(0, n),
  UrlFetchApp: { fetch: fakeFetch },
  JSON, Error
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas-project', 'GitHub.js'), 'utf8'), sandbox);

const files = [
  { path: 'v1/calendar.json', content: '{"a":1}' },
  { path: 'v1/today.json', content: '{"b":2}' },
  { path: 'v1/next-vacation.json', content: '{"c":3}' },
  { path: 'v1/health.json', content: '{"d":4}' }
];
const sha = sandbox.publishFiles_(files, 'PAT', 'publish v1 TS');

assert.strictEqual(sha, 'NEW_COMMIT');
assert.deepStrictEqual(calls.map(c => c.key), Object.keys(responses), 'call sequence');
assert.strictEqual(calls.filter(c => /^POST \/git\/commits$/.test(c.key)).length, 1, 'exactly one commit created');
assert.strictEqual(calls.filter(c => /^PATCH /.test(c.key)).length, 1, 'exactly one ref update');
assert.ok(calls.every(c => c.options.headers.Authorization === 'token PAT'), 'auth header on every call');

const treeBody = JSON.parse(calls[2].options.payload);
assert.strictEqual(treeBody.base_tree, 'BASE_TREE');
assert.deepStrictEqual(treeBody.tree.map(e => e.path), files.map(f => f.path));
assert.ok(treeBody.tree.every(e => e.mode === '100644' && e.type === 'blob' && typeof e.content === 'string'));

const commitBody = JSON.parse(calls[3].options.payload);
assert.deepStrictEqual(commitBody, { message: 'publish v1 TS', tree: 'NEW_TREE', parents: ['HEAD_SHA'] });

const refBody = JSON.parse(calls[4].options.payload);
assert.deepStrictEqual(refBody, { sha: 'NEW_COMMIT', force: false });

// Failure path: a non-2xx anywhere throws and stops the sequence.
calls.length = 0;
sandbox.UrlFetchApp.fetch = (url, options) => {
  calls.push({ key: options.method.toUpperCase() });
  return { getResponseCode: () => 422, getContentText: () => 'nope' };
};
assert.throws(() => sandbox.publishFiles_(files, 'PAT', 'm'), /HTTP 422/);
assert.strictEqual(calls.length, 1, 'stops at first failure');
assert.throws(() => sandbox.publishFiles_([], 'PAT', 'm'), /no files/);

console.log('github-publish: all assertions passed (' + Object.keys(responses).length + ' calls, 1 commit for ' + files.length + ' files).');
