'use strict';

/* Harvest mode (v0.54.4): only crops that match the rule you set can be
 * harvested; everything else is kept, so you can sweep the whole garden
 * without looking. The rule is groups that must all match:
 *   color: 'any', 'goldOrRainbow' or 'rainbow',
 *   hydro: any of these weather mutations (none picked = any),
 *   lunar: any of these moon mutations (none picked = any),
 *   size:  true = full size only.
 * The game page does the stopping (garden-observer.js has the same check,
 * `harvestMiss`); this copy is for the app: tidying the setting, saying it in
 * words, and counting what matches right now. */

const HYDRO = ['wet', 'chilled', 'frozen', 'thunderstruck', 'thundercharged'];
const LUNAR = ['dawnlit', 'dawnbound', 'amberlit', 'amberbound'];
const COLORS = ['any', 'goldOrRainbow', 'rainbow'];
const NAMES = {
  wet: 'Wet', chilled: 'Chilled', frozen: 'Frozen', thunderstruck: 'Thunderstruck', thundercharged: 'Thundercharged',
  dawnlit: 'Dawnlit', dawnbound: 'Dawnbound', amberlit: 'Amberlit', amberbound: 'Amberbound',
};

// A tidy rule from whatever was saved or sent.
function clean(mode) {
  const m = mode && typeof mode === 'object' ? mode : {};
  const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).toLowerCase()).filter((x) => allowed.includes(x)))];
  return {
    on: m.on === true,
    color: COLORS.includes(m.color) ? m.color : 'any',
    hydro: pick(m.hydro, HYDRO),
    lunar: pick(m.lunar, LUNAR),
    size: m.size === true,
  };
}

// Why a crop doesn't match (words), or null when it does. `keys` are its
// mutations as keys ('rainbow', 'thundercharged', ...), `size` its size.
function miss(keys, size, mode) {
  const k = new Set((keys || []).map((x) => String(x).toLowerCase()));
  const r = clean(mode);
  if (r.color === 'rainbow' && !k.has('rainbow')) return 'not Rainbow';
  if (r.color === 'goldOrRainbow' && !k.has('gold') && !k.has('rainbow')) return 'not Gold or Rainbow';
  if (r.hydro.length && !r.hydro.some((x) => k.has(x))) return `not ${r.hydro.map((x) => NAMES[x]).join(' or ')}`;
  if (r.lunar.length && !r.lunar.some((x) => k.has(x))) return `not ${r.lunar.map((x) => NAMES[x]).join(' or ')}`;
  if (r.size && !(Number(size) >= 99.999)) return 'not full size';
  return null;
}

// The rule in a few words: "Gold or Rainbow · Thundercharged · Amberbound ·
// full size", or "anything".
function describe(mode) {
  const r = clean(mode);
  const bits = [];
  if (r.color === 'rainbow') bits.push('Rainbow');
  if (r.color === 'goldOrRainbow') bits.push('Gold or Rainbow');
  if (r.hydro.length) bits.push(r.hydro.map((x) => NAMES[x]).join(' or '));
  if (r.lunar.length) bits.push(r.lunar.map((x) => NAMES[x]).join(' or '));
  if (r.size) bits.push('full size');
  return bits.length ? bits.join(' · ') : 'anything';
}

// What matches now, from the garden report's plants ([{ i, sp, s: [[muts,
// size, ripe, value], ...] }], muts a comma list of keys): ripe crops only.
function count(plants, mode) {
  let crops = 0;
  let value = 0;
  let onPlants = 0;
  let ripe = 0;
  for (const p of Array.isArray(plants) ? plants : []) {
    let here = 0;
    for (const s of Array.isArray(p && p.s) ? p.s : []) {
      if (!s || !s[2]) continue;
      ripe += 1;
      const keys = String(s[0] || '').split(',').filter(Boolean);
      if (miss(keys, s[1], mode)) continue;
      here += 1;
      value += Number(s[3]) || 0;
    }
    crops += here;
    if (here) onPlants += 1;
  }
  return { crops, value, plants: onPlants, ripe };
}

module.exports = { HYDRO, LUNAR, COLORS, NAMES, clean, miss, describe, count };
