'use strict';
// Mutations plant by plant (v0.64.0): the rows match the garden-wide counts,
// only changed rows are stored, and every reading can be rebuilt exactly,
// even after the oldest readings are dropped.
const { plantMutRows, plantStateAt, pushReading, rowEq } = require('../plant-muts');

let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  n += 1;
};

// gardenPlants as the game page sends them: { i, sp, s: [[mutations, size, ripe, value]] }.
const plants = [
  { i: 0, sp: 'Lychee', s: [['wet,gold', 2, 1, 5], ['', 1, 0, 1]] },
  { i: 1, sp: 'Lychee', s: [['frozen,amberbound', 2, 1, 9]] },
  { i: 2, sp: 'Ube', s: [['thunderstruck,dawnlit,rainbow', 1, 1, 3], ['thundercharged', 1, 1, 2], ['gold,rainbow', 1, 1, 4]] },
  { i: 3, sp: 'Empty', s: [] },
];
const rows = plantMutRows(plants);
ok(Object.keys(rows).sort().join() === 'Lychee,Ube', 'a row per plant kind with crops');
// Lychee: 3 crops; weather 2 (wet, frozen); moon 1; colour 1 (gold); wet 1, frozen 1; amber 1; gold 1.
ok(rowEq(rows.Lychee, [3, 2, 1, 1, 1, 0, 1, 0, 0, 1, 1]), `Lychee counted right (${rows.Lychee})`);
// Ube: 3 crops; weather 2; moon 1; colour 2; thunder 2 (struck + charged); dawn 1; gold 1, rainbow 2.
ok(rowEq(rows.Ube, [3, 2, 1, 2, 0, 0, 0, 2, 1, 0, 1, 2]), `Ube counted right (${rows.Ube})`);
ok(plantMutRows(null) === null, 'no plants: nothing');

// A week of readings every 10 minutes, kept to 50, with changes now and then.
const EVERY = 600000;
const KEEP = 50;
const h = [];
const truth = [];
const t0 = Date.parse('2026-10-09T00:00:00Z');
let cur = { Lychee: [3, 1], Ube: [5, 2, 0, 1] };
for (let i = 0; i < 140; i += 1) {
  if (i % 7 === 3) cur = Object.assign({}, cur, { Ube: [5, 3, 1, 2] });
  if (i % 11 === 5) cur = Object.assign({}, cur, { Lychee: [4 + (i % 3), 2] });
  if (i === 60) {
    cur = Object.assign({}, cur);
    delete cur.Lychee; // all harvested
  }
  if (i === 70) cur = Object.assign({}, cur, { Lychee: [2] }); // replanted
  if (i === 90) cur = Object.assign({}, cur, { Sunflower: [8, 8, 0, 3] }); // a new kind
  const t = t0 + i * EVERY;
  // Two updates inside the same 10 minutes: the later one wins.
  pushReading(h, { t, n: 1 }, Object.assign({}, cur, { Ube: [9] }), EVERY, KEEP);
  pushReading(h, { t: t + 1000, n: 1 }, cur, EVERY, KEEP);
  truth.push({ t: t + 1000, rows: JSON.parse(JSON.stringify(cur)) });
}
ok(h.length === KEEP, `kept to ${KEEP} readings (${h.length})`);
ok(Boolean(h[0].sf), 'the first reading kept is a full set');
let exact = true;
for (let i = 0; i < h.length; i += 1) {
  const want = truth.find((x) => x.t === h[i].t);
  const got = plantStateAt(h, i + 1);
  if (!want || JSON.stringify(got) !== JSON.stringify(Object.fromEntries(Object.entries(want.rows)))) {
    exact = false;
    break;
  }
}
ok(exact, 'every reading kept rebuilds to exactly what was recorded');
const stored = h.reduce((a, p) => a + Object.keys(p.s || {}).length, 0);
ok(stored < h.length * 3 * 0.6, `only changed rows are stored (${stored} rows for ${h.length} readings of up to 3 kinds)`);

// Not tracked for a while (an older app), then tracked again: a full set
// starts again, and the untracked readings rebuild as unknown.
const g = [];
pushReading(g, { t: t0, n: 1 }, { A: [1] }, EVERY, KEEP);
pushReading(g, { t: t0 + EVERY, n: 1 }, null, EVERY, KEEP);
pushReading(g, { t: t0 + 2 * EVERY, n: 1 }, { A: [2] }, EVERY, KEEP);
ok(plantStateAt(g, 2) === null, 'a reading without rows is unknown');
ok(g[2].sf === 1 && rowEq(plantStateAt(g, 3).A, [2]), 'tracking again starts with a full set');

console.log(`plant-muts: ${n} checks passed`);
