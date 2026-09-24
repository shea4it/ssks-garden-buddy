'use strict';

// Crop sell values. Prices and max sizes from magicgarden.wiki/Crops;
// the mutation multipliers from magicgarden.wiki/Multipliers.
//
//   value = base sell price x size multiplier x mutation multiplier
//
// Size in the game runs 50 to 100, and the size multiplier runs from 1x at
// size 50 up to the crop's max multiplier at size 100.
//
// Mutations: Gold (25x) and Rainbow (50x) are exclusive, and weather
// conditions stack by adding and then subtracting one each:
//   total = variant x (sum of conditions - count + 1)

// Base sell price and max size multiplier, from magicgarden.wiki/Crops
// ("List of Crops", checked 23 Sep 2026; page last edited 13 Sep 2026).
const CROPS = {
  Carrot: [20, 3], Cabbage: [42, 3], Strawberry: [14, 2],
  Aloe: [310, 2.5], Beet: [350, 3], Clover: [30, 3],
  'Four-Leaf Clover': [7777, 3], Rose: [300, 4], Delphinium: [530, 3],
  Snowdrop: [250, 1.85], 'Double Snowdrop': [8888, 1.85], 'Fava Bean': [30, 3],
  Blueberry: [23, 2], Apple: [800, 2], Tulip: [767, 3],
  Tomato: [27, 2], Daisy: [130, 2.5], 'Purple Daisy': [9999, 2.5],
  Daffodil: [1090, 3], Corn: [36, 2], Watermelon: [2708, 3],
  Pumpkin: [3700, 3], Echeveria: [3200, 2.75], Cattail: [1800, 2.5],
  'Variegated Cattail': [11111, 2.5], Pear: [3000, 2], Gentian: [10000, 3],
  Lavender: [20000, 3], Coconut: [12000, 3], 'Pine Tree': [75000, 3.5],
  Banana: [1750, 1.7], Leek: [35000, 3], Lily: [20123, 2.75],
  Camellia: [4875, 2.5], Squash: [7000, 2.5], Peach: [9000, 3],
  "Burro's Tail": [6000, 2.5], Cardoon: [50000, 3], Saffron: [50000, 3],
  Persimmon: [25000, 2.5], Mushroom: [160000, 3.5], Cactus: [220000, 1.8],
  Bamboo: [500000, 2], 'Violet Cort': [600000, 3.5], Chrysanthemum: [18000, 2.75],
  Habanero: [15000, 2.5], Date: [15000, 2], Grape: [50000, 2],
  Poinsettia: [20000, 2], 'Prickly Pear': [75000, 2.5], Eggplant: [100000, 2.5],
  Pepper: [7000, 2], Lemon: [50000, 3], 'Passion Fruit': [200000, 2],
  'Dragon Fruit': [30000, 2], Cacao: [150000, 2.5], Lychee: [50000, 2],
  Milkcap: [3000000, 3], Ube: [2000000, 3], Sunflower: [750000, 2.5],
  Marigold: [1000000, 2.5], Thunderpeel: [100000, 2], Stormcap: [1000000, 2],
  Dawnbreaker: [12000000, 3], Emberbloom: [5000000, 2.5], Embercrown: [15000000, 2.5],
  Starweaver: [10000000, 2], Dawnbinder: [11000000, 2.5], Moonbinder: [11000000, 2],
};

// The game's own ids for a few crops don't match the wiki's names.
const ALIASES = {
  dawncelestial: 'Dawnbinder',
  mooncelestial: 'Moonbinder',
  starcelestial: 'Starweaver',
};

// Plants whose fruit slots carry the plant's id rather than the fruit's.
// Thunderspire (game id ThunderCelestial) has 12 slots that grow Thunderpeel
// and 4 more that grow Stormcap during Thunderstorms (magicgarden.wiki/Thunderspire).
// A slot is priced as the second fruit if anything in it names that fruit,
// or if its slotId is at or past the first extra slot (0-based 12). The
// slot numbering is an inference: confirm with a sample taken while
// Stormcaps are growing.
const SPLIT_SPECIES = {
  // Stormcaps turned out to be stored as their own crop (the owner's garden
  // listed 16 unidentified crops: 4 Thunderspires x 4 mushroom spots), so
  // every plain Thunderspire slot is a Thunderpeel. See PATTERNS for them.
  thundercelestial: { main: 'Thunderpeel', extra: 'Stormcap', extraFromSlot: 999, plantDecides: true },
  // Emberbloom (Amber Shop) likely follows the same naming. Embercrown is
  // its rare variant (wiki): counted as one only if the slot names it.
  embercelestial: { main: 'Emberbloom', extra: 'Embercrown', extraFromSlot: 999 },
  ambercelestial: { main: 'Emberbloom', extra: 'Embercrown', extraFromSlot: 999 },
};

// Crop ids matched by pattern when the exact id isn't known yet. The
// Thunderspire's mushroom (Stormcap on the wiki; "Thundercap" to some
// players) is stored under an id with "thunder" and "shroom"/"cap" in it.
const PATTERNS = [
  ['^thunder.*(shroom|mushroom|cap)', 'Stormcap'],
  ['^(storm|thunder)cap', 'Stormcap'],
];

const VARIANTS = { gold: 25, rainbow: 50 };
const CONDITIONS = {
  wet: 2, chilled: 2, frozen: 6, thunderstruck: 5, thundercharged: 7,
  dawnlit: 4, dawnbound: 7, amberlit: 6, amberbound: 10,
};

