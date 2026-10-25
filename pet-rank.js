'use strict';

/* Pet rankings (v0.58.0), from pet-plan's ability families (Sell Boost I-IV
 * as one line, and so on).
 *
 * A pet's strength in a family is its score as a share of the family's
 * most (its best tier at full strength): 0-100%, so families compare.
 *   - Each family's top 3: your strongest team for it.
 *   - Value: for every family you tick, that share x your weight, added up.
 *   - Level next by value: the pets whose value rises most from their
 *     strength now to their max.
 *   - Level next by team: the pets whose max would most improve your top-3
 *     teams (each family's gain x its weight), and which team gains most.
 *
 * A pet's own mutation counts too (v0.59.3): a Rainbow pet adds 0.5 (half a
 * perfect Rainbow Granter) and a Gold pet 0.2 by default, under the pref keys
 * _petRainbow and _petGold.
 * prefs: { [familyKey]: { on, w } } (w 0-1). Families without a pref are
 * ticked, at their coins compared with Rainbow Granter (ability-value.js,
 * v0.59.0; the working is in docs/ability-weights.md).
 */

const petPlan = require('./pet-plan');
const abilityData = require('./ability-data');
const abilityValue = require('./ability-value');

let NAMES = null;
function familyName(key) {
  if (!NAMES) {
    NAMES = {};
    const fam = petPlan.families();
    for (const [id, f] of Object.entries(fam)) {
      const def = abilityData.lookup(id);
      const name = String((def && def.name) || id).replace(/\s+(IV|III|II|I)$/, '');
      if (!NAMES[f.key]) NAMES[f.key] = name;
    }
  }
  return NAMES[key] || key;
}

function prefFor(prefs, key, defaultWeight) {
  const p = prefs && prefs[key];
  if (p && typeof p === 'object') return { on: p.on !== false, w: Math.max(0, Math.min(1, Number(p.w) || 0)) };
  return { on: true, w: defaultWeight };
}

