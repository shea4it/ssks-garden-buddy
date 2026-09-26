'use strict';

// Pet abilities, from the Magic Garden Wiki's Abilities page
// (magicgarden.wiki/Abilities, edited 17 September 2026).
//
// Everything scales with the pet's strength: the wiki's figures are quoted
// "x STR", meaning the listed value multiplied by strength/100. A Gold
// Granter on a strength-64 pet is 0.72% x 0.64 = 0.46% per minute.
//
// kinds:
//   perMinute  a roll every minute (chance scales with strength)
//   onEvent    a roll when something happens (selling, hatching, harvesting)
//   passive    an always-on percentage

const ABILITIES = {
  // --- coins -------------------------------------------------------------
  CoinFinderI: { name: 'Coin Finder I', group: 'Coins', kind: 'perMinute', chance: 35, coinMax: 120000 },
  CoinFinderII: { name: 'Coin Finder II', group: 'Coins', kind: 'perMinute', chance: 13, coinMax: 1200000 },
  CoinFinderIII: { name: 'Coin Finder III', group: 'Coins', kind: 'perMinute', chance: 6, coinMax: 10000000 },
  CoinFinderIV: { name: 'Coin Finder IV', group: 'Coins', kind: 'perMinute', chance: 3, coinMax: 40000000 },
  DawnCoinFinder: { name: 'Dawn Coin Finder', group: 'Coins', kind: 'perMinute', chance: 45, coinMax: 6000000, weather: 'Dawn' },
  SnowCoinFinder: { name: 'Snow Coin Finder', group: 'Coins', kind: 'perMinute', chance: 15, coinMax: 5000000, weather: 'Snow' },
  ThunderCoinFinder: { name: 'Thunder Coin Finder', group: 'Coins', kind: 'perMinute', chance: 35, coinMax: 5500000, weather: 'Thunderstorms' },

  // --- selling -----------------------------------------------------------
  SellBoostI: { name: 'Sell Boost I', group: 'Selling', kind: 'onEvent', chance: 10, bonusPct: 20, per: 'sale' },
  SellBoostII: { name: 'Sell Boost II', group: 'Selling', kind: 'onEvent', chance: 12, bonusPct: 30, per: 'sale' },
  SellBoostIII: { name: 'Sell Boost III', group: 'Selling', kind: 'onEvent', chance: 14, bonusPct: 40, per: 'sale' },
  SellBoostIV: { name: 'Sell Boost IV', group: 'Selling', kind: 'onEvent', chance: 16, bonusPct: 50, per: 'sale' },
  CropEater: { name: 'Crop Eater', group: 'Selling', kind: 'perMinute', chance: 60, note: 'Eats and sells a non-mutated crop, at +150% x STR' },
  CropRefund: { name: 'Crop Refund', group: 'Selling', kind: 'onEvent', chance: 20, per: 'sale', note: 'Crops come back when sold' },
  DoubleHarvest: { name: 'Double Harvest', group: 'Selling', kind: 'onEvent', chance: 5, per: 'harvest', note: 'An extra crop' },

  // --- crop mutations ----------------------------------------------------
  GoldGranter: { name: 'Gold Granter', group: 'Crop mutations', kind: 'perMinute', chance: 0.72, grants: 'Gold' },
  RainbowGranter: { name: 'Rainbow Granter', group: 'Crop mutations', kind: 'perMinute', chance: 0.72, grants: 'Rainbow' },
  RainGranter: { name: 'Rain Granter', group: 'Crop mutations', kind: 'perMinute', chance: 10, grants: 'Wet' },
  SnowGranter: { name: 'Snow Granter', group: 'Crop mutations', kind: 'perMinute', chance: 8, grants: 'Chilled' },
  FrostGranter: { name: 'Frost Granter', group: 'Crop mutations', kind: 'perMinute', chance: 6, grants: 'Frozen' },
  ThunderstruckGranter: { name: 'Thunderstruck Granter', group: 'Crop mutations', kind: 'perMinute', chance: 5, grants: 'Thunderstruck' },
  DawnlitGranter: { name: 'Dawnlit Granter', group: 'Crop mutations', kind: 'perMinute', chance: 4, grants: 'Dawnlit' },
  AmberlitGranter: { name: 'Amberlit Granter', group: 'Crop mutations', kind: 'perMinute', chance: 2, grants: 'Amberlit' },

  WeatherMutationBoostI: { name: 'Weather Mutation Boost I', group: 'Crop mutations', kind: 'passive', boostPct: 15, note: 'More weather mutations' },
  WeatherMutationBoostII: { name: 'Weather Mutation Boost II', group: 'Crop mutations', kind: 'passive', boostPct: 20, note: 'More weather mutations' },
  AmberMoonBoost: { name: 'Amber Moon Boost', group: 'Crop mutations', kind: 'passive', boostPct: 40, weather: 'Amber Moon' },
  DawnBoost: { name: 'Dawn Boost', group: 'Crop mutations', kind: 'passive', boostPct: 36, weather: 'Dawn' },
  DawnbinderBoost: { name: 'Dawnbinder Boost', group: 'Crop mutations', kind: 'passive', boostPct: 40, note: 'Dawnbinder activating' },
  SnowBoost: { name: 'Snow Boost', group: 'Crop mutations', kind: 'passive', boostPct: 32, weather: 'Snow' },
  ThunderBoost: { name: 'Thunder Boost', group: 'Crop mutations', kind: 'passive', boostPct: 34, weather: 'Thunderstorms' },

  CropSizeBoostI: { name: 'Crop Size Boost I', group: 'Crop size', kind: 'perMinute', chance: 0.3, sizePct: 6 },
  CropSizeBoostII: { name: 'Crop Size Boost II', group: 'Crop size', kind: 'perMinute', chance: 0.4, sizePct: 10 },
  SnowCropSizeBoost: { name: 'Snow Crop Size Boost', group: 'Crop size', kind: 'perMinute', chance: 0.8, sizePct: 12, weather: 'Snow' },

  // --- growth ------------------------------------------------------------
  PlantGrowthBoostI: { name: 'Plant Growth Boost I', group: 'Growing', kind: 'perMinute', chance: 24, minutesOff: 3 },
  PlantGrowthBoostII: { name: 'Plant Growth Boost II', group: 'Growing', kind: 'perMinute', chance: 27, minutesOff: 5 },
  PlantGrowthBoostIII: { name: 'Plant Growth Boost III', group: 'Growing', kind: 'perMinute', chance: 30, minutesOff: 7 },
  AmberPlantGrowthBoost: { name: 'Amber Plant Growth Boost', group: 'Growing', kind: 'perMinute', chance: 80, minutesOff: 6, weather: 'Amber Moon' },
  DawnPlantGrowthBoost: { name: 'Dawn Plant Growth Boost', group: 'Growing', kind: 'perMinute', chance: 60, minutesOff: 6, weather: 'Dawn' },
  SnowPlantGrowthBoost: { name: 'Snow Plant Growth Boost', group: 'Growing', kind: 'perMinute', chance: 40, minutesOff: 6, weather: 'Snow' },
  ThunderPlantGrowthBoost: { name: 'Thunder Plant Growth Boost', group: 'Growing', kind: 'perMinute', chance: 50, minutesOff: 6, weather: 'Thunderstorms' },

  // --- eggs and hatching -------------------------------------------------
  EggGrowthBoostI: { name: 'Egg Growth Boost I', group: 'Eggs', kind: 'perMinute', chance: 21, minutesOff: 7 },
  EggGrowthBoostII: { name: 'Egg Growth Boost II', group: 'Eggs', kind: 'perMinute', chance: 24, minutesOff: 9 },
  EggGrowthBoostIII: { name: 'Egg Growth Boost III', group: 'Eggs', kind: 'perMinute', chance: 27, minutesOff: 11 },
  AmberEggGrowthBoost: { name: 'Amber Egg Growth Boost', group: 'Eggs', kind: 'perMinute', chance: 90, minutesOff: 16, weather: 'Amber Moon' },
  ThunderEggGrowthBoost: { name: 'Thunder Egg Growth Boost', group: 'Eggs', kind: 'perMinute', chance: 50, minutesOff: 10, weather: 'Thunderstorms' },
  DoubleHatchI: { name: 'Double Hatch I', group: 'Eggs', kind: 'onEvent', chance: 3, per: 'hatch', note: 'An extra pet' },
  DoubleHatchII: { name: 'Double Hatch II', group: 'Eggs', kind: 'onEvent', chance: 5, per: 'hatch', note: 'An extra pet' },
  HatchXPBoostI: { name: 'Hatch XP Boost I', group: 'Eggs', kind: 'onEvent', chance: 50, per: 'hatch', xp: 8000 },
  HatchXPBoostII: { name: 'Hatch XP Boost II', group: 'Eggs', kind: 'onEvent', chance: 60, per: 'hatch', xp: 12000 },
  HatchXPBoostIII: { name: 'Hatch XP Boost III', group: 'Eggs', kind: 'onEvent', chance: 70, per: 'hatch', xp: 16000 },
  PetMutationBoostI: { name: 'Pet Mutation Boost I', group: 'Eggs', kind: 'passive', boostPct: 7, note: 'Gold/Rainbow pets from eggs' },
  PetMutationBoostII: { name: 'Pet Mutation Boost II', group: 'Eggs', kind: 'passive', boostPct: 10, note: 'Gold/Rainbow pets from eggs' },
  PetMutationBoostIII: { name: 'Pet Mutation Boost III', group: 'Eggs', kind: 'passive', boostPct: 13, note: 'Gold/Rainbow pets from eggs' },
  MaxStrengthBoostI: { name: 'Max Strength Boost I', group: 'Eggs', kind: 'onEvent', chance: 12, per: 'hatch', boostPct: 2.4, note: 'Higher max strength' },
  MaxStrengthBoostII: { name: 'Max Strength Boost II', group: 'Eggs', kind: 'onEvent', chance: 14, per: 'hatch', boostPct: 3.5, note: 'Higher max strength' },

  // --- pets --------------------------------------------------------------
  XPBoostI: { name: 'XP Boost I', group: 'Pets', kind: 'perMinute', chance: 30, xp: 300 },
  XPBoostII: { name: 'XP Boost II', group: 'Pets', kind: 'perMinute', chance: 35, xp: 400 },
  AmberXPBoost: { name: 'Amber XP Boost', group: 'Pets', kind: 'perMinute', chance: 90, xp: 1400, weather: 'Amber Moon' },
  DawnXPBoost: { name: 'Dawn XP Boost', group: 'Pets', kind: 'perMinute', chance: 75, xp: 850, weather: 'Dawn' },
  SnowXPBoost: { name: 'Snow XP Boost', group: 'Pets', kind: 'perMinute', chance: 50, xp: 450, weather: 'Snow' },
  ThunderXPBoost: { name: 'Thunder XP Boost', group: 'Pets', kind: 'perMinute', chance: 65, xp: 650, weather: 'Thunderstorms' },
  HungerBoostI: { name: 'Hunger Boost I', group: 'Pets', kind: 'passive', hungerPct: 12 },
  HungerBoostII: { name: 'Hunger Boost II', group: 'Pets', kind: 'passive', hungerPct: 16 },
  SnowHungerBoost: { name: 'Snow Hunger Boost', group: 'Pets', kind: 'passive', hungerPct: 30, weather: 'Snow' },
  HungerRestoreI: { name: 'Hunger Restore I', group: 'Pets', kind: 'perMinute', chance: 12, restorePct: 30 },
  HungerRestoreII: { name: 'Hunger Restore II', group: 'Pets', kind: 'perMinute', chance: 14, restorePct: 35 },
  HungerRestoreIII: { name: 'Hunger Restore III', group: 'Pets', kind: 'perMinute', chance: 16, restorePct: 40 },
  Rebirth: { name: 'Rebirth', group: 'Pets', kind: 'perMinute', chance: 20, note: 'Refills a starving pet' },
  PetRefundI: { name: 'Pet Refund I', group: 'Pets', kind: 'onEvent', chance: 5, per: 'pet sold', note: 'Pet comes back as an egg' },
  PetRefundII: { name: 'Pet Refund II', group: 'Pets', kind: 'onEvent', chance: 7, per: 'pet sold', note: 'Pet comes back as an egg' },
  DustBoost: { name: 'Dust Boost', group: 'Pets', kind: 'onEvent', chance: 10, per: 'pet sold', boostPct: 20, note: 'Bonus magic dust' },

  // --- seeds and specials ------------------------------------------------
  SeedFinderI: { name: 'Seed Finder I', group: 'Seeds', kind: 'perMinute', chance: 40, note: 'Common and uncommon seeds' },
  SeedFinderII: { name: 'Seed Finder II', group: 'Seeds', kind: 'perMinute', chance: 20, note: 'Rare and legendary seeds' },
  SeedFinderIII: { name: 'Seed Finder III', group: 'Seeds', kind: 'perMinute', chance: 10, note: 'Mythical seeds' },
  SeedFinderIV: { name: 'Seed Finder IV', group: 'Seeds', kind: 'perMinute', chance: 0.72, note: 'A divine seed' },
  AmberCapture: { name: 'Amber Capture', group: 'Specials', kind: 'charge', seconds: 300, note: 'Turns Amber mutations into capsules' },
  DawnCapture: { name: 'Dawn Capture', group: 'Specials', kind: 'charge', seconds: 300, note: 'Turns Dawn mutations into capsules' },
  Thundercharger: { name: 'Thundercharger', group: 'Specials', kind: 'charge', seconds: 300, note: 'Thunderstruck becomes Thundercharged' },

  // Not on the wiki's page; numbers from the game's own catalog (an older
  // copy, so the live one replaces them when the app can read it).
  CropSizeBoostIII: { name: 'Crop Size Boost III', group: 'Crop size', kind: 'perMinute', chance: 0.5, sizePct: 9, older: true },
  WeatherMutationBoostIII: { name: 'Weather Mutation Boost III', group: 'Crop mutations', kind: 'passive', boostPct: 25, note: 'More weather mutations', older: true },
  HungerBoostIII: { name: 'Hunger Boost III', group: 'Pets', kind: 'passive', hungerPct: 20, older: true },
  SnowHungerRestore: { name: 'Snow Hunger Restore', group: 'Pets', kind: 'perMinute', chance: 15, restorePct: 38, weather: 'Snow', older: true },
  SnowEggGrowthBoost: { name: 'Snow Egg Growth Boost', group: 'Eggs', kind: 'perMinute', chance: 40, minutesOff: 10, weather: 'Snow', older: true },
  Copycat: { name: 'Copycat', group: 'Specials', kind: 'special', note: 'Copies another ability', older: true },
};

