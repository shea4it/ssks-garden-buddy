'use strict';

/* Time to max strength (v0.66.0), for the Pets tab.
 *
 * A pet out and fed gains 1 XP a second (60 a minute); its strength climbs
 * from max - 30 to its max over its species' hours to mature (pet-data.js
 * strength() works out hoursToMax). XP Boost abilities on the pets out add
 * XP to every pet out: each a chance a minute and an amount, both scaled by
 * the booster's strength (the wiki's "x STR"), so on average
 * chance x STR x amount x STR a minute. Weather ones only in their weather.
 *
 * Nocturnal pets (Bat, Platypus, Red Fox and the Spooky Egg's Moth, Snake
 * and Toad) are up to +20 STR at night (the Haunt Event, Oct 2026); that's a
 * boost while it's dark, not growth, so it isn't counted here.
 */

const abilityData = require('./ability-data');
const petData = require('./pet-data');

const BASE_PER_MIN = 60;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function weatherMatches(abilityWeather, kind) {
  if (!abilityWeather) return true;
  if (!kind || kind === 'clear') return false;
  const w = norm(abilityWeather);
  const k = norm(kind);
  return w.startsWith(k) || k.startsWith(w.slice(0, 4));
}

// XP a minute each pet out gets from the XP Boost pets out.
function xpBoost(pets, weatherKind, opts = {}) {
  let perMin = 0;
  const who = [];
  for (const p of pets || []) {
    const str = Number(opts.atMax ? p.maxStrength || p.strength : p.strength) || abilityData.DEFAULT_STRENGTH;
    const s = str / 100;
    for (const id of p.abilities || []) {
      const a = abilityData.lookup(id);
      if (!a || a.kind !== 'perMinute' || !(a.xp > 0) || !(a.chance > 0)) continue;
      if (opts.alwaysOn ? a.weather : !weatherMatches(a.weather, weatherKind)) continue;
      const v = (a.chance / 100) * s * a.xp * s;
      perMin += v;
      who.push({ id: p.id, name: p.name || petData.prettySpecies(p.species), species: p.species, ability: a.name, perMin: v, strength: str });
    }
  }
  return { perMin, who };
}

// Your two best always-on XP Boost pets at their max strength: a team of
// those two and the pet you're growing.
function bestBoost(allPets) {
  const each = (allPets || []).map((p) => ({ p, v: xpBoost([p], null, { atMax: true, alwaysOn: true }) })).filter((x) => x.v.perMin > 0);
  each.sort((a, b) => b.v.perMin - a.v.perMin);
  const top = each.slice(0, 2);
  return {
    perMin: top.reduce((a, x) => a + x.v.perMin, 0),
    ids: top.map((x) => x.p.id),
    who: top.map((x) => ({ id: x.p.id, name: x.p.name || petData.prettySpecies(x.p.species), species: x.p.species, strength: Number(x.p.maxStrength || x.p.strength) || null })),
  };
}

function isNocturnal(species) {
  return petData.isNocturnal ? petData.isNocturnal(species) : false;
}

function view(allPets, activePets, weatherKind) {
  const active = new Set((activePets || []).map((p) => p.id));
  const team = xpBoost(activePets, weatherKind);
  const best = bestBoost(allPets);
  const rows = (allPets || [])
    .filter((p) => p && p.maxStrength && Number(p.strength) < Number(p.maxStrength) && Number(p.hoursToMax) > 0)
    .map((p) => {
      const leftXp = Number(p.hoursToMax) * 3600;
      const out = active.has(p.id);
      const hours = (perMin) => leftXp / (BASE_PER_MIN + perMin) / 60;
      return {
        id: p.id,
        name: p.name || null,
        species: p.species,
        speciesName: p.speciesName || petData.prettySpecies(p.species),
        strength: Number(p.strength),
        max: Number(p.maxStrength),
        estimated: Boolean(p.strengthEstimated),
        nocturnal: isNocturnal(p.species),
        out,
        hoursBase: Number(p.hoursToMax),
        hoursTeam: out && team.perMin > 0 ? hours(team.perMin) : null,
        hoursBest: best.perMin > 0 && !best.ids.includes(p.id) ? hours(best.perMin) : null,
      };
    })
    .sort((a, b) => (b.out - a.out) || a.hoursBase - b.hoursBase);
  return { basePerMin: BASE_PER_MIN, team, best, rows, maxed: (allPets || []).filter((p) => p && p.maxStrength && Number(p.strength) >= Number(p.maxStrength)).length };
}

module.exports = { BASE_PER_MIN, xpBoost, bestBoost, view, weatherMatches };
