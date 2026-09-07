/**
 * GitHub publishing for the School Dates Writer.
 * Shares the Apps Script global scope with Code.js (GITHUB_REPO, GITHUB_BRANCH, truncate_).
 *
 * Every output file is written in ONE commit via the Git Data API
 * (ref -> base tree -> new tree -> commit -> ref update). One push per run means
 * one GitHub Pages build. The previous one-commit-per-file approach started four
 * Pages builds a few seconds apart and GitHub cancelled three of them every day,
 * which surfaced as daily "cancelled workflow" notifications.
 */

/**
 * Publishes every entry in `files` ([{ path, content }]) as a single commit on
 * GITHUB_BRANCH and returns the new commit sha. Throws on any non-2xx response.
 */
function publishFiles_(files, githubPat, message) {
  if (!files || !files.length) {
    throw new Error('publishFiles_ called with no files');
  }
  var base = 'https://api.github.com/repos/' + GITHUB_REPO;
  var branch = encodeURIComponent(GITHUB_BRANCH);

  var headRef = gitHubJson_(base + '/git/ref/heads/' + branch, 'get', null, githubPat);
  var headSha = headRef.object && headRef.object.sha;
  if (!headSha) {
    throw new Error('GitHub ref lookup returned no sha for ' + GITHUB_BRANCH);
  }

  var headCommit = gitHubJson_(base + '/git/commits/' + headSha, 'get', null, githubPat);
  var baseTreeSha = headCommit.tree && headCommit.tree.sha;
  if (!baseTreeSha) {
    throw new Error('GitHub commit lookup returned no tree sha for ' + headSha);
  }

  var treeEntries = files.map(function(file) {
    return { path: file.path, mode: '100644', type: 'blob', content: file.content };
  });
  var tree = gitHubJson_(base + '/git/trees', 'post', {
    base_tree: baseTreeSha,
    tree: treeEntries
  }, githubPat);

  var commit = gitHubJson_(base + '/git/commits', 'post', {
    message: message,
    tree: tree.sha,
    parents: [headSha]
  }, githubPat);

  gitHubJson_(base + '/git/refs/heads/' + branch, 'patch', {
    sha: commit.sha,
    force: false
  }, githubPat);

  return commit.sha;
}

/**
 * Performs one GitHub REST call and returns the parsed JSON body; throws on non-2xx.
 */
function gitHubJson_(url, method, payload, githubPat) {
  var options = {
    method: method,
    headers: {
      Authorization: 'token ' + githubPat,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Google-Apps-Script-school-dates-writer'
    },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  var response = UrlFetchApp.fetch(url, options);
  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('GitHub ' + method.toUpperCase() + ' ' + url + ' failed with HTTP ' + status + ': ' +
      truncate_(body, 1000));
  }
  return body ? JSON.parse(body) : {};
}

/**
 * Verifies GitHub auth in setup() without publishing anything.
 */
function verifyGitHubAccess_(githubPat) {
  gitHubJson_('https://api.github.com/repos/' + GITHUB_REPO, 'get', null, githubPat);
}