// The game's own ids, where they differ from the names above. From the
// game's pet ability catalog: Crop Size Boost is ProduceScaleBoost, XP Boost
// is PetXpBoost, Hatch XP Boost is PetAgeBoost, Max Strength Boost is
// PetHatchSizeBoost, and so on. Note the game's EggGrowthBoostII is the
// wiki's Egg Growth Boost III (EggGrowthBoostII_NEW is II).
const GAME_IDS = {
  ProduceScaleBoost: 'CropSizeBoostI', ProduceScaleBoostII: 'CropSizeBoostII', ProduceScaleBoostIII: 'CropSizeBoostIII',
  SnowyCropSizeBoost: 'SnowCropSizeBoost',
  ProduceEater: 'CropEater', ProduceRefund: 'CropRefund',
  DoubleHatch: 'DoubleHatchI',
  PlantGrowthBoost: 'PlantGrowthBoostI', SnowyPlantGrowthBoost: 'SnowPlantGrowthBoost',
  ProduceMutationBoost: 'WeatherMutationBoostI', ProduceMutationBoostII: 'WeatherMutationBoostII', ProduceMutationBoostIII: 'WeatherMutationBoostIII',
  SnowyCropMutationBoost: 'SnowBoost',
  PetMutationBoost: 'PetMutationBoostI',
  RainDance: 'RainGranter',
  EggGrowthBoost: 'EggGrowthBoostI', EggGrowthBoostII_NEW: 'EggGrowthBoostII', EggGrowthBoostII: 'EggGrowthBoostIII',
  SnowyEggGrowthBoost: 'SnowEggGrowthBoost',
  PetAgeBoost: 'HatchXPBoostI', PetAgeBoostII: 'HatchXPBoostII', PetAgeBoostIII: 'HatchXPBoostIII',
  PetHatchSizeBoost: 'MaxStrengthBoostI', PetHatchSizeBoostII: 'MaxStrengthBoostII',
  PetXpBoost: 'XPBoostI', PetXpBoostII: 'XPBoostII', SnowyPetXpBoost: 'SnowXPBoost',
  HungerRestore: 'HungerRestoreI', SnowyHungerRestore: 'SnowHungerRestore',
  HungerBoost: 'HungerBoostI', SnowyHungerBoost: 'SnowHungerBoost',
  PetRefund: 'PetRefundI',
  SnowyCoinFinder: 'SnowCoinFinder',
};