// opts.stage (v0.70.0): 'late' weighs by the late-game meta (ability-value);
// early and mid as before.
function rank(allPets, prefs, opts) {
  const stage = opts && opts.stage === 'late' ? 'late' : opts && opts.stage ? String(opts.stage) : null;
  const pets = (Array.isArray(allPets) ? allPets : []).filter((p) => p && p.id && Array.isArray(p.abilities) && p.abilities.length);
  const fam = petPlan.families();
  const most = {};
  const defaults = {};
  const money = abilityValue.defaultWeights(stage);
  for (const f of Object.values(fam)) {
    most[f.key] = Math.max(most[f.key] || 0, f.most || 0);
    // Coins compared with Rainbow (v0.59.0); a family the model doesn't
    // know gets a small weight.
    defaults[f.key] = f.key in money ? money[f.key] : 0.02;
  }
  const share = (score, key) => (most[key] > 0 ? Math.max(0, Math.min(1, score / most[key])) : 0);
  // Each pet's families now and at its max.
  const rows = pets.map((p) => {
    const strength = Number(p.strength) || 0;
    const max = Math.max(strength, Number(p.maxStrength) || strength);
    const now = petPlan.petFamilies(p, strength);
    const atMax = max > strength ? petPlan.petFamilies(p, max) : now;
    const fams = {};
    // v0.59.9: also which ability it is (its tier) and what it does now, so
    // the panel can show STR, tier and the real effect, never the internal
    // share as a "%" (it read as strength and made no sense for lower tiers).
    const tierOf = (n) => (String(n || '').match(/\s(IV|III|II|I)$/) || [])[1] || '';
    for (const [key, x] of Object.entries(now)) fams[key] = { now: share(x.score, key), max: share((atMax[key] || x).score, key), tier: tierOf(x.name), text: x.text || '' };
    return { pet: p, strength, max, fams };
  });
  // The families your pets have, with your weight for each.
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.fams)))];
  const weight = {};
  const families = keys.map((key) => {
    const pref = prefFor(prefs, key, defaults[key] == null ? 0.2 : defaults[key]);
    weight[key] = pref.on ? pref.w : 0;
    const top = rows.filter((r) => r.fams[key]).sort((a, b) => b.fams[key].now - a.fams[key].now || b.strength - a.strength).slice(0, 3);
    return {
      key,
      name: familyName(key),
      on: pref.on,
      w: pref.w,
      defaultWeight: defaults[key] == null ? 0.2 : defaults[key],
      top: top.map((r) => ({ id: r.pet.id, species: r.pet.species, name: r.pet.name || r.pet.species, strength: r.strength, pct: Math.round(r.fams[key].now * 100), tier: r.fams[key].tier, text: r.fams[key].text, where: r.pet.where || null })),
      team: top.reduce((s, r) => s + r.fams[key].now, 0),
    };
  }).sort((a, b) => (b.on ? b.w : -1) - (a.on ? a.w : -1) || a.name.localeCompare(b.name));
  // The pet's own mutation (v0.59.3), on top of its abilities.
  const MUT = [['_petRainbow', 'Rainbow pet', 'Rainbow', 0.5], ['_petGold', 'Gold pet', 'Gold', 0.2]];
  const mutWeight = {};
  const mutations = MUT.map(([key, name, mut, def]) => {
    const pref = prefFor(prefs, key, def);
    mutWeight[mut] = pref.on ? pref.w : 0;
    return { key, name, mutation: mut, on: pref.on, w: pref.w, defaultWeight: def, count: rows.filter((x) => (x.pet.mutations || []).includes(mut)).length };
  });
  const mutBonus = (r) => (r.pet.mutations || []).reduce((s, m) => s + (mutWeight[m] || 0), 0);
  const valueOf = (r, which) => Object.entries(r.fams).reduce((s, [key, x]) => s + (weight[key] || 0) * x[which], 0) + mutBonus(r);
  const ranking = rows.map((r) => {
    const best = Object.entries(r.fams).filter(([key]) => weight[key] > 0).sort((a, b) => weight[b[0]] * b[1].now - weight[a[0]] * a[1].now).slice(0, 2).map(([key, x]) => ({ name: familyName(key), pct: Math.round(x.now * 100), tier: x.tier, text: x.text }));
    const h = Number(r.pet.xp) / 3600;
    const age = h > 0 ? (h < 24 ? `age ${Math.max(1, Math.round(h))}h` : `age ${h < 240 ? (h / 24).toFixed(1) : Math.round(h / 24)}d`) : '';
    return { id: r.pet.id, species: r.pet.species, name: r.pet.name || r.pet.species, strength: r.strength, maxStrength: r.max, where: r.pet.where || null, age, mutations: (r.pet.mutations || []).filter((m) => m === 'Rainbow' || m === 'Gold'), mutationBonus: Math.round(mutBonus(r) * 100) / 100, abilities: Object.entries(r.fams).map(([key, x]) => ({ key, name: familyName(key), pct: Math.round(x.now * 100), tier: x.tier, text: x.text, w: weight[key] || 0 })).sort((a, b) => b.w * b.pct - a.w * a.pct), value: Math.round(valueOf(r, 'now') * 100) / 100, atMax: Math.round(valueOf(r, 'max') * 100) / 100, best };
  }).sort((a, b) => b.value - a.value);
  // Level next: by value, and by how much your top-3 teams improve.
  const teamTotal = (key, swap) => rows.filter((r) => r.fams[key]).map((r) => (swap && r === swap ? r.fams[key].max : r.fams[key].now)).sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
  const growable = rows.filter((r) => r.max > r.strength);
  const days = (r) => (Number.isFinite(Number(r.pet.hoursToMax)) ? Number(r.pet.hoursToMax) / 24 : null);
  const byValue = growable.map((r) => ({ id: r.pet.id, species: r.pet.species, name: r.pet.name || r.pet.species, strength: r.strength, maxStrength: r.max, days: days(r), gain: valueOf(r, 'max') - valueOf(r, 'now') }))
    .filter((x) => x.gain > 0.0001).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const byTeam = growable.map((r) => {
    let gain = 0;
    let bestKey = null;
    let bestGain = 0;
    for (const key of Object.keys(r.fams)) {
      if (!weight[key]) continue;
      const g = (teamTotal(key, r) - teamTotal(key, null)) * weight[key];
      gain += g;
      if (g > bestGain) {
        bestGain = g;
        bestKey = key;
      }
    }
    return { id: r.pet.id, species: r.pet.species, name: r.pet.name || r.pet.species, strength: r.strength, maxStrength: r.max, days: days(r), gain, team: bestKey ? familyName(bestKey) : null };
  }).filter((x) => x.gain > 0.0001).sort((a, b) => b.gain - a.gain).slice(0, 3);
  return { stage, families, mutations, ranking, levelValue: byValue, levelTeam: byTeam };
}

