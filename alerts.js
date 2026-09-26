'use strict';

// Watches Magic Circle's official shop and weather API for mods and decides
// what deserves an announcement. Read-only: it never buys anything and never
// touches the game connection.

// MG_SHOPS_API is a test hook (the harness serves a stand-in feed).
const API_URL = process.env.MG_SHOPS_API || 'https://magicgarden.gg/platform/v1/shops';
const weather = require('./weather');

// Order matters: the first rule that matches an item wins, and alerts that
// fire together are announced in this order.
//
// tier decides the sound:
//   legendary  siren, fanfare, announcement twice      (the biggest)
//   epic       shorter siren, fanfare, announcement
//   big        fanfare, announcement
//   alarm      klaxon and an excited voice
//   named      chime, "<name> alert!"
//   basic      soft ding, short announcement
//
// Item rules match the start of the item's name or id, ignoring spaces and
// case, so "firepit" matches "Fire Pit" and "dawnbinder" matches "Dawnbinder Pod".
const RULES = [
  // ids: what the game itself calls the item (its species id), matched
  // exactly as well as the name, so a renamed shop entry can't slip past.
  { id: 'moonbinder', label: 'Moonbinder', kind: 'item', match: 'moonbinder', ids: ['MoonCelestial'], tier: 'legendary' },
  { id: 'dawnbinder', label: 'Dawnbinder', kind: 'item', match: 'dawnbinder', ids: ['DawnCelestial'], tier: 'epic' },
  { id: 'dawnbreaker', label: 'Dawnbreaker', kind: 'item', match: 'dawnbreaker', tier: 'big' },
  { id: 'emberbloom', label: 'Emberbloom', kind: 'item', match: 'emberbloom', tier: 'big' },
  { id: 'thunderspire', label: 'Thunderspire', kind: 'item', match: 'thunderspire', ids: ['ThunderCelestial'], tier: 'big' },
  { id: 'mythicalegg', label: 'Mythical Egg', kind: 'item', match: 'mythicalegg', tier: 'big' },
  { id: 'amberegg', label: 'Amber Egg', kind: 'item', match: 'amberegg', ids: ['AmberEgg'], tier: 'big' },
  { id: 'starweaver', label: 'Starweaver', kind: 'item', match: 'starweaver', tier: 'alarm' },
  { id: 'windturner', label: 'Windturner', kind: 'item', match: 'windturner', tier: 'named' },
  { id: 'firepit', label: 'Firepit', kind: 'item', match: 'firepit', tier: 'named' },
  // Late game's must-have.
  { id: 'xppotion', label: 'XP Potion', kind: 'item', match: 'xppotion', tier: 'named' },
  // Everyone gets excited about these. They shouldn't. They deserve a spot.
  { id: 'sunflower', label: 'Sunflower', kind: 'item', match: 'sunflower', tier: 'basic' },
  { id: 'ube', label: 'Ube', kind: 'item', match: 'ube', tier: 'basic' },
  { id: 'milkcap', label: 'Milkcap', kind: 'item', match: 'milkcap', tier: 'basic' },
  { id: 'marigold', label: 'Marigold', kind: 'item', match: 'marigold', tier: 'basic' },
  { id: 'legendaryegg', label: 'Legendary Egg', kind: 'item', match: 'legendaryegg', tier: 'basic' },
  { id: 'decor', label: 'Decor over 500M', kind: 'decor', minPrice: 500000000, tier: 'named' },

  { id: 'thunder', label: 'Thunder', kind: 'weather', pattern: /thunder/i, tier: 'weather' },
  { id: 'rain', label: 'Rain', kind: 'weather', pattern: /\brain\b/i, tier: 'weather' },
  { id: 'dawn', label: 'Dawn', kind: 'weather', pattern: /\bdawn\b/i, tier: 'weather' },
  { id: 'amber', label: 'Amber', kind: 'weather', pattern: /\bamber/i, tier: 'weather' },
  { id: 'snow', label: 'Snow', kind: 'weather', pattern: /\b(snow|frost|blizzard)\b/i, tier: 'weather' },
  // Catches anything the list above doesn't, including weather added later.
  { id: 'weatherother', label: 'Any other weather', kind: 'weather', pattern: /./, tier: 'weather', fallback: true },

  // Fired by the garden watcher in the game page, not by the shop watcher.
  { id: 'petgold', label: 'Pet turned a crop Gold', kind: 'pet', tier: 'pet' },
  { id: 'petrainbow', label: 'Pet turned a crop Rainbow', kind: 'pet', tier: 'pet' },
  { id: 'pethungry', label: 'A pet is getting hungry', kind: 'pet', tier: 'pet' },
  { id: 'petgrown', label: 'A pet is fully grown', kind: 'pet', tier: 'pet' },
  { id: 'hatchgold', label: 'You hatched a Gold pet', kind: 'pet', tier: 'pet' },
  { id: 'hatchrainbow', label: 'You hatched a Rainbow pet', kind: 'pet', tier: 'pet' },
  { id: 'hatchspecies', label: 'You hatched a rare pet', kind: 'pet', tier: 'pet' },
  { id: 'luckprimed', label: 'Bad Luck Protection is primed', kind: 'pet', tier: 'pet' },
];