function norm(id) {
  return String(id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BY_NORM = {};
for (const [id, data] of Object.entries(ABILITIES)) BY_NORM[norm(id)] = Object.assign({ id }, data);
const GAME_BY_NORM = {};
for (const [gameId, id] of Object.entries(GAME_IDS)) GAME_BY_NORM[norm(gameId)] = id;

// The game's live catalog (game-data.js), keyed by the game's ids.
let LIVE = {};
function setLive(catalog) {
  LIVE = {};
  for (const [id, a] of Object.entries((catalog && catalog.abilities) || {})) LIVE[norm(id)] = Object.assign({ gameId: id }, a);
}

const WEATHER_NAMES = { frost: 'Snow', snow: 'Snow', ambermoon: 'Amber Moon', dawn: 'Dawn', thunderstorm: 'Thunderstorms', rain: 'Rain' };
const MUTATION_NAMES = { ambershine: 'Amberlit', dawncharged: 'Dawnbound', ambercharged: 'Amberbound' };
const TRIGGER_PER = { sellallcrops: 'sale', sellcrop: 'sale', hatchegg: 'hatch', harvest: 'harvest', harvestcrop: 'harvest', sellpet: 'pet sold' };

// Fills in what the live catalog says over the built-in numbers. The
// built-in entry still decides the group and kind; the game decides chances
// and amounts.
function applyLive(def, live) {
  const p = live.params || {};
  const out = Object.assign({}, def);
  if (live.name) out.name = live.name;
  if (live.chance != null && out.kind !== 'passive' && out.kind !== 'charge') out.chance = live.chance;
  if (p.sizeIncrease != null) out.sizePct = p.sizeIncrease;
  if (p.cropSellPriceIncreasePercentage != null) out.bonusPct = p.cropSellPriceIncreasePercentage;
  if (p.plantGrowthReductionMinutes != null) out.minutesOff = p.plantGrowthReductionMinutes;
  if (p.eggGrowthTimeReductionMinutes != null) out.minutesOff = p.eggGrowthTimeReductionMinutes;
  if (p.mutationChanceIncreasePercentage != null) out.boostPct = p.mutationChanceIncreasePercentage;
  if (p.maxStrengthIncreasePercentage != null) out.boostPct = p.maxStrengthIncreasePercentage;
  if (p.bonusXp != null) out.xp = p.bonusXp;
  if (p.hungerRestorePercentage != null) out.restorePct = p.hungerRestorePercentage;
  if (p.hungerDepletionRateDecreasePercentage != null) out.hungerPct = p.hungerDepletionRateDecreasePercentage;
  if (p.baseMaxCoinsFindable != null) out.coinMax = p.baseMaxCoinsFindable;
  if (Array.isArray(p.grantedMutations) && p.grantedMutations[0]) {
    const m = String(p.grantedMutations[0]);
    out.grants = MUTATION_NAMES[norm(m)] || m;
  }
  if (p.requiredWeather) out.weather = WEATHER_NAMES[norm(p.requiredWeather)] || String(p.requiredWeather);
  out.live = true;
  out.older = false;
  return out;
}

// An ability only the live catalog knows about (one added to the game
// after this app was written): best guess at what it does, from its numbers.
function fromLive(live) {
  const p = live.params || {};
  let group = 'Specials';
  let kind = live.chance != null ? 'perMinute' : 'passive';
  if (p.grantedMutations) group = 'Crop mutations';
  else if (p.sizeIncrease != null) group = 'Crop size';
  else if (p.baseMaxCoinsFindable != null) group = 'Coins';
  else if (p.cropSellPriceIncreasePercentage != null) group = 'Selling';
  else if (p.plantGrowthReductionMinutes != null) group = 'Growing';
  else if (p.eggGrowthTimeReductionMinutes != null) group = 'Eggs';
  else if (p.bonusXp != null || p.hungerRestorePercentage != null || p.hungerDepletionRateDecreasePercentage != null) group = 'Pets';
  else if (p.mutationChanceIncreasePercentage != null) group = 'Crop mutations';
  const trig = norm(live.trigger);
  if (trig && trig !== 'continuous' && live.chance != null) kind = 'onEvent';
  const base = { id: live.gameId, name: live.name || String(live.gameId).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(I{1,3})$/, '$1 $2'), group, kind, per: TRIGGER_PER[trig] || 'use', chance: live.chance };
  return applyLive(base, live);
}

function lookup(id) {
  const key = norm(id);
  const canonical = GAME_BY_NORM[key] || id;
  const builtIn = BY_NORM[norm(canonical)] || null;
  const live = LIVE[key] || null;
  if (builtIn && live) return applyLive(builtIn, live);
  if (builtIn) return builtIn;
  if (live) return fromLive(live);
  return null;
}

const DEFAULT_STRENGTH = 70;

function everyText(perHour) {
  if (!(perHour > 0)) return 'never';
  if (perHour >= 1) return `${perHour >= 10 ? Math.round(perHour) : perHour.toFixed(1)} an hour`;
  const h = 1 / perHour;
  return h < 48 ? `1 every ${h < 10 ? h.toFixed(1) : Math.round(h)} h` : `1 every ${(h / 24).toFixed(1)} days`;
}

// For things that happen: "about 3 times an hour", "about once every 2.3 h".
function oftenText(perHour) {
  if (!(perHour > 0)) return 'never';
  if (perHour >= 1.5) return `about ${perHour >= 10 ? Math.round(perHour) : perHour.toFixed(1)} times an hour`;
  if (perHour >= 0.95) return 'about once an hour';
  const h = 1 / perHour;
  return h < 48 ? `about once every ${h < 10 ? h.toFixed(1) : Math.round(h)} h` : `about once every ${(h / 24).toFixed(1)} days`;
}

function shortNum(n) {
  const v = Number(n) || 0;
  for (const [size, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (v >= size) return (v / size).toFixed(v / size >= 100 ? 0 : 1).replace(/\.0$/, '') + suffix;
  }
  return String(Math.round(v));
}

// What an ability is for, so pets can be compared goal by goal.
const GOALS = [
  { id: 'gold', label: '🟡 Gold crops' },
  { id: 'rainbow', label: '🌈 Rainbow crops' },
  { id: 'coins', label: '🪙 Coins found' },
  { id: 'sell', label: '💰 Selling' },
  { id: 'size', label: '📏 Crop size' },
  { id: 'weatherBoost', label: '🌦️ Weather mutation chance' },
  { id: 'grant:Wet', label: '💧 Wet crops' },
  { id: 'grant:Chilled', label: '❄️ Chilled crops' },
  { id: 'grant:Frozen', label: '🧊 Frozen crops' },
  { id: 'grant:Thunderstruck', label: '⚡ Thunderstruck crops' },
  { id: 'grant:Dawnlit', label: '🌅 Dawnlit crops' },
  { id: 'grant:Amberlit', label: '🌕 Amberlit crops' },
  { id: 'growth', label: '🌱 Plant growth' },
  { id: 'eggs', label: '🥚 Egg growth' },
  { id: 'hatchXp', label: '🐣 Hatch XP' },
  { id: 'maxStrength', label: '💪 Max strength' },
  { id: 'petMutation', label: '✨ Gold/Rainbow pets' },
  { id: 'doubleHatch', label: '👯 Double hatch' },
  { id: 'xp', label: '⭐ Pet XP' },
  { id: 'hunger', label: '🍖 Hunger' },
  { id: 'seeds', label: '🌰 Seed finding' },
  { id: 'special', label: '✨ Special' },
];

function goalOf(a) {
  if (a.grants === 'Gold') return 'gold';
  if (a.grants === 'Rainbow') return 'rainbow';
  if (a.grants) return 'grant:' + a.grants;
  if (a.coinMax) return 'coins';
  if (a.group === 'Selling') return 'sell';
  if (a.sizePct) return 'size';
  if (a.group === 'Crop mutations' && a.kind === 'passive') return 'weatherBoost';
  if (a.group === 'Growing') return 'growth';
  if (a.group === 'Eggs' && a.minutesOff) return 'eggs';
  if (a.group === 'Eggs') {
    if (/double hatch/i.test(a.name)) return 'doubleHatch';
    if (/max strength/i.test(a.name) || a.id === 'MaxStrengthBoostI' || a.id === 'MaxStrengthBoostII') return 'maxStrength';
    if (a.kind === 'passive' || /pet mutation/i.test(a.name)) return 'petMutation';
    if (a.xp) return 'hatchXp';
    return 'special';
  }
  if (a.xp && a.kind === 'perMinute') return 'xp';
  if (a.restorePct || a.hungerPct || /Rebirth/.test(a.name)) return 'hunger';
  if (a.group === 'Seeds') return 'seeds';
  return 'special';
}

// What one ability does for one pet, at that pet's strength, in plain words.
// score is the number used to rank pets for the ability's goal (bigger is
// better); text says it the way a person would.
function describe(ability, strength) {
  const str = Number(strength) || DEFAULT_STRENGTH;
  const s = str / 100;
  const out = {
    id: ability.id, name: ability.name, group: ability.group, kind: ability.kind,
    weather: ability.weather || null, note: ability.note || null, goal: goalOf(ability),
    live: Boolean(ability.live), older: Boolean(ability.older),
  };

  if (ability.kind === 'charge') {
    out.seconds = ability.seconds / s;
    out.text = `${ability.note || 'Charges up'}, every ${Math.round(out.seconds / 60 * 10) / 10} min`;
    out.score = 3600 / out.seconds;
    return out;
  }
  if (ability.kind === 'special') {
    out.text = ability.note || 'Special ability';
    out.score = 0;
    return out;
  }
  if (ability.kind === 'passive') {
    const pct = (ability.boostPct || ability.hungerPct || 0) * s;
    out.pct = pct;
    out.score = pct;
    if (ability.hungerPct) out.text = `pets get hungry ${pct.toFixed(1)}% slower`;
    else if (out.goal === 'petMutation') out.text = `Gold/Rainbow pets ${pct.toFixed(1)}% more likely from eggs`;
    else if (ability.note && /Dawnbinder/.test(ability.note)) out.text = `Dawnbinder works ${pct.toFixed(0)}% more often`;
    else out.text = `+${pct.toFixed(1)}% chance of weather mutations`;
    return out;
  }

  const chance = (ability.chance || 0) * s;
  out.chance = chance;

  if (ability.kind === 'perMinute') {
    const perHour = (chance / 100) * 60;
    out.perHour = perHour;
    if (ability.grants) {
      out.score = perHour;
      out.text = `turns a crop ${String(ability.grants).replace(/`/g, '')}, ${oftenText(perHour)}`;
    } else if (ability.coinMax) {
      out.coinsPerHour = (perHour * ability.coinMax * s) / 2;
      out.score = out.coinsPerHour;
      out.text = `about ${shortNum(out.coinsPerHour)} coins an hour`;
    } else if (ability.sizePct) {
      out.sizeStep = ability.sizePct * s;
      out.score = perHour * out.sizeStep;
      out.text = `+${out.sizeStep.toFixed(1)} size to every crop, ${oftenText(perHour)}`;
    } else if (ability.minutesOff) {
      const each = ability.minutesOff * s;
      out.score = perHour * each;
      out.text = `${ability.group === 'Eggs' ? 'eggs' : 'plants'} hatch/grow about ${Math.round(out.score)} min sooner every hour`;
      if (ability.group !== 'Eggs') out.text = `plants grow about ${Math.round(out.score)} min sooner every hour`;
      else out.text = `eggs hatch about ${Math.round(out.score)} min sooner every hour`;
    } else if (ability.xp) {
      out.score = perHour * ability.xp * s;
      out.text = `about ${shortNum(out.score)} XP an hour to your pets`;
    } else if (ability.restorePct) {
      out.score = perHour * ability.restorePct * s;
      out.text = `refills ${Math.round(ability.restorePct * s)}% of a pet's hunger, ${oftenText(perHour)}`;
    } else if (ability.group === 'Seeds') {
      out.score = perHour;
      out.text = `finds ${ability.note ? ability.note.toLowerCase().replace(/^(an?|common) /, (m) => m) : 'a seed'}, ${oftenText(perHour)}`;
    } else if (ability.note) {
      out.score = perHour;
      out.text = `${ability.note.toLowerCase()}, ${oftenText(perHour)}`;
    } else {
      out.score = perHour;
      out.text = `${chance.toFixed(chance < 1 ? 2 : 1)}% a minute`;
    }
    return out;
  }

  // onEvent: rolls when you sell, hatch, harvest...
  out.score = chance;
  if (ability.bonusPct) {
    out.sellChance = chance;
    out.sellBonus = ability.bonusPct * s;
    out.score = (chance / 100) * out.sellBonus;
    out.text = `${chance.toFixed(0)}% chance of +${out.sellBonus.toFixed(0)}% when you sell (≈ +${out.score.toFixed(1)}% on average)`;
  } else if (ability.xp) {
    out.score = (chance / 100) * ability.xp * s;
    out.text = `${chance.toFixed(0)}% chance a new pet starts with +${shortNum(ability.xp * s)} XP (≈ +${shortNum(out.score)} a hatch)`;
  } else if (ability.boostPct) {
    out.score = (chance / 100) * ability.boostPct * s;
    out.text = `${chance.toFixed(0)}% chance a new pet gets +${(ability.boostPct * s).toFixed(1)}% max strength`;
  } else if (out.goal === 'doubleHatch') {
    out.text = `${chance.toFixed(1)}% chance an egg gives you an extra pet`;
  } else {
    out.text = `${chance.toFixed(1)}% chance per ${ability.per || 'use'}${ability.note ? ': ' + ability.note.toLowerCase() : ''}`;
  }
  return out;
}

