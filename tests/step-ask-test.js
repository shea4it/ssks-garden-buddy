'use strict';
// When the app asks about weather you don't want (v0.63.9): usually the lead
// plus 20 seconds before it starts; only 10 seconds before when a Dawn or
// Amber Moon runs right up to it (you almost never want to leave a moon
// event early). The functions are read straight from main.js.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const a = src.indexOf('const MOON_KINDS');
const b = src.indexOf('function planLogoff(status)');
if (a < 0 || b < 0) throw new Error('moon timing not found in main.js');
// eslint-disable-next-line no-new-func
const make = new Function('STEP_ASK_MS', `${src.slice(a, b)}\nreturn { moonRunsUpTo, stepAskAt };`);
const { stepAskAt } = make(20000);

let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  n += 1;
};

const T = Date.parse('2026-10-06T20:00:00Z');
const iso = (ms) => new Date(T + ms).toISOString();
const lead = 30000;
const rain = { kind: 'rain', startsAt: iso(0), endsAt: iso(600000) };
const before = (events) => (T - stepAskAt(rain, [...events, rain], lead)) / 1000;

ok(before([]) === 50, 'clear skies before: asks 50 s before (the lead + 20 s)');
ok(before([{ kind: 'amber', startsAt: iso(-1200000), endsAt: iso(0) }]) === 10, 'an Amber Moon right up to it: 10 s before');
ok(before([{ kind: 'dawn', startsAt: iso(-1200000), endsAt: iso(-30000) }]) === 10, 'Dawn ending 30 s before it: 10 s before');
ok(before([{ kind: 'dawn', startsAt: iso(-1500000), endsAt: iso(-300000) }]) === 50, 'Dawn over 5 min before: the usual 50 s');
ok(before([{ kind: 'thunder', startsAt: iso(-600000), endsAt: iso(0) }]) === 50, 'thunder (not a moon) before: the usual 50 s');
ok(before([{ kind: 'amber', startsAt: iso(60000), endsAt: iso(900000) }]) === 50, 'a moon starting after it does not count');
ok((T - stepAskAt(rain, [rain], 0)) / 1000 === 20, 'a lead of 0: 20 s to answer');

console.log(`step-ask: ${n} checks passed`);
