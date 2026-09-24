'use strict';

// Max hunger and diet for every pet, from the Magic Garden Wiki's pet table
// (magicgarden.wiki/Pets, last edited 10 September 2026). Used to mirror the
// game's own warning: a pet at 10% hunger or less, with nothing it eats in
// the feeding trough. New pets that aren't listed here fall back to a
// time-based warning.

const PETS = {
  Worm: [500, ['Carrot', 'Strawberry', 'Tomato', 'Apple', 'Aloe']],
  Snail: [1000, ['Blueberry', 'Tomato', 'Corn', 'Daffodil', 'Chrysanthemum']],
  Bee: [1500, ['Strawberry', 'Blueberry', 'Daffodil', 'Lily', 'Chrysanthemum']],
  Chicken: [3000, ['Aloe', 'Corn', 'Watermelon', 'Pumpkin']],
  Bunny: [750, ['Carrot', 'Strawberry', 'Blueberry', 'Tulip', 'Apple']],
  Dragonfly: [250, ['Apple', 'Tulip', 'Echeveria']],
  Pig: [50000, ['Watermelon', 'Pumpkin', 'Eggplant', 'Mushroom', 'Bamboo']],
  Cow: [25000, ['Coconut', 'Banana', "Burro's Tail", 'Mushroom']],
  Turkey: [500, ['Fava Bean', 'Corn', 'Squash']],
  'Snow Fox': [14000, ['Echeveria', 'Squash', 'Grape']],
  Stoat: [10000, ['Banana', 'Pepper', 'Cactus']],
  Caribou: [30000, ['Camellia', "Burro's Tail", 'Mushroom']],
  Squirrel: [15000, ['Pumpkin', 'Banana', 'Grape']],
  Turtle: [100000, ['Watermelon', "Burro's Tail", 'Bamboo', 'Pepper']],
  Goat: [20000, ['Pumpkin', 'Coconut', 'Pepper', 'Camellia', 'Passion Fruit']],
  Sheep: [250, ['Clover', 'Fava Bean', 'Cabbage', 'Four-Leaf Clover']],
  Ostrich: [40000, ['Peach', 'Eggplant', 'Date', 'Violet Cort']],
  Pony: [4000, ['Beet', 'Pear', 'Coconut']],
  Horse: [25000, ['Squash', 'Echeveria', 'Gentian']],
  'Fire Horse': [200000, ['Dragon Fruit', 'Poinsettia', 'Cacao']],
  Bat: [300, ['Clover', 'Cabbage', 'Delphinium']],
  Platypus: [10000, ['Cattail', 'Pear', 'Leek']],
  'Thunder Wolf': [150000, ['Prickly Pear', 'Date', 'Dragon Fruit']],
  Butterfly: [25000, ['Daffodil', 'Lily', 'Grape', 'Lemon', 'Sunflower']],
  Peacock: [100000, ['Cactus', 'Lychee', 'Sunflower']],
  Capybara: [150000, ['Lemon', 'Passion Fruit', 'Dragon Fruit', 'Lychee']],
  Rooster: [1000, ['Corn', 'Daisy', 'Habanero', 'Cardoon']],
  'Red Fox': [75000, ['Peach', 'Persimmon', 'Prickly Pear', 'Violet Cort']],
  Phoenix: [300000, ['Dragon Fruit', 'Saffron', 'Cacao', 'Marigold', 'Milkcap']],
};

// How many hours of XP a pet needs to reach its max strength (wiki "Hours to
// Mature", 10 Sep 2026) and its species' maximum size (the game's pet
// catalog). Size decides max strength: 80 at the smallest, 100 at maxScale.
// maxScale is 2 or 2.5 for every species the catalog shows; null means not
// known yet (the app then assumes 2.5, marks the number as an estimate, and
// corrects itself if one of your pets of that species is bigger than 2).
const GROWTH = {
  Worm: [12, 2], Snail: [12, 2], Bee: [12, 2.5],
  Chicken: [24, 2], Bunny: [24, 2], Dragonfly: [24, 2.5],
  Pig: [72, 2.5], Cow: [72, 2.5], Turkey: [72, 2.5],
  Squirrel: [100, 2], Turtle: [100, 2.5], Goat: [100, 2],
  'Snow Fox': [100, 2], Stoat: [100, 2], Caribou: [100, 2.5],
  Pony: [72, 2], Horse: [100, 2.5], 'Fire Horse': [144, 2.5],
  Butterfly: [144, 2.5], Peacock: [144, 2.5], Capybara: [144, 2.5],
  Sheep: [100, null], Ostrich: [144, null],
  Bat: [100, null], Platypus: [100, null], 'Thunder Wolf': [144, null],
  Rooster: [144, null], 'Red Fox': [144, null], Phoenix: [168, null],
};

