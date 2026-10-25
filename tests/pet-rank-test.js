'use strict';

// Tests for pet-rank.js (v0.58.0) on the owner's real pets (their sample).
const fs = require('fs');
const path = require('path');
const petRank = require('../pet-rank');

let n = 0;
function ok(cond, what) {
  n += 1;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
}

const SAMPLE = '/mnt/user-data/uploads/garden-sample.json';
let pets = null;
if (fs.existsSync(SAMPLE)) pets = JSON.parse(fs.readFileSync(SAMPLE, 'utf8')).lastStatus.allPets;
if (!pets) pets = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pets.json'), 'utf8'));

const R = petRank.rank(pets, {});
ok(R.families.length > 5, `families found (${R.families.length})`);
ok(R.families.every((f) => f.top.length >= 1 && f.top.length <= 3), 'each family has its top 1-3');
ok(R.families.every((f) => f.top.every((x, i) => i === 0 || x.pct <= f.top[i - 1].pct)), 'each top 3 is strongest first');
ok(R.ranking.length === pets.filter((p) => p.abilities && p.abilities.length).length, 'every pet with an ability is ranked');
ok(R.ranking.every((x, i) => i === 0 || x.value <= R.ranking[i - 1].value), 'the ranking is highest first');
ok(R.ranking.every((x) => x.atMax >= x.value - 1e-9), 'a pet is worth at least as much at its max');
ok(R.levelValue.length <= 3 && R.levelValue.every((x) => x.gain > 0 && x.maxStrength > x.strength), 'level next by value: up to 3 that can grow, with a gain');
ok(R.levelTeam.length <= 3 && R.levelTeam.every((x) => x.gain > 0 && x.team), 'level next by team: up to 3, each naming the team it improves');

// Unticking a family takes it out of every value.
const growth = R.families.find((f) => /growth/i.test(f.name));
if (growth) {
  const off = petRank.rank(pets, { [growth.key]: { on: false, w: growth.w } });
  const g = off.families.find((f) => f.key === growth.key);
  ok(g && g.on === false, `${growth.name} can be unticked`);
  const growers = pets.filter((p) => (p.abilities || []).some((a) => /Growth/i.test(a)));
  const before = R.ranking.filter((x) => growers.some((p) => p.id === x.id)).reduce((s, x) => s + x.value, 0);
  const after = off.ranking.filter((x) => growers.some((p) => p.id === x.id)).reduce((s, x) => s + x.value, 0);
  ok(after < before, `growth pets are worth less with ${growth.name} unticked (${before.toFixed(2)} -> ${after.toFixed(2)})`);
}
// A heavier weight raises a family's pets.
const top = R.families[0];
const heavy = petRank.rank(pets, { [top.key]: { on: true, w: 1 } });
const light = petRank.rank(pets, { [top.key]: { on: true, w: 0.1 } });
const lead = top.top[0].id;
ok(heavy.ranking.find((x) => x.id === lead).value > light.ranking.find((x) => x.id === lead).value, `weight matters: ${top.name}'s best pet is worth more at weight 1 than 0.1`);

// The default weights come from coins (v0.59.0): Rainbow 100%, Gold about half.
{
  const rb = R.families.find((f) => f.key === 'RainbowGranter');
  const gd = R.families.find((f) => f.key === 'GoldGranter');
  ok(rb && rb.w === 1 && rb.on, `Rainbow Granter is 100% by default (${rb && rb.w})`);
  ok(gd && gd.w > 0.4 && gd.w < 0.6, `Gold Granter is about half of Rainbow (${gd && gd.w})`);
  const growth = R.families.find((f) => f.key === 'PlantGrowthBoost');
  if (growth) ok(growth.w < 0.15, `Plant Growth Boost is small next to Rainbow (${growth.w})`);
  ok(R.families.every((f) => f.on), 'every ability counts by default, at its weight');
}

// A pet's own mutation counts (v0.59.3): the owner's Rainbow Pig (1605) is
// first by a clear margin, Rainbow pets get +0.5 and Gold pets +0.2.
{
  const rainbow = pets.find((p) => (p.mutations || []).includes('Rainbow'));
  if (rainbow) {
    ok(R.ranking[0].id === rainbow.id, `the Rainbow pet (${rainbow.name || rainbow.species}) is first`);
    ok(R.ranking[0].mutationBonus === 0.5 && R.ranking[0].value - R.ranking[1].value > 0.5, `by a clear margin (${R.ranking[0].value} vs ${R.ranking[1].value})`);
    const off = petRank.rank(pets, { _petRainbow: { on: false, w: 0.5 } });
    ok(off.ranking.find((x) => x.id === rainbow.id).mutationBonus === 0, 'the Rainbow pet bonus can be switched off');
  }
  ok(R.mutations.length === 2 && R.mutations.every((m) => m.on), 'Rainbow pet and Gold pet both count by default');
}