// The game's internal mutation names, where they differ from what the wiki
// and the game's own labels say. The wiki's icon files give two of these
// away: Dawnbound's icon is MutationDawncharged.png and Amberbound's is
// MutationAmbercharged.png. Ambershine is the old name for Amberlit (it was
// "Amberglow" before a rename) and is the one educated guess here.
const MUTATION_ALIASES = {
  dawncharged: 'dawnbound',
  ambercharged: 'amberbound',
  ambershine: 'amberlit',
  amberglow: 'amberlit',
};

// Display names for every mutation this app knows, keyed by normalised name.
const MUTATION_NAMES = {
  gold: 'Gold', rainbow: 'Rainbow',
  wet: 'Wet', chilled: 'Chilled', frozen: 'Frozen',
  thunderstruck: 'Thunderstruck', thundercharged: 'Thundercharged',
  dawnlit: 'Dawnlit', dawnbound: 'Dawnbound', amberlit: 'Amberlit', amberbound: 'Amberbound',
};

// The scoring function. It is written in plain old JavaScript on purpose: the
// app uses it here, and the garden observer runs the very same function inside
// the game page (see browserSource below), so there is only one copy of the
// maths to keep right.
//
// bucket collects anything that couldn't be priced, so the app can say which
// crops and which mutations were left out instead of guessing.
function makeScorer(table, cropAliases, variants, conditions, mutationAliases, splitSpecies, patterns) {
  var norm = function (x) {
    return String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]/g, '');
  };
  var byNorm = {};
  for (var name in table) byNorm[norm(name)] = table[name];

  return function score(crop, bucket) {
    var species = crop && (crop.species || crop.speciesId || crop.cropSpecies);
    var key = norm(species);
    var split = splitSpecies && splitSpecies[key];
    if (split) {
      var isExtra = Number(crop.slotId) >= split.extraFromSlot;
      var extraKey = norm(split.extra);
      for (var field in crop) {
        if (field !== 'species' && field !== 'mutations' && typeof crop[field] === 'string' && norm(crop[field]).indexOf(extraKey) >= 0) isExtra = true;
      }
      key = norm(isExtra ? split.extra : split.main);
    }
    var found = byNorm[cropAliases[key] ? norm(cropAliases[key]) : key];
    if (!found && patterns) {
      for (var p = 0; p < patterns.length && !found; p += 1) {
        if (new RegExp(patterns[p][0]).test(key)) found = byNorm[norm(patterns[p][1])];
      }
    }
    var variant = 1;
    var sum = 0;
    var count = 0;
    var muts = (crop && crop.mutations) || [];
    for (var i = 0; i < muts.length; i += 1) {
      var m = norm(muts[i]);
      if (mutationAliases[m]) m = mutationAliases[m];
      if (variants[m]) variant = Math.max(variant, variants[m]);
      else if (conditions[m]) {
        sum += conditions[m];
        count += 1;
      } else if (bucket && bucket.unknownMutations.indexOf(String(muts[i])) < 0) {
        bucket.unknownMutations.push(String(muts[i]));
      }
    }
    if (!found) {
      if (bucket) {
        bucket.unpriced += 1;
        var label = String(species || 'unknown');
        bucket.unpricedSpecies[label] = (bucket.unpricedSpecies[label] || 0) + 1;
      }
      return 0;
    }
    var size = Math.max(50, Math.min(100, Number(crop.size) || 50));
    var sizeMult = 1 + ((size - 50) / 50) * (found[1] - 1);
    return found[0] * sizeMult * variant * (count ? sum - count + 1 : 1);
  };
}

const score = makeScorer(CROPS, ALIASES, VARIANTS, CONDITIONS, MUTATION_ALIASES, SPLIT_SPECIES, PATTERNS);

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function lookup(species) {
  let key = norm(species);
  if (SPLIT_SPECIES[key]) key = norm(SPLIT_SPECIES[key].main);
  for (const [re, target] of PATTERNS) if (!CROPS[key] && new RegExp(re).test(key) && !Object.keys(CROPS).some((n) => norm(n) === key)) key = norm(target);
  const want = ALIASES[key] ? norm(ALIASES[key]) : key;
  for (const [name, [price, maxMult]] of Object.entries(CROPS)) {
    if (norm(name) === want) return { name, price, maxMult };
  }
  return null;
}

// The canonical name for a mutation as the game stores it ("Dawncharged"
// becomes "Dawnbound"). Unknown names come back as they were.
function mutationName(raw) {
  let m = norm(raw);
  if (MUTATION_ALIASES[m]) m = MUTATION_ALIASES[m];
  return MUTATION_NAMES[m] || String(raw);
}

// The sell value of one unpicked crop.
function cropValue(crop) {
  const bucket = { unpriced: 0, unpricedSpecies: {}, unknownMutations: [] };
  const value = score(crop, bucket);
  return { value, knownSpecies: bucket.unpriced === 0, unknown: bucket.unknownMutations };
}

// What the garden observer needs, as source code to run in the game page
// before the game starts: the scorer and the mutation-name table.
function browserSource() {
  const args = [CROPS, ALIASES, VARIANTS, CONDITIONS, MUTATION_ALIASES, SPLIT_SPECIES, PATTERNS].map((a) => JSON.stringify(a)).join(', ');
  return [
    `window.__MG_CROP_VALUE = (${makeScorer.toString()})(${args});`,
    `window.__MG_MUTATION_ALIASES = ${JSON.stringify(MUTATION_ALIASES)};`,
    `window.__MG_MUTATION_NAMES = ${JSON.stringify(MUTATION_NAMES)};`,
    '',
  ].join('\n');
}

module.exports = {
  CROPS, ALIASES, SPLIT_SPECIES, PATTERNS, VARIANTS, CONDITIONS, MUTATION_ALIASES, MUTATION_NAMES,
  cropValue, lookup, mutationName, browserSource, makeScorer,
};