// Hatch odds per egg. Since the Bad Luck Protection update every egg is
// 65% / 30% / 5% (the devs' announcement). The game's own table replaces
// these when the app can read it. Game ids on the left.
const EGGS = {
  CommonEgg: { name: 'Common Egg', odds: { Worm: 65, Snail: 30, Bee: 5 } },
  UncommonEgg: { name: 'Uncommon Egg', odds: { Chicken: 65, Bunny: 30, Dragonfly: 5 } },
  RareEgg: { name: 'Rare Egg', odds: { Pig: 65, Cow: 30, Turkey: 5 } },
  LegendaryEgg: { name: 'Legendary Egg', odds: { Squirrel: 65, Turtle: 30, Goat: 5 } },
  MythicalEgg: { name: 'Mythical Egg', odds: { Butterfly: 65, Peacock: 30, Capybara: 5 } },
  WinterEgg: { name: 'Winter Egg', odds: { SnowFox: 65, Stoat: 30, WhiteCaribou: 5 } },
  SnowEgg: { name: 'Snow Egg', odds: { SnowFox: 65, Stoat: 30, WhiteCaribou: 5 } },
  HorseEgg: { name: 'Horse Egg', odds: { Pony: 65, Horse: 30, FireHorse: 5 } },
  DawnEgg: { name: 'Dawn Egg', odds: { Sheep: 65, Horse: 30, Ostrich: 5 } },
  // Not 65/30/5: the game's Bad Luck Protection help lists Fire Horse at 5%
  // and Phoenix at 2%; Rooster and Red Fox from the wiki's table.
  AmberEgg: { name: 'Amber Egg', odds: { Rooster: 60, RedFox: 33, FireHorse: 5, Phoenix: 2 } },
  ThunderEgg: { name: 'Thunder Egg', odds: { Bat: 65, Platypus: 30, ThunderWolf: 5 } },
};

// Bad Luck Protection (the devs' announcement): the rare outcome is
// guaranteed at 2x the expected number of tries. Gold pets (1%) are
// guaranteed on the 200th hatch without one (199 misses), Rainbow (0.1%) on
// the 2000th, a 5% pet on the 40th. For odds that don't divide evenly (30%
// is 6.67) the game's rounding isn't known, so those are marked approximate.
const GUARANTEE_FACTOR = 2;

function guarantee(chancePct) {
  const c = Number(chancePct);
  if (!(c > 0) || c >= 100) return null;
  const exact = (GUARANTEE_FACTOR * 100) / c;
  return { at: Math.round(exact), approx: Math.abs(exact - Math.round(exact)) > 1e-9 };
}

// Every pet has a 1% chance to hatch Gold and 0.1% Rainbow (wiki Pets page),
// before Pet Mutation Boost.
const GOLD_CHANCE = 1;
const RAINBOW_CHANCE = 0.1;

// The game's ids drop spaces and punctuation ("Snow Fox" is "SnowFox",
// "Burro's Tail" is "BurrosTail"), so names are compared in that form. A
// few ids are different words altogether.
const SPECIES_ALIASES = { whitecaribou: 'caribou' };

function norm(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return SPECIES_ALIASES[n] || n;
}

const BY_NORM = {};
for (const [name, [maxHunger, diet]] of Object.entries(PETS)) {
  BY_NORM[norm(name)] = { name, maxHunger, diet, dietNorm: diet.map(norm) };
}
for (const [name, [hours, maxScale]] of Object.entries(GROWTH)) {
  const e = BY_NORM[norm(name)] || (BY_NORM[norm(name)] = { name, diet: [], dietNorm: [] });
  e.hours = hours;
  e.maxScale = maxScale;
}

// The game's own catalog, when the observer could read it (game-data.js).
// Anything it has wins over the tables above.
let LIVE_EGGS = {};
function setLive(catalog) {
  if (!catalog) return;
  for (const [id, p] of Object.entries(catalog.pets || {})) {
    const key = norm(id);
    const e = BY_NORM[key] || (BY_NORM[key] = { name: p.name || id, diet: [], dietNorm: [] });
    if (p.hoursToMature > 0) e.hours = p.hoursToMature;
    if (p.maxScale > 1) {
      e.maxScale = p.maxScale;
      e.maxScaleLive = true;
    }
    if (p.maxHunger > 0 && !e.maxHunger) e.maxHunger = p.maxHunger;
    if (p.name) e.displayName = p.name;
  }
  LIVE_EGGS = {};
  for (const [id, egg] of Object.entries(catalog.eggs || {})) {
    if (egg && egg.weights && Object.keys(egg.weights).length) {
      LIVE_EGGS[id] = { name: egg.name || id, odds: egg.weights, live: true };
    }
  }
}

