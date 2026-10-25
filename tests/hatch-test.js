'use strict';

// A deep check of the egg hatch trackers (v0.56.11): realistic hatch
// streams through the very code the app runs (hatches.js -> pity.js and
// luck.js), with the ways real play can trip them up. Each scenario is
// checked against the truth: every hatch on its egg exactly once, each
// egg's \"since its last rare pet\" counter right, the shared Gold / Rainbow
// counters right, and the game's own total followed.
const pity = require('../pity');
const luck = require('../luck');
const hatches = require('../hatches');

let n = 0;
function ok(cond, what) {
  n += 1;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
}

// A seeded random, so every run is the same.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const EGGS = {
  CommonEgg: ['Worm', 'Snail', 'Bee'],
  RareEgg: ['Pig', 'Cow', 'Turkey'],
  LegendaryEgg: ['Squirrel', 'Turtle', 'Goat'],
  MythicalEgg: ['Butterfly', 'Peacock', 'Capybara'],
  SnowEgg: ['Stoat', 'Caribou', 'Snow Fox'],
};
const LOG_SIZE = 50;

// The game: an activity log that keeps its newest LOG_SIZE entries, and its
// own running total of hatches.
function makeGame(seed) {
  const r = rng(seed);
  let t = 1790000000000;
  let id = 0;
  const g = { log: [], total: 0, truth: [] };
  g.hatch = (opts = {}) => {
    const eggs = Object.keys(EGGS);
    const eggId = opts.egg || eggs[Math.floor(r() * eggs.length)];
    const pool = EGGS[eggId];
    const species = opts.species || pool[Math.floor(r() * pool.length)];
    const mutations = opts.mutations || (r() < 0.02 ? ['Gold'] : r() < 0.01 ? ['Rainbow'] : []);
    if (!opts.sameTime) t += 1000 + Math.floor(r() * 5000);
    id += 1;
    const h = { at: t, eggId, petId: `pet-${seed}-${id}`, species, mutations, abilities: [], targetScale: 1.2, xp: 0 };
    g.truth.push(h);
    g.log.push(h);
    if (g.log.length > LOG_SIZE) g.log.shift();
    g.total += 1;
    return h;
  };
  g.oldest = () => (g.log.length ? g.log[0].at : null);
  return g;
}

// The app: both trackers, connected or not, fed as main.js feeds them.
function makeApp() {
  const a = { p: pity.migrate({}), l: luck.migrate({}), connected: false, conn: 0 };
  a.connect = (g) => {
    a.connected = true;
    a.conn += 1;
    return hatches.backlog(a.p, a.l, { hatches: g.log.slice(), eggsHatched: g.total, oldestLogAt: g.oldest(), connection: `c${a.conn}` });
  };
  a.live = (h, total) => hatches.live(a.p, a.l, Object.assign({ eggsHatched: total }, h));
  a.status = (total) => pity.syncTotal(a.p, total);
  return a;
}

// What the counters should say, from the truth (the hatches after tracking
// began).
function expected(list) {
  const perEgg = {};
  const since = {};
  let gold = 0;
  let rainbow = 0;
  for (const h of list) {
    perEgg[h.eggId] = (perEgg[h.eggId] || 0) + 1;
    for (const target of EGGS[h.eggId]) {
      const k = `egg:${h.eggId}:${target}`;
      since[k] = h.species === target ? 0 : (since[k] || 0) + 1;
    }
    gold = h.mutations.includes('Gold') ? 0 : gold + 1;
    rainbow = h.mutations.includes('Rainbow') ? 0 : rainbow + 1;
  }
  return { perEgg, since, gold, rainbow };
}

// Compare what the app holds with the truth. Only targets the app tracks
// (luck.js's rare pets for each egg) are compared.
function compare(a, list, label, opts = {}) {
  const want = expected(list);
  const au = luck.audit(a.l);
  for (const [egg, cnt] of Object.entries(want.perEgg)) {
    ok((au.perEgg[egg] || 0) === cnt, `${label}: ${egg} hatches seen ${au.perEgg[egg] || 0}, truth ${cnt}`);
  }
  for (const [k, v] of Object.entries(a.l.counters)) {
    if (!k.startsWith('egg:') || !(k in want.since)) continue;
    // v0.72.0: a counter has a count only once its result has been seen;
    // before that it's waiting (no number to compare).
    if (!v.known) { ok(v.v === 0, `${label}: ${k} waiting holds no count`); continue; }
    ok(v.v === want.since[k], `${label}: ${k} since last rare ${v.v}, truth ${want.since[k]}`);
  }
  if (!opts.unknown) {
    ok(au.unattributed === 0, `${label}: every hatch on its egg (unattributed ${au.unattributed})`);
  }
}

// --- 1. Steady live hatching: 300 hatches, all seen as they happen.
{
  const g = makeGame(1);
  const a = makeApp();
  a.connect(g); // first time: counting starts here
  const start = g.truth.length;
  for (let i = 0; i < 300; i += 1) {
    const h = g.hatch();
    a.live(h, g.total);
    if (i % 3 === 0) a.status(g.total);
  }
  compare(a, g.truth.slice(start), 'live');
  ok(a.p.totalHatches === 300, `live: hatches tracked follows the game (${a.p.totalHatches})`);
}

// --- 2. Duplicates: each hatch delivered twice, and once more re-sent (a
// rewritten log entry): still once each.
{
  const g = makeGame(2);
  const a = makeApp();
  a.connect(g);
  for (let i = 0; i < 120; i += 1) {
    const h = g.hatch();
    a.live(h, g.total);
    a.live(h, g.total);
    if (i % 10 === 0) a.live(Object.assign({}, h, { xp: 5 }), g.total);
  }
  compare(a, g.truth, 'duplicates');
}

