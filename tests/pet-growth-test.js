'use strict';
// Time to max strength (v0.66.0), on the owner's pets (16 Oct 2026 sample):
// two Peacocks with XP Boost II out at STR 58 and 56 (max 86), and a Pig.
const g = require('../pet-growth');
const fx = require('./fixtures/pets-1016.json');

let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  n += 1;
};
const all = fx.allPets;
const active = all.filter((p) => fx.active.includes(p.id));

// XP Boost II: 35% x STR a minute, 400 x STR XP to every pet out.
const team = g.xpBoost(active, 'clear');
const want = 0.35 * 0.58 * 400 * 0.58 + 0.35 * 0.56 * 400 * 0.56;
ok(Math.abs(team.perMin - want) < 1e-6 && team.who.length === 2, `the two Peacocks out: ${team.perMin.toFixed(1)} XP a minute`);
ok(g.xpBoost([{ strength: 100, abilities: ['ThunderXpBoost'] }], 'clear').perMin === 0, 'a thunder XP Boost on a clear day: nothing');
ok(Math.abs(g.xpBoost([{ strength: 100, abilities: ['ThunderXpBoost'] }], 'thunder').perMin - 0.65 * 650) < 1e-6, 'and in a thunderstorm: 422.5');

// Best two always-on XP Boost pets at max: his Peacocks at 86.
const best = g.bestBoost(all);
ok(best.ids.length === 2 && Math.abs(best.perMin - 2 * 0.35 * 0.86 * 400 * 0.86) < 1e-6, `best: two Peacocks at 86 (${best.perMin.toFixed(1)})`);

const v = g.view(all, active, 'clear');
const pea = v.rows.find((r) => r.id === fx.active[0]);
ok(pea && pea.out && pea.strength === 58 && pea.max === 86, 'a Peacock out is listed');
ok(Math.abs(pea.hoursBase - 134.27) < 0.01, `out and fed alone: ${pea.hoursBase.toFixed(1)} h`);
const expectTeam = (pea.hoursBase * 3600) / (60 + want) / 60;
ok(Math.abs(pea.hoursTeam - expectTeam) < 1e-6 && pea.hoursTeam < pea.hoursBase / 1.5, `with the team's XP Boost: ${pea.hoursTeam.toFixed(1)} h`);
ok(pea.hoursBest === null, 'one of the best XP pets itself: no "with your best" line');
ok(v.rows[0].out && v.rows.every((r) => r.strength < r.max), 'pets out first; only pets still growing');
const other = v.rows.find((r) => !r.out);
ok(other && other.hoursBest > 0 && other.hoursBest < other.hoursBase, 'others: how long with your best XP pets out');
ok(v.rows.some((r) => r.nocturnal) || !all.some((p) => /bat|platypus|redfox/i.test(p.species)), 'nocturnal pets are marked');
ok(!v.rows.some((r) => r.id === 'af34dfa1-de9e-4469-b189-143242e2dd85'), 'the maxed Pig is not listed');
console.log(`pet-growth: ${n} checks passed`);