function lookup(species) {
  return BY_NORM[norm(species)] || null;
}

function prettySpecies(species) {
  const e = lookup(species);
  if (e) return e.displayName || e.name;
  return String(species || 'Pet').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function eggInfo(eggId) {
  const e = LIVE_EGGS[eggId] || EGGS[eggId];
  if (!e) return { name: String(eggId || 'Egg').replace(/([a-z])([A-Z])/g, '$1 $2'), odds: null };
  const total = Object.values(e.odds).reduce((a, b) => a + b, 0) || 1;
  const odds = {};
  for (const [sp, w] of Object.entries(e.odds)) odds[sp] = (w / total) * 100;
  return { name: e.name, odds, live: Boolean(e.live) };
}

function allEggs() {
  const ids = new Set([...Object.keys(EGGS), ...Object.keys(LIVE_EGGS)]);
  return [...ids].map((id) => Object.assign({ id }, eggInfo(id)));
}

// A species' max size isn't always known. If any of your pets of that species
// has grown past 2, it must be a 2.5 species (the only two sizes there are).
function inferMaxScale(species, allPets) {
  const e = lookup(species);
  if (e && e.maxScale) return { maxScale: e.maxScale, estimated: false };
  const key = norm(species);
  const biggest = (allPets || [])
    .filter((p) => norm(p.species) === key)
    .reduce((m, p) => Math.max(m, Number(p.targetScale) || 0), 0);
  if (biggest > 2.0001) return { maxScale: 2.5, estimated: false };
  return { maxScale: 2.5, estimated: true };
}

// Pet strength, worked out the way the game does it (the same maths other
// community mods use, from the Gemini mod's petCalcul):
//   max strength = 80 + 20 x (size - 1) / (species max size - 1)
//   strength     = max - 30, plus 1 for every 1/30th of the species' hours
//                  to mature earned in XP (1 XP a second while out and fed)
function strength(pet, allPets) {
  const e = lookup(pet.species);
  const ts = Number(pet.targetScale);
  const xp = Math.max(0, Number(pet.xp) || 0);
  if (!e || !e.hours || !Number.isFinite(ts)) return null;
  const { maxScale, estimated } = inferMaxScale(pet.species, allPets);
  const ratio = maxScale > 1 ? (ts - 1) / (maxScale - 1) : 0;
  const max = Math.max(50, Math.min(100, Math.floor(80 + 20 * ratio)));
  const matureXp = e.hours * 3600;
  const gained = Math.min(30, Math.floor((xp / matureXp) * 30));
  const now = Math.max(0, Math.min(max, max - 30 + gained));
  return {
    strength: now,
    max,
    estimated,
    hoursToMax: now >= max ? 0 : Math.max(0, (matureXp - xp) / 3600),
  };
}

function eats(info, cropSpecies) {
  const c = norm(cropSpecies);
  return info.dietNorm.some((d) => c === d || c.startsWith(d));
}

const WARN_AT = 0.10;

// Adds max hunger, % full, diet, and whether the trough has something it
// eats to each pet the garden observer reports.
function describePets(pets, trough) {
  const inTrough = (trough && Array.isArray(trough.species) && trough.species) || [];
  return (pets || []).map((p) => {
    const out = Object.assign({}, p);
    const info = lookup(p.species);
    if (info && info.maxHunger && typeof p.hunger === 'number') {
      out.known = true;
      out.maxHunger = info.maxHunger;
      out.pct = Math.max(0, Math.min(1, p.hunger / info.maxHunger));
      out.diet = info.diet;
      out.troughHasFood = inTrough.some((s) => eats(info, s));
      out.needsFood = out.pct <= WARN_AT && !out.troughHasFood;
    } else {
      out.known = false;
      out.needsFood = p.secondsLeft != null && p.secondsLeft <= 300;
    }
    return out;
  });
}

module.exports = {
  PETS, GROWTH, EGGS, GOLD_CHANCE, RAINBOW_CHANCE, GUARANTEE_FACTOR, guarantee,
  lookup, eats, describePets, strength, inferMaxScale, setLive,
  eggInfo, allEggs, prettySpecies, norm, WARN_AT,
};
