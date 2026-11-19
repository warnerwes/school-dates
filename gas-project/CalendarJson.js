/** Keep each calendar record on one line so the published data is easy to diff. */
function formatCalendarJson_(calendar) {
  var fields = Object.keys(calendar).map(function(key) {
    var value = calendar[key];
    var formatted;
    if (Array.isArray(value) && value.length) {
      var records = value.map(function(record) { return '    ' + JSON.stringify(record); });
      formatted = '[\n' + records.join(',\n') + '\n  ]';
    } else {
      formatted = JSON.stringify(value);
    }
    return '  ' + JSON.stringify(key) + ': ' + formatted;
  });
  return '{\n' + fields.join(',\n') + '\n}';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = formatCalendarJson_;
}
