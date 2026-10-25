'use strict';

/* What each ability is worth in coins, compared with Rainbow Granter
 * (v0.59.0). Rainbow Granter = 100%; every other ability family's default
 * weight in the pet rankings is its coins per day / Rainbow's, each at its
 * best tier and full strength, in a late-game reference garden.
 *
 * The reference garden is the owner's (tests/fixtures/garden-layout.json:
 * 270 crops worth 612B), with two stated assumptions about money flow
 * (REF.turnoverPerDay, REF.growingShare). docs/ability-weights.md is written
 * from this file by tools/write-ability-notes.js, so the notes always match
 * the numbers the app uses.
 */

const abilityData = require('./ability-data');
const petPlan = require('./pet-plan');
const cropData = require('./crop-data');

const COND = { wet: 2, chilled: 2, frozen: 6, thunderstruck: 5, thundercharged: 7, dawnlit: 4, dawnbound: 7, amberlit: 6, amberbound: 10 };
const HYDRO = ['wet', 'chilled', 'frozen', 'thunderstruck', 'thundercharged'];
const LUNAR = ['dawnlit', 'dawnbound', 'amberlit', 'amberbound'];

// The reference economy, measured from a garden layout (the owner's).
function measure(layout) {
  const crops = [];
  for (const p of layout.plants) for (const s of p.s) crops.push({ m: new Set(String(s[0] || '').split(',').filter(Boolean)), size: s[1], value: s[3] || 0 });
  const colourOf = (c) => (c.m.has('rainbow') ? 50 : c.m.has('gold') ? 25 : 1);
  const condMult = (c) => {
    const ks = [...c.m].filter((k) => k in COND);
    return ks.reduce((a, k) => a + COND[k], 0) - ks.length + 1;
  };
  const coloured = crops.filter((c) => colourOf(c) > 1);
  const uncoloured = crops.filter((c) => colourOf(c) === 1);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const base = mean(coloured.map((c) => c.value / (colourOf(c) * condMult(c))));
  return {
    crops: crops.length,
    totalValue: crops.reduce((a, c) => a + c.value, 0),
    uncoloured: uncoloured.length,
    uncolouredValue: mean(uncoloured.map((c) => c.value)),
    colouredValue: mean(coloured.map((c) => c.value)),
    colourFactor: mean(coloured.map(colourOf)),
    baseValue: base,
    notFullValue: crops.filter((c) => c.size < 100).reduce((a, c) => a + c.value, 0),
    notFull: crops.filter((c) => c.size < 100).length,
    lackingHydro: crops.filter((c) => !HYDRO.some((k) => c.m.has(k))).length,
    lackingLunar: crops.filter((c) => !LUNAR.some((k) => c.m.has(k))).length,
  };
}

// Assumptions about money flow (not in the layout), stated in the notes.
const ASSUME = {
  // Crops sold a day: about what the Money tab shows getting ready a day in
  // this garden (~99.5B).
  turnoverPerDay: 100e9,
  // Share of a crop's life spent growing (the rest is waiting for weather
  // and moons): growth speed only helps that part.
  growingShare: 0.1,
  // Share of a granted weather / moon mutation that weather would have given
  // anyway (a granter mostly speeds it up).
  naturalShare: 0.5,
  // Weather-only abilities work during their weather: about a quarter of the
  // time (the app's existing convention).
  weatherShare: 0.25,
  // Extra divine / mythical seeds when the garden is already full: mostly
  // unused, so worth a twentieth of their shop price.
  seedUse: 0.05,
  // Size points a new crop has to grow before it's full (it can't go past).
  sizeHeadroom: 15,
  // Lit crops a binder turns bound a day (its ring, its events).
  binderPerDay: 10,
  // Captures (v0.59.10, from the owner): a capsule costs the crop its Dawn /
  // Amber mutation. A Dawn capsule is 0.5% a Dawnbreaker Spore (worth up to
  // 28B, the owner's figure, once grown and mutated) and 2.5% an Ube Seed;
  // the rest is junk. Amber capsules give pet shards (no coins).
  sporeValue: 28e9,
  // Seeds take time to grow and mutate to their full value (and need room):
  // counted at half.
  seedTime: 0.5,
  // A crop that loses an Amber mutation waits this long for one back.
  regainDays: 0.5,
  // Dawn captures cost nothing (v0.59.11, the owner's practice): a crop
  // holds one moon mutation, Amberbound (x10) beats Dawnbound (x7), and Gold /
  // Rainbow is the slow part, so Dawn is farmed off (Thunderpeels kept just
  // for it) until Amberbound will land in time. Amber is the goal: losing it
  // does cost.
  dawnCaptureFree: true,
  // Measured (the owner's lifetime counters): Dawn Capture 105 -> 112 in 24 h.
  dawnCapturesSeen: 7,
  // Share of new crops that get a Dawn mutation (the rest get Amber).
  dawnShare: 0.5,
  // Late game (v0.70.0, from the owner): new crops are taken Thunderstruck
  // -> Thundercharged, so about this share of them are struck and waiting
  // for a charge (the early/mid model assumes 30%).
  lateStruckShare: 0.8,
};

