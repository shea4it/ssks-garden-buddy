'use strict';

// Bad Luck Protection tracker.
//
// The game's rules (its own "Bad Luck Protection" help, Sept 2026):
// - Every plant, egg, and capsule has its own counter for each rare outcome:
//   Carrot's Gold is separate from Tomato's Gold, and a Common Egg's Bee
//   progress does nothing for a Rare Egg's Turkey. "Nothing is
//   account-wide." That includes Gold and Rainbow pets: each egg kind keeps
//   its own (v0.74.0, from the game's help, after a Gold "due" on a Thunder
//   Egg didn't come: 0.56.x-0.73 had them as one count across every egg,
//   the 'pet' source 'AnyEgg', now retired).
// - When guarantees from the same roll are due together (two species from
//   one egg, Gold and Rainbow, two capsule items), the rarer wins; the other
//   isn't spent: it keeps climbing and stays due until a pull doesn't
//   naturally roll something rarer. Species and mutations are separate
//   rolls, so a hatch can force both (a guaranteed Rainbow Thunder Wolf).
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
// app counts the pulls it sees.
//
// Measured, not guessed (v0.72.0, the owner): a counter only counts once
// the app has seen its result happen (a Gold pet hatch, a Thunder Wolf, a
// Dawnbreaker Spore...), because only then does it know where the game's
// counter is: zero. Until then it's "waiting for the first one": no number,
// no heads-up, no hatch warning. (It used to start halfway, and a guess
// that was too high called a Gold pet that didn't come.) A measured counter
// that misses when the game would have forced the result has lost track (a
// pull it didn't see) and waits for the next one again.
//
// A count you type is measured too (v0.72.1): you tracked it yourself. It's
// marked `typed` until the app sees the result itself. 0.72.0 reset those
// with the guesses (the owner's Rainbow pet count, kept by hand from before
// the app); v0.72.1 keeps them when it upgrades older saves and brings them
// back from a backup made before 0.72.0 (recover()).

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
  SpookyEgg: { Toad: 5 },
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
  // Gold and Rainbow, per egg and per plant (v0.74.0). 'pet' (the retired
  // one-count-for-every-egg source) only so old saves can still be read.
  if (type === 'egg' || type === 'pet' || type === 'plant') {
    out.push({ target: 'gold', chance: GOLD, threshold: threshold(GOLD), kind: 'mutation' });
    out.push({ target: 'rainbow', chance: RAINBOW, threshold: threshold(RAINBOW), kind: 'mutation' });
  }
  return out;
}
// Outcomes that come from one roll (and so compete when due together):
// an egg's or plant's species / variant, its mutation, a capsule's item.
function rollOf(t) {
  return t.kind === 'mutation' ? 'mutation' : t.kind === 'item' ? 'item' : 'species';
}

