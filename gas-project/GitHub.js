/**
 * GitHub publishing for the School Dates Writer.
 * Extracted verbatim from Code.js; shares the global scope (GITHUB_REPO, GITHUB_BRANCH, truncate_).
 */

/**
 * Publishes one file to the configured GitHub repo via the Contents API.
 */
function publishFile(path, contentString, githubPat, isoTimestamp) {
  var url = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + encodePath_(path) +
    '?ref=' + encodeURIComponent(GITHUB_BRANCH);
  var headers = {
    Authorization: 'token ' + githubPat,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Google-Apps-Script-school-dates-writer'
  };

  var existingSha = null;
  var getResponse = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });
  var getStatus = getResponse.getResponseCode();

  if (getStatus === 200) {
    var getPayload = JSON.parse(getResponse.getContentText());
    existingSha = getPayload.sha || null;
  } else if (getStatus !== 404) {
    throw new Error('GitHub GET failed for ' + path + ' with HTTP ' + getStatus + ': ' +
      truncate_(getResponse.getContentText(), 1000));
  }

  var putPayload = {
    message: 'publish ' + path + ' ' + isoTimestamp,
    content: Utilities.base64Encode(contentString, Utilities.Charset.UTF_8),
    branch: GITHUB_BRANCH
  };
  if (existingSha) {
    putPayload.sha = existingSha;
  }

  var putResponse = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(putPayload),
    muteHttpExceptions: true
  });
  var putStatus = putResponse.getResponseCode();

  if (putStatus < 200 || putStatus >= 300) {
    throw new Error('GitHub PUT failed for ' + path + ' with HTTP ' + putStatus + ': ' +
      truncate_(putResponse.getContentText(), 1000));
  }
}

/**
 * Verifies GitHub auth in setup() without publishing anything.
 */
function verifyGitHubAccess_(githubPat) {
  var response = UrlFetchApp.fetch('https://api.github.com/repos/' + GITHUB_REPO, {
    method: 'get',
    headers: {
      Authorization: 'token ' + githubPat,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Google-Apps-Script-school-dates-writer'
    },
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();

  if (status < 200 || status >= 300) {
    throw new Error('GitHub auth check failed with HTTP ' + status + ': ' +
      truncate_(response.getContentText(), 500));
  }
}

function encodePath_(path) {
  return path.split('/').map(function(segment) {
    return encodeURIComponent(segment);
  }).join('/');
}