/* Which eggs to hunt (v0.61.1): for choosing which eggs to hatch next.
 * Per egg: what it hatches (odds), the kinds you've never had, and about what
 * a hatch is worth to you: the odds-weighted Pet Power of the kinds you've had
 * (each judged by all your pets of that kind, 0 PP for ones with nothing that
 * counts; kinds you've never had can't be judged, and the estimate says how
 * much of the egg it covers). Plus your gaps: the abilities you count where
 * your best team is weakest, and the eggs whose kinds have shown them on your
 * pets. Eggs with the very same odds (Winter / Snow) are one. */
function eggHunt(R, eggs, allPets) {
  const ranking = (R && R.ranking) || [];
  const bySp = {};
  for (const p of allPets || []) {
    if (!p || !p.species) continue;
    const s = bySp[p.species] || (bySp[p.species] = { n: 0, pp: [] });
    s.n += 1;
  }
  for (const x of ranking) if (bySp[x.species]) bySp[x.species].pp.push(Math.round((x.value || 0) * 100));
  for (const s of Object.values(bySp)) while (s.pp.length < s.n) s.pp.push(0);
  const fams = ((R && R.families) || []).filter((f) => f.on && f.w >= 0.05);
  const gaps = fams.map((f) => {
    const team = f.top.map((x) => x.pct);
    while (team.length < 3) team.push(0);
    return { key: f.key, name: f.name, w: f.w, team, room: (1 - team.reduce((s, v) => s + v, 0) / 300) * f.w };
  }).filter((g) => g.room > 0.02).sort((x, y) => y.room - x.room).slice(0, 4);
  const seen = {};
  for (const x of ranking) for (const ab of x.abilities || []) (seen[ab.key] || (seen[ab.key] = new Set())).add(x.species);
  const groups = [];
  const sig = (e) => JSON.stringify(Object.entries(e.odds).sort());
  for (const e of (Array.isArray(eggs) ? eggs : []).filter((x) => x && x.odds)) {
    const g = groups.find((x) => x.sig === sig(e));
    if (g) {
      g.ids.push(e.id);
      g.name = `${g.name.replace(/ Egg$/, '')} / ${e.name}`;
    } else groups.push({ sig: sig(e), ids: [e.id], name: e.name, odds: e.odds });
  }
  const out = groups.map((g) => {
    const species = Object.entries(g.odds).map(([sp, odds]) => {
      const s = bySp[sp];
      const avg = s ? s.pp.reduce((x, y) => x + y, 0) / s.n : null;
      return { species: sp, odds, have: s ? s.n : 0, avg: avg == null ? null : Math.round(avg), best: s ? Math.max(...s.pp) : null, fills: gaps.filter((gp) => seen[gp.key] && seen[gp.key].has(sp)).map((gp) => gp.name) };
    }).sort((x, y) => y.odds - x.odds);
    const judged = species.filter((s) => s.avg != null);
    const known = judged.reduce((s, x) => s + x.odds, 0);
    const est = known ? judged.reduce((s, x) => s + x.odds * x.avg, 0) / 100 : null;
    return { id: g.ids.join('+'), name: g.name, species, est: est == null ? null : Math.round(est * 10) / 10, known, based: judged.reduce((s, x) => s + x.have, 0), never: species.filter((s) => !s.have).map((s) => s.species), fills: [...new Set(species.flatMap((s) => s.fills))] };
  }).sort((x, y) => (y.est == null ? -1 : y.est) - (x.est == null ? -1 : x.est) || y.known - x.known);
  for (const g of gaps) g.eggs = out.filter((e) => e.species.some((s) => s.fills.includes(g.name))).map((e) => e.name);
  return { eggs: out, gaps };
}

module.exports = { rank, familyName, eggHunt };
