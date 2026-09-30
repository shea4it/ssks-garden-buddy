'use strict';

/* Which pet to level next (v0.54.5).
 *
 * For every ability line (a "family": Sell Boost I-IV, Coin Finder I-IV,
 * Gold Granter, ...) the account's best is the strongest one any pet has, at
 * its strength now; a higher tier naturally scores more (Sell Boost IV beats
 * III). Levelling a pet takes it from its strength now to its max. For each
 * pet that isn't at max yet: in which families would it become the account's
 * new best, and by how much? Each family's gain is measured against the most
 * that family can give (its best tier at full strength), so percentages and
 * chances compare fairly, then weighted by how much that family matters
 * (Rainbow and Gold first, then selling and crop size, ...). Pets are ranked
 * by gain / sqrt(days of levelling): time counts, but less than in
 * proportion, so a big upgrade isn't buried under tiny quick ones (per day
 * alone put a Capybara 8 hours from 79 -> 81 above a Peacock whose Sell
 * Boost IV would lead the account). The best quick one (gain per day) is
 * given too, as `quick`, when it isn't already a pick.
 *
 * Wrinkles: a family is only merged across tiers when the numbers rise with
 * tier (Seed Finder IV finds rarer seeds, so its number is lower: its tiers
 * stand alone); an ability that only works in some weather counts a quarter.
 */

const abilityData = require('./ability-data');

// How much each kind of benefit matters, by the ability's goal; a few
// families get their own. Tunable.
const WEIGHTS = {
  rainbow: 1, gold: 0.8, sell: 0.7, size: 0.6,
  weatherBoost: 0.45, 'grant:Thunderstruck': 0.5, 'grant:Amberlit': 0.5, 'grant:Frozen': 0.4, 'grant:Dawnlit': 0.3, 'grant:Wet': 0.25, 'grant:Chilled': 0.25,
  special: 0.45, petMutation: 0.4, growth: 0.35, maxStrength: 0.35, doubleHatch: 0.35,
  coins: 0.3, eggs: 0.3, xp: 0.3, seeds: 0.3, hatchXp: 0.25, hunger: 0.15,
};
const FAMILY_WEIGHTS = { CropEater: 0.15, DustBoost: 0.2, PetRefund: 0.25, Copycat: 0 };
const WEATHER_SHARE = 0.25;
const TOP = 100; // full strength, for each family's most

// Families: ability ids by line, and each family's most (best tier at TOP).
let FAMILIES = null;
function families() {
  if (FAMILIES) return FAMILIES;
  const lines = {};
  for (const id of Object.keys(abilityData.ABILITIES)) {
    const base = id.replace(/(IV|III|II|I)$/, '');
    (lines[base] = lines[base] || []).push(id);
  }
  const fam = {};
  const tierOf = (id) => ({ I: 1, II: 2, III: 3, IV: 4 }[(id.match(/(IV|III|II|I)$/) || [])[1]] || 0);
  for (const [base, ids] of Object.entries(lines)) {
    const scored = ids.map((id) => ({ id, tier: tierOf(id), d: abilityData.describe(abilityData.lookup(id), TOP) })).sort((a, b) => a.tier - b.tier);
    const rising = scored.every((x, i) => i === 0 || (x.d.score || 0) >= (scored[i - 1].d.score || 0));
    const groups = rising ? [scored] : scored.map((x) => [x]);
    for (const g of groups) {
      const key = rising ? base : g[0].id;
      const goal = g[0].d.goal;
      const most = Math.max(0, ...g.map((x) => (x.d.score || 0) * (x.d.weather ? WEATHER_SHARE : 1)));
      const weight = key in FAMILY_WEIGHTS ? FAMILY_WEIGHTS[key] : base in FAMILY_WEIGHTS ? FAMILY_WEIGHTS[base] : WEIGHTS[goal] || 0.2;
      for (const x of g) fam[x.id] = { key, goal, most, weight };
    }
  }
  FAMILIES = fam;
  return fam;
}

