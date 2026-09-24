'use strict';

// Bad Luck Protection tracker.
//
// The game's rules (its own "Bad Luck Protection" help, Sept 2026):
// - Every plant, egg, and capsule has its own counter for each rare outcome:
//   Carrot's Gold is separate from Tomato's Gold, and a Common Egg's Bee
//   progress does nothing for a Rare Egg's Turkey.
// - Except Gold and Rainbow pets: the owner confirmed those are one counter
//   each across every egg (any hatch that isn't Gold adds to the Gold
//   counter, whatever the egg). They're the 'pet' source 'AnyEgg' here.
// - A pull is one rolled outcome: one hatch, one crop grown (every crop a
//   patch or multi-harvest plant fills, and every regrow), one capsule opened.
// - A miss adds one; getting the outcome resets it to zero, lucky or forced.
//   "Guaranteed by pull 200" means after 199 straight misses the next pull is
//   forced. Every threshold is 2x the pulls the listed rate would average,
//   and only outcomes at 5% or rarer are protected.
// - Species and mutations are separate rolls. Gold and Rainbow share one
//   roll: a Rainbow resets Rainbow, and Gold stays due (a Rainbow is a Gold
//   miss).
// - When chance decides what a plant grows (a Daisy patch can grow Purple
//   Daisies), one set of counters covers the plant. When the plant decides (a
//   Thunderspire's Stormcaps grow in fixed spots), each crop keeps its own.
// - Not pulls: Double Hatch bonus pets, and Gold/Rainbow from pet abilities
//   (Granters). Weather mutations have no protection.
//
// The game keeps the real counters on its server and doesn't send them to
// the game page (other mods found the same: serverOnly.pityCounters). So the
// app counts the pulls it sees. Accounts from before the update started at
// halfway on every counter, so by default a counter the app hasn't seen yet
// starts at half its threshold, marked as an estimate. Any number can be
// typed over.

const cropData = require('./crop-data');

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Percent chances, from the game's Bad Luck Protection help.
const EGG_RARES = {
  CommonEgg: { Bee: 5 },
  UncommonEgg: { Dragonfly: 5 },
  RareEgg: { Turkey: 5 },
  LegendaryEgg: { Goat: 5 },
  SnowEgg: { WhiteCaribou: 5 },
  WinterEgg: { WhiteCaribou: 5 },
  DawnEgg: { Ostrich: 5 },
  ThunderEgg: { ThunderWolf: 5 },
  AmberEgg: { FireHorse: 5, Phoenix: 2 },
  MythicalEgg: { Capybara: 5 },
};
const PLANT_RARES = {
  Daisy: { PurpleDaisy: 0.4 },
  Clover: { FourLeafClover: 0.4 },
  Snowdrop: { DoubleSnowdrop: 0.4 },
  Cattail: { VariegatedCattail: 0.4 },
  Emberbloom: { Embercrown: 0.4 },
};
const CAPSULE_RARES = {
  DawnCapsule: { Dawnbreaker: 0.5, Ube: 2.5 },
  AmberCapsule: { StrengthShard: 0.5, XPShard: 2.5 },
};
const GOLD = 1;
const RAINBOW = 0.1;