const CUSTOM_TIERS = new Set(['basic', 'named', 'big', 'epic', 'legendary', 'alarm']);

// Don't announce the same weather twice within this window. Events run about
// ten minutes, and the shop opening and the weather starting are the same event.
const WEATHER_COOLDOWN_MS = 15 * 60 * 1000;

function normalise(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '');
}

// An item's name, prepared once for matching: its id and every tail of its
// name's words ("Dawnbinder Pod" → "dawnbinderpod", "pod"), squashed.
// Callers matching many rules against the same items keep these.
function nameKeys(item) {
  const words = normalise(item && item.name).split(/\s+/).filter(Boolean);
  const tails = [];
  for (let i = 0; i < words.length; i += 1) tails.push(words.slice(i).join(''));
  return { id: String((item && item.itemId) || ''), idKey: normalise(item && item.itemId).replace(/ /g, ''), tails };
}

// Does a rule's match (or one of its exact game ids) cover prepared keys?
function keysMatch(keys, match, ids) {
  if (Array.isArray(ids) && keys.id && ids.some((id) => String(id).toLowerCase() === keys.id.toLowerCase())) return true;
  const want = normalise(match).replace(/ /g, '');
  if (!want) return false;
  if (keys.idKey.startsWith(want)) return true;
  return keys.tails.some((t) => t.startsWith(want));
}

function nameMatches(item, match, ids) {
  return keysMatch(nameKeys(item), match, ids);
}

function customRules(settings) {
  return (settings.alerts.custom || [])
    .filter((c) => c && c.name)
    .map((c) => ({
      id: 'custom:' + normalise(c.name).replace(/ /g, ''),
      label: c.name,
      kind: 'item',
      match: c.name,
      tier: CUSTOM_TIERS.has(c.tier) ? c.tier : 'basic',
      custom: true,
    }));
}

function allRules(settings) {
  return [...RULES, ...customRules(settings)];
}

function publicRules(settings) {
  return allRules(settings).map(({ id, label, kind, tier, custom }) => ({
    id, label, kind, tier, custom: Boolean(custom),
  }));
}

function inQuietHours(settings, date = new Date()) {
  const q = settings.alerts.quietHours;
  if (!q || !q.enabled) return false;
  const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const t = date.getHours() * 60 + date.getMinutes();
  const from = toMin(q.from);
  const to = toMin(q.to);
  if (from === to) return false;
  return from < to ? t >= from && t < to : t >= from || t < to;
}