function sumText(goal, rows) {
  const sum = rows.reduce((a, r) => a + (r.score || 0), 0);
  switch (goal) {
    case 'gold': case 'rainbow': return `a crop turns ${goal === 'gold' ? 'Gold' : 'Rainbow'} ${oftenText(sum)}`;
    case 'coins': return `about ${shortNum(sum)} coins an hour`;
    case 'sell': {
      const none = rows.reduce((a, r) => a * (1 - (r.sellChance || 0) / 100), 1);
      return `${((1 - none) * 100).toFixed(0)}% chance of a bonus when you sell, ≈ +${sum.toFixed(1)}% on average`;
    }
    case 'size': return `every crop grows about +${sum.toFixed(2)} size an hour`;
    case 'weatherBoost': return `+${sum.toFixed(1)}% chance of weather mutations`;
    case 'growth': return `plants grow about ${Math.round(sum)} min sooner every hour`;
    case 'eggs': return `eggs hatch about ${Math.round(sum)} min sooner every hour`;
    case 'xp': return `about ${shortNum(sum)} XP an hour for your pets`;
    case 'hatchXp': return `new pets start with about +${shortNum(sum)} XP on average`;
    case 'maxStrength': {
      const none = rows.reduce((a, r) => a * (1 - (r.chance || 0) / 100), 1);
      return `${((1 - none) * 100).toFixed(0)}% chance a new pet gets a max strength boost (≈ +${sum.toFixed(2)}% a hatch)`;
    }
    case 'petMutation': return `Gold/Rainbow pets ${sum.toFixed(1)}% more likely`;
    case 'doubleHatch': {
      const none = rows.reduce((a, r) => a * (1 - (r.chance || 0) / 100), 1);
      return `${((1 - none) * 100).toFixed(1)}% chance an egg hatches twice`;
    }
    default:
      if (goal.startsWith('grant:')) return `a crop turns ${goal.slice(6)} ${oftenText(sum)}`;
      return rows.map((r) => r.text).join('; ');
  }
}