// Each ranked pet lists its abilities (v0.59.8, the team builder's stats).
ok(R.ranking.every((x) => Array.isArray(x.abilities) && x.abilities.length >= 1 && x.abilities.every((a) => a.name && a.pct >= 0 && a.pct <= 100)), 'every ranked pet lists its abilities with a strength %');
ok(R.ranking[0].abilities[0].name === 'Rainbow Granter', `the top pet's leading ability is ${R.ranking[0].abilities[0].name}`);

// The panel shows tier and the real effect, not the internal share (v0.59.9).
{
  const sell = R.families.find((f) => f.key === 'SellBoost');
  if (sell) ok(sell.top.every((x) => /^(I|II|III|IV)$/.test(x.tier) && /sell/i.test(x.text)), `Sell Boost entries carry their tier and effect (${sell.top.map((x) => `${x.tier}: ${x.text}`).join(' | ')})`);
  ok(R.families.every((f) => f.top.every((x) => typeof x.text === 'string' && x.text.length > 3)), 'every top-3 entry says what the ability does');
  ok(R.ranking.every((x) => x.best.every((b) => b.text)), 'every pet\'s best abilities say what they do');
}

// Which eggs to hunt (v0.61.1).
{
  const pd = require('../pet-data');
  const H = petRank.eggHunt(R, pd.allEggs(), pets);
  ok(H.eggs.length >= 8 && H.eggs.every((e) => e.species.length >= 2), `every egg listed with what it hatches (${H.eggs.length})`);
  ok(H.eggs.every((e, i) => i === 0 || (e.est == null ? -1 : e.est) <= (H.eggs[i - 1].est == null ? -1 : H.eggs[i - 1].est)), 'best estimated egg first');
  const rare = H.eggs.find((e) => e.id === 'RareEgg');
  const pig = rare && rare.species.find((s) => s.species === 'Pig');
  ok(pig && pig.odds === 65 && pig.have === pets.filter((p) => p.species === 'Pig').length && pig.best >= 140, `Rare Egg: Pig at 65%, all ${pig && pig.have} of your Pigs counted, best ${pig && pig.best} PP`);
  ok(rare.never.includes('Cow') === !pets.some((p) => p.species === 'Cow'), 'kinds you never had are marked');
  ok(rare.known < 100 || rare.never.length === 0, 'an egg with unknown kinds says how much its estimate covers');
  ok(H.gaps.length >= 1 && H.gaps.every((g) => g.team.length === 3 && Array.isArray(g.eggs)), `gaps found (${H.gaps.map((g) => `${g.name} [${g.team.join(',')}] -> ${g.eggs.join(', ') || 'no egg seen yet'}`).join(' | ')})`);
  console.log('  eggs:', H.eggs.slice(0, 5).map((e) => `${e.name} ~${e.est} PP/hatch (covers ${e.known}%; never had: ${e.never.join(', ') || 'none'})`).join(' | '));
}

// Late-game weights (v0.70.0, the owner's meta): the weather slot is saved
// for Thunderstruck -> Thundercharged and the moon slot for Amberbound.
{
  const av = require('../ability-value');
  const base = av.defaultWeights();
  const late = av.defaultWeights('late');
  ok(late.FrostGranter === 0 && late.RainGranter === 0 && late.SnowGranter === 0, 'late: Frost, Rain and Snow Granters count for nothing');
  ok(base.FrostGranter > 0.1, 'early/mid: Frost Granter still counts (' + base.FrostGranter + ')');
  ok(late.ThunderstruckGranter > base.ThunderstruckGranter && late.Thundercharger > base.Thundercharger, 'late: Thunderstruck Granter and Thundercharger count more');
  ok(late.AmberlitGranter > base.AmberlitGranter && late.AmberlitGranter > late.DawnlitGranter, 'late: Amberlit above Dawnlit');
  ok(late.DawnlitGranter > 0 && late.DawnlitGranter < base.DawnlitGranter, 'late: Dawnlit small but not nothing (Dawn captures)');
  ok(late.RainbowGranter === 1 && late.GoldGranter === base.GoldGranter, 'late: Rainbow still 100%, Gold unchanged');
  const RL = petRank.rank(pets, {}, { stage: 'late' });
  ok(RL.stage === 'late' && (RL.families.find((f) => f.key === 'FrostGranter') || { defaultWeight: 0 }).defaultWeight === 0, 'the ranking says which stage and uses its weights');
  const RM = petRank.rank(pets, {}, { stage: 'mid' });
  ok(RM.stage === 'mid', 'mid stage passed through');
}
console.log(`pet-rank: ${n} checks passed`);
console.log('  top families:', R.families.slice(0, 4).map((f) => `${f.name} (${Math.round(f.w * 100)}%): ${f.top.map((x) => `${x.species} ${x.pct}%`).join(', ')}`).join(' | '));
console.log('  top 5 pets:', R.ranking.slice(0, 5).map((x) => `${x.species} ${x.value.toFixed(2)}`).join(', '));
console.log('  level next (value):', R.levelValue.map((x) => `${x.species} +${x.gain.toFixed(2)} (${x.strength}->${x.maxStrength})`).join(', '));
console.log('  level next (team):', R.levelTeam.map((x) => `${x.species} +${x.gain.toFixed(2)} ${x.team}`).join(', '));