function migrate(l) {
  const luck = l && typeof l === 'object' ? l : {};
  luck.counters = luck.counters && typeof luck.counters === 'object' ? luck.counters : {};
  // v0.72.0: counters the app never saw reset were guesses: they wait now.
  // Counts you typed are yours, so they stay (v0.72.1). (Only once: after
  // this, 'known' is kept by pull itself.)
  if (!(luck.version >= 2)) {
    for (const [k, c] of Object.entries(luck.counters)) {
      if (!c || typeof c !== 'object') continue;
      const typed = wasTyped(k, c);
      c.known = (Number(c.hits) || 0) > 0 || typed;
      if (typed) c.typed = true;
      if (!c.known) c.v = 0;
      delete c.est;
    }
    luck.primedSaid = {};
    // Nothing to bring back from a backup: this save still had its counts.
    luck.recovered = luck.recovered || { at: Date.now(), from: 'upgrade', keys: [] };
  }
  // v0.74.0: Gold and Rainbow pets are per egg, not one count for every egg
  // (the game's help: "Nothing is account-wide"). The old shared counts
  // can't be split by egg, so each egg's start waiting; the old ones are
  // kept aside (retired) in case they're ever wanted.
  if (!(luck.version >= 3)) {
    // Every hatch the app has counted, for the hatch check (the shared Gold
    // count used to be it).
    const shared = luck.counters['pet:AnyEgg:gold'];
    if (!Number.isFinite(luck.allHatches)) luck.allHatches = shared ? Number(shared.pulls) || 0 : auditRaw(luck).seen;
    for (const k of Object.keys(luck.counters)) {
      if (!k.startsWith('pet:')) continue;
      luck.retired = Object.assign({}, luck.retired, { [k]: Object.assign({ at: Date.now() }, luck.counters[k]) });
      delete luck.counters[k];
      if (luck.primedSaid) delete luck.primedSaid[k];
    }
  }
  luck.version = 3;
  luck.startHalf = false;
  luck.notify = Object.assign({ egg: true, plant: true, capsule: true }, luck.notify);
  luck.capsuleSeen = luck.capsuleSeen && typeof luck.capsuleSeen === 'object' ? luck.capsuleSeen : null;
  luck.hits = Array.isArray(luck.hits) ? luck.hits.slice(-100) : [];
  luck.primedSaid = luck.primedSaid && typeof luck.primedSaid === 'object' ? luck.primedSaid : {};
  // Where the hatch check starts (v0.56.11).
  if (!luck.auditBase || typeof luck.auditBase !== 'object') {
    const r = auditRaw(luck);
    luck.auditBase = { seen: r.seen, all: r.all, at: Date.now() };
  }
  return luck;
}

function keyOf(type, source, target) {
  return `${type}:${source}:${target}`;
}

function thresholdOf(key) {
  const [type, source, target] = String(key).split(':');
  const t = targets(type, source).find((x) => x.target === target);
  return t ? t.threshold : null;
}

// A counter from before v0.72.0 that holds a number you typed: never reset
// by a hit, not the halfway estimate (`est`), started above zero (the app
// itself started at zero or halfway), and still short of the guarantee (one
// past it can't be right). The owner's Rainbow pet count: v 1227 from 180
// pulls, so it started at 1047.
function wasTyped(key, c) {
  if (!c || typeof c !== 'object' || c.est === true || (Number(c.hits) || 0) > 0) return false;
  const thr = thresholdOf(key);
  const v = Number(c.v) || 0;
  return thr != null && v - (Number(c.pulls) || 0) > 0 && v <= thr - 1;
}

// Bring back counts you typed from a save made before v0.72.0 (a daily
// backup), for counters 0.72.0 reset to waiting that haven't had their
// result since. Every pull the app counted after that save is added (pulls
// only go up). A count that would now be past its guarantee stays waiting.
// Returns what came back: [{ key, name, v }].
function recover(luck, old) {
  const out = [];
  const counters = old && old.counters && typeof old.counters === 'object' ? old.counters : null;
  if (!counters || (old.version >= 2)) return out;
  for (const [k, o] of Object.entries(counters)) {
    if (!wasTyped(k, o)) continue;
    const cur = luck.counters[k];
    if (!cur || cur.known || (Number(cur.hits) || 0) !== (Number(o.hits) || 0)) continue;
    const since = (Number(cur.pulls) || 0) - (Number(o.pulls) || 0);
    if (since < 0) continue;
    const v = (Number(o.v) || 0) + since;
    if (v > thresholdOf(k) - 1) continue;
    cur.v = v;
    cur.known = true;
    cur.typed = true;
    const [type, , target] = k.split(':');
    out.push({ key: k, name: type === 'pet' ? `${pretty(target)} pet` : pretty(target), v });
  }
  return out;
}

function counter(luck, type, source, t) {
  const k = keyOf(type, source, t.target);
  if (!luck.counters[k]) luck.counters[k] = { v: 0, known: false, pulls: 0, hits: 0 };
  return luck.counters[k];
}