// Adds up what a team does, goal by goal. Abilities that need weather only
// count while that weather is on (pass the current weather's label, or
// null); the rest are listed separately.
function summarise(pets, opts) {
  const o = opts || {};
  const rows = [];
  const unknown = [];
  for (const pet of pets || []) {
    const strength = pet.strength || DEFAULT_STRENGTH;
    for (const id of pet.abilities || []) {
      const ability = lookup(id);
      if (!ability) {
        if (!unknown.includes(String(id))) unknown.push(String(id));
        continue;
      }
      rows.push(Object.assign(describe(ability, strength), { petId: pet.id, petName: pet.name, strength }));
    }
  }
  const isOn = (r) => !r.weather || (o.weatherMatches ? o.weatherMatches(r.weather) : false);
  const totals = [];
  const waiting = [];
  for (const g of GOALS) {
    const mine = rows.filter((r) => r.goal === g.id);
    if (!mine.length) continue;
    const on = mine.filter(isOn);
    const off = mine.filter((r) => !isOn(r));
    if (on.length) totals.push({ goal: g.id, label: g.label, text: sumText(g.id, on) });
    for (const r of off) waiting.push({ goal: g.id, label: g.label, weather: r.weather, text: r.text, petName: r.petName });
  }
  return { rows, totals, waiting, unknown, defaultStrength: DEFAULT_STRENGTH };
}

