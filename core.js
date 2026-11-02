/* FC visitor register: data rules with no screen code, so they can be tested with `node core.test.js`. */
(function (root) {
  'use strict';
  var VERSION = '1.3.0';
  var ELIG = ['not_elig', 'pmt', 'docs', 'dup', 'criteria'];
  var OPS = ['system', 'crowd', 'staff', 'food', 'another_day', 'left'];
  var KEEP_DAYS = 30;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function hhmm(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  function emptyState(now) { return { cfg: null, day: dayKey(now), visits: [], seq: 0, archive: {}, sentAt: {}, uploaded: {} }; }

  // Tablet 1 numbers from 1, tablet 2 from 501: two tablets at one FC never hand out the same number.
  // ponytail: exits are matched only on the tablet that recorded the arrival; one tablet per gate in the pilot.
  function firstNumber(tablet) { return (Math.max(1, +tablet || 1) - 1) * 500 + 1; }

  function isOpen(v) { return v.status === 'in' || v.status === 'out'; }
  function findOpen(state, no) {
    for (var i = state.visits.length - 1; i >= 0; i--) { var v = state.visits[i]; if (v.no === no && isOpen(v)) return v; }
    return null;
  }

  function arrive(state, type, no, now) {
    if (no == null) { no = state.seq ? state.seq + 1 : firstNumber(state.cfg && state.cfg.tablet); state.seq = no; }
    var v = { no: no, type: type, arr: now, exit: null, status: 'in', outcome: null, service: null, reason: null, outs: 0, matched: true, auto: false };
    state.visits.push(v);
    return v;
  }
  function stepOut(v) { v.status = 'out'; v.outs += 1; }
  function stepIn(v) { v.status = 'in'; }
  function reasonGroup(r) { return ELIG.indexOf(r) > -1 ? 'eligibility' : OPS.indexOf(r) > -1 ? 'operations' : 'other'; }

  // v is null when the visitor has no number: the exit is still saved, without a match.
  function leave(state, v, outcome, detail, now) {
    if (!v) { v = { no: null, type: null, arr: null, outs: 0, matched: false, auto: false }; state.visits.push(v); }
    v.exit = now; v.status = 'closed'; v.outcome = outcome;
    v.service = outcome === 'served' ? detail : null;
    v.reason = outcome === 'not_served' ? detail : null;
    return v;
  }

  function closeOpen(state, now) {
    var n = 0;
    state.visits.forEach(function (v) { if (isOpen(v)) { v.status = 'closed'; v.outcome = 'no_exit'; v.exit = null; v.auto = true; n++; } });
    return n;
  }

  // Called at start-up and every minute: a new calendar day archives yesterday, closing what was left open.
  function rollover(state, now) {
    var today = dayKey(now);
    if (state.day === today) return false;
    closeOpen(state, now);
    if (state.visits.length) state.archive[state.day] = { visits: state.visits };
    state.day = today; state.visits = []; state.seq = 0;
    var cut = dayKey(now - KEEP_DAYS * 86400000);
    state.sentAt = state.sentAt || {}; state.uploaded = state.uploaded || {};
    [state.archive, state.sentAt, state.uploaded].forEach(function (m) { Object.keys(m).forEach(function (d) { if (d < cut) delete m[d]; }); });
    return true;
  }

  function visitId(cfg, day, v) {
    var t = v.arr || v.exit;
    // a visitor with no number gets U + exit time to the second, so two such exits at one FC do not share an ID
    var tail = v.no != null ? String(v.no).padStart(3, '0') : 'U' + hhmm(v.exit).replace(':', '') + pad2(new Date(v.exit).getSeconds());
    return [cfg.fc_code, day.replace(/-/g, ''), 'T' + cfg.tablet, v.type || 'X', t ? hhmm(t).replace(':', '') : '0000', tail].join('_');
  }

  var HEAD = ['visit_id', 'fc_code', 'fc_name', 'tablet', 'date', 'number', 'visitor_type', 'arrival_time', 'exit_time', 'minutes_at_fc',
    'status', 'outcome', 'service', 'reason_group', 'reason', 'times_out', 'exit_matched', 'closed_by_app', 'app_version'];
  function cell(x) { x = x == null ? '' : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }
  function rowValues(cfg, day, v) {
    var mins = v.arr && v.exit ? Math.round((v.exit - v.arr) / 60000) : '';
    return [visitId(cfg, day, v), cfg.fc_code, cfg.fc_name, cfg.tablet, day, v.no, v.type, v.arr ? hhmm(v.arr) : '', v.exit ? hhmm(v.exit) : '', mins,
      v.status, v.outcome, v.service, v.reason ? reasonGroup(v.reason) : '', v.reason, v.outs, v.matched, v.auto, VERSION];
  }
  function toCSV(cfg, day, visits) {
    var rows = visits.map(function (v) { return rowValues(cfg, day, v).map(cell).join(','); });
    return [HEAD.join(',')].concat(rows).join('\r\n') + '\r\n';
  }

  /* ---------- direct upload: send only rows that changed since the last successful upload ---------- */
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function rowObject(vals) { var o = {}; HEAD.forEach(function (h, i) { o[h] = vals[i] == null ? '' : String(vals[i]); }); return o; }

  // One batch per day with changes: {day, rows, sigs}. rows are objects keyed by the CSV header.
  // ponytail: an Undo after an upload can leave a stray row on the server; uploads run every 15 minutes, Undo within seconds.
  function pendingUpload(state) {
    var up = state.uploaded || {}, days = Object.keys(state.archive || {}).concat([state.day]), out = [];
    days.forEach(function (day) {
      var visits = day === state.day ? state.visits : state.archive[day].visits, done = up[day] || {}, rows = [], sigs = {};
      visits.forEach(function (v) {
        var vals = rowValues(state.cfg, day, v), sig = hash(vals.join('|'));
        if (done[vals[0]] !== sig) { rows.push(rowObject(vals)); sigs[vals[0]] = sig; }
      });
      if (rows.length) out.push({ day: day, rows: rows, sigs: sigs });
    });
    return out;
  }
  function markUploaded(state, batch) {
    state.uploaded = state.uploaded || {};
    var d = state.uploaded[batch.day] || (state.uploaded[batch.day] = {});
    Object.keys(batch.sigs).forEach(function (k) { d[k] = batch.sigs[k]; });
  }
  function payload(state, batch) {
    return JSON.stringify({ app_version: VERSION, fc_code: state.cfg.fc_code, tablet: state.cfg.tablet, date: batch.day, rows: batch.rows });
  }

  function stats(visits) {
    var arr = visits.filter(function (v) { return v.arr; });
    var by = function (o) { return visits.filter(function (v) { return v.outcome === o; }).length; };
    var times = arr.filter(function (v) { return v.exit; }).map(function (v) { return v.exit - v.arr; }).sort(function (a, b) { return a - b; });
    var hours = {}, reasons = {};
    arr.forEach(function (v) { var h = new Date(v.arr).getHours(); hours[h] = (hours[h] || 0) + 1; });
    visits.forEach(function (v) { if (v.reason) reasons[v.reason] = (reasons[v.reason] || 0) + 1; });
    var served = by('served'), notServed = by('not_served');
    return {
      arrived: arr.length, served: served, notServed: notServed, noExit: by('no_exit'),
      open: visits.filter(isOpen).length,
      medianMs: times.length ? times[Math.floor(times.length / 2)] : null,
      capture: arr.length ? Math.round(arr.filter(function (v) { return v.outcome === 'served' || v.outcome === 'not_served'; }).length / arr.length * 100) : null,
      hours: hours, reasons: reasons
    };
  }

  /* ---------- for the admin page: read the daily files, merge them, label the codes ---------- */
  var LABELS = {
    visitor_type: { N: 'New registration', F: 'Follow-up visit', R: 'Referred here', I: 'Only information' },
    status: { in: 'Inside', out: 'Out, coming back', closed: 'Closed' },
    outcome: { served: 'Served', not_served: 'Not served', no_exit: 'No exit check' },
    service: { reg: 'Registered (new)', fu: 'Follow-up done', info: 'Information or counselling', ref: 'Referred elsewhere' },
    reason_group: { eligibility: 'Eligibility', operations: 'FC operations', other: 'Other' },
    reason: { not_elig: 'Not eligible', pmt: 'PMT, NSER or Kafaalat issue', docs: 'Documents missing', dup: 'Already registered',
      criteria: 'Pregnancy or child age criteria not met', system: 'System or internet down', crowd: 'Too many people today',
      staff: 'Staff not available', food: 'Food not available', another_day: 'Told to come another day', left: 'Left before their turn', other: 'Other reason' }
  };

  function parseCSV(text) { // quotes, doubled quotes, CRLF
    var rows = [], row = [], f = '', q = false, c;
    text = text.replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || r[0] !== ''; });
  }

  // One daily file: rows keyed by the header, or an error when it is not a visitor file.
  function readDaily(text) {
    var t = parseCSV(text);
    if (!t.length || t[0].join(',') !== HEAD.join(',')) return { rows: [], error: 'Not an FC visitor file: the first line does not match' };
    return { rows: t.slice(1).map(function (r) { var o = {}; HEAD.forEach(function (h, i) { o[h] = r[i] == null ? '' : r[i]; }); return o; }) };
  }

  // A day sent twice gives the same visit twice; keep the most complete row (closed beats out beats in).
  var RANK = { in: 0, out: 1, closed: 2 };
  function merge(rows) {
    var by = {}, dropped = 0;
    rows.forEach(function (r) {
      var old = by[r.visit_id];
      if (old) dropped++;
      if (!old || (RANK[r.status] || 0) >= (RANK[old.status] || 0)) by[r.visit_id] = r;
    });
    var key = function (r) { return [r.date, r.fc_code, r.tablet, r.arrival_time || r.exit_time, r.visit_id].join('|'); };
    return { rows: Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return key(a) < key(b) ? -1 : 1; }), dropped: dropped };
  }

  function median(xs) {
    if (!xs.length) return null;
    xs = xs.slice().sort(function (a, b) { return a - b; }); var m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  }

  // One line per FC and day, all tablets together.
  function daily(rows) {
    var g = {};
    rows.forEach(function (r) {
      var k = r.date + '|' + r.fc_code;
      var d = g[k] || (g[k] = { date: r.date, fc_code: r.fc_code, fc_name: r.fc_name, arrived: 0, served: 0, not_served: 0, no_exit: 0, still_open: 0, captured: 0, mins: [], hours: {} });
      if (r.arrival_time) { d.arrived++; var h = r.arrival_time.slice(0, 2); d.hours[h] = (d.hours[h] || 0) + 1; }
      if (r.outcome === 'served') d.served++; else if (r.outcome === 'not_served') d.not_served++;
      else if (r.outcome === 'no_exit') d.no_exit++; else d.still_open++;
      if (r.arrival_time && (r.outcome === 'served' || r.outcome === 'not_served')) d.captured++;
      if (r.minutes_at_fc !== '') d.mins.push(+r.minutes_at_fc);
    });
    return Object.keys(g).sort().map(function (k) {
      var d = g[k], peak = Object.keys(d.hours).sort(function (a, b) { return d.hours[b] - d.hours[a] || (a < b ? -1 : 1); })[0];
      return { date: d.date, fc_code: d.fc_code, fc_name: d.fc_name, arrived: d.arrived, served: d.served, not_served: d.not_served,
        no_exit: d.no_exit, still_open: d.still_open, exit_capture_pct: d.arrived ? Math.round(d.captured / d.arrived * 100) : null,
        median_minutes_at_fc: median(d.mins), peak_hour: peak ? peak + ':00' : '' };
    });
  }

  root.Core = { VERSION: VERSION, ELIG: ELIG, OPS: OPS, pad2: pad2, dayKey: dayKey, hhmm: hhmm, emptyState: emptyState, firstNumber: firstNumber,
    isOpen: isOpen, findOpen: findOpen, arrive: arrive, stepOut: stepOut, stepIn: stepIn, leave: leave, closeOpen: closeOpen,
    rollover: rollover, visitId: visitId, toCSV: toCSV, stats: stats, reasonGroup: reasonGroup,
    pendingUpload: pendingUpload, markUploaded: markUploaded, payload: payload,
    HEAD: HEAD, LABELS: LABELS, parseCSV: parseCSV, readDaily: readDaily, merge: merge, median: median, daily: daily };
  if (typeof module !== 'undefined') module.exports = root.Core;
})(typeof window !== 'undefined' ? window : globalThis);