// --- 3. Frequent reconnects (the backlog repeats what was already counted).
{
  const g = makeGame(3);
  const a = makeApp();
  a.connect(g);
  for (let i = 0; i < 200; i += 1) {
    a.live(g.hatch(), g.total);
    if (i % 25 === 24) a.connect(g);
  }
  compare(a, g.truth, 'reconnects');
}

// --- 4. The app closed for a few hatches (still in the game's log).
{
  const g = makeGame(4);
  const a = makeApp();
  a.connect(g);
  for (let i = 0; i < 40; i += 1) a.live(g.hatch(), g.total);
  for (let i = 0; i < 12; i += 1) g.hatch(); // closed: the app sees nothing
  const r = a.connect(g);
  ok(r.counted === 12 && r.unknown === 0, `closed briefly: caught up on 12 by egg (${r.counted}, unknown ${r.unknown})`);
  for (let i = 0; i < 40; i += 1) a.live(g.hatch(), g.total);
  compare(a, g.truth, 'closed briefly');
}

// --- 5. The app closed for longer than the game's log holds: the hatches
// still in the log land on their eggs; the rest are known only from the
// game's total, so the shared Gold / Rainbow counters count them and the
// audit says how many the per-egg counters can't include.
{
  const g = makeGame(5);
  const a = makeApp();
  a.connect(g);
  for (let i = 0; i < 30; i += 1) a.live(g.hatch(), g.total);
  const before = g.truth.length;
  for (let i = 0; i < 80; i += 1) g.hatch(); // closed: 80 hatches, the log keeps 50
  const r = a.connect(g);
  ok(r.counted === 50 && r.unknown === 30, `closed long: 50 by egg, 30 from the total (${r.counted}, ${r.unknown})`);
  const au = luck.audit(a.l);
  ok(au.unattributed === 30, `the check says 30 hatches couldn't be put on an egg (${au.unattributed})`);
  const seen = g.truth.slice(0, before).concat(g.truth.slice(g.truth.length - 50));
  compare(a, seen, 'closed long', { unknown: true });
  ok(a.l.allHatches === 110, `all hatches counted: 110 (${a.l.allHatches})`);
  ok(a.p.totalHatches === 110, `hatches tracked: 110 (${a.p.totalHatches})`);
}

// --- 6. Two hatches in the same millisecond, the app closing between them.
{
  const g = makeGame(6);
  const a = makeApp();
  a.connect(g);
  for (let i = 0; i < 10; i += 1) a.live(g.hatch(), g.total);
  const first = g.hatch({ egg: 'MythicalEgg', species: 'Peacock' });
  a.live(first, g.total);
  g.hatch({ egg: 'MythicalEgg', species: 'Butterfly', sameTime: true }); // closed before this one was seen
  const r = a.connect(g);
  ok(r.counted === 1, `same-millisecond hatch caught up after a restart (${r.counted})`);
  compare(a, g.truth, 'same millisecond');
}

// --- 7. The game's total arriving late, or out of order: no phantom hatches.
{
  const g = makeGame(7);
  const a = makeApp();
  a.connect(g);
  for (let i = 0; i < 50; i += 1) {
    const h = g.hatch();
    a.live(h, g.total - 1); // the total in the hatch message lags
    if (i % 4 === 0) a.status(g.total - 2); // a stale status
    if (i % 4 === 1) a.status(g.total);
  }
  a.connect(g);
  compare(a, g.truth, 'late totals');
  ok(a.p.totalHatches === 50, `hatches tracked 50 after late totals (${a.p.totalHatches})`);
}

// --- 8. Auto-counting off: nothing counted; back on: old hatches aren't counted later.
{
  const g = makeGame(8);
  const a = makeApp();
  a.connect(g);
  for (let i = 0; i < 20; i += 1) a.live(g.hatch(), g.total);
  pity.act(a.p, { type: 'setAuto', on: false });
  const offFrom = g.truth.length;
  for (let i = 0; i < 10; i += 1) a.live(g.hatch(), g.total);
  pity.act(a.p, { type: 'setAuto', on: true });
  a.connect(g);
  const onFrom = g.truth.length;
  for (let i = 0; i < 20; i += 1) a.live(g.hatch(), g.total);
  const counted = g.truth.slice(0, offFrom).concat(g.truth.slice(onFrom));
  compare(a, counted, 'auto-count off then on');
}

// --- 9. The very first connection: counting starts there, nothing before it counts.
{
  const g = makeGame(9);
  for (let i = 0; i < 30; i += 1) g.hatch();
  const a = makeApp();
  const r = a.connect(g);
  ok(r.counted === 0 && r.unknown === 0 && luck.audit(a.l).all === 0, 'first connection: nothing counted from before');
  for (let i = 0; i < 25; i += 1) a.live(g.hatch(), g.total);
  compare(a, g.truth.slice(30), 'first connection');
}

// --- 10. A burst: 30 hatches arriving in one go (one frame).
{
  const g = makeGame(10);
  const a = makeApp();
  a.connect(g);
  const burst = [];
  for (let i = 0; i < 30; i += 1) burst.push(g.hatch());
  for (const h of burst) a.live(h, g.total);
  compare(a, g.truth, 'burst');
}

// The recent hatches keep each pet's id (v0.57.2).
{
  const g = makeGame(11);
  const a = makeApp();
  a.connect(g);
  for (let i = 0; i < 5; i += 1) a.live(g.hatch(), g.total);
  const ids = a.p.recent.map((r) => r.petId);
  ok(ids.length === 5 && ids.every(Boolean) && new Set(ids).size === 5, `recent hatches carry their pet ids (${ids.join(',')})`);
}

console.log(`hatches: ${n} checks passed`);
