'use strict';

// Cute pet names (v0.76.0; v0.77.0 bigger, with ranks): the lists are safe
// for the game's name box; the picker never repeats a name you have or gave
// lately, keeps thousands of hatches varied, gives your best pets grand
// names and Gold / Rainbow pets their own.
const assert = require('assert');
const N = require('../pet-names');
const petData = require('../pet-data');

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks += 1;
};
// A repeatable "random": a small LCG.
const seeded = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const norm = N.norm;
const SAFE = /^[A-Za-z]+( [A-Za-z]+)*$/;

// 1. Every listed name: letters and single spaces, 2-12 characters; no
//    repeats within a list.
const lists = [['generic', N.GENERIC], ['fancy', N.FANCY], ['grand', N.GRAND]]
  .concat(Object.entries(N.BY_SPECIES))
  .concat(Object.entries(N.BY_MUTATION).flatMap(([k, M]) => [[k + ' names', M.names], [k + ' grand', M.grand]]));
for (const [k, list] of lists) {
  ok(Array.isArray(list) && list.length >= 10, `${k}: at least 10 names`);
  for (const n of list) ok(SAFE.test(n) && n.length >= 2 && n.length <= N.MAX, `${k}: "${n}" letters/spaces, 2-12`);
  ok(new Set(list.map(norm)).size === list.length, `${k}: no repeats`);
}
for (const t of N.CUTE_ADJ.concat(N.LOW_TITLES, N.MID_TITLES, N.GRAND_TITLES, N.BY_MUTATION.gold.adjectives, N.BY_MUTATION.rainbow.adjectives)) ok(/^[A-Za-z]+$/.test(t), `title ${t}`);
ok(N.GENERIC.length >= 300, `a big general list: ${N.GENERIC.length}`);
ok(N.poolSize() >= 8000, `thousands of names in all: ${N.poolSize()}`);

// 2. Every species the app knows has a list (directly or by another name).
for (const sp of Object.keys(petData.PETS)) {
  const k = norm(sp);
  ok(N.BY_SPECIES[k] || N.BY_SPECIES[N.ALIASES[k]], `a list for ${sp}`);
}

// 3. Thousands of hatches: 5,000 names in a row, each avoiding the last
//    1,500 given (what main.js keeps). No repeat inside that window, every
//    name safe, plenty different overall, and late on still a mix of plain
//    names and two-word ones.
{
  const r = seeded(11);
  const given = [];
  const species = Object.keys(petData.PETS);
  let repeats = 0;
  for (let i = 0; i < 5000; i += 1) {
    const recent = given.slice(-1500);
    const tier = i % 10 === 0 ? 'top' : i % 3 === 0 ? 'high' : 'normal';
    const mutations = i % 25 === 0 ? ['Rainbow'] : i % 7 === 0 ? ['Gold'] : [];
    const n = N.pick({ species: species[i % species.length], mutations }, { tier, taken: recent, rand: r });
    if (recent.map(norm).includes(norm(n))) repeats += 1;
    if (!(SAFE.test(n) || / \d+$/.test(n)) || n.length > N.MAX + 6) repeats += 1000;
    given.push(n);
  }
  ok(repeats === 0, `no repeats within the last 1,500 (and all safe): ${repeats}`);
  const distinct = new Set(given.map(norm)).size;
  ok(distinct >= 3300, `5,000 hatches, ${distinct} different names`);
  const late = given.slice(3000);
  const plain = late.filter((n) => !/ /.test(n) || N.GENERIC.includes(n)).length;
  ok(plain > 300 && plain < 1500, `late on, still plenty of plain names: ${plain}/2000`);
  ok(given.filter((n) => / \d+$/.test(n)).length === 0, 'never had to fall back to numbers');
}

// 4. Never a name you have, whatever the case or spacing.
{
  const taken = N.GENERIC.slice(0, 290).map((n) => n.toUpperCase().replace(/ /g, ''));
  for (let i = 0; i < 300; i += 1) {
    const n = N.pick({ species: 'Worm' }, { taken, rand: seeded(i) });
    ok(!taken.map(norm).includes(norm(n)), `not taken: ${n}`);
  }
}