// What a pet gives in each family at a strength: { key: { score, id, text } }.
function petFamilies(pet, strength) {
  const fam = families();
  const out = {};
  for (const gameId of Array.isArray(pet.abilities) ? pet.abilities : []) {
    const def = abilityData.lookup(gameId);
    if (!def || !fam[def.id]) continue;
    const d = abilityData.describe(def, strength);
    const score = (d.score || 0) * (d.weather ? WEATHER_SHARE : 1);
    const f = fam[def.id];
    if (!out[f.key] || score > out[f.key].score) out[f.key] = { score, id: def.id, name: d.name || def.name, text: d.text || '' };
  }
  return out;
}

const nameOf = (p) => p.name || p.speciesName || p.species || 'a pet';

function recommend(pets, opts = {}) {
  const fam = families();
  const list = (Array.isArray(pets) ? pets : []).filter((p) => p && p.id);
  // The account's best in each family now.
  const best = {};
  for (const p of list) {
    const s = Number(p.strength) || 0;
    for (const [key, v] of Object.entries(petFamilies(p, s))) {
      if (!best[key] || v.score > best[key].score) best[key] = Object.assign({ pet: nameOf(p), petId: p.id }, v);
    }
  }
  const infoOf = (key) => Object.values(fam).find((f) => f.key === key) || { most: 0, weight: 0 };
  // What levelling one pet would add, against the account's best so far.
  const judge = (p, bestNow) => {
    const now = Number(p.strength) || 0;
    const max = Number(p.maxStrength) || 0;
    const hours = Number(p.hoursToMax);
    if (!(max > now) || !(hours > 0)) return null;
    let gain = 0;
    const reasons = [];
    const atMax = petFamilies(p, max);
    for (const [key, v] of Object.entries(atMax)) {
      const f = infoOf(key);
      if (!(f.most > 0) || !(f.weight > 0)) continue;
      const cur = bestNow[key] ? bestNow[key].score : 0;
      if (v.score <= cur + 1e-9) continue;
      const g = (f.weight * (v.score - cur)) / f.most;
      gain += g;
      reasons.push({ family: key, ability: v.name, text: v.text, gain: g, now: bestNow[key] ? { pet: bestNow[key].pet, same: bestNow[key].petId === p.id, ability: bestNow[key].name, text: bestNow[key].text } : null });
    }
    if (gain < (opts.minGain || 0.005)) return null;
    reasons.sort((x, y) => y.gain - x.gain);
    const days = Math.max(0.25, hours / 24);
    return { id: p.id, name: nameOf(p), species: p.speciesName || p.species, where: p.where, strength: now, maxStrength: max, hoursToMax: hours, gain, perDay: gain / days, rank: gain / Math.sqrt(days), reasons, atMax };
  };
  // Picks build on each other: after one, the account's best is as if that
  // pet were levelled, and the rest are judged against that (two identical
  // Peacocks aren't both worth levelling).
  const bestSoFar = Object.assign({}, best);
  const picks = [];
  const used = new Set();
  const first = list.map((p) => judge(p, best)).filter(Boolean);
  for (let k = 0; k < (opts.top || 3); k += 1) {
    const cands = list.filter((p) => !used.has(p.id)).map((p) => judge(p, bestSoFar)).filter(Boolean);
    cands.sort((x, y) => y.rank - x.rank || y.gain - x.gain);
    const pick = cands[0];
    if (!pick) break;
    picks.push(pick);
    used.add(pick.id);
    for (const [key, v] of Object.entries(pick.atMax)) {
      if (!bestSoFar[key] || v.score > bestSoFar[key].score) bestSoFar[key] = Object.assign({ pet: `${pick.name} (levelled)`, petId: pick.id }, v);
    }
  }
  // The quickest worthwhile one on its own (gain per day), when it isn't a pick.
  const quick = first.slice().sort((x, y) => y.perDay - x.perDay)[0] || null;
  const strip = (x) => x && Object.assign({}, x, { atMax: undefined });
  return {
    picks: picks.map(strip),
    quick: quick && !used.has(quick.id) ? strip(quick) : null,
    considered: list.length,
    toLevel: list.filter((p) => Number(p.maxStrength) > Number(p.strength) && Number(p.hoursToMax) > 0).length,
  };
}

module.exports = { recommend, families, petFamilies, WEIGHTS };