function rates(id) {
  const def = abilityData.lookup(id);
  return def ? abilityData.describe(def, 100) : null;
}

// Each family's coins a day at its best tier and full strength, with its sum.
//
// Late game (v0.70.0, the owner's meta): a crop holds one weather mutation
// and one moon mutation, and late gardens save both slots for their best
// path: Thunderstruck -> Thundercharged (x7) and Amberlit -> Amberbound
// (x10). So late, Thunderstruck and Amberlit Granters count toward x7 and
// x10, Thundercharger converts most new crops, Frost / Rain / Snow Granters
// would take the weather slot with less (worth nothing), and Dawnlit Granter
// only feeds Dawn captures (Dawnbreaker farming). Early and mid: as before,
// each mutation by its own multiplier.
function model(layout, assume, stage) {
  const R = measure(layout);
  const A = Object.assign({}, ASSUME, assume || {});
  const late = stage === 'late';
  const fam = petPlan.families();
  const best = {};
  const tierOf = (id) => ({ I: 1, II: 2, III: 3, IV: 4 }[(id.match(/(IV|III|II|I)$/) || [])[1]] || 0);
  for (const [id, f] of Object.entries(fam)) if (!best[f.key] || tierOf(id) > tierOf(best[f.key])) best[f.key] = id;
  const newCrops = A.turnoverPerDay / R.colouredValue; // crops replaced a day
  const finished = (mult) => R.colourFactor * R.baseValue * (mult - 1); // a mutation's worth on a finished crop
  const out = {};
  for (const [key, id] of Object.entries(best)) {
    const d = rates(id);
    if (!d) continue;
    const w = d.weather ? A.weatherShare : 1;
    const per = d.score || 0; // per hour, %, coins/h ... by goal
    let coins = 0;
    let how = '';
    const g = d.goal || '';
    if (g === 'rainbow' || g === 'gold') {
      const lift = g === 'rainbow' ? 49 : 24;
      coins = per * 24 * R.uncolouredValue * lift * w;
      how = `${(per * 24).toFixed(2)} procs/day x ${fmt(R.uncolouredValue)} uncoloured crop x ${lift} (x${lift + 1} - x1)`;
    } else if (g === 'sell') {
      if (key === 'CropEater') {
        coins = 0;
        how = 'eats crops with no mutation at all: a late-game garden has none worth eating (every crop is on its way to x hundreds)';
      } else {
        coins = (per / 100) * A.turnoverPerDay * w;
        how = `${per}% of ${fmt(A.turnoverPerDay)} sold a day`;
      }
    } else if (late && g.startsWith('grant:') && ['wet', 'chilled', 'frozen'].includes(g.slice(6).toLowerCase())) {
      const name = g.slice(6).toLowerCase();
      coins = 0;
      how = `late game: the weather slot is kept for Thunderstruck -> Thundercharged (x${COND.thundercharged}); ${name} (x${COND[name]}) would take it with less, so it counts for nothing`;
    } else if (late && g === 'grant:Dawnlit') {
      // Only as a way to Dawn captures: each Dawnlit crop can be captured
      // for a capsule (Dawnbreaker Spore, Ube), then goes on to Amber.
      const ube = 2e6 * (R.colouredValue / R.baseValue);
      const gain = 0.005 * A.sporeValue * A.seedTime + 0.025 * ube * A.seedTime;
      const procs = Math.min(per * 24 * w, newCrops);
      coins = procs * gain;
      how = `late game: Amber is the goal, so a Dawnlit crop is only worth its Dawn capture: ${procs.toFixed(1)} procs/day x a capsule's ${fmt(gain)} (0.5% a Dawnbreaker Spore, 2.5% an Ube Seed, at half for the time)`;
    } else if (g.startsWith('grant:')) {
      const name = g.slice(6).toLowerCase();
      // Late: the start of the best path in its slot counts toward its end.
      const path = late && name === 'thunderstruck' ? 'thundercharged' : late && name === 'amberlit' ? 'amberbound' : name;
      const mult = COND[path] || 2;
      const lacking = HYDRO.includes(name) ? R.lackingHydro : R.lackingLunar;
      const supply = newCrops + lacking / 7;
      const procs = Math.min(per * 24 * w, supply);
      coins = procs * finished(mult) * (1 - A.naturalShare);
      how = `min(${(per * 24 * w).toFixed(1)} procs/day, ${supply.toFixed(1)} crops lacking it a day) x ${fmt(finished(mult))} (x${mult} on a finished crop: ${R.colourFactor.toFixed(1)} colour x ${fmt(R.baseValue)} base x ${mult - 1}) x ${1 - A.naturalShare} (weather would give the rest)${path !== name ? ` (late game: it starts the ${path} path)` : ''}`;
    } else if (g === 'weatherBoost' && key !== 'DawnbinderBoost') {
      const natural = newCrops * (finished(6) + finished(7)) * (1 - A.naturalShare);
      coins = (per / 100) * natural * w;
      how = `+${per}% of the weather mutations new crops get (${newCrops.toFixed(1)} a day x (a x6 + a x7 mutation) x ${1 - A.naturalShare}: ${fmt(natural)} a day)${d.weather ? ` x ${A.weatherShare} (its weather only)` : ''}`;
    } else if (g === 'coins') {
      coins = per * 24 * w;
      how = `${fmt(per)} coins/h x 24${d.weather ? ` x ${A.weatherShare} (its weather only)` : ''}`;
    } else if (g === 'seeds') {
      const price = seedPrice(id);
      coins = per * 24 * price * A.seedUse * w;
      how = `${(per * 24).toFixed(1)} seeds/day x ${fmt(price)} (a ${seedTier(id)} seed's price) x ${A.seedUse} (the garden is full)`;
    } else if (g === 'growth') {
      // Growing s times faster saves s / (1 + s) of the growing time, and
      // growing is only part of a crop's life: the rest is waiting for
      // weather, which speed doesn't touch.
      const s = per / 60;
      const saved = A.growingShare * (s / (1 + s));
      coins = saved * A.turnoverPerDay * w;
      how = `${per.toFixed(0)} min sooner/h = ${s.toFixed(2)}x faster growing -> saves ${(s / (1 + s) * 100).toFixed(0)}% of growing time x ${A.growingShare} (the share of a crop's life spent growing) = ${(saved * 100).toFixed(1)}% more crops a day x ${fmt(A.turnoverPerDay)}${d.weather ? ` x ${A.weatherShare} (its weather only)` : ''}`;
    } else if (g === 'size') {
      // Each boost adds size to every crop not yet full; a crop stops at
      // full. Steady state: limited by the room new crops have to grow.
      const demand = per * 24 * w * Math.max(1, R.notFull);
      const supply = newCrops * A.sizeHeadroom;
      const points = Math.min(demand, supply);
      coins = points * 0.01 * R.colouredValue;
      how = `min(${demand.toFixed(0)} size points/day it could add (${(per * 24 * w).toFixed(1)}/crop x ${R.notFull} not-full crops), ${supply.toFixed(0)} points of room new crops have (${newCrops.toFixed(1)}/day x ${A.sizeHeadroom})) x 1% of a finished crop's ${fmt(R.colouredValue)}`;
    } else if (key === 'DawnbinderBoost') {
      const each = R.colourFactor * R.baseValue * (COND.dawnbound - COND.dawnlit);
      coins = (per / 100) * A.binderPerDay * each;
      how = `+${per}% of a Dawnbinder's ~${A.binderPerDay} conversions/day x ${fmt(each)} each (Dawnlit x4 -> Dawnbound x7 on a finished crop)`;
    } else if (key === 'DawnCapture' || key === 'AmberCapture') {
      // v0.59.10: what a capsule is worth, minus what the capture costs.
      const dawn = key === 'DawnCapture';
      const life = R.totalValue / A.turnoverPerDay; // days a crop spends in the garden
      const ube = 2e6 * (R.colouredValue / R.baseValue); // a finished Ube crop
      const gain = dawn ? 0.005 * A.sporeValue * A.seedTime + 0.025 * ube * A.seedTime : 0;
      const cost = dawn && A.dawnCaptureFree ? 0 : R.colouredValue * (A.regainDays / life);
      const supply = newCrops * (dawn ? A.dawnShare : 1 - A.dawnShare);
      const captures = Math.min(per * 24 * w, supply);
      coins = captures * (gain - cost);
      how = `${captures.toFixed(1)} captures/day (min of ${(per * 24 * w).toFixed(0)} charges and ${supply.toFixed(1)} new ${dawn ? 'Dawn' : 'Amber'} mutations) x (${dawn ? `capsule ${fmt(gain)}: 0.5% x a ${fmt(A.sporeValue * A.seedTime)} Dawnbreaker Spore (${fmt(A.sporeValue)} grown, x ${A.seedTime} for the time) + 2.5% x a ${fmt(ube * A.seedTime)} Ube Seed` : 'capsule 0: pet shards, no coins'} - cost ${cost ? `${fmt(cost)}: a ${fmt(R.colouredValue)} crop held ${A.regainDays} day of its ${life.toFixed(1)}-day stay` : '0: Dawn is farmed off to make room for Amberbound'}) = ${fmt(coins)}/day${coins < 0 ? ' (a loss: counted as 0)' : ''}${dawn ? `; at the ${A.dawnCapturesSeen} a day this garden actually made, ${fmt(A.dawnCapturesSeen * gain)}/day` : ''}`;
    } else if (key === 'Thundercharger' && late) {
      const struck = newCrops * A.lateStruckShare;
      const charges = Math.min(per * 24 * w, struck);
      coins = charges * R.colourFactor * R.baseValue * (COND.thundercharged - COND.thunderstruck);
      how = `late game: min(${(per * 24 * w).toFixed(1)} charges/day, ~${struck.toFixed(1)} new Thunderstruck crops/day (${Math.round(A.lateStruckShare * 100)}% of new crops)) x ${R.colourFactor.toFixed(1)} x ${fmt(R.baseValue)} x 2 (x7 - x5)`;
    } else if (key === 'Thundercharger') {
      const struck = newCrops * 0.3;
      coins = struck * R.colourFactor * R.baseValue * (COND.thundercharged - COND.thunderstruck);
      how = `~${struck.toFixed(1)} new Thunderstruck crops/day (30% of new crops) x ${R.colourFactor.toFixed(1)} x ${fmt(R.baseValue)} x 2 (x7 - x5)`;
    } else {
      // No coins of their own: pets, eggs, hunger, captures, copies.
      const SMALL = { xp: 0.02, hatchXp: 0.01, eggs: 0.02, petMutation: 0.03, doubleHatch: 0.02, hunger: 0.02, maxStrength: 0.02, special: 0.02 };
      coins = null;
      out[key] = { id, goal: g, coins: null, share: SMALL[g] == null ? 0.01 : SMALL[g], how: `no coins of its own (${g || 'other'}): a small flat weight for what it helps indirectly`, text: d.text };
      continue;
    }
    out[key] = { id, goal: g, coins, how, text: d.text };
  }
  const rainbow = out.RainbowGranter ? out.RainbowGranter.coins : 1;
  for (const v of Object.values(out)) if (v.coins != null) v.share = Math.max(0, Math.min(1, v.coins / rainbow));
  return { reference: R, assume: A, families: out };
}

