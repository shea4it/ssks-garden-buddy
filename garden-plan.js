'use strict';

// The Garden map's to-do (v0.52): every plant on its tile, what it's worth,
// and the next step for it.
//
// A crop's value is base x size x colour x (hydro + lunar - 1). In the end
// game the moves that change that are:
//   - Cleanse: a Crop Cleanser strips hydro and lunar from a whole plant
//     (Gold and Rainbow stay). Worth it next to a Moonbinder when Dawn
//     mutations are in the way: Dawnlit and Amberlit can't share a crop, and
//     only Amberlit crops beside a Moonbinder can bind to Amberbound (x10).
//   - Pot: move a plant with a Planter Pot. An Amberlit crop that isn't next
//     to a Moonbinder binds to Amberbound during the next Amber Moon (25% a
//     minute) once it is.
// "Next to" is the 8 tiles around a binder, on the same side of the garden
// (the two 10 x 10 sides are apart). Everything else is waiting on weather
// or pets, growing, or done.
//
// plants: [{ i: tile 0-199 (row by row, 20 across), sp: the plant's species,
//            s: [[mutations 'gold,frozen', size 50-100, ripe 0/1, value]] }]
// occupied: tile indexes with anything on them (plants, eggs, decor...).

const cropData = require('./crop-data');

const HYDRO = { wet: 2, chilled: 2, frozen: 6, thunderstruck: 5, thundercharged: 7 };
const LUNAR = { dawnlit: 4, dawnbound: 7, amberlit: 6, amberbound: 10 };
const COLOUR = { gold: 25, rainbow: 50 };

function place(i) {
  const row = Math.floor(i / 20);
  const col = i % 20;
  return { row, col, side: col < 10 ? 0 : 1 };
}

// The 8 tiles around one, on its own side of the garden.
function neighbours(i) {
  const { row, col, side } = place(i);
  const out = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (!dr && !dc) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r > 9 || c < 0 || c > 19 || (c < 10 ? 0 : 1) !== side) continue;
      out.push(r * 20 + c);
    }
  }
  return out;
}

// The weather part of the multiplier: hydro and lunar add, minus one each.
function condMult(h, l) {
  const list = [h, l].filter(Boolean);
  return list.length ? list.reduce((a, b) => a + b, 0) - list.length + 1 : 1;
}

function readSlot(raw) {
  const [muts, size, ripe, value] = raw;
  const keys = String(muts || '').split(',').filter(Boolean);
  const pick = (table) => keys.find((k) => table[k]) || null;
  const hydro = pick(HYDRO);
  const lunar = pick(LUNAR);
  const colour = pick(COLOUR);
  return { hydro, lunar, colour, size: Number(size) || 0, ripe: Boolean(ripe), value: Number(value) || 0 };
}

// A slot's value with a different lunar mutation (hydro and the rest kept).
function withLunar(slot, lunar) {
  const h = HYDRO[slot.hydro] || 0;
  const now = condMult(h, LUNAR[slot.lunar] || 0);
  return (slot.value / now) * condMult(h, lunar ? LUNAR[lunar] : 0);
}

function binderOf(species) {
  const found = cropData.lookup(species);
  const name = found ? found.name : String(species || '');
  if (/moonbinder/i.test(name)) return 'moon';
  if (/dawnbinder/i.test(name)) return 'dawn';
  return null;
}

