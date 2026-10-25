'use strict';

/* Daily quests (v0.65.0; added to the game 8 Oct 2026).
 *
 * The game keeps today's quests on your slot (slot.data.dailyQuests):
 *   { dayUTC: '2026-10-12', tier: 4,
 *     quests: [{ instanceId, difficulty: 'easy'|'medium'|'hard',
 *                objective: { kind, target, ...details }, progress,
 *                reward: { kind: 'coins'|'dust'|'tools'|..., amount | toolId, quantity },
 *                completedAt, claimedAt, refreshed }],
 *     bonusReward, bonusClaimedAt }
 * Three a day, new at 00:00 UTC; each can be re-rolled once.
 *
 * This turns that into what the Quests tab shows: each objective in the
 * game's own words (from its questCopy text), the reward, where it stands,
 * and a line of help from what the app already knows (what the shop has,
 * your ripe crops, your eggs, your pets' abilities, the weather). Pure
 * functions: main.js passes the context in.
 */

const cropData = require('./crop-data');
const petData = require('./pet-data');
const abilityData = require('./ability-data');
const harvestRule = require('./harvest-rule');

const RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythical', 'Divine', 'Celestial'];
const rank = (r) => RARITIES.findIndex((x) => x.toLowerCase() === String(r || '').toLowerCase());