// Friendlier names for ids.
const NAMES = {
  AnyEgg: 'any egg',
  WhiteCaribou: 'Caribou', ThunderWolf: 'Thunder Wolf', FireHorse: 'Fire Horse',
  PurpleDaisy: 'Purple Daisy', FourLeafClover: 'Four-Leaf Clover', DoubleSnowdrop: 'Double Snowdrop',
  VariegatedCattail: 'Variegated Cattail', Dawnbreaker: 'Dawnbreaker Spore', Ube: 'Ube Seed',
  StrengthShard: 'Strength Shard', XPShard: 'XP Shard', DawnCapsule: 'Dawn Capsule', AmberCapsule: 'Amber Capsule',
  gold: 'Gold', rainbow: 'Rainbow',
};
function pretty(id) {
  if (NAMES[id]) return NAMES[id];
  return String(id || '').replace(/Egg$/, ' Egg').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

function threshold(chancePct) {
  return Math.round(200 / chancePct);
}

// Live thresholds from the game's catalog, when the app could read them
// (eggs carry speciesPityThresholdPulls).
let LIVE_EGG = {};
function setLive(catalog) {
  LIVE_EGG = {};
  for (const [id, egg] of Object.entries((catalog && catalog.eggs) || {})) {
    if (egg && egg.pity && typeof egg.pity === 'object' && Object.keys(egg.pity).length) LIVE_EGG[id] = egg.pity;
  }
}

// Every target a source has: [{ target, chance, threshold, kind }].
function targets(type, source) {
  const out = [];
  if (type === 'egg') {
    const live = LIVE_EGG[source];
    if (live) {
      for (const [sp, t] of Object.entries(live)) out.push({ target: sp, threshold: Number(t), chance: 200 / Number(t), kind: 'species' });
    } else {
      for (const [sp, c] of Object.entries(EGG_RARES[source] || {})) out.push({ target: sp, chance: c, threshold: threshold(c), kind: 'species' });
    }
  }
  if (type === 'plant') {
    const key = Object.keys(PLANT_RARES).find((k) => norm(k) === norm(source));
    for (const [v, c] of Object.entries(key ? PLANT_RARES[key] : {})) out.push({ target: v, chance: c, threshold: threshold(c), kind: 'variant' });
  }
  if (type === 'capsule') {
    for (const [it, c] of Object.entries(CAPSULE_RARES[source] || {})) out.push({ target: it, chance: c, threshold: threshold(c), kind: 'item' });
  }
  if (type === 'pet' || type === 'plant') {
    out.push({ target: 'gold', chance: GOLD, threshold: threshold(GOLD), kind: 'mutation' });
    out.push({ target: 'rainbow', chance: RAINBOW, threshold: threshold(RAINBOW), kind: 'mutation' });
  }
  return out;
}

function migrate(l) {
  const luck = l && typeof l === 'object' ? l : {};
  luck.version = 1;
  luck.counters = luck.counters && typeof luck.counters === 'object' ? luck.counters : {};
  if (luck.startHalf === undefined) luck.startHalf = true;
  luck.notify = Object.assign({ egg: true, plant: true, capsule: true }, luck.notify);
  luck.capsuleSeen = luck.capsuleSeen && typeof luck.capsuleSeen === 'object' ? luck.capsuleSeen : null;
  luck.hits = Array.isArray(luck.hits) ? luck.hits.slice(-100) : [];
  luck.primedSaid = luck.primedSaid && typeof luck.primedSaid === 'object' ? luck.primedSaid : {};
  // v0.15.0 kept Gold/Rainbow per egg; they're shared. Merge any per-egg
  // ones into the shared counter, keeping the highest (nobody loses ground).
  for (const target of ['gold', 'rainbow']) {
    const old = Object.keys(luck.counters).filter((k) => k.startsWith('egg:') && k.endsWith(':' + target));
    if (!old.length) continue;
    const shared = keyOf('pet', 'AnyEgg', target);
    const best = old.map((k) => luck.counters[k]).reduce((a, c) => (!a || c.v > a.v ? c : a), luck.counters[shared] || null);
    luck.counters[shared] = Object.assign({}, best, { v: best.v });
    for (const k of old) {
      delete luck.counters[k];
      delete luck.primedSaid[k];
    }
  }
  return luck;
}

function keyOf(type, source, target) {
  return `${type}:${source}:${target}`;
}

function startValue(luck, t) {
  return luck.startHalf ? Math.round(t.threshold / 2) : 0;
}

function counter(luck, type, source, t) {
  const k = keyOf(type, source, t.target);
  if (!luck.counters[k]) luck.counters[k] = { v: startValue(luck, t), est: luck.startHalf, pulls: 0, hits: 0 };
  return luck.counters[k];
}

// One pull. hit(target) says whether this pull got that target.
function pull(luck, type, source, hit, at) {
  const events = [];
  for (const t of targets(type, source)) {
    const c = counter(luck, type, source, t);
    c.pulls += 1;
    if (hit(t)) {
      events.push({ type, source, target: t.target, kind: t.kind, after: c.v + 1, forced: c.v >= t.threshold - 1 });
      luck.hits.push({ at: at || Date.now(), type, source, target: t.target, after: c.v + 1 });
      c.v = 0;
      c.hits += 1;
      c.est = false;
    } else {
      c.v += 1;
    }
  }
  if (luck.hits.length > 100) luck.hits.splice(0, luck.hits.length - 100);
  return events;
}

function hasMut(mutations, name) {
  return (mutations || []).some((m) => norm(m) === name);
}

// An egg hatch (a hatchEgg log entry; never a Double Hatch bonus pet).
function onEgg(luck, h) {
  if (!h || !h.eggId) return [];
  // The egg's own rare pets...
  const events = pull(luck, 'egg', h.eggId, (t) =>
    norm(t.target) === norm(h.species) || (norm(t.target) === 'whitecaribou' && norm(h.species) === 'caribou'), h.at);
  // ...and the shared Gold / Rainbow pet counters.
  events.push(...pull(luck, 'pet', 'AnyEgg', (t) => hasMut(h.mutations, t.target), h.at));
  for (const e of events) e.species = h.species;
  return events;
}

// Hatches that happened while the app was away and have since dropped off
// the game's log: which egg they were is unknown, but they still count toward
// the shared Gold / Rainbow pet counters (as misses; a Gold or Rainbow among
// them would be very unlikely, and would have reset the counter anyway).
function onUnknownHatches(luck, n) {
  const count = Math.max(0, Math.min(2000, Math.floor(Number(n) || 0)));
  for (let i = 0; i < count; i += 1) pull(luck, 'pet', 'AnyEgg', () => false);
}

// Which counters a crop belongs to. Plants whose fruit is decided by the
// plant (a Thunderspire's fixed Stormcap spots) count per fruit; the rest
// count per plant.
function plantSource(c) {
  const split = cropData.SPLIT_SPECIES && cropData.SPLIT_SPECIES[norm(c.plant || c.crop)];
  if (split && split.plantDecides) {
    // Thunderspire: its Stormcaps are their own crop; the rest are Thunderpeels.
    const other = norm(c.crop) && norm(c.crop) !== norm(c.plant);
    const found = other ? cropData.lookup(c.crop) : null;
    return found ? found.name : split.main;
  }
  if (split) return split.main; // Emberbloom: chance decides, one set of counters
  const plant = cropData.ALIASES && cropData.ALIASES[norm(c.plant)];
  return plant || String(c.plant || c.crop || 'Plant');
}

// A crop that just appeared in the garden. Its mutations at that moment are
// its natural ones (pet Granters add theirs later, and those don't count).
function onCrop(luck, c) {
  const source = plantSource(c);
  return pull(luck, 'plant', source, (t) => {
    if (t.target === 'gold') return hasMut(c.mutations, 'gold');
    if (t.target === 'rainbow') return hasMut(c.mutations, 'rainbow');
    return norm(c.crop).includes(norm(t.target)) || (norm(t.target) === 'fourleafclover' && norm(c.crop).includes('fourleaf'));
  }, c.at);
}

// The game's running capsule totals (stats.capsulePulls). Works across app
// restarts: the difference since last time is what was opened. If a batch
// of opens included a hit, the counter is set as if the hit came last.
function onCapsuleStats(luck, stats) {
  const events = [];
  if (!stats || typeof stats !== 'object') return events;
  const now = {};
  for (const [capsule, s] of Object.entries(stats)) {
    if (!s || typeof s !== 'object') continue;
    const items = Object.assign({}, s.speciesPulled || {}, s.toolsPulled || {});
    now[capsule] = { opens: Number(s.numOpens) || 0, items };
  }
  if (!luck.capsuleSeen) {
    luck.capsuleSeen = now;
    return events;
  }
  for (const [capsule, cur] of Object.entries(now)) {
    const was = luck.capsuleSeen[capsule] || { opens: 0, items: {} };
    const opens = cur.opens - was.opens;
    if (opens <= 0 || opens > 5000) continue;
    for (const t of targets('capsule', capsule)) {
      const find = (items) => {
        const k = Object.keys(items).find((x) => norm(x) === norm(t.target) || norm(x).includes(norm(t.target).replace('shard', '')) && /shard/i.test(x) === /shard/i.test(t.target));
        return k ? Number(items[k]) || 0 : 0;
      };
      const got = find(cur.items) - find(was.items);
      const c = counter(luck, 'capsule', capsule, t);
      c.pulls += opens;
      if (got > 0) {
        events.push({ type: 'capsule', source: capsule, target: t.target, kind: t.kind, after: c.v + opens });
        luck.hits.push({ at: Date.now(), type: 'capsule', source: capsule, target: t.target, after: c.v + opens });
        c.v = 0;
        c.hits += got;
        c.est = false;
      } else {
        c.v += opens;
      }
    }
  }
  luck.capsuleSeen = now;
  return events;
}

// Counters whose next pull is guaranteed. Each is reported once per streak.
function newlyPrimed(luck) {
  const out = [];
  for (const [k, c] of Object.entries(luck.counters)) {
    const [type, source, target] = k.split(':');
    const t = targets(type, source).find((x) => x.target === target);
    if (!t) continue;
    const primed = c.v >= t.threshold - 1;
    if (!primed) {
      delete luck.primedSaid[k];
      continue;
    }
    if (luck.primedSaid[k]) continue;
    luck.primedSaid[k] = true;
    if (luck.notify[type === 'pet' ? 'egg' : type] === false) continue;
    out.push({ key: k, type, source, target, estimated: Boolean(c.est) });
  }
  return out;
}

function describePrimed(p) {
  const what = p.target === 'gold' ? (p.type === 'pet' ? 'a Gold pet' : 'Gold')
    : p.target === 'rainbow' ? (p.type === 'pet' ? 'a Rainbow pet' : 'Rainbow')
      : pretty(p.target);
  if (p.type === 'pet') return `Your next hatch, any egg, is guaranteed to be ${what}`;
  if (p.type === 'egg') return `Your next ${pretty(p.source)} is a guaranteed ${what}`;
  if (p.type === 'capsule') return `Your next ${pretty(p.source)} is a guaranteed ${what}`;
  if (p.target === 'gold' || p.target === 'rainbow') return `Your next ${pretty(p.source)} crop is guaranteed ${what}`;
  return `Your next ${pretty(p.source)} crop is a guaranteed ${what}`;
}

// Everything for the panel: every source the app knows or has seen.
function view(luck) {
  const sources = { pet: new Set(['AnyEgg']), egg: new Set(Object.keys(EGG_RARES).filter((e) => e !== 'WinterEgg')), plant: new Set(), capsule: new Set(Object.keys(CAPSULE_RARES)) };
  for (const k of Object.keys(luck.counters)) {
    const [type, source] = k.split(':');
    if (sources[type]) sources[type].add(source);
  }
  const groups = {};
  for (const type of ['pet', 'egg', 'plant', 'capsule']) {
    groups[type] = [...sources[type]].map((source) => ({
      source,
      name: type === 'pet' ? 'Gold & Rainbow pets (any egg)' : pretty(source),
      rows: targets(type, source).map((t) => {
        const c = luck.counters[keyOf(type, source, t.target)];
        const v = c ? c.v : startValue(luck, t);
        return {
          key: keyOf(type, source, t.target),
          target: t.target,
          name: type === 'pet' ? `${pretty(t.target)} pet` : pretty(t.target),
          chance: t.chance,
          threshold: t.threshold,
          value: v,
          left: Math.max(1, t.threshold - v),
          primed: v >= t.threshold - 1,
          estimated: c ? Boolean(c.est) : luck.startHalf,
          seen: Boolean(c),
          pulls: c ? c.pulls : 0,
        };
      }),
    })).sort((a, b) => Math.min(...a.rows.map((r) => r.left)) - Math.min(...b.rows.map((r) => r.left)));
  }
  const primed = [];
  for (const type of Object.keys(groups)) {
    for (const g of groups[type]) for (const r of g.rows) if (r.primed) primed.push({ type, source: g.source, target: r.target, key: r.key, estimated: r.estimated, text: describePrimed({ type, source: g.source, target: r.target }) });
  }
  return { groups, primed, startHalf: luck.startHalf, notify: luck.notify, hits: luck.hits.slice(-30).reverse().map((h) => Object.assign({}, h, { sourceName: pretty(h.source), targetName: pretty(h.target) })) };
}

function set(luck, key, value) {
  const [type, source, target] = String(key).split(':');
  const t = targets(type, source).find((x) => x.target === target);
  if (!t) return false;
  const c = counter(luck, type, source, t);
  c.v = Math.max(0, Math.min(t.threshold - 1, Math.floor(Number(value) || 0)));
  c.est = false;
  delete luck.primedSaid[key];
  return true;
}

module.exports = {
  migrate, onEgg, onUnknownHatches, onCrop, onCapsuleStats, newlyPrimed, describePrimed, view, set, setLive,
  targets, threshold, pretty, EGG_RARES, PLANT_RARES, CAPSULE_RARES,
};
