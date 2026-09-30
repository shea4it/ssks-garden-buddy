'use strict';

// Tests for sell-team.js: the best three pets for selling, the Capybara's
// Double Harvest and Crop Refund counted, the team following pets' strength,
// and who's out worked out fresh even when the maths is cached.
const abilityData = require('../ability-data');
const sellTeam = require('../sell-team');

let n = 0;
function ok(cond, what) {
  n += 1;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
}

// A pet as main.js describes it: its abilities at its strength.
function pet(id, species, abilities, strength, where) {
  return {
    id,
    species,
    speciesName: species,
    abilities,
    strength,
    where,
    abilityInfo: abilities.map((x) => Object.assign(abilityData.describe(abilityData.lookup(x), strength), { gameId: x })),
  };
}

// The owner's sell pets from their sample (v0.54.2): two Pigs with Sell Boost
// II (89, 99), three Peacocks with Sell Boost IV (54, 56, 56) and a Capybara
// with Double Harvest and Crop Refund (the game's ProduceRefund) at 79, in
// the hutch.
const owner = () => [
  pet('pig1', 'Pig', ['SellBoostII'], 89, 'out'),
  pet('pig2', 'Pig', ['SellBoostII'], 99, 'out'),
  pet('pea1', 'Peacock', ['SellBoostIV'], 54, 'hutch'),
  pet('pea2', 'Peacock', ['SellBoostIV'], 56, 'hutch'),
  pet('pea3', 'Peacock', ['SellBoostIV'], 56, 'inventory'),
  pet('capy', 'Capybara', ['ProduceRefund', 'DoubleHarvest'], 79, 'hutch'),
  pet('snail', 'Snail', ['CoinFinderI'], 100, 'out'),
];

// 1. The Capybara's numbers count, and win it a place.
{
  const t = sellTeam.idealSellTeam(owner());
  const capy = t.pets.find((p) => p.id === 'capy');
  ok(capy && capy.dh > 0 && capy.refund > 0, 'the Capybara is on the team with Double Harvest and Crop Refund');
  ok(t.dh > 0 && t.refund > 0, 'the team counts Double Harvest and Crop Refund');
  ok(t.pets.map((p) => p.id).sort().join(',') === 'capy,pig1,pig2', `the owner's team is Pig, Pig, Capybara (got ${t.pets.map((p) => p.species).join(', ')})`);
  ok(Math.abs(t.petPart - (1 + t.sellPct / 100) * ((1 + t.dh / 100) / (1 - t.refund / 100))) < 1e-9, 'the multiplier is (1 + sell)(1 + DH) / (1 - refund)');
  ok(!t.pets.some((p) => p.id === 'snail'), 'a pet that does nothing for a sale is never on it');
}

// 2. It follows strength: a Peacock grown to 100 takes a place.
{
  const before = sellTeam.idealSellTeam(owner());
  const grown = owner();
  grown[2] = pet('pea1', 'Peacock', ['SellBoostIV'], 100, 'hutch');
  const after = sellTeam.idealSellTeam(grown);
  ok(after.pets.some((p) => p.id === 'pea1'), 'a Peacock at strength 100 joins the team');
  ok(after.petPart > before.petPart, 'and the multiplier goes up');
}

// 3. Who's out is fresh even when the maths is cached: the Capybara moved
// from the hutch to out (its numbers don't change).
{
  const t1 = sellTeam.idealSellTeam(owner());
  ok(!t1.allOut && t1.notOut.includes('Capybara'), 'with the Capybara in the hutch, it says so');
  const moved = owner();
  moved[5] = Object.assign({}, moved[5], { where: 'out' });
  const t2 = sellTeam.idealSellTeam(moved);
  ok(t2.allOut && t2.notOut.length === 0, 'once it is out, all of the team is out');
  ok(t2.petPart === t1.petPart, 'the maths is the same (from the cache)');
}

// 4. The pets out now, from their rows, count the same way.
{
  const team = owner().filter((p) => ['pig1', 'pig2', 'capy'].includes(p.id));
  const rows = abilityData.summarise(team, { weatherMatches: () => false }).rows;
  const now = sellTeam.fromRows(rows);
  const best = sellTeam.idealSellTeam(owner());
  ok(Math.abs(now.petPart - best.petPart) < 1e-9, 'the same three out now give the same multiplier');
  ok(sellTeam.fromRows([]).petPart === 1, 'no pets out: no bonus');
}

// 5. No sell pets at all: no bonus and nobody named.
{
  const t = sellTeam.idealSellTeam([pet('w', 'Worm', ['SeedFinderI'], 50, 'out')]);
  ok(t.petPart === 1 && t.pets.length === 0 && !t.allOut, 'no sell pets: x1, nobody, nothing to put out');
}

console.log(`sell-team: ${n} checks passed`);