/* ------------------------------------------------------------------ *
 * Team recommendations
 *
 * Each preset is a goal made of ability goals with weights. For every pet
 * you own, each of its abilities is scored against the best pet you own for
 * that ability goal (so coins, sell boosts and Gold rates can be added up
 * fairly), weighted, and summed. The top three make the team.
 * Abilities that need weather only count in that weather's preset.
 * ------------------------------------------------------------------ */

const PRESETS = [
  { id: 'money', label: '💰 Money', why: 'coins found plus a better price when you sell', goals: { coins: 1, sell: 1.2 }, anyGoal: true },
  { id: 'gold', label: '🟡 Gold crops', why: 'turning crops Gold (25x their price)', goals: { gold: 1 } },
  { id: 'rainbow', label: '🌈 Rainbow crops', why: 'turning crops Rainbow (50x their price)', goals: { rainbow: 1 } },
  { id: 'goldrainbow', label: '✨ Gold & Rainbow', why: 'both, with Rainbow counted double since it\'s worth twice as much', goals: { rainbow: 2, gold: 1 } },
  { id: 'thunder', label: '⛈️ Thunderstorm', why: 'Thunderstruck crops and more weather mutations', goals: { 'grant:Thunderstruck': 1, weatherBoost: 0.6 }, weather: 'thunder' },
  { id: 'rain', label: '🌧️ Rain', why: 'Wet crops and more weather mutations', goals: { 'grant:Wet': 1, weatherBoost: 0.6 }, weather: 'rain' },
  { id: 'snow', label: '❄️ Snow', why: 'Chilled and Frozen crops, and the Snow-only abilities', goals: { 'grant:Chilled': 1, 'grant:Frozen': 1, weatherBoost: 0.6, size: 0.4 }, weather: 'snow' },
  { id: 'dawn', label: '🌅 Dawn', why: 'Dawnlit crops and more lunar mutations', goals: { 'grant:Dawnlit': 1, weatherBoost: 0.6 }, weather: 'dawn' },
  { id: 'amber', label: '🌕 Amber Moon', why: 'Amberlit crops and more lunar mutations', goals: { 'grant:Amberlit': 1, weatherBoost: 0.6 }, weather: 'amber' },
  { id: 'size', label: '📏 Crop size', why: 'growing every crop to full size', goals: { size: 1 } },
  { id: 'growth', label: '🌱 Faster growing', why: 'plants growing sooner', goals: { growth: 1 } },
  { id: 'hatching', label: '🥚 Hatching', why: 'better eggs: hatch XP, max strength, Gold/Rainbow pets, double hatches and faster eggs', goals: { petMutation: 1.2, doubleHatch: 1, maxStrength: 1, hatchXp: 0.7, eggs: 0.7 }, anyGoal: true },
  { id: 'leveling', label: '⭐ Leveling pets', why: 'XP for the pets that are out', goals: { xp: 1, hunger: 0.3 } },
];