function plan(plants, occupied) {
  const list = Array.isArray(plants) ? plants.filter((p) => p && Number.isInteger(p.i)) : [];
  const taken = new Set((occupied || []).map(Number));
  for (const p of list) taken.add(p.i);
  const moonNear = new Set();
  const dawnNear = new Set();
  let moons = 0;
  for (const p of list) {
    const b = binderOf(p.sp);
    if (b === 'moon') moons += 1;
    for (const n of b ? neighbours(p.i) : []) (b === 'moon' ? moonNear : dawnNear).add(n);
  }
  const openBesideMoon = [...moonNear].filter((i) => !taken.has(i)).sort((a, b) => a - b);

  const tiles = list.map((p) => {
    const found = cropData.lookup(p.sp);
    const name = found ? found.name : String(p.sp || 'Plant');
    const slots = (p.s || []).map(readSlot);
    const ripe = slots.filter((s) => s.ripe);
    const value = slots.reduce((a, s) => a + s.value, 0);
    const t = { i: p.i, name, value, slots: slots.length, ripe: ripe.length, step: 'done', gain: 0, why: [], mutations: summarise(slots) };
    // A binder grows fruit too (celestial fruit, the garden's most
    // valuable), and it mutates and binds like any crop when it sits beside
    // another binder (v0.53.6, seen in the owner's garden: a Moonbinder with
    // Dawnbound fruit beside another Moonbinder). Its own fruit gets the
    // same look as any plant's; it's never suggested for a pot (moving it
    // moves its 8 spots).
    const isBinder = binderOf(p.sp);
    if (isBinder) {
      t.binder = isBinder;
      const plantsAt = new Set(list.map((q) => q.i));
      t.beside = neighbours(p.i).filter((j) => plantsAt.has(j)).length;
    }
    if (!ripe.length) {
      t.step = isBinder ? 'binder' : 'growing';
      return t;
    }
    const nextToMoon = moonNear.has(p.i);
    const nextToDawn = dawnNear.has(p.i);
    t.nextTo = nextToMoon ? 'moon' : nextToDawn ? 'dawn' : null;
    // Beside both kinds: a cleansed crop can go Dawn again (Dawns come twice
    // as often as Amber Moons) unless you step out during Dawns.
    if (nextToMoon && nextToDawn) t.both = true;
    // Cleanse: Dawn mutations next to a Moonbinder. The whole plant is
    // cleansed, so what the Amber ones would lose counts against it.
    if (nextToMoon) {
      const dawnSlots = ripe.filter((s) => s.lunar === 'dawnlit' || s.lunar === 'dawnbound');
      if (dawnSlots.length) {
        const up = dawnSlots.reduce((a, s) => a + withLunar(s, 'amberbound') - s.value, 0);
        const down = ripe.filter((s) => s.lunar === 'amberlit' || s.lunar === 'amberbound').reduce((a, s) => a + s.value - withLunar(s, null), 0);
        if (up - down > 0) {
          t.cleanseGain = up - down;
          t.cleanseWhy = `${dawnSlots.length} crop${dawnSlots.length === 1 ? ' is' : 's are'} ${dawnSlots[0].lunar === 'dawnbound' ? 'Dawnbound' : 'Dawnlit'}, which blocks Amberbound here`;
        }
      }
    }
    // Pot: Amberlit crops away from a Moonbinder. Which ones get the open
    // spots is decided below, once all are known.
    if (moons && !nextToMoon && !isBinder) {
      const lit = ripe.filter((s) => s.lunar === 'amberlit');
      if (lit.length) {
        t.potGain = lit.reduce((a, s) => a + withLunar(s, 'amberbound') - s.value, 0);
        t.potWhy = `${lit.length} Amberlit crop${lit.length === 1 ? '' : 's'} would bind to Amberbound beside a Moonbinder`;
      }
    }
    // Waiting on weather or pets.
    const need = [];
    if (ripe.some((s) => !s.hydro)) need.push('a hydro mutation (rain, snow or thunder)');
    else if (ripe.some((s) => s.hydro === 'wet' || s.hydro === 'chilled')) need.push('Frozen (Wet + Snow or Chilled + Rain)');
    if (ripe.some((s) => !s.lunar)) need.push('a lunar mutation (Dawn or Amber Moon)');
    if (nextToMoon && ripe.some((s) => s.lunar === 'amberlit')) need.push('Amberbound (next Amber Moon)');
    if (nextToDawn && !nextToMoon && ripe.some((s) => s.lunar === 'dawnlit')) need.push('Dawnbound (next Dawn)');
    if (ripe.some((s) => !s.colour)) need.push('Gold or Rainbow (from pets)');
    if (ripe.some((s) => s.size > 0 && s.size < 99.999)) need.push('full size');
    if (need.length) {
      t.step = 'wait';
      t.why = need;
    }
    // A binder shows as a binder unless its own fruit has a to-do (below).
    if (isBinder) t.step = 'binder';
    return t;
  });

  // A to-do has to be worth a Crop Cleanser or a Planter Pot: at least
  // 0.1 % of the garden's value (1M at the least). Smaller ones keep their
  // own step and just note the gain.
  const total = tiles.reduce((acc, t) => acc + t.value, 0);
  const worth = Math.max(1e6, total * 0.001);
  for (const t of tiles) {
    if (!t.cleanseGain) continue;
    if (t.cleanseGain >= worth) {
      t.step = 'cleanse';
      t.gain = t.cleanseGain;
      t.why = [t.cleanseWhy];
      if (t.both) t.why.push('It\'s also beside a Dawnbinder, and Dawns come twice as often as Amber Moons: after cleansing, step out during Dawns (Weather tab) until it\'s Amberlit, or it may go Dawn again');
      delete t.potGain;
    } else {
      t.small = t.cleanseGain;
    }
    delete t.cleanseGain;
    delete t.cleanseWhy;
  }
  for (const t of tiles) {
    if (t.potGain && t.potGain < worth) {
      t.small = Math.max(t.small || 0, t.potGain);
      delete t.potGain;
      delete t.potWhy;
    }
  }
  // Only as many pots as there are open spots beside a Moonbinder, best
  // first. The rest keep their own step and say what a spot there would
  // gain ("free up a spot").
  const potting = tiles.filter((t) => t.potGain > 0 && t.step !== 'cleanse').sort((x, y) => y.potGain - x.potGain);
  potting.forEach((t, n) => {
    if (n < openBesideMoon.length) {
      t.step = 'pot';
      t.gain = t.potGain;
      t.why = [t.potWhy];
    } else {
      t.later = t.potGain;
    }
    delete t.potWhy;
  });
  const waiting = potting.slice(openBesideMoon.length);

  const count = (s) => tiles.filter((t) => t.step === s).length;
  const gainOf = (s) => tiles.filter((t) => t.step === s).reduce((a, t) => a + t.gain, 0);
  return {
    tiles,
    openBesideMoon,
    worth,
    summary: {
      cleanse: count('cleanse'), pot: count('pot'), wait: count('wait'), growing: count('growing'), done: count('done'), binders: tiles.filter((t) => t.binder).length,
      gain: gainOf('cleanse') + gainOf('pot'),
      // Amberlit plants with no open spot beside a Moonbinder, and their gain.
      potLater: waiting.length, potLaterGain: waiting.reduce((a, t) => a + t.later, 0),
    },
  };
}

// "Rainbow · Frozen · Dawnlit" for the whole plant (the most common of each).
function summarise(slots) {
  const pick = (k) => {
    const n = {};
    for (const s of slots) if (s[k]) n[s[k]] = (n[s[k]] || 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([m, c]) => ({ m, c }));
  };
  return { colour: pick('colour'), hydro: pick('hydro'), lunar: pick('lunar'), full: slots.filter((s) => s.size >= 99.999).length };
}

module.exports = { plan, neighbours, place, condMult, binderOf, HYDRO, LUNAR, COLOUR };