// One pull. hit(target) says whether this pull got that target.
function pull(luck, type, source, hit, at) {
  const events = [];
  const all = targets(type, source);
  const got = all.filter((t) => hit(t));
  for (const t of all) {
    const c = counter(luck, type, source, t);
    c.pulls += 1;
    // A rarer outcome from the same roll came out: a due guarantee here
    // isn't spent, it waits (the game's "the rarer one wins").
    const outranked = got.some((x) => x !== t && rollOf(x) === rollOf(t) && x.chance < t.chance);
    if (got.includes(t)) {
      events.push({ type, source, target: t.target, kind: t.kind, after: c.known ? c.v + 1 : null, forced: Boolean(c.known && c.v >= t.threshold - 1), first: !c.known });
      luck.hits.push({ at: at || Date.now(), type, source, target: t.target, after: c.known ? c.v + 1 : null });
      // Now the count is known: zero, like the game's.
      c.v = 0;
      c.hits += 1;
      c.known = true;
      delete c.typed;
    } else if (c.known && c.v >= t.threshold - 1 && !outranked) {
      // The game would have forced it, so a pull went unseen: start over at
      // the next one rather than count past the guarantee.
      c.known = false;
      c.v = 0;
      delete c.typed;
      c.lost = (Number(c.lost) || 0) + 1;
    } else if (c.known) {
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
  luck.allHatches = (Number(luck.allHatches) || 0) + 1;
  // The egg's own counters (v0.74.0: its Gold and Rainbow too): its rare
  // pets by species, Gold and Rainbow by the pet's mutation.
  const events = pull(luck, 'egg', h.eggId, (t) => (t.kind === 'mutation'
    ? hasMut(h.mutations, t.target)
    : norm(t.target) === norm(h.species) || (norm(t.target) === 'whitecaribou' && norm(h.species) === 'caribou')), h.at);
  for (const e of events) e.species = h.species;
  return events;
}

// Hatches that happened while the app was away and have since dropped off
// the game's log: which egg they were is unknown, and every counter is per
// egg (v0.74.0), so they can't be counted anywhere. That egg's counts are
// then behind the game's: a guarantee comes sooner than they say, never
// later. (The hatch check still notes how many.)
function onUnknownHatches(luck, n) {
  const count = Math.max(0, Math.min(2000, Math.floor(Number(n) || 0)));
  luck.allHatches = (Number(luck.allHatches) || 0) + count;
  return [];
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
    const find = (items, t) => {
      const k = Object.keys(items).find((x) => norm(x) === norm(t.target) || norm(x).includes(norm(t.target).replace('shard', '')) && /shard/i.test(x) === /shard/i.test(t.target));
      return k ? Number(items[k]) || 0 : 0;
    };
    const capTargets = targets('capsule', capsule);
    const gotOf = new Map(capTargets.map((t) => [t, Math.max(0, find(cur.items, t) - find(was.items, t))]));
    for (const t of capTargets) {
      const got = gotOf.get(t);
      // Opens that gave something rarer can hold a due item back (v0.74.0).
      const outranked = capTargets.filter((x) => x !== t && x.chance < t.chance).reduce((a, x) => a + gotOf.get(x), 0);
      const c = counter(luck, 'capsule', capsule, t);
      c.pulls += opens;
      if (got > 0) {
        events.push({ type: 'capsule', source: capsule, target: t.target, kind: t.kind, after: c.known ? c.v + opens : null, first: !c.known });
        luck.hits.push({ at: Date.now(), type: 'capsule', source: capsule, target: t.target, after: c.known ? c.v + opens : null });
        // Opened in a batch, the hit could be anywhere in it: zero is the
        // low end, so a guarantee is never called early.
        c.v = 0;
        c.hits += got;
        c.known = true;
        delete c.typed;
      } else if (c.known && c.v + opens - outranked > t.threshold - 1) {
        // More misses than the guarantee allows: some went unseen.
        c.known = false;
        c.v = 0;
        delete c.typed;
        c.lost = (Number(c.lost) || 0) + 1;
      } else if (c.known) {
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
    const primed = Boolean(c.known) && c.v >= t.threshold - 1;
    if (!primed) {
      delete luck.primedSaid[k];
      continue;
    }
    if (luck.primedSaid[k]) continue;
    luck.primedSaid[k] = true;
    if (type === 'pet') continue;
    if (luck.notify[type] === false) continue;
    out.push({ key: k, type, source, target, estimated: false });
  }
  return out;
}

function describePrimed(p) {
  const pet = p.type === 'pet' || p.type === 'egg';
  const what = p.target === 'gold' ? (pet ? 'Gold pet' : 'Gold')
    : p.target === 'rainbow' ? (pet ? 'Rainbow pet' : 'Rainbow')
      : pretty(p.target);
  if (p.type === 'egg') return `Your next ${pretty(p.source)} is a guaranteed ${what}`;
  if (p.type === 'capsule') return `Your next ${pretty(p.source)} is a guaranteed ${what}`;
  if (p.target === 'gold' || p.target === 'rainbow') return `Your next ${pretty(p.source)} crop is guaranteed ${what}`;
  return `Your next ${pretty(p.source)} crop is a guaranteed ${what}`;
}

// Everything for the panel: every source the app knows or has seen.
// How close a group's closest measured counter is (waiting ones last).
const nearest = (g) => Math.min(Infinity, ...g.rows.filter((r) => r.known).map((r) => r.left));
function view(luck) {
  const sources = { pet: new Set(), egg: new Set(Object.keys(EGG_RARES).filter((e) => e !== 'WinterEgg')), plant: new Set(), capsule: new Set(Object.keys(CAPSULE_RARES)) };
  for (const k of Object.keys(luck.counters)) {
    const [type, source] = k.split(':');
    if (sources[type]) sources[type].add(source);
  }
  const groups = {};
  for (const type of ['pet', 'egg', 'plant', 'capsule']) {
    groups[type] = [...sources[type]].map((source) => ({
      source,
      name: pretty(source),
      rows: targets(type, source).map((t) => {
        const c = luck.counters[keyOf(type, source, t.target)];
        // v0.72.0: only a counter the app has seen reset has a count.
        const known = Boolean(c && c.known);
        const v = known ? c.v : null;
        return {
          key: keyOf(type, source, t.target),
          target: t.target,
          name: (type === 'pet' || type === 'egg') && t.kind === 'mutation' ? `${pretty(t.target)} pet` : pretty(t.target),
          chance: t.chance,
          threshold: t.threshold,
          known,
          typed: known && Boolean(c.typed),
          value: v,
          left: known ? Math.max(1, t.threshold - v) : null,
          primed: known && v >= t.threshold - 1,
          estimated: false,
          seen: Boolean(c),
          pulls: c ? c.pulls : 0,
          lost: c ? Number(c.lost) || 0 : 0,
        };
      }),
    })).sort((a, b) => nearest(a) - nearest(b));
  }
  const primed = [];
  for (const type of Object.keys(groups)) {
    for (const g of groups[type]) for (const r of g.rows) if (r.primed) primed.push({ type, source: g.source, target: r.target, key: r.key, estimated: r.estimated, text: describePrimed({ type, source: g.source, target: r.target }) });
  }
  return { audit: audit(luck), groups, primed, startHalf: luck.startHalf, notify: luck.notify, hits: luck.hits.slice(-30).reverse().map((h) => Object.assign({}, h, { sourceName: pretty(h.source), targetName: pretty(h.target) })) };
}

// Hatches close to a guarantee (v0.69.0): each egg's rare pets, and Gold and
// Rainbow pets from any egg, within `within` hatches (or next), closest
// first. Eggs you've locked are flagged (and listed even when not close).
const HATCH_WITHIN = 5;
function hatchWatch(v, locks, within = HATCH_WITHIN) {
  const L = (Array.isArray(locks) ? locks : []).map(String);
  const isLocked = (egg) => L.some((x) => norm(x) === norm(egg));
  const rows = [];
  const groups = (v && v.groups) || {};
  for (const type of ['egg', 'pet']) {
    for (const g of groups[type] || []) {
      for (const r of g.rows || []) {
        if (type === 'pet' && r.target !== 'gold' && r.target !== 'rainbow') continue;
        if (!r.known || !(r.left <= within)) continue;
        const egg = type === 'egg' ? g.source : null;
        rows.push({
          key: r.key,
          type,
          egg,
          eggName: egg ? pretty(egg) : 'any egg',
          target: r.target,
          name: r.name || pretty(r.target),
          left: r.left,
          primed: Boolean(r.primed),
          estimated: Boolean(r.estimated),
          locked: egg ? isLocked(egg) : false,
        });
      }
    }
  }
  rows.sort((a, b) => a.left - b.left || (a.type === 'pet') - (b.type === 'pet'));
  return { within, rows, locks: L.slice() };
}

function set(luck, key, value) {
  const [type, source, target] = String(key).split(':');
  const t = targets(type, source).find((x) => x.target === target);
  if (!t) return false;
  const c = counter(luck, type, source, t);
  delete luck.primedSaid[key];
  // Cleared: back to waiting for the first one.
  if (value === '' || value == null) {
    c.v = 0;
    c.known = false;
    delete c.typed;
    return true;
  }
  // A count you set is yours (v0.72.1): measured, not guessed.
  c.v = Math.max(0, Math.min(t.threshold - 1, Math.floor(Number(value) || 0)));
  c.known = true;
  c.typed = true;
  return true;
}

// Has every hatch landed on its egg? (v0.56.11) Each egg's counters count
// the hatches they've seen (pulls); the shared Gold counter counts every
// hatch, including any the app couldn't put on an egg (hatched while the app
// was closed and since gone from the game's log). The difference is how many
// hatches the per-egg counters can't include.
function auditRaw(l) {
  const counters = (l && l.counters) || {};
  const perEgg = {};
  for (const [k, c] of Object.entries(counters)) {
    const [type, source] = k.split(':');
    if (type !== 'egg' || !c) continue;
    perEgg[source] = Math.max(perEgg[source] || 0, Number(c.pulls) || 0);
  }
  const seen = Object.values(perEgg).reduce((a, n) => a + n, 0);
  const g = counters['pet:AnyEgg:gold'];
  const all = Number.isFinite(l && l.allHatches) ? l.allHatches : g ? Number(g.pulls) || 0 : seen;
  return { perEgg, seen, all };
}
// All time when the shared counter is as old as the egg counters (all >=
// seen); and since this check began (auditBase, kept from the first run), for
// gardens where an early version's merge started the shared counter later.
function audit(l) {
  const now = auditRaw(l);
  const base = (l && l.auditBase) || { seen: now.seen, all: now.all, at: Date.now() };
  return {
    perEgg: now.perEgg,
    seen: now.seen,
    all: now.all,
    allTime: now.all >= now.seen,
    unattributed: Math.max(0, now.all - now.seen),
    since: { at: base.at, all: Math.max(0, now.all - base.all), seen: Math.max(0, now.seen - base.seen), unattributed: Math.max(0, (now.all - base.all) - (now.seen - base.seen)) },
  };
}

module.exports = {
  audit,
  migrate, recover, wasTyped, onEgg, onUnknownHatches, onCrop, onCapsuleStats, newlyPrimed, describePrimed, view, set, setLive, hatchWatch, HATCH_WITHIN,
  targets, threshold, pretty, EGG_RARES, PLANT_RARES, CAPSULE_RARES,
};