function seedTier(id) {
  return /IV$/.test(id) ? 'divine' : /III$/.test(id) ? 'mythical' : /II$/.test(id) ? 'legendary' : 'uncommon';
}
function seedPrice(id) {
  const tier = seedTier(id);
  const prices = Object.values(cropData.CROPS || {}).filter((c) => String(c.rarity || '').toLowerCase() === tier && Number(c.seedPrice) > 0).map((c) => Number(c.seedPrice));
  if (prices.length) return Math.min(...prices);
  return { divine: 5e9, mythical: 5e8, legendary: 5e7, uncommon: 1e5 }[tier];
}
function fmt(n) {
  const a = Math.abs(n);
  return a >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));
}

// The default weights (key -> 0-1), rounded to whole percent. Late game
// has its own (v0.70.0); early and mid share the others.
const WEIGHTS = {};
function defaultWeights(stage) {
  const k = stage === 'late' ? 'late' : 'base';
  if (WEIGHTS[k]) return WEIGHTS[k];
  let layout = null;
  try {
    layout = require('./ability-reference.json');
  } catch (err) {
    layout = null;
  }
  const out = {};
  if (layout) {
    const M = model(layout, null, k === 'late' ? 'late' : null);
    for (const [key, v] of Object.entries(M.families)) out[key] = Math.round(v.share * 100) / 100;
  }
  WEIGHTS[k] = out;
  return out;
}

module.exports = { model, measure, defaultWeights, ASSUME, COND, fmt };