// pets: [{ id, name, strength, abilityInfo: [describe() rows] }]
// weatherKind(label) -> 'rain' | 'snow' | 'thunder' | 'dawn' | 'amber' | ...
function recommend(pets, weatherKind) {
  const all = (pets || []).filter((p) => p && Array.isArray(p.abilityInfo));
  const out = [];
  for (const preset of PRESETS) {
    const counts = (a) => a.score > 0 && preset.goals[a.goal] && (!a.weather || (preset.weather && weatherKind(a.weather) === preset.weather));
    // The best single ability you own for each goal, to scale against.
    const best = {};
    for (const p of all) for (const a of p.abilityInfo) if (counts(a)) best[a.goal] = Math.max(best[a.goal] || 0, a.score);
    const scored = all.map((p) => {
      let score = 0;
      const reasons = [];
      for (const a of p.abilityInfo) {
        if (!counts(a) || !best[a.goal]) continue;
        const part = preset.goals[a.goal] * (a.score / best[a.goal]);
        score += part;
        reasons.push({ part, text: `${a.name}: ${a.text}` });
      }
      reasons.sort((x, y) => y.part - x.part);
      return { pet: p, score, reasons: reasons.map((r) => r.text) };
    }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score);
    // Only offer a preset if you own a pet for its main job (a Rain team
    // needs something that makes crops Wet, not just a general boost).
    const top = Math.max(...Object.values(preset.goals));
    // Presets that bundle several jobs (Money, Hatching) just need any one.
    const main = Object.keys(preset.goals).filter((g) => preset.anyGoal || preset.goals[g] === top);
    if (!main.some((g) => best[g])) continue;
    if (!scored.length) continue;
    out.push({
      id: preset.id,
      label: preset.label,
      why: preset.why,
      weather: preset.weather || null,
      picks: scored.slice(0, 3).map((x) => ({ id: x.pet.id, score: Math.round(x.score * 100) / 100, reasons: x.reasons.slice(0, 2) })),
      candidates: scored.length,
    });
  }
  return out;
}

module.exports = { PRESETS, recommend, ABILITIES, GAME_IDS, GOALS, lookup, describe, summarise, setLive, goalOf, everyText, oftenText, DEFAULT_STRENGTH };
