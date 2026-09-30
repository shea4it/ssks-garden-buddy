'use strict';

// Tests for pet-plan.js: which pet to level next.
const plan = require('../pet-plan');

let n = 0;
function ok(cond, what) {
  n += 1;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
}

const pet = (id, species, abilities, strength, maxStrength, hoursToMax, where = 'hutch') => ({ id, species, speciesName: species, abilities, strength, maxStrength, hoursToMax, where });

// A higher tier is the same line and wins: Sell Boost IV over III.
{
  const fam = plan.families();
  ok(fam.SellBoostIV.key === 'SellBoost' && fam.SellBoostIII.key === 'SellBoost', 'Sell Boost I-IV are one family');
  const r = plan.recommend([pet('pig', 'Pig', ['SellBoostIII'], 100, 100, 0, 'out'), pet('pea', 'Peacock', ['SellBoostIV'], 50, 100, 48)]);
  ok(r.picks.length === 1 && r.picks[0].id === 'pea', 'a Peacock that would take Sell Boost IV past the Pig\'s III is the pick');
  ok(r.picks[0].reasons[0].now.pet === 'Pig', 'and it says whose best it beats');
  const weak = plan.recommend([pet('pig', 'Pig', ['SellBoostIV'], 100, 100, 0, 'out'), pet('p2', 'Pig', ['SellBoostII'], 50, 100, 48)]);
  ok(weak.picks.length === 0, 'levelling a Sell Boost II can\'t beat an owned IV at full strength: nothing to recommend');
}

// Tiers only merge when the numbers rise with tier: Seed Finder IV (rarer
// seeds, a lower number) stands alone.
{
  const fam = plan.families();
  ok(fam.SeedFinderIV.key !== fam.SeedFinderI.key, 'Seed Finder tiers are separate families');
}

// A pet at max is never a pick; nor one with no hours left.
{
  const r = plan.recommend([pet('a', 'Snail', ['GoldGranter'], 93, 93, 0, 'out')]);
  ok(r.picks.length === 0 && r.toLevel === 0, 'nothing to level when every pet is at max');
}

// The account's only one of something: levelling it grows the account's best.
{
  const r = plan.recommend([pet('r', 'Pig', ['RainbowGranter'], 40, 90, 72)]);
  ok(r.picks.length === 1 && r.picks[0].reasons[0].now && r.picks[0].reasons[0].now.same === true, 'the only Rainbow Granter, levelled: recommended, as already the best and growing');
}

// Picks build on each other: two identical pets aren't both worth levelling.
{
  const r = plan.recommend([pet('p1', 'Peacock', ['SellBoostIV'], 50, 90, 100), pet('p2', 'Peacock', ['SellBoostIV'], 50, 90, 100), pet('b', 'Bat', ['CoinFinderIII'], 40, 90, 50)]);
  const ids = r.picks.map((p) => p.id);
  ok(ids.filter((x) => x === 'p1' || x === 'p2').length === 1, `only one of two identical Peacocks is recommended (${ids.join(', ')})`);
  ok(ids.includes('b'), 'and the next pick is something else worth doing');
}

// Time counts, but a big upgrade isn't buried by a tiny quick one.
{
  const r = plan.recommend([pet('capy', 'Capybara', ['CropRefund', 'DoubleHarvest'], 79, 81, 8), pet('pea', 'Peacock', ['SellBoostIV'], 30, 86, 144)]);
  ok(r.picks[0].id === 'pea', 'the Peacock\'s big Sell Boost IV comes before the Capybara\'s tiny quick gain');
  ok(r.picks.some((p) => p.id === 'capy') || (r.quick && r.quick.id === 'capy'), 'the Capybara still shows (as a pick or the quick win)');
}

// An ability that only works in some weather counts a quarter.
{
  const always = plan.petFamilies(pet('x', 'X', ['CoinFinderIII'], 100, 100, 0), 100);
  const snowy = plan.petFamilies(pet('y', 'Y', ['SnowCoinFinder'], 100, 100, 0), 100);
  const sc = Object.values(snowy)[0];
  ok(Object.values(always)[0].score > 0 && sc && sc.score > 0, 'both have a score');
  const raw = require('../ability-data').describe(require('../ability-data').lookup('SnowCoinFinder'), 100).score;
  ok(Math.abs(sc.score - raw * 0.25) < 1e-6, 'the Snow-only one counts a quarter of its number');
}

console.log(`pet-plan: ${n} checks passed`);
