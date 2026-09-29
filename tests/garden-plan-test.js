// garden-plan.js (v0.52): who's next to a binder, and each plant's next step.
const gp = require('../garden-plan');

let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error('FAILED: ' + what);
  n += 1;
};
const near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
const slot = (muts, value, { size = 100, ripe = 1 } = {}) => [muts, size, ripe, value];
const tile = (plan, i) => plan.tiles.find((t) => t.i === i);

// Neighbours: 8 around, on the same side of the garden only.
ok(gp.neighbours(0).sort((a, b) => a - b).join() === '1,20,21', 'corner has 3');
ok(gp.neighbours(44).length === 8, 'inside has 8');
ok(gp.neighbours(9).sort((a, b) => a - b).join() === '8,28,29', 'left side edge stops at the gap');
ok(gp.neighbours(10).sort((a, b) => a - b).join() === '11,30,31', 'right side edge stops at the gap');
ok(gp.binderOf('MoonCelestial') === 'moon' && gp.binderOf('DawnCelestial') === 'dawn' && gp.binderOf('Dawnbreaker') === null, 'binders by game id');
ok(gp.condMult(6, 10) === 15 && gp.condMult(6, 0) === 6 && gp.condMult(0, 0) === 1, 'hydro + lunar - 1');

// A Moonbinder at 44 (row 2, column 4 of the left side).
const V = 900e6;
const plants = [
  { i: 44, sp: 'MoonCelestial', s: [slot('', 11e6)] },
  { i: 45, sp: 'Dawnbreaker', s: [slot('rainbow,frozen,dawnlit', V)] },                       // cleanse
  { i: 24, sp: 'Dawnbreaker', s: [slot('rainbow,frozen,dawnlit', 10e6), slot('rainbow,frozen,amberbound', 5e9)] }, // mixed: not worth it
  { i: 150, sp: 'Dawnbreaker', s: [slot('gold,frozen,amberlit', 2e9)] },                      // pot
  { i: 151, sp: 'Milkcap', s: [slot('gold,frozen,amberlit', 1e9)] },                          // pot, second
  { i: 43, sp: 'Dawnbreaker', s: [slot('rainbow,frozen,amberlit', 3e9)] },                    // beside the Moonbinder: waits for Amber
  { i: 64, sp: 'Dawnbreaker', s: [slot('rainbow,frozen,amberbound', 30e9)] },                 // done
  { i: 120, sp: 'Ube', s: [slot('rainbow,frozen,dawnlit', 1e9)] },                            // away from binders: any lunar is done
  { i: 121, sp: 'Ube', s: [slot('', 2e6, { ripe: 0 })] },                                     // growing
  { i: 122, sp: 'Ube', s: [slot('wet', 4e6, { size: 80 })] },                                 // waits: Frozen, lunar, colour, size
  { i: 10, sp: 'Dawnbreaker', s: [slot('rainbow,frozen,dawnlit', 1e9)] },
  { i: 9, sp: 'MoonCelestial', s: [slot('', 11e6)] },                                        // at the gap: 10 is on the other side
];
// Around the 44 Moonbinder (23-25, 43, 45, 63-65) all taken but 25 and 65;
// around the 9 one (8, 28, 29), 29 is open.
const occupied = [23, 24, 43, 45, 63, 64, 8, 28];
const P = gp.plan(plants, occupied);

ok(tile(P, 44).step === 'binder' && tile(P, 44).binder === 'moon', 'the Moonbinder is a binder');
const c = tile(P, 45);
ok(c.step === 'cleanse' && near(c.gain, V * (15 / 9 - 1)), 'Dawnlit beside a Moonbinder: cleanse, gain = value x (15/9 - 1)');
ok(tile(P, 24).step !== 'cleanse', 'a plant whose Amberbound crop would be lost is not worth cleansing');
ok(tile(P, 150).step === 'pot' && near(tile(P, 150).gain, 2e9 * (15 / 11 - 1)), 'Amberlit away from a Moonbinder: pot, gain = value x (15/11 - 1)');
ok(P.openBesideMoon.join() === '25,29,65', 'open spots beside a Moonbinder');
const a = tile(P, 43);
ok(a.step === 'wait' && a.why.some((w) => /Amberbound/.test(w)), 'Amberlit beside a Moonbinder waits for the Amber Moon');
ok(tile(P, 64).step === 'done', 'Rainbow Frozen Amberbound at full size is done');
ok(tile(P, 120).step === 'done', 'away from binders, any lunar counts');
ok(tile(P, 121).step === 'growing', 'unripe is growing');
const w = tile(P, 122);
ok(w.step === 'wait' && w.why.join('|') === 'Frozen (Wet + Snow or Chilled + Rain)|a lunar mutation (Dawn or Amber Moon)|Gold or Rainbow (from pets)|full size', 'waiting lists what is missing');
ok(tile(P, 10).nextTo === null && tile(P, 10).step === 'done', 'a Moonbinder does not reach across the gap');
ok(P.summary.cleanse === 1 && P.summary.pot === 2 && P.summary.binders === 2 && P.summary.growing === 1, 'summary counts');
ok(near(P.summary.gain, c.gain + tile(P, 150).gain + tile(P, 151).gain), 'total gain: cleanse + pots that have room');

