// Run: node core.test.js  (no dependencies)
const assert = require('assert');
const C = require('./core.js');

const T0 = new Date(2026, 10, 2, 9, 0).getTime(), MIN = 60000;
const s = C.emptyState(T0);
s.cfg = { fc_code: 'PB014', fc_name: 'Lahore, "Cantt"', tablet: 2 };

// numbering starts at the tablet's block
const a = C.arrive(s, 'N', null, T0), b = C.arrive(s, 'F', null, T0 + 5 * MIN), c = C.arrive(s, 'I', null, T0 + 9 * MIN);
assert.deepStrictEqual([a.no, b.no, c.no], [501, 502, 503]);

// out and back keeps one visit
C.stepOut(b); assert.strictEqual(C.findOpen(s, 502).status, 'out'); C.stepIn(b);
C.leave(s, C.findOpen(s, 501), 'served', 'reg', T0 + 125 * MIN);
C.leave(s, C.findOpen(s, 502), 'not_served', 'system', T0 + 60 * MIN);
C.leave(s, null, 'not_served', 'docs', T0 + 70 * MIN);           // visitor with no number
assert.strictEqual(C.findOpen(s, 501), null);

let st = C.stats(s.visits);
assert.deepStrictEqual([st.arrived, st.served, st.notServed, st.open, st.capture], [3, 1, 2, 1, 67]);
assert.strictEqual(st.medianMs, 125 * MIN);                      // median of 60 and 125 min (upper middle)

// CSV: header plus one row per visit, quoting kept intact
const csv = C.toCSV(s.cfg, s.day, s.visits).trim().split('\r\n');
assert.strictEqual(csv.length, 5);
assert.ok(csv[1].startsWith('PB014_20261102_T2_N_0900_501,PB014,"Lahore, ""Cantt""",2,2026-11-02,501,N,09:00,11:05,125,closed,served,reg'));
assert.ok(csv[2].includes(',operations,system,1,true,false,'));
assert.ok(csv[3].includes(',503,I,09:09,,,in,'));                    // still inside
assert.ok(/_U\d{6},/.test(csv[4]) && csv[4].includes(',false,false,'));  // unmatched exit

// next day: open visit closed as no_exit, archived, counter reset
assert.strictEqual(C.rollover(s, T0 + 3 * MIN), false);
assert.strictEqual(C.rollover(s, T0 + 24 * 60 * MIN), true);
assert.strictEqual(s.day, '2026-11-03');
assert.deepStrictEqual([s.visits.length, s.seq], [0, 0]);
const y = s.archive['2026-11-02'].visits;
assert.strictEqual(y.find(v => v.no === 503).outcome, 'no_exit');
assert.strictEqual(C.arrive(s, 'N', null, T0 + 25 * 60 * MIN).no, 501);

// archive keeps 30 days
C.rollover(s, T0 + 40 * 24 * 60 * MIN);
assert.strictEqual(s.archive['2026-11-02'], undefined);

// admin side: read two sends of the same day (the second has one more closed visit), merge, summarise
const s2 = C.emptyState(T0); s2.cfg = { fc_code: 'PB014', fc_name: 'Lahore, "Cantt"', tablet: 1 };
const v1 = C.arrive(s2, 'N', null, T0), v2 = C.arrive(s2, 'F', null, T0 + 10 * MIN);
C.leave(s2, v1, 'served', 'reg', T0 + 40 * MIN);
const first = C.toCSV(s2.cfg, s2.day, s2.visits);
C.leave(s2, v2, 'not_served', 'docs', T0 + 90 * MIN);
const second = C.toCSV(s2.cfg, s2.day, s2.visits);
assert.ok(C.readDaily('hello,world\r\n1,2').error);
const r1 = C.readDaily('\uFEFF' + first), r2 = C.readDaily(second);
assert.strictEqual(r1.rows[0].fc_name, 'Lahore, "Cantt"');
const m = C.merge(r1.rows.concat(r2.rows));
assert.deepStrictEqual([m.rows.length, m.dropped], [2, 2]);
assert.strictEqual(m.rows[1].outcome, 'not_served');             // the more complete row won
const d = C.daily(m.rows)[0];
assert.deepStrictEqual([d.arrived, d.served, d.not_served, d.still_open, d.exit_capture_pct, d.median_minutes_at_fc, d.peak_hour],
  [2, 1, 1, 0, 100, 60, '09:00']);                                 // median of 40 and 80 minutes
assert.strictEqual(C.median([5, 1, 3]), 3);

// direct upload: first everything is pending, then only what changed
const s3 = C.emptyState(T0); s3.cfg = { fc_code: 'PB014', fc_name: 'Lahore', tablet: 1 };
const u1 = C.arrive(s3, 'N', null, T0), u2 = C.arrive(s3, 'F', null, T0 + MIN);
let p = C.pendingUpload(s3);
assert.deepStrictEqual([p.length, p[0].rows.length, p[0].rows[0].status], [1, 2, 'in']);
const body = JSON.parse(C.payload(s3, p[0]));
assert.deepStrictEqual([body.fc_code, body.date, body.rows[1].visitor_type], ['PB014', '2026-11-02', 'F']);
C.markUploaded(s3, p[0]);
assert.strictEqual(C.pendingUpload(s3).length, 0);                    // nothing new
C.leave(s3, u1, 'served', 'reg', T0 + 30 * MIN);
p = C.pendingUpload(s3);
assert.deepStrictEqual([p[0].rows.length, p[0].rows[0].outcome], [1, 'served']);   // only the changed visit
C.markUploaded(s3, p[0]);
C.rollover(s3, T0 + 24 * 60 * MIN);                                     // u2 closed as no_exit overnight
p = C.pendingUpload(s3);
assert.deepStrictEqual([p.length, p[0].day, p[0].rows[0].outcome], [1, '2026-11-02', 'no_exit']);

console.log('core.test.js: all checks passed');