// Crop rarity by name (magicgarden.wiki/Crops, Oct 2026).
const CROP_RARITY = {
  Common: ['Carrot', 'Cabbage', 'Strawberry', 'Aloe', 'Beet'],
  Uncommon: ['Clover', 'Rose', 'Delphinium', 'Snowdrop', 'Fava Bean', 'Blueberry', 'Apple', 'Tulip', 'Tomato', 'Daisy'],
  Rare: ['Daffodil', 'Corn', 'Watermelon', 'Pumpkin', 'Echeveria', 'Cattail', 'Pear', 'Gentian', 'Lavender'],
  Legendary: ['Four-Leaf Clover', 'Double Snowdrop', 'Purple Daisy', 'Variegated Cattail', 'Coconut', 'Pine Tree', 'Banana', 'Leek', 'Lily', 'Camellia', 'Squash', 'Peach', "Burro's Tail", 'Cardoon', 'Saffron', 'Persimmon'],
  Mythical: ['Mushroom', 'Cactus', 'Bamboo', 'Violet Cort', 'Chrysanthemum', 'Habanero', 'Date', 'Grape', 'Poinsettia', 'Prickly Pear', 'Eggplant'],
  Divine: ['Pepper', 'Lemon', 'Passion Fruit', 'Dragon Fruit', 'Cacao', 'Lychee', 'Milkcap', 'Ube', 'Sunflower', 'Marigold'],
  Celestial: ['Thunderpeel', 'Stormcap', 'Dawnbreaker', 'Emberbloom', 'Embercrown', 'Starweaver', 'Dawnbinder', 'Moonbinder'],
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const RARITY_BY_NAME = {};
for (const [r, names] of Object.entries(CROP_RARITY)) for (const n of names) RARITY_BY_NAME[norm(n)] = r;
// The egg shop's eggs (magicgarden.wiki/Eggs); the weather eggs don't say.
const EGG_RARITY = { commonegg: 'Common', uncommonegg: 'Uncommon', rareegg: 'Rare', legendaryegg: 'Legendary', mythicalegg: 'Mythical' };

function cropName(id) {
  const c = cropData.lookup(id);
  return c ? c.name : String(id || '').replace(/([a-z])([A-Z])/g, '$1 $2');
}
function cropRarity(id) {
  return RARITY_BY_NAME[norm(cropName(id))] || RARITY_BY_NAME[norm(id)] || null;
}
function eggName(id) {
  return petData.eggInfo(id).name;
}
function eggRarity(id) {
  return EGG_RARITY[norm(id)] || null;
}
const pretty = (id) => String(id || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
function mutationName(id) {
  return cropData.mutationName(id) || pretty(id);
}
function mutationKey(id) {
  const m = norm(id);
  return cropData.MUTATION_ALIASES[m] || m;
}

const n = (x) => Math.max(0, Math.round(Number(x) || 0));
const s = (count, one, many) => (count === 1 ? one : many);
function short(v) {
  const x = Number(v) || 0;
  const a = Math.abs(x);
  const fmt = (d, u) => {
    const t = (x / d).toFixed(x / d >= 100 ? 0 : x / d >= 10 ? 1 : 2);
    return `${t.includes('.') ? t.replace(/\.?0+$/, '') : t}${u}`;
  };
  if (a >= 1e12) return fmt(1e12, 'T');
  if (a >= 1e9) return fmt(1e9, 'B');
  if (a >= 1e6) return fmt(1e6, 'M');
  return Math.round(x).toLocaleString('en-US');
}

/* The objective in words, following the game's own text (questCopy). */
function objectiveText(o) {
  const ob = o || {};
  const t = n(ob.target);
  const rarity = ob.minRarity ? `${ob.minRarity} or rarer` : '';
  // "Buy 2 Rare or rarer seeds", "Buy 1 Carrot seed", "Buy 3 seeds".
  const thing = (verb, one, many, id, nameOf) => {
    if (id) return `${verb} ${t} ${nameOf(id)}${t === 1 ? ` ${one}` : ` ${many}`}`;
    if (rarity) return `${verb} ${t} ${rarity} ${s(t, one, many)}`;
    return `${verb} ${t} ${s(t, one, many)}`;
  };
  switch (ob.kind) {
    case 'harvestCrops': {
      const what = ob.speciesId ? `${cropName(ob.speciesId)} ${s(t, 'crop', 'crops')}` : rarity ? `${rarity} ${s(t, 'crop', 'crops')}` : s(t, 'crop', 'crops');
      const bits = [`Harvest ${t} ${ob.mutationId ? `${mutationName(ob.mutationId)} ` : ''}${what}`];
      if (ob.minSize) bits.push(`of size ${n(ob.minSize)}+`);
      if (ob.minMutations) bits.push(`with ${n(ob.minMutations)}+ mutations`);
      return bits.join(' ');
    }
    case 'sellForCoins': return `Earn ${short(t)} coins selling crops`;
    case 'sellForDust': return `Earn ${short(t)} Magic Dust selling pets`;
    case 'plantSeeds': return thing('Plant', 'seed', 'seeds', ob.speciesId, cropName);
    case 'buySeeds': return thing('Buy', 'seed', 'seeds', ob.speciesId, cropName);
    case 'waterPlants': return t === 1 ? 'Water a plant once' : `Water plants ${t} times`;
    case 'feedPets': return t === 1 ? 'Hand-feed a pet once' : `Hand-feed pets ${t} times`;
    case 'growEggs': return ob.eggId ? `Grow ${t} ${eggName(ob.eggId)}${t === 1 ? '' : 's'}` : thing('Grow', 'egg', 'eggs', null, eggName);
    case 'hatchEggs': return ob.eggId ? `Hatch ${t} ${eggName(ob.eggId)}${t === 1 ? '' : 's'}` : thing('Hatch', 'egg', 'eggs', null, eggName);
    case 'buyEggs': return ob.eggId ? `Buy ${t} ${eggName(ob.eggId)}${t === 1 ? '' : 's'}` : thing('Buy', 'egg', 'eggs', null, eggName);
    case 'buyDecor': return ob.decorId ? `Buy ${t} ${pretty(ob.decorId)}` : thing('Buy', 'decoration', 'decorations', null, pretty);
    case 'logJournal': {
      const which = ob.category === 'crops' ? 'crop ' : ob.category === 'pets' ? 'pet ' : '';
      return `Log ${t} new ${which}journal ${s(t, 'entry', 'entries')}`;
    }
    case 'mutateCrops':
      if (ob.mutationId) return t === 1 ? `Have a crop turn ${mutationName(ob.mutationId)}` : `Have ${t} crops turn ${mutationName(ob.mutationId)}`;
      return t === 1 ? 'Have a crop gain a mutation' : `Have ${t} crops gain a mutation`;
    case 'placeCrystals': return t === 1 ? 'Plant or fuse a shard' : `Plant or fuse ${t} shards`;
    case 'triggerPetAbilities':
      if (ob.abilityGroup === 'coinFinder') return t === 1 ? 'Have your pets find coins once' : `Have your pets find coins ${t} times`;
      if (ob.abilityGroup === 'seedFinder') return t === 1 ? 'Have your pets find seeds once' : `Have your pets find seeds ${t} times`;
      if (ob.abilityGroup === 'cropGranter') return t === 1 ? 'Have your pets mutate a crop' : `Have your pets mutate ${t} crops`;
      return t === 1 ? 'Have your pets use an ability once' : `Have your pets use abilities ${t} times`;
    default:
      return `${pretty(ob.kind || 'Quest').replace(/^\w/, (c) => c.toUpperCase())}${t ? ` (${t})` : ''}`;
  }
}

// What the objective is about, for the tab's icon.
const KIND_EMOJI = {
  harvestCrops: '🧺', sellForCoins: '💰', sellForDust: '✨', plantSeeds: '🌱', buySeeds: '🛒', waterPlants: '💧',
  feedPets: '🍖', growEggs: '🥚', hatchEggs: '🐣', buyEggs: '🥚', buyDecor: '🪑', logJournal: '📖', mutateCrops: '🌈',
  placeCrystals: '💎', triggerPetAbilities: '🐾',
};

function rewardText(r) {
  if (!r || !r.kind) return '';
  const q = n(r.quantity || r.amount || 1);
  const times = q > 1 ? `${q}× ` : '';
  switch (r.kind) {
    case 'coins': return `💰 ${short(r.amount)} coins`;
    case 'dust': return `✨ ${short(r.amount)} Magic Dust`;
    case 'tools': return `🧪 ${times}${pretty(r.toolId || 'tool')}`;
    case 'seeds': return `🌱 ${times}${cropName(r.speciesId || r.seedId)} seed${q > 1 ? 's' : ''}`;
    case 'eggs': return `🥚 ${times}${eggName(r.eggId)}`;
    case 'decor': return `🪑 ${times}${pretty(r.decorId)}`;
    default: return `🎁 ${times}${pretty(r.toolId || r.itemId || r.decorId || r.eggId || r.speciesId || r.kind)}`;
  }
}

// The next 00:00 UTC after `now`.
function nextReset(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
const dayUTC = (now) => new Date(now).toISOString().slice(0, 10);

/* ---- help for each kind of quest -------------------------------------- */

// The shop item a quest asks for: { inStock, stock, shop, restockAt }.
function shopFind(shops, id, kind) {
  const want = norm(id);
  if (!want) return null;
  for (const [shopId, shop] of Object.entries(shops || {})) {
    if (!shop || !Array.isArray(shop.items)) continue;
    for (const it of shop.items) {
      const ids = [norm(it.itemId), norm(it.name), norm(it.species), norm(it.eggId), norm(it.decorId)];
      const hit = ids.some((x) => x && (x === want || x === `${want}seed` || x === norm(`${cropName(id)}`) || x === norm(`${cropName(id)} seed`) || (kind === 'egg' && x === norm(eggName(id)))));
      if (hit) return { inStock: Number(it.stock) > 0, stock: Number(it.stock) || 0, shop: shopId, restockAt: Date.parse(shop.nextRestockAt) || null, open: shop.open !== false };
    }
  }
  return null;
}

// Ripe crops in the garden that would count; `ready` = also ready by your
// harvest rule (when one is given).
function harvestMatches(plants, ob, rule) {
  let ripe = 0;
  let ready = 0;
  let growing = 0;
  const minR = ob.minRarity ? rank(ob.minRarity) : -1;
  const mut = ob.mutationId ? mutationKey(ob.mutationId) : null;
  for (const p of plants || []) {
    if (ob.speciesId && norm(cropName(p.sp)) !== norm(cropName(ob.speciesId))) continue;
    if (minR >= 0 && !(rank(cropRarity(p.sp)) >= minR)) continue;
    for (const c of p.s || []) {
      const muts = String(c[0] || '').split(',').filter(Boolean);
      if (mut && !muts.includes(mut)) continue;
      if (ob.minSize && !(Number(c[1]) >= Number(ob.minSize))) continue;
      if (ob.minMutations && muts.length < Number(ob.minMutations)) continue;
      if (c[2]) {
        ripe += 1;
        if (rule && !harvestRule.miss(muts, c[1], rule)) ready += 1;
      } else growing += 1;
    }
  }
  return { ripe, ready, growing };
}

// Eggs in the garden that would count: [{ egg, at }] (at = when it hatches).
function eggMatches(eggs, ob, now) {
  const minR = ob.minRarity ? rank(ob.minRarity) : -1;
  const list = (eggs || []).filter((e) => (!ob.eggId || norm(e.egg) === norm(ob.eggId)) && (minR < 0 || rank(eggRarity(e.egg)) >= minR));
  const ready = list.filter((e) => e.at && e.at <= now).length;
  const next = list.filter((e) => e.at && e.at > now).map((e) => e.at).sort((a, b) => a - b)[0] || null;
  return { count: list.length, ready, next, unknown: list.filter((e) => !e.at).length };
}

// How often your pets out now trigger abilities of a kind, per minute.
const GROUP_RE = { coinFinder: /coinfinder/i, seedFinder: /seedfinder/i, cropGranter: /granter$|raindance/i };
function abilityRate(pets, group, weatherKind) {
  let perMin = 0;
  const who = [];
  for (const p of pets || []) {
    const str = Number(p.strength) || abilityData.DEFAULT_STRENGTH;
    for (const id of p.abilities || []) {
      if (group && GROUP_RE[group] && !GROUP_RE[group].test(id)) continue;
      const a = abilityData.lookup(id);
      if (!a || a.kind !== 'perMinute' || !(a.chance > 0)) continue;
      if (a.weather) {
        const wk = norm(a.weather);
        if (!weatherKind || !(wk.startsWith(norm(weatherKind)) || norm(weatherKind).startsWith(wk.slice(0, 4)))) continue;
      }
      perMin += (a.chance / 100) * (str / 100);
      if (!who.includes(p.name || p.species)) who.push(p.name || p.species);
    }
  }
  return { perMin, who };
}

function fmtMinutes(m) {
  if (!(m > 0) || !Number.isFinite(m)) return '';
  if (m < 1.5) return 'about a minute';
  if (m < 90) return `about ${Math.round(m)} min`;
  const h = m / 60;
  return h < 36 ? `about ${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} h` : `about ${Math.round(h / 24)} days`;
}
function clockOf(ms, clock) {
  return clock ? clock(ms) : new Date(ms).toISOString().slice(11, 16);
}

// Which weather gives a mutation (for "Have crops turn Wet").
const MUTATION_WEATHER = { wet: 'rain', chilled: 'snow', frozen: 'snow', thunderstruck: 'thunder', dawnlit: 'dawn', amberlit: 'amber' };

function helpFor(q, ctx) {
  const ob = q.objective || {};
  const left = Math.max(0, n(ob.target) - n(q.progress));
  const now = ctx.now;
  switch (ob.kind) {
    case 'buyEggs':
    case 'buySeeds':
    case 'buyDecor': {
      const id = ob.eggId || ob.speciesId || ob.decorId;
      if (!id) return '';
      const f = shopFind(ctx.shops, id, ob.kind === 'buyEggs' ? 'egg' : ob.kind === 'buySeeds' ? 'seed' : 'decor');
      if (!f) return 'Not listed in the shops right now.';
      if (f.inStock) return `In the shop now (${f.stock} left).`;
      return f.restockAt && f.restockAt > now ? `Sold out · the shop restocks at ${clockOf(f.restockAt, ctx.clock)}.` : 'Sold out right now.';
    }
    case 'harvestCrops': {
      if (!ctx.plants) return '';
      // With a harvest rule, what it lets through is what you'd pick anyway.
      const rule = ctx.readyRule && harvestRule.describe(ctx.readyRule) !== 'anything' ? ctx.readyRule : null;
      const m = harvestMatches(ctx.plants, ob, rule);
      const f = (x) => x.toLocaleString('en-US');
      if (rule) {
        if (m.ready >= left) return `${f(m.ready)} ready by your harvest rule: enough to finish.`;
        if (m.ripe) return `${f(m.ripe)} ripe in your garden, ${f(m.ready)} of them ready by your harvest rule.`;
      } else {
        if (m.ripe >= left) return `${f(m.ripe)} ripe ${s(m.ripe, 'one', 'ones')} in your garden: enough to finish.`;
        if (m.ripe) return `${f(m.ripe)} ripe in your garden${m.growing ? `, ${f(m.growing)} still growing` : ''}.`;
      }
      return m.growing ? `None ripe yet; ${f(m.growing)} still growing.` : 'None in your garden right now.';
    }
    case 'hatchEggs':
    case 'growEggs': {
      if (!ctx.eggs) return '';
      const m = eggMatches(ctx.eggs, ob, now);
      if (!m.count) return ob.kind === 'growEggs' ? 'Plant eggs in your garden to grow them.' : 'No eggs growing in your garden right now.';
      const bits = [`${m.count} growing in your garden`];
      if (m.ready) bits.push(`${m.ready} ready to hatch`);
      else if (m.next) bits.push(`the next one hatches at ${clockOf(m.next, ctx.clock)}`);
      return `${bits.join(', ')}.`;
    }
    case 'triggerPetAbilities': {
      const r = abilityRate(ctx.pets, ob.abilityGroup, ctx.weatherKind);
      if (!r.perMin) return ob.abilityGroup ? 'None of the pets you have out do that.' : '';
      return `Your pets out (${r.who.slice(0, 3).join(', ')}): ${fmtMinutes(left / r.perMin)} to go at their usual rate.`;
    }
    case 'sellForCoins':
      return ctx.readyValue > 0 ? `Your ready crops would bring about ${short(ctx.readyValue)}.` : '';
    case 'mutateCrops': {
      const want = ob.mutationId ? mutationKey(ob.mutationId) : null;
      if (want === 'gold' || want === 'rainbow') {
        const r = abilityRate(ctx.pets, 'cropGranter', ctx.weatherKind);
        return r.perMin ? `Your granter pets out: ${fmtMinutes(left / r.perMin)} to go at their usual rate.` : 'A Gold or Rainbow Granter pet out does this.';
      }
      const kind = want ? MUTATION_WEATHER[want] : null;
      const ev = (ctx.weather || []).find((e) => e && e.kind && (kind ? e.kind === kind : e.kind !== 'clear'));
      if (!ev) return '';
      const on = Date.parse(ev.startsAt) <= now;
      return on ? `${ev.name || pretty(ev.kind)} is on now.` : `Next ${ev.name || pretty(ev.kind)} at ${clockOf(Date.parse(ev.startsAt), ctx.clock)}.`;
    }
    case 'logJournal': {
      const j = ctx.journal;
      if (!j) return '';
      const c = ob.category === 'pets' ? j.pets : ob.category === 'crops' ? j.crops : null;
      if (c) return `Your journal: ${c.logged.toLocaleString('en-US')} of ${c.total.toLocaleString('en-US')} ${ob.category === 'pets' ? 'pet' : 'crop'} entries.`;
      return `Your journal: ${(j.crops.logged + j.pets.logged).toLocaleString('en-US')} of ${(j.crops.total + j.pets.total).toLocaleString('en-US')} entries.`;
    }
    default:
      return '';
  }
}

/* ---- the view --------------------------------------------------------- */

function view(dq, ctx = {}) {
  const now = ctx.now || Date.now();
  const resetAt = nextReset(now);
  if (!dq || !Array.isArray(dq.quests)) return { loaded: false, resetAt };
  const today = dayUTC(now);
  const stale = dq.dayUTC && dq.dayUTC < today;
  const quests = dq.quests.map((q, i) => {
    const ob = q.objective || {};
    const target = n(ob.target);
    const progress = Math.min(target || Infinity, n(q.progress));
    const done = Boolean(q.completedAt) || (target > 0 && progress >= target);
    const claimed = Boolean(q.claimedAt);
    return {
      i,
      id: String(q.instanceId || i),
      difficulty: String(q.difficulty || ['easy', 'medium', 'hard'][i] || ''),
      kind: String(ob.kind || ''),
      emoji: KIND_EMOJI[ob.kind] || '📜',
      text: objectiveText(ob),
      progress,
      target,
      pct: target ? Math.min(100, Math.round((progress / target) * 100)) : done ? 100 : 0,
      reward: rewardText(q.reward),
      rewardKind: q.reward ? q.reward.kind : null,
      state: claimed ? 'claimed' : done ? 'ready' : 'open',
      refreshed: Boolean(q.refreshed),
      completedAt: q.completedAt || null,
      help: !done && !stale ? helpFor(q, Object.assign({}, ctx, { now })) : '',
    };
  });
  const doneCount = quests.filter((q) => q.state !== 'open').length;
  const bonus = {
    reward: rewardText(dq.bonusReward),
    claimed: Boolean(dq.bonusClaimedAt),
    remaining: quests.length - doneCount,
  };
  bonus.state = bonus.claimed ? 'claimed' : bonus.remaining <= 0 ? 'ready' : 'open';
  const toClaim = quests.filter((q) => q.state === 'ready').length + (bonus.state === 'ready' ? 1 : 0);
  return {
    loaded: true,
    day: dq.dayUTC || null,
    stale: Boolean(stale),
    tier: dq.tier == null ? null : Number(dq.tier),
    resetAt,
    quests,
    bonus,
    toClaim,
    left: stale ? 0 : quests.length - doneCount,
    allDone: !stale && bonus.claimed && quests.every((q) => q.state === 'claimed'),
  };
}

/* ---- the Haunt Quest (v0.66.0) ---------------------------------------- */

// The Haunt Event (Oct - 9 Nov 2026): haunts roam the villages at night and
// during weather; snap them with the Camera. slot.data.spookyQuest:
//   { dayUTC, target, progress, reward: { kind: 'avatarCosmetic',
//     cosmeticFilename: 'Mid_BlackCat.png', alternate: { kind: 'decor',
//     decorId: 'HauntLamp', quantity } }, completedAt, claimedAt }
function cosmeticName(file) {
  return pretty(String(file || '').replace(/\.\w+$/, '').replace(/^(top|mid|bot|bottom|head|hat|face|back|hair|feet)_/i, ''));
}
function hauntReward(r) {
  if (!r || !r.kind) return '';
  if (r.kind === 'avatarCosmetic') {
    const alt = r.alternate ? rewardText(r.alternate).replace(/^\S+\s/, '') : '';
    return `👕 ${cosmeticName(r.cosmeticFilename)} outfit${alt ? ` (or ${/^\d/.test(alt) ? alt : `a ${alt}`} if you have it)` : ''}`;
  }
  return rewardText(r);
}
// When haunts are out: night or any weather. { now: true, what, until } or
// { now: false, what, at } for the next chance, or null.
function hauntChance(ctx) {
  const now = ctx.now || Date.now();
  const night = ctx.night || {};
  const evs = (ctx.weather || []).filter((e) => e && e.kind && e.kind !== 'clear' && !(Date.parse(e.endsAt) <= now));
  const on = evs.find((e) => Date.parse(e.startsAt) <= now);
  if (night.on) return { now: true, what: 'night', until: night.endsAt || null };
  if (on) return { now: true, what: on.name || pretty(on.kind), until: Date.parse(on.endsAt) || null };
  const next = [];
  if (night.known && night.next) next.push({ what: 'night', at: night.next });
  const w = evs.map((e) => ({ what: e.name || pretty(e.kind), at: Date.parse(e.startsAt) })).filter((x) => x.at > now).sort((a, b) => a.at - b.at)[0];
  if (w) next.push(w);
  next.sort((a, b) => a.at - b.at);
  return next[0] ? Object.assign({ now: false }, next[0]) : null;
}
function hauntView(sq, ctx = {}) {
  const now = ctx.now || Date.now();
  const running = !ctx.ends || now < ctx.ends;
  if (!running) return null;
  if (!sq || !(Number(sq.target) > 0)) return { loaded: false, ends: ctx.ends || null };
  const target = n(sq.target);
  const progress = Math.min(target, n(sq.progress));
  const done = Boolean(sq.completedAt) || progress >= target;
  const claimed = Boolean(sq.claimedAt);
  const stale = sq.dayUTC && sq.dayUTC < dayUTC(now);
  const c = hauntChance(Object.assign({}, ctx, { now }));
  let help = '';
  if (!done && !stale && c) {
    if (c.now) help = `${c.what === 'night' ? 'It\'s night' : `${c.what} is on`}: haunts are out now${c.until ? ` (until ${clockOf(c.until, ctx.clock)})` : ''}. Snap them with your Camera.`;
    else help = `Haunts come out at night and in weather. Next chance: ${c.what === 'night' ? 'night' : c.what} at ${clockOf(c.at, ctx.clock)}.`;
  }
  return {
    loaded: true,
    day: sq.dayUTC || null,
    stale: Boolean(stale),
    text: target === 1 ? 'Snap a haunt with your Camera' : `Snap ${target} haunts with your Camera`,
    progress,
    target,
    pct: target ? Math.min(100, Math.round((progress / target) * 100)) : 0,
    reward: hauntReward(sq.reward),
    state: claimed ? 'claimed' : done ? 'ready' : 'open',
    help,
    ends: ctx.ends || null,
  };
}

/* ---- the record of past days ----------------------------------------- */

// One line per day, kept for 30 days: what the quests were, which got done,
// what they paid, whether the bonus was claimed.
function recordDay(days, dq) {
  if (!dq || !dq.dayUTC || !Array.isArray(dq.quests)) return false;
  const line = {
    tier: dq.tier == null ? null : Number(dq.tier),
    quests: dq.quests.map((q) => ({
      d: String(q.difficulty || '').slice(0, 6),
      text: objectiveText(q.objective).slice(0, 80),
      reward: rewardText(q.reward).slice(0, 60),
      done: Boolean(q.completedAt),
      claimed: Boolean(q.claimedAt),
      rerolled: Boolean(q.refreshed),
    })),
    bonus: rewardText(dq.bonusReward).slice(0, 60),
    bonusClaimed: Boolean(dq.bonusClaimedAt),
  };
  const before = JSON.stringify(days[dq.dayUTC] || null);
  if (before === JSON.stringify(line)) return false;
  days[dq.dayUTC] = line;
  const keys = Object.keys(days).sort();
  while (keys.length > 30) delete days[keys.shift()];
  return true;
}

// Counts for the tab: days with all three done, the bonus claimed in a row
// (up to yesterday, plus today if it's done), and tools won from bonuses.
function historySummary(days, today) {
  const keys = Object.keys(days || {}).sort();
  let streak = 0;
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const d = days[keys[i]];
    if (keys[i] === today && !d.bonusClaimed) continue;
    if (!d.bonusClaimed) break;
    streak += 1;
  }
  const fullDays = keys.filter((k) => days[k].bonusClaimed).length;
  return { streak, fullDays, days: keys.length };
}

module.exports = {
  RARITIES, CROP_RARITY, cropRarity, eggRarity, objectiveText, rewardText, nextReset, dayUTC,
  shopFind, harvestMatches, eggMatches, abilityRate, helpFor, view, recordDay, historySummary, short,
  hauntView, hauntChance, hauntReward, cosmeticName,
};