// 5. Ranks: your best pets mostly get grand names or rulers' titles, the
//    next ones fancy names or noble titles, the rest neither.
{
  const r = seeded(5);
  const isGrand = (n) => N.GRAND.includes(n) || N.GRAND_TITLES.some((t) => n.startsWith(t + ' '));
  const isFancy = (n) => N.FANCY.includes(n) || N.MID_TITLES.some((t) => n.startsWith(t + ' '));
  const count = (tier, test) => {
    let c = 0;
    for (let i = 0; i < 400; i += 1) if (test(N.pick({ species: 'Turtle' }, { tier, rand: r }))) c += 1;
    return c;
  };
  const topGrand = count('top', isGrand);
  const highFancy = count('high', isFancy);
  const normalGrand = count('normal', isGrand);
  const normalFancy = count('normal', isFancy);
  ok(topGrand > 260, `top: grand ${topGrand}/400`);
  ok(highFancy > 200, `high: fancy ${highFancy}/400`);
  ok(normalGrand < 12 && normalFancy < 24, `normal: grand ${normalGrand}, fancy ${normalFancy} (only by coincidence of a shared name)`);
}

// 6. Gold and Rainbow pets mostly get their own names; the best of them the
//    grand ones; species lists still show up.
{
  const r = seeded(7);
  const mine = (M, n) => M.names.includes(n) || M.grand.includes(n) || M.adjectives.some((a) => n.startsWith(a + ' '));
  let rb = 0;
  let gd = 0;
  let pig = 0;
  let topRb = 0;
  for (let i = 0; i < 400; i += 1) {
    if (mine(N.BY_MUTATION.rainbow, N.pick({ species: 'Pig', mutations: ['Rainbow'] }, { rand: r }))) rb += 1;
    if (mine(N.BY_MUTATION.gold, N.pick({ species: 'Turtle', mutations: ['Gold'] }, { rand: r }))) gd += 1;
    if (N.BY_SPECIES.pig.includes(N.pick({ species: 'Pig' }, { rand: r }))) pig += 1;
    if (N.BY_MUTATION.rainbow.grand.includes(N.pick({ species: 'Pig', mutations: ['Rainbow'] }, { tier: 'top', rand: r }))) topRb += 1;
  }
  ok(rb > 260 && rb < 340, `rainbow ~75%: ${rb}/400`);
  ok(gd > 260 && gd < 340, `gold ~75%: ${gd}/400`);
  ok(pig > 100 && pig < 190, `species ~35%: ${pig}/400`);
  ok(topRb > 140, `best Rainbow pets: grand ${topRb}/400`);
  ok(N.BY_SPECIES.caribou.includes(N.pick({ species: 'WhiteCaribou' }, { taken: N.GENERIC.concat(N.SHORT.map((b) => b + ' Jr')), rand: () => 0.1 })), 'White Caribou uses the caribou list');
}

// 7. Everything taken: still a name, still unique.
{
  const all = new Set();
  for (const [, list] of lists) for (const n of list) all.add(n);
  for (const t of N.LOW_TITLES.concat(N.MID_TITLES)) for (const b of N.SHORT) if (`${t} ${b}`.length <= N.MAX) all.add(`${t} ${b}`);
  const taken = [...all];
  const n1 = N.pick({ species: 'Pig', mutations: ['Gold'] }, { taken, rand: seeded(3) });
  ok(!taken.map(norm).includes(norm(n1)), `free when nearly all taken: ${n1}`);
  const n2 = N.pick({ species: 'Pig' }, { taken: taken.concat([n1]), rand: seeded(3) });
  ok(n2 !== n1 && !taken.map(norm).includes(norm(n2)), `and the next one differs: ${n2}`);
  ok(typeof N.pick({ species: 'Unknownling' }, {}) === 'string', 'an unknown species still gets a name');
}

console.log(`pet-names: ${checks} checks passed`);
