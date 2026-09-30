'use strict';

/* Your best sell team (v0.53.13; its own module since v0.54.2).
 *
 * Of every pet you own (out, in the inventory or the hutch), the three whose
 * sell abilities together multiply a sale the most:
 *   - Sell Boost (I-IV): each one's expected boost, % (chance x bonus),
 *   - Double Harvest (the Capybara): the chance of an extra crop when you
 *     harvest, so more to sell,
 *   - Crop Refund (the Capybara; the game calls it ProduceRefund): the chance
 *     a sold crop comes back, so each crop sells 1 / (1 - chance) times over.
 * A team's multiplier is (1 + sell) x (1 + DH) / (1 - refund), with DH capped
 * at 100% and refund at 90%, the way the Garden and Money tabs count the pets
 * that are out. Everything is at each pet's strength now, so it moves as
 * pets grow, and a new pet can take a place.
 *
 * The maths is cached by what each pet contributes; who's out right now is
 * worked out fresh every time (a pet moved from the hutch changes nothing in
 * the maths, but does change the reminder).
 */

const abilityData = require('./ability-data');
const petData = require('./pet-data');

// What one pet adds: { sell, dh, refund }, in %.
function contribution(pet, matches) {
  const rows = (abilityData.summarise([pet], { weatherMatches: matches || (() => false) }).rows || []).filter((r) => !r.weather);
  return fromRowsParts(rows);
}

// Sell, Double Harvest and Crop Refund from summarise() rows.
function fromRowsParts(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && !r.weather);
  return {
    sell: list.filter((r) => r.goal === 'sell' && r.sellChance).reduce((a, r) => a + (r.score || 0), 0),
    dh: list.filter((r) => r.id === 'DoubleHarvest').reduce((a, r) => a + (r.chance || 0), 0),
    refund: list.filter((r) => r.id === 'CropRefund').reduce((a, r) => a + (r.chance || 0), 0),
  };
}

// A set of contributions together: the multiplier on a sale.
function partOf(list) {
  const sell = list.reduce((a, c) => a + c.sell, 0);
  const dh = Math.min(100, list.reduce((a, c) => a + c.dh, 0));
  const refund = Math.min(90, list.reduce((a, c) => a + c.refund, 0));
  return { sell, dh, refund, petPart: (1 + sell / 100) * ((1 + dh / 100) / (1 - refund / 100)) };
}

// The pets out now, from the rows the app already has for them.
function fromRows(rows) {
  return partOf([fromRowsParts(rows)]);
}

let cache = { key: null, best: null };

function idealSellTeam(pets, matches) {
  const all = Array.isArray(pets) ? pets : [];
  const parts = all.map((p) => Object.assign({ p }, contribution(p, matches))).filter((c) => c.sell > 0 || c.dh > 0 || c.refund > 0);
  const key = parts.map((c) => `${c.p.id}:${c.sell.toFixed(3)}:${c.dh.toFixed(3)}:${c.refund.toFixed(3)}`).join('|');
  let best = cache.key === key ? cache.best : null;
  if (!best) {
    // Every one, two or three of the pets that help a sale.
    best = Object.assign({ ids: [] }, partOf([]));
    const consider = (list) => {
      const r = partOf(list);
      if (r.petPart > best.petPart + 1e-9) best = Object.assign({ ids: list.map((c) => c.p.id) }, r);
    };
    for (let x = 0; x < parts.length; x += 1) {
      consider([parts[x]]);
      for (let y = x + 1; y < parts.length; y += 1) {
        consider([parts[x], parts[y]]);
        for (let z = y + 1; z < parts.length; z += 1) consider([parts[x], parts[y], parts[z]]);
      }
    }
    cache = { key, best };
  }
  // Fresh every time: each member's share and where it is now.
  const nameOf = (p) => p.speciesName || petData.prettySpecies(p.species);
  const members = best.ids.map((id) => parts.find((c) => c.p.id === id)).filter(Boolean).map((c) => ({
    id: c.p.id,
    name: c.p.name || nameOf(c.p),
    species: nameOf(c.p),
    where: c.p.where,
    out: c.p.where === 'out',
    sell: c.sell,
    dh: c.dh,
    refund: c.refund,
  }));
  return {
    petPart: best.petPart,
    sellPct: best.sell,
    dh: best.dh,
    refund: best.refund,
    pets: members,
    allOut: members.length > 0 && members.every((m) => m.out),
    notOut: members.filter((m) => !m.out).map((m) => m.species),
  };
}

module.exports = { idealSellTeam, contribution, partOf, fromRows };