// Only as many pots as open spots.
const crowded = gp.plan(plants, occupied.concat([25, 29, 65]));
ok(crowded.summary.pot === 0 && crowded.summary.potLater === 2, 'no room: no pot to-dos, two waiting for a spot');
ok(tile(crowded, 150).step === 'done' && near(tile(crowded, 150).later, 2e9 * (15 / 11 - 1)), 'the plant keeps its own step and says what a spot would gain');
ok(near(crowded.summary.gain, c.gain) && near(crowded.summary.potLaterGain, tile(crowded, 150).later + tile(crowded, 151).later), 'only doable gains in the total');
const one = gp.plan(plants, occupied.concat([25, 29]));
ok(one.summary.pot === 1 && tile(one, 150).step === 'pot' && tile(one, 151).later > 0, 'one spot: the most valuable one gets it');
// No Moonbinder at all: nothing to pot for.
ok(gp.plan(plants.filter((p) => p.sp !== 'MoonCelestial'), []).summary.pot === 0, 'no Moonbinder, no pot suggestions');

// A to-do has to be worth it: at least 0.1 % of the garden (1M at the least).
const big = plants.concat([{ i: 199, sp: 'Dawnbreaker', s: [slot('rainbow,frozen,amberbound', 5e12)] }]);
const B = gp.plan(big, occupied.concat([199]));
ok(near(B.worth, 0.001 * B.tiles.reduce((a, t) => a + t.value, 0)), 'the bar is 0.1 % of the garden');
ok(tile(B, 45).step !== 'cleanse' && near(tile(B, 45).small, c.gain), 'a cleanse under the bar is not a to-do, but its gain is noted');
ok(B.summary.cleanse === 0 && B.summary.pot === 0, 'nothing small on the list');
ok(gp.plan(plants, occupied).worth === 1e6 || gp.plan(plants, occupied).worth >= 1e6, 'never under 1M');
// A binder counts only its own neighbours.
ok(tile(P, 44).beside <= 8 && tile(P, 44).beside === gp.neighbours(44).filter((j) => plants.some((p) => p.i === j)).length, "a binder counts its own 8 tiles");

// Binders' own fruit (v0.53.6): a Moonbinder with Dawnbound fruit beside
// another Moonbinder is a cleanse; beside a Dawnbinder too, it says to step
// out during Dawns; a binder is never a pot.
{
  const pl = [
    { i: 44, sp: 'MoonCelestial', s: [slot('rainbow,thundercharged,dawnbound', 12e9), slot('rainbow,frozen,dawnbound', 11e9)] },
    { i: 45, sp: 'MoonCelestial', s: [slot('gold,frozen,amberlit', 5e9)] },
    { i: 64, sp: 'DawnCelestial', s: [slot('rainbow,frozen,amberbound', 9e9)] },
  ];
  const Q = gp.plan(pl, []);
  const m = tile(Q, 44);
  ok(m.binder === 'moon' && m.step === 'cleanse' && near(m.gain, 12e9 * (16 / 13 - 1) + 11e9 * (15 / 12 - 1)), 'a binder with Dawnbound fruit beside a Moonbinder: cleanse its fruit');
  ok(m.why.some((w) => /Dawnbinder/.test(w)), 'beside a Dawnbinder too: step out during Dawns');
  ok(tile(Q, 45).step === 'binder' && tile(Q, 45).why.some((w) => /Amberbound/.test(w)), 'Amberlit fruit on a binder beside a Moonbinder waits for the Amber Moon');
  ok(Q.summary.binders === 3, 'every binder counts, whatever its step');
  const lone = gp.plan([{ i: 150, sp: 'MoonCelestial', s: [slot('gold,frozen,amberlit', 5e9)] }, { i: 44, sp: 'MoonCelestial', s: [slot('', 1e6)] }], []);
  ok(tile(lone, 150).step === 'binder', 'a binder is never a pot');
}

// The owner's garden (tests/fixtures/garden-layout.json): the Moonbinder at
// 107 (Dawnbound fruit, beside the other Moonbinder and a Dawnbinder) is the
// biggest cleanse, with the Dawn warning; all five binders count.
{
  const fx = require('./fixtures/garden-layout.json');
  const R = gp.plan(fx.plants, fx.occupied);
  const top = R.tiles.filter((t) => t.step === 'cleanse').sort((a, b) => b.gain - a.gain)[0];
  ok(top && top.i === 107 && top.binder === 'moon' && top.gain > 5e9 && top.why.some((w) => /Dawnbinder/.test(w)), 'owner garden: Moonbinder 107 is the top cleanse, with the Dawn warning');
  ok(R.summary.binders === 5, 'owner garden: five binders');
  ok(tile(R, 108).step === 'binder' && tile(R, 129).step === 'wait', 'owner garden: Amberlit fruit beside the Moonbinders waits for the Amber Moon');
  console.log('  owner garden:', JSON.stringify(R.summary), '| top cleanse', top.i, top.name, (top.gain / 1e9).toFixed(2) + 'B');
}
console.log(`garden-plan: ${n} checks passed`);