function createWatcher({ getSettings, onAlerts, onStatus, onData, fetchImpl }) {
  const doFetch = fetchImpl || ((url, opts) => fetch(url, opts));

  const state = {
    running: false,
    inFlight: false,
    timer: null,
    firstPoll: true,
    errors: 0,
    seen: new Set(),
    lastFired: {},
    wasOpen: {},
    openedAt: {},
    recentFired: [],
    lastCheck: null,
    nextCheck: null,
    lastError: null,
    last: null,
  };

  // What identifies "this restock" of a shop: its next restock time, or
  // any restock/start id the feed gives, or, for a shop that just opens
  // for an event, the time it was first seen open this time.
  function restockKey(shopId, shop, now) {
    if (shop.nextRestockAt) return String(shop.nextRestockAt);
    for (const k of ['restockId', 'restockAt', 'startedAt', 'startsAt', 'openedAt']) if (shop[k]) return `${k}=${shop[k]}`;
    if (!state.openedAt[shopId]) state.openedAt[shopId] = now;
    return `open@${state.openedAt[shopId]}`;
  }

  function remember(key) {
    if (state.seen.has(key)) return false;
    state.seen.add(key);
    if (state.seen.size > 800) {
      for (const k of [...state.seen].slice(0, 300)) state.seen.delete(k);
    }
    return true;
  }

  function activeRules() {
    const settings = getSettings();
    const off = new Set(settings.alerts.disabled || []);
    return allRules(settings).filter((r) => !off.has(r.id));
  }

  function evaluate(data, now = Date.now()) {
    const rules = activeRules();
    const order = new Map(rules.map((r, i) => [r.id, i]));
    const fired = [];

    // Shop items.
    const itemRules = rules.filter((r) => r.kind === 'item' || r.kind === 'decor');
    for (const [shopId, shop] of Object.entries(data.shops || {})) {
      if (!shop || !shop.open) continue;
      for (const item of shop.items || []) {
        if (!(item.stock > 0)) continue;
        const rule = itemRules.find((r) =>
          r.kind === 'decor'
            ? item.itemType === 'Decor' && item.coinPrice != null && item.coinPrice >= r.minPrice
            : nameMatches(item, r.match, r.ids)
        );
        if (!rule) continue;
        // One announcement per item per restock. Weather shops don't
        // restock (no nextRestockAt), so for them each opening is the
        // "restock": otherwise the second Thunderspire of a session would
        // look like the first one again and stay silent.
        const key = `${rule.id}:${shopId}:${item.itemId}:${restockKey(shopId, shop, now)}`;
        if (!remember(key)) continue;
        state.recentFired.push({ at: now, key, item: item.name || item.itemId, stock: item.stock });
        if (state.recentFired.length > 30) state.recentFired.shift();
        fired.push({
          ruleId: rule.id,
          tier: rule.tier,
          kind: rule.kind,
          label: rule.label,
          itemName: item.name,
          stock: item.stock,
          shop: shopId,
        });
      }
    }

    // Weather: either the weather itself has started, or its shop just opened.
    const signals = [];
    const cur = data.weather && data.weather.current;
    if (cur) {
      const starts = Date.parse(cur.startsAt);
      const ends = Date.parse(cur.endsAt);
      if (starts <= now && now < ends) signals.push(`${cur.weatherId || ''} ${cur.name || ''}`);
    }
    for (const [shopId, shop] of Object.entries(data.shops || {})) {
      const was = state.wasOpen[shopId];
      const open = Boolean(shop && shop.open);
      state.wasOpen[shopId] = open;
      if (open && was === false) signals.push(shopId);
      if (!open) delete state.openedAt[shopId];
    }

    const weatherRules = rules.filter((r) => r.kind === 'weather');
    const weatherName = cur && (cur.name || cur.weatherId);
    let matchedWeather = false;

    const fireWeather = (rule, label) => {
      if (now - (state.lastFired[rule.id] || 0) < WEATHER_COOLDOWN_MS) return true;
      state.lastFired[rule.id] = now;
      // Weather already under way when the app opened isn't news.
      if (state.firstPoll) return true;
      fired.push({
        ruleId: rule.id,
        tier: 'weather',
        kind: 'weather',
        label: label || rule.label,
        endsAt: cur && cur.endsAt,
      });
      return true;
    };

    for (const rule of weatherRules) {
      if (rule.fallback) continue;
      if (!signals.some((s) => rule.pattern.test(s))) continue;
      matchedWeather = true;
      fireWeather(rule);
    }

    // Nothing named it, but something is happening: announce it anyway.
    const fallback = weatherRules.find((r) => r.fallback);
    if (fallback && !matchedWeather && signals.length) {
      fireWeather(fallback, weatherName ? String(weatherName) : 'New');
    }

    fired.sort((a, b) => (order.get(a.ruleId) ?? 999) - (order.get(b.ruleId) ?? 999));
    return fired;
  }

  function nextDelay(data, now = Date.now()) {
    let next = now + 45000;
    for (const shop of Object.values(data.shops || {})) {
      if (!shop || !shop.open || !shop.nextRestockAt) continue;
      const at = Date.parse(shop.nextRestockAt) + 3000;
      if (at > now) next = Math.min(next, at);
    }
    const w = data.weather || {};
    for (const e of [w.current, ...(w.upcoming || [])].filter(Boolean)) {
      // Once just before it starts (lunar events only say which one they are
      // shortly beforehand, and the log-off feature wants to know in time),
      // and once just after.
      for (const at of [Date.parse(e.startsAt) - 45000, Date.parse(e.startsAt) + 3000, Date.parse(e.endsAt) + 3000]) {
        if (at > now) next = Math.min(next, at);
      }
    }
    return Math.max(5000, next - now);
  }

  function status() {
    const w = (state.last && state.last.weather) || {};
    const now = Date.now();
    const describe = (e) => {
      const kind = weather.kindOf(e.name || e.weatherId);
      const announced = Boolean(e.name || e.weatherId);
      const group = e.groupId ? String(e.groupId).replace(/^\w/, (c) => c.toUpperCase()) : '';
      return {
        name: announced ? String(e.name || e.weatherId) : `${group ? group + ' ' : ''}event`.replace(/^\w/, (c) => c.toUpperCase()),
        kind: announced ? kind : null,
        possible: weather.possibleKinds(e),
        announced,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
      };
    };
    const current =
      w.current && Date.parse(w.current.startsAt) <= now && now < Date.parse(w.current.endsAt)
        ? describe(w.current)
        : null;
    const upcoming = (w.upcoming || [])
      .filter((e) => Date.parse(e.startsAt) > now)
      .slice(0, 4)
      .map(describe);
    // When each shop restocks next (seeds, eggs, tools, decor...).
    const restocks = Object.entries((state.last && state.last.shops) || {})
      .filter(([, sh]) => sh && sh.open !== false && sh.nextRestockAt)
      .map(([id, sh]) => ({ id, at: sh.nextRestockAt }));
    return {
      running: state.running,
      lastCheck: state.lastCheck,
      nextCheck: state.nextCheck,
      error: state.lastError,
      current,
      upcoming,
      restocks,
    };
  }

  async function check() {
    try {
      const res = await doFetch(API_URL, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`The shop API answered with HTTP ${res.status}`);
      const data = await res.json();
      state.last = data;
      state.lastCheck = Date.now();
      state.lastError = null;
      state.errors = 0;
      // Every poll is a sample of what the shops stock (budget.js counts them).
      if (onData) {
        try {
          onData(data);
        } catch (err) {
          /* statistics must never stop an alert */
        }
      }
      const fired = evaluate(data);
      state.firstPoll = false;
      if (fired.length) onAlerts(fired);
      return data;
    } catch (err) {
      state.errors += 1;
      state.lastError = err && err.message ? err.message : String(err);
      return null;
    }
  }

  async function loop() {
    if (!state.running || state.inFlight) return;
    clearTimeout(state.timer);
    state.inFlight = true;
    const data = await check();
    state.inFlight = false;
    if (!state.running) return;
    // On failure, back off: 15s, 30s, 1m, 2m, then every 4m.
    const delay = data ? nextDelay(data) : 15000 * 2 ** Math.min(state.errors - 1, 4);
    state.nextCheck = Date.now() + delay;
    onStatus(status());
    state.timer = setTimeout(loop, delay);
  }

  // For the sample: what the watcher last saw and did, compactly, so a
  // missed alert can be traced (which items were in stock, which rule they
  // matched, what key they were remembered under).
  function diagnostics() {
    const rules = activeRules();
    const itemRules = rules.filter((r) => r.kind === 'item' || r.kind === 'decor');
    const feed = state.last || {};
    const shops = {};
    for (const [shopId, shop] of Object.entries(feed.shops || {})) {
      if (!shop) continue;
      shops[shopId] = {
        open: Boolean(shop.open),
        keys: Object.keys(shop).slice(0, 12),
        nextRestockAt: shop.nextRestockAt || null,
        listed: Array.isArray(shop.items) ? shop.items.length : 0,
        inStock: (Array.isArray(shop.items) ? shop.items : []).filter((it) => it && it.stock > 0).slice(0, 30).map((it) => {
          const rule = itemRules.find((r) => (r.kind === 'decor' ? it.itemType === 'Decor' && it.coinPrice != null && it.coinPrice >= r.minPrice : nameMatches(it, r.match, r.ids)));
          return { itemId: it.itemId, name: it.name, stock: it.stock, type: it.itemType, rule: rule ? rule.id : null };
        }),
      };
    }
    return {
      lastCheck: state.lastCheck,
      lastError: state.lastError,
      errors: state.errors,
      firstPoll: state.firstPoll,
      activeItemRules: itemRules.map((r) => r.id),
      remembered: state.seen.size,
      recentFired: state.recentFired.slice(-30),
      openedAt: state.openedAt,
      weather: feed.weather && feed.weather.current ? { name: feed.weather.current.name || feed.weather.current.weatherId, endsAt: feed.weather.current.endsAt } : null,
      shops,
    };
  }

  // What's in stock right now in every open shop, with prices.
  function current() {
    const out = [];
    for (const [shopId, shop] of Object.entries((state.last && state.last.shops) || {})) {
      if (!shop || !shop.open) continue;
      for (const it of Array.isArray(shop.items) ? shop.items : []) {
        if (!it || !(it.stock > 0) || !(Number(it.coinPrice) > 0)) continue;
        out.push({ itemId: String(it.itemId || ''), name: String(it.name || it.itemId || ''), type: String(it.itemType || ''), price: Number(it.coinPrice), shop: shopId });
      }
    }
    return out;
  }

  return {
    current,
    start() {
      if (state.running) return;
      state.running = true;
      state.firstPoll = true;
      loop();
    },
    stop() {
      state.running = false;
      clearTimeout(state.timer);
    },
    async checkNow() {
      if (state.inFlight) return;
      state.running = true;
      await loop();
    },
    status,
    diagnostics,
    // exposed for testing
    _evaluate: evaluate,
    _state: state,
  };
}

module.exports = { RULES, createWatcher, publicRules, allRules, inQuietHours, nameMatches, nameKeys, keysMatch };
