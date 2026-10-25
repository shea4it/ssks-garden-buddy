'use strict';
// The money forecast (v0.63.10): crops in your bag are counted, and the two
// estimates behind the ramp (what a ready crop is worth, how fast crops
// mature) move gradually with ctx.steady instead of jumping.
const budget = require('../budget');

let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  n += 1;
};

// The bag.
ok(budget.gardenParts({ bagWorth: 5e9 }).bag === 5e9, 'gardenParts counts the bag');
ok(budget.gardenParts({}).bag === 0, 'no bag: 0');

// A garden whose ready crops are worth 1B each, turning Gold at 10 an hour.
const H = 3600000;
const t0 = Date.parse('2026-10-06T12:00:00Z');
const ctxOf = (readyValue, steady) => ({
  steady,
  readyRule: { size: false, color: true, hydro: false, lunar: false },
  garden: { total: 100, ready: 10, readyValue, growingValue: 0, growingPotential: 0, missing: { color: 90 }, goldPerHour: 10, stepHours: { color: 9 } },
});
const settings = {};

budget.resetSteady();
const a = budget.estimate(settings, ctxOf(10e9, true), null, t0);
ok(a.usable && Math.abs(a.perCrop - 1e9) < 1, `first reading taken as it is (${a.perCrop})`);
const b = budget.estimate(settings, ctxOf(30e9, true), null, t0 + H);
const expect = 1e9 + (1 - Math.pow(0.5, 0.5)) * 2e9;
ok(Math.abs(b.perCrop - expect) < 1e3, `a jump to 3B moves part way in an hour (${(b.perCrop / 1e9).toFixed(3)}B)`);
ok(Math.abs(b.perCropRaw - 3e9) < 1, 'the raw reading is kept alongside');
const c = budget.estimate(settings, ctxOf(30e9, true), null, t0 + 12 * H);
ok(Math.abs(c.perCrop - 3e9) / 3e9 < 0.02, `a lasting change comes through within hours (${(c.perCrop / 1e9).toFixed(3)}B after 12 h)`);

// A one-off wrong reading that flips straight back barely moves it.
budget.resetSteady();
budget.estimate(settings, ctxOf(10e9, true), null, t0);
const blip = budget.estimate(settings, ctxOf(40e9, true), null, t0 + 5 * 60000);
const back = budget.estimate(settings, ctxOf(10e9, true), null, t0 + 10 * 60000);
ok(blip.perCrop < 1.2e9 && back.perCrop < 1.2e9, `a 5-minute blip to 4B stays near 1B (${(blip.perCrop / 1e9).toFixed(3)}B, then ${(back.perCrop / 1e9).toFixed(3)}B)`);

// Without ctx.steady (the unit tests, the raw math): no smoothing.
budget.resetSteady();
budget.estimate(settings, ctxOf(10e9, false), null, t0);
const raw = budget.estimate(settings, ctxOf(30e9, false), null, t0 + H);
ok(Math.abs(raw.perCrop - 3e9) < 1, 'without steady, the reading is used as it is');

budget.resetSteady();
console.log(`forecast-steady: ${n} checks passed`);
