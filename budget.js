'use strict';

// Spending vs. earning: is your garden paying for what you buy?
//
// It watches, rather than predicts. Every half hour (while the game is open
// here) the app notes three numbers the game already keeps:
//
//   coins   your wallet
//   sold    lifetime coins from selling crops and pets
//   found   lifetime coins your pets found (Coin Finder, Crop Eater)
//
// Over any stretch of time:
//
//   earned = sold + found (the change in them)
//   kept   = the change in your wallet
//   spent  = earned - kept        every coin that went out, wherever you
//                                 spent it: seeds, eggs, decor, restocks,
//                                 on your phone, while the app was closed
//
// Purchases of particular things (for "you buy 3 of every 4 Moonbinders
// you see") come from the game's own purchase command going over its
// connection, which the app can see the same way it sees harvests, so those
// only count what you buy through this app. How often each thing was in
// stock comes from the shop feed the alert watcher already polls.
//
// Plain Node, no Electron, so it can be tested on its own.

const alerts = require('./alerts');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pretty = (id) => String(id || '').replace(/([a-z])([A-Z])/g, '$1 $2');

// Prices for the alerted items (wiki shop pages, Sep 2026), used for "how
// long to afford" until the shop feed has shown the item.
const KNOWN = {
  moonbinder: { name: 'Moonbinder Pod', price: 50e9, cat: 'celestials' },
  dawnbinder: { name: 'Dawnbinder Pod', price: 10e9, cat: 'celestials' },
  dawnbreaker: { name: 'Dawnbreaker Spore', price: 10e6, cat: 'seeds' },
  emberbloom: { name: 'Emberbloom Pod', price: 25e6, cat: 'seeds' },
  thunderspire: { name: 'Thunderspire Pod', price: 3e9, cat: 'celestials' },
  starweaver: { name: 'Starweaver Pod', price: 1e9, cat: 'celestials' },
  mythicalegg: { name: 'Mythical Egg', price: 1e9, cat: 'eggs' },
  amberegg: { name: 'Amber Egg', price: 2e9, cat: 'eggs' },
  legendaryegg: { name: 'Legendary Egg', price: 100e6, cat: 'eggs' },
  windturner: { name: 'Wind Turner', price: 100e9, cat: 'decor' },
  firepit: { name: 'Stone Firepit', price: 100e9, cat: 'decor' },
  ube: { name: 'Ube Seed', price: 1e6, cat: 'seeds' },
  milkcap: { name: 'Milkcap Spore', price: 1e6, cat: 'seeds' },
  marigold: { name: 'Marigold Seed', price: 250e6, cat: 'seeds' },
};

// Spending categories. Seeds are the odd one out: they pay you back, so the
// budget treats them as an investment rather than something to cut.
// Spending categories, in the owner's order of importance. Celestials, seeds
// and eggs (pets) are *invested*: coins turned into garden or into what
// grows it. Decor, tools and the rest are *spent*. Celestials outrank
// everything: they're so rare that owning them, even cash-poor, opens more
// than the best pets or decor.
const CATS = ['celestials', 'seeds', 'eggs', 'decor', 'tools', 'other'];
const CAT_INFO = {
  celestials: { label: 'Celestials', emoji: '✨', investment: true },
  seeds: { label: 'Seeds', emoji: '🌱', investment: true },
  eggs: { label: 'Eggs & pets', emoji: '🥚', investment: true },
  decor: { label: 'Decor', emoji: '🪴', investment: false },
  tools: { label: 'Tools & potions', emoji: '🧰', investment: false },
  other: { label: 'Other', emoji: '📦', investment: false },
  elsewhere: { label: 'Not seen', emoji: '❔', investment: false },
};
// The game's own ids for the celestial plants, and their names.
const CELESTIAL = /celestial|moonbinder|dawnbinder|thunderspire|starweaver/i;

function categoryOf({ type, shop, id, name }) {
  if (CELESTIAL.test(String(id || '')) || CELESTIAL.test(String(name || ''))) return 'celestials';
  const t = String(type || '');
  if (/seed|plant|crop|spore|pod/i.test(t)) return 'seeds';
  if (/egg/i.test(t)) return 'eggs';
  if (/decor/i.test(t)) return 'decor';
  if (/tool|potion|shard|gear/i.test(t)) return 'tools';
  const k = KNOWN[norm(id)] || KNOWN[norm(name)];
  if (k) return k.cat;
  const n = String(name || id || '');
  if (/egg$/i.test(n)) return 'eggs';
  if (/seed|pod|spore|cutting|kernel|pit|bean$/i.test(n)) return 'seeds';
  if (/potion|shard/i.test(n)) return 'tools';
  const sk = shopKind(shop);
  if (sk === 'seed') return 'seeds';
  if (sk === 'egg') return 'eggs';
  if (sk === 'decor') return 'decor';
  if (sk === 'tool') return 'tools';
  return 'other';
}

/* ---------------------------------------------------------------- *
 * How often things show up
 *
 * Two sources, blended by how many days each has watched:
 *   - BASELINE: the Magic Circle Discord's #pingspam channel, where people
 *     ping when a rare item is in stock (many pings per stock, clustered
 *     into appearances by tests/pingspam-rates.js). Very reliable for the
 *     rare, expensive things; patchy for cheap ones, which aren't listed.
 *   - The app's own shop-feed counting (stats above): times in stock over
 *     restocks watched, turned into days with the shop's cadence.
 * ---------------------------------------------------------------- */

// Openings per day (magicgarden.wiki/Shops and /Weather_Events, Sep 2026):
// seed 5 min, egg 15, tool 10, decor hourly; hydro weather every 40-60 min
// split Rain 50 / Snow 30 / Thunder 20; lunar every 4 h split Dawn 67 /
// Amber 33 (each weather shop opens once per event).
const SHOP_KINDS = {
  seed: { label: 'Seed shop', perDay: 288 },
  egg: { label: 'Egg shop', perDay: 96 },
  tool: { label: 'Tool shop', perDay: 144 },
  decor: { label: 'Decor shop', perDay: 24 },
  rain: { label: 'Rain shop', perDay: 14.4 },
  snow: { label: 'Snow shop', perDay: 8.64 },
  thunder: { label: 'Thunder shop', perDay: 5.76 },
  dawn: { label: 'Dawn shop', perDay: 4.02 },
  amber: { label: 'Amber shop', perDay: 1.98 },
};

function shopKind(shopId) {
  const s = String(shopId || '').toLowerCase();
  if (/thunder|storm|lightning/.test(s)) return 'thunder';
  if (/rain/.test(s)) return 'rain';
  if (/snow|frost|winter/.test(s)) return 'snow';
  if (/dawn/.test(s)) return 'dawn';
  if (/amber|harvest/.test(s)) return 'amber';
  if (/seed/.test(s)) return 'seed';
  if (/egg|pet/.test(s)) return 'egg';
  if (/tool|gear/.test(s)) return 'tool';
  if (/decor|cosmetic/.test(s)) return 'decor';
  return null;
}

// Appearances per day from #pingspam (export of 24 Sep 2026; see
// tests/pingspam-rates.js for the windows). Items that moved to the
// Dawn/Amber shops on 28 Aug use the window since then when it has 8+
// sightings, else since 1 Jun (the per-day rate looks alike either side).
const BASELINE_SHOP = { moonbinder: 'amber', dawnbinder: 'dawn', dawnbreaker: 'dawn', emberbloom: 'amber', ube: 'dawn', thunderspire: 'thunder', milkcap: 'thunder', windturner: 'thunder', mythicalegg: 'egg', amberegg: 'amber', windspinner: 'thunder', cauldron: 'thunder', miniwizardtower: 'decor', minifairycastle: 'decor', starweaver: 'seed', legendaryegg: 'egg', firepit: 'amber', marigold: 'amber' };
const BASELINE = {
  moonbinder: { perDay: 0.0777, events: 9, days: 115.8, since: '2026-06-01' },
  dawnbinder: { perDay: 0.1814, events: 21, days: 115.8, since: '2026-06-01' },
  dawnbreaker: { perDay: 0.3602, events: 10, days: 27.8, since: '2026-08-28' },
  emberbloom: { perDay: 0.1441, events: 4, days: 27.8, since: '2026-08-28' },
  ube: { perDay: 0.646, events: 89, days: 137.8, since: '2026-05-10' },
  thunderspire: { perDay: 0.2451, events: 22, days: 89.8, since: '2026-06-27' },
  milkcap: { perDay: 1.0138, events: 91, days: 89.8, since: '2026-06-27' },
  windturner: { perDay: 0.1114, events: 10, days: 89.8, since: '2026-06-27' },
  mythicalegg: { perDay: 1.0798, events: 125, days: 115.8, since: '2026-06-01' },
  // Amber Egg: new with the Amber shop on 28 Aug; 47 sightings in 27.8 days.
  amberegg: { perDay: 1.6906, events: 47, days: 27.8, since: '2026-08-28' },
  // Decor (for the "buy everything" line), from the same pings.
  windspinner: { perDay: 0.2116, events: 19, days: 89.8, since: '2026-06-27' },
  cauldron: { perDay: 0.4009, events: 36, days: 89.8, since: '2026-06-27' },
  miniwizardtower: { perDay: 0.1814, events: 21, days: 115.8, since: '2026-06-01' },
  minifairycastle: { perDay: 0.0868, events: 13, days: 149.8, since: '2026-04-28' },
  starweaver: { perDay: 0.095, events: 11, days: 115.8, since: '2026-06-01' },
};

/* ---------------------------------------------------------------- *
 * What the shop feed shows: one sample per restock, per item
 *
 * stats = { shops: { [shopId]: { restocks, key, wasOpen, firstAt, lastAt } },
 *           items: { [itemId]: { name, type, shop, price, restocks, seen,
 *                                stockSum, firstAt, lastSeenAt } } }
 * ---------------------------------------------------------------- */

const MAX_ITEMS = 500;

function emptyStats() {
  return { shops: {}, items: {} };
}

function migrateStats(s) {
  const st = s && typeof s === 'object' ? s : {};
  st.shops = st.shops && typeof st.shops === 'object' ? st.shops : {};
  st.items = st.items && typeof st.items === 'object' ? st.items : {};
  return st;
}

// One poll of the shop feed. Returns how many new restocks were counted.
function record(stats, data, now = Date.now()) {
  let counted = 0;
  for (const [shopId, shop] of Object.entries((data && data.shops) || {})) {
    const sh = stats.shops[shopId] || (stats.shops[shopId] = { restocks: 0, key: null, wasOpen: null, firstAt: now, lastAt: null });
    const open = Boolean(shop && shop.open);
    if (!open) {
      sh.wasOpen = false;
      continue;
    }
    // A new restock: the feed's next restock time moved on. Shops that give
    // no time (a weather shop, open for one event) count each opening.
    const key = shop.nextRestockAt ? `r:${shop.nextRestockAt}` : sh.wasOpen ? sh.key : `o:${now}`;
    sh.wasOpen = true;
    if (key === sh.key) continue;
    sh.key = key;
    sh.restocks += 1;
    sh.lastAt = now;
    counted += 1;
    for (const item of Array.isArray(shop.items) ? shop.items : []) {
      if (!item || !item.itemId) continue;
      const id = String(item.itemId).slice(0, 80);
      const it = stats.items[id] || (stats.items[id] = { name: '', type: '', shop: shopId, price: null, restocks: 0, seen: 0, stockSum: 0, firstAt: now, lastSeenAt: null });
      it.name = String(item.name || it.name || id).slice(0, 60);
      it.type = String(item.itemType || it.type || '').slice(0, 20);
      it.shop = shopId;
      const price = Number(item.coinPrice);
      if (Number.isFinite(price) && price > 0) it.price = price;
      it.restocks += 1;
      const stock = Number(item.stock);
      if (stock > 0) {
        it.seen += 1;
        it.stockSum += stock;
        it.lastSeenAt = now;
      }
    }
  }
  const ids = Object.keys(stats.items);
  if (ids.length > MAX_ITEMS) {
    ids.sort((a, b) => (stats.items[a].lastSeenAt || stats.items[a].firstAt) - (stats.items[b].lastSeenAt || stats.items[b].firstAt));
    for (const id of ids.slice(0, ids.length - MAX_ITEMS)) delete stats.items[id];
  }
  return counted;
}

/* ---------------------------------------------------------------- *
 * Money history: { t, c: coins, s: sold, f: found }, one point per half hour
 * ---------------------------------------------------------------- */

const EVERY_MS = 30 * 60 * 1000;
const KEEP = 1500;

function recordMoney(settings, sample, now = Date.now()) {
  const c = Number(sample && sample.coins);
  const s = Number(sample && sample.sold);
  const f = Number(sample && sample.found);
  if (!Number.isFinite(c) || !Number.isFinite(s)) return false;
  const h = Array.isArray(settings.moneyHistory) ? settings.moneyHistory : (settings.moneyHistory = []);
  const point = { t: now, c: Math.round(c), s: Math.round(s), f: Number.isFinite(f) ? Math.round(f) : 0 };
  const last = h[h.length - 1];
  if (!last || now - last.t >= EVERY_MS) {
    h.push(point);
    if (h.length > KEEP) h.splice(0, h.length - KEEP);
    return true;
  }
  Object.assign(last, point, { t: last.t });
  return false;
}

const MIN_SPAN_MS = 60 * 60 * 1000;

// Money in and out over the last `days` days (or all of the history if it
// is shorter). Rates are per day of real time, gaps included: a day the
// app was closed still passed, and the game's totals catch up on reconnect.
function flows(history, days, now = Date.now()) {
  const pts = (Array.isArray(history) ? history : []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.c) && Number.isFinite(p.s)).sort((a, b) => a.t - b.t);
  if (!pts.length) return { ok: false, days, hours: 0, note: "Nothing measured yet: the app notes what you earn and spend every half hour while the game is open here." };
  const last = pts[pts.length - 1];
  const first = pts.find((p) => p.t >= last.t - days * 86400000) || pts[0];
  const span = last.t - first.t;
  const hours = span / 3600000;
  if (span < MIN_SPAN_MS) return { ok: false, days, hours, note: `Still measuring (${Math.max(1, Math.round(span / 60000))} minutes so far; it needs an hour).` };
  const sold = Math.max(0, last.s - first.s);
  const found = Math.max(0, (last.f || 0) - (first.f || 0));
  const earned = sold + found;
  const kept = last.c - first.c;
  const rawSpent = earned - kept;
  // Coins that arrived from somewhere the app can't see (a gift, a quest)
  // show up as more kept than earned. Spending can't be less than nothing.
  const spent = Math.max(0, rawSpent);
  const unknownIn = Math.max(0, -rawSpent);
  const perDay = 86400000 / span;
  return {
    ok: true,
    days,
    hours,
    from: first.t,
    to: last.t,
    earned, sold, found, kept, spent, unknownIn,
    coinsNow: last.c,
    coinsStart: first.c,
    earnedPerDay: earned * perDay,
    spentPerDay: spent * perDay,
    keptPerDay: kept * perDay,
    // The share of what you earn that goes straight back out.
    share: earned > 0 ? Math.min(9.99, spent / earned) : null,
  };
}

// Day by day, for a chart: the last `days` days with what came in, went out
// and stayed each day (UTC days), from the money history's points.
function daily(history, days = 14, now = Date.now()) {
  const pts = (Array.isArray(history) ? history : []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.c) && Number.isFinite(p.s)).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return [];
  const D = 86400000;
  const today = Math.floor(now / D);
  const out = [];
  for (let d = today - days + 1; d <= today; d += 1) {
    const from = d * D;
    const to = from + D;
    // The last point before the day and the last point inside it.
    let a = null;
    let b = null;
    for (const p of pts) {
      if (p.t < from) a = p;
      else if (p.t < to) b = p;
      else break;
    }
    if (!a || !b) {
      out.push({ day: d, t: from, earned: null, spent: null, kept: null });
      continue;
    }
    const earned = Math.max(0, (b.s - a.s) + ((b.f || 0) - (a.f || 0)));
    const kept = b.c - a.c;
    out.push({ day: d, t: from, earned, kept, spent: Math.max(0, earned - kept) });
  }
  return out;
}

// The verdict for one period, with friendly tips. Levels: wait, quiet,
// short (spending ahead), close (just about even), ok (saving).
function verdict(f) {
  if (!f || !f.ok) return { level: 'wait', text: (f && f.note) || 'Measuring…', tips: [] };
  const tips = [];
  if (f.earned <= 0 && f.spent <= 0) return { level: 'quiet', text: 'Nothing bought or sold in this stretch.', tips };
  const net = f.keptPerDay;
  if (net < 0) {
    const runway = f.coinsNow > 0 ? f.coinsNow / -net : 0;
    if (f.coinsNow > 0) tips.push({ kind: 'runway', days: runway });
    tips.push({ kind: 'cut', perDay: -net, share: f.spentPerDay > 0 ? -net / f.spentPerDay : null });
    return { level: 'short', net, runway, text: 'Spending is ahead of earning.', tips };
  }
  if (f.share != null && f.share >= 0.9) {
    tips.push({ kind: 'room', perDay: net });
    return { level: 'close', net, text: 'Just about breaking even.', tips };
  }
  tips.push({ kind: 'room', perDay: net });
  tips.push({ kind: 'month', total: net * 30 });
  return { level: 'ok', net, text: 'Earning is ahead of spending.', tips };
}

/* ---------------------------------------------------------------- *
 * Purchases: what the game's purchase command bought
 * ---------------------------------------------------------------- */

const ID_KEYS = ['itemId', 'id', 'item', 'species', 'eggId', 'decorId', 'toolId', 'shopItemId', 'productId', 'name'];
const QTY_KEYS = ['quantity', 'count', 'amount', 'qty', 'number'];
const SHOP_KEYS = ['shopId', 'shop', 'shopType', 'shopKind'];

// The purchase record's format version. Anything recorded before the
// game's own tally was used (v2) was junk (purchases went unidentified),
// so older records are cleared once on upgrade.
const PURCHASES_VERSION = 2;

function migratePurchases(p) {
  const x = p && typeof p === 'object' ? p : {};
  x.v = Number.isFinite(x.v) ? x.v : (p ? 1 : PURCHASES_VERSION);
  x.since = Number.isFinite(x.since) ? x.since : null;
  x.total = x.total && typeof x.total === 'object' ? x.total : { count: 0, coins: 0 };
  x.byRule = x.byRule && typeof x.byRule === 'object' ? x.byRule : {};
  x.log = Array.isArray(x.log) ? x.log.slice(-100) : [];
  x.unknown = Number(x.unknown) || 0;
  // Coins per day per category, keyed by day number (UTC), 60 days kept.
  x.days = x.days && typeof x.days === 'object' ? x.days : {};
  // Per item id (so a thing matched by two alerts is never counted twice).
  x.byItem = x.byItem && typeof x.byItem === 'object' ? x.byItem : {};
  return x;
}
const MAX_BY_ITEM = 300;

const DAY_MS = 86400000;
const KEEP_DAYS = 60;

// Starts the purchase record over (the shop's "seen" counts stay: they were
// always right). The tally already seen is kept, so only purchases from
// now on count, not the current restock's again.
function resetPurchases(settings, now = Date.now()) {
  settings.purchases = migratePurchases({ v: PURCHASES_VERSION, since: now });
  return settings.purchases;
}

// Which item a purchase command names, how many, from which shop.
function itemOfCommand(cmd, stats) {
  const c0 = cmd && typeof cmd === 'object' ? cmd : {};
  // The game's purchase command nests the item ({shop, item: {...}}): look
  // one level in as well.
  const c = Object.assign({}, c0);
  for (const v of Object.values(c0)) if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) if (!(k2 in c)) c[k2] = v2;
  let id = null;
  for (const v of Object.values(c)) {
    if (typeof v === 'string' && stats.items[v]) {
      id = v;
      break;
    }
  }
  if (!id) for (const k of ID_KEYS) if (typeof c[k] === 'string' && c[k]) { id = c[k]; break; }
  let qty = 1;
  for (const k of QTY_KEYS) {
    const n = Number(c[k]);
    if (Number.isFinite(n) && n >= 1) { qty = Math.min(999, Math.floor(n)); break; }
  }
  let shop = null;
  for (const k of SHOP_KEYS) if (typeof c[k] === 'string' && c[k]) { shop = c[k].slice(0, 40); break; }
  return { id: id ? String(id).slice(0, 80) : null, qty, shop };
}

function matches(rule, id, it, keys) {
  if (rule.kind === 'decor') return /decor/i.test(it.type || '') && it.price != null && it.price >= (rule.minPrice || 0);
  return alerts.keysMatch(keys || alerts.nameKeys({ itemId: id, name: it.name }), rule.match, rule.ids);
}

// The items a rule covers. Inside a cached() call this is worked out once
// per rule and reused, and each item's name is prepared for matching once
// (every part of the view needs the matches; matching every item against
// every rule over and over was most of its cost).
let CACHE = null;
function itemKeys(stats, id) {
  if (!(CACHE && CACHE.stats === stats)) return null;
  let k = CACHE.keys.get(id);
  if (!k) {
    k = alerts.nameKeys({ itemId: id, name: stats.items[id].name });
    CACHE.keys.set(id, k);
  }
  return k;
}
function matchedIds(rule, stats) {
  if (CACHE && CACHE.stats === stats && CACHE.byRule.has(rule.id)) return CACHE.byRule.get(rule.id);
  const ids = Object.keys(stats.items).filter((id) => matches(rule, id, stats.items[id], itemKeys(stats, id)));
  if (CACHE && CACHE.stats === stats) CACHE.byRule.set(rule.id, ids);
  return ids;
}

// Runs fn with the cache on for these settings, or inside the one already
// running for them (so view → foresight → everything share one). Nothing
// outside changes: same inputs, same results, just less repeated work.
function cached(settings, fn) {
  if (CACHE && CACHE.settings === settings) return fn();
  const outer = CACHE;
  CACHE = { settings, stats: migrateStats(settings.shopStats), byRule: new Map(), keys: new Map(), rules: null };
  try {
    return fn();
  } finally {
    CACHE = outer;
  }
}
function itemRules(settings) {
  if (CACHE && CACHE.settings === settings && CACHE.rules) return CACHE.rules;
  const rules = alerts.allRules(settings).filter((r) => r.kind === 'item' || r.kind === 'decor');
  if (CACHE && CACHE.settings === settings) CACHE.rules = rules;
  return rules;
}

// Records one accepted purchase. Returns what was recorded, or null.
function recordPurchase(settings, payload, now = Date.now()) {
  const stats = migrateStats(settings.shopStats);
  const p = (settings.purchases = migratePurchases(settings.purchases));
  if (p.since == null) p.since = now;
  const { id, qty, shop } = itemOfCommand(payload && payload.command, stats);
  if (!id) {
    p.unknown += 1;
    return null;
  }
  const it = stats.items[id] || null;
  const known = KNOWN[norm(id)] || null;
  const name = (it && it.name) || (known && known.name) || pretty(id);
  const unit = it && it.price != null ? it.price : known ? known.price : null;
  const coins = unit != null ? unit * qty : null;
  const rules = alerts.allRules(settings).filter((r) => r.kind === 'item' || r.kind === 'decor');
  const hit = rules.filter((r) => matches(r, id, { name, type: it ? it.type : '', price: unit })).map((r) => r.id);
  const cat = categoryOf({ type: it ? it.type : '', shop: (it && it.shop) || shop, id, name });
  const entry = { t: Number(payload && payload.at) || now, id, name: String(name).slice(0, 60), qty, coins, shop: (it && it.shop) || shop || null, cat, rules: hit };
  p.log.push(entry);
  {
    const day = String(Math.floor(entry.t / DAY_MS));
    const b = p.days[day] || (p.days[day] = {});
    b[cat] = (b[cat] || 0) + (coins || 0);
    const cutoff = Math.floor(entry.t / DAY_MS) - KEEP_DAYS;
    for (const k of Object.keys(p.days)) if (Number(k) < cutoff) delete p.days[k];
  }
  if (p.log.length > 100) p.log.splice(0, p.log.length - 100);
  p.total.count += 1;
  p.total.coins += coins || 0;
  {
    const bi = p.byItem[id] || (p.byItem[id] = { count: 0, coins: 0, last: null });
    bi.count += 1;
    bi.coins += coins || 0;
    bi.last = entry.t;
    const ids = Object.keys(p.byItem);
    if (ids.length > MAX_BY_ITEM) {
      ids.sort((a, b) => p.byItem[a].last - p.byItem[b].last);
      for (const k of ids.slice(0, ids.length - MAX_BY_ITEM)) delete p.byItem[k];
    }
  }
  for (const r of hit) {
    const b = p.byRule[r] || (p.byRule[r] = { count: 0, coins: 0, last: null });
    b.count += 1;
    b.coins += coins || 0;
    b.last = entry.t;
  }
  return entry;
}

// For each alerted thing: how often it was in stock while the app watched,
// how many times you bought it here, and the share.
function patterns(settings) {
  const stats = migrateStats(settings.shopStats);
  const p = migratePurchases(settings.purchases);
  const off = new Set((settings.alerts && settings.alerts.disabled) || []);
  const rows = [];
  for (const rule of itemRules(settings)) {
    let seen = 0;
    let price = null;
    for (const id of matchedIds(rule, stats)) {
      const it = stats.items[id];
      seen += it.seen;
      if (it.price != null && (price == null || it.price > price)) price = it.price;
    }
    const b = p.byRule[rule.id] || { count: 0, coins: 0, last: null };
    if (!seen && !b.count) continue;
    rows.push({
      ruleId: rule.id,
      label: rule.label,
      alertOn: !off.has(rule.id),
      seen,
      bought: b.count,
      coins: b.coins,
      last: b.last,
      share: seen > 0 ? Math.min(1, b.count / seen) : null,
      price,
    });
  }
  rows.sort((a, b) => b.coins - a.coins || b.bought - a.bought || b.seen - a.seen);
  return rows;
}

// How often something shows up, per day: the community baseline and the
// app's own counting blended by days watched. null until anything is known.
function rate(rule, stats) {
  const base = BASELINE[rule.id] || BASELINE[norm(rule.match)] || null;
  let best = null;
  for (const id of matchedIds(rule, stats)) {
    const it = stats.items[id];
    if (!best || it.restocks > best.restocks) best = it;
  }
  const kind = best ? shopKind(best.shop) : null;
  const appDays = best && kind && best.restocks > 0 ? best.restocks / SHOP_KINDS[kind].perDay : 0;
  const appSeen = appDays > 0 ? best.seen : 0;
  const events = (base ? base.events : 0) + appSeen;
  const days = (base ? base.days : 0) + appDays;
  if (days <= 0) return null;
  const shopK = kind || (base && (BASELINE_SHOP[rule.id] || BASELINE_SHOP[norm(rule.match)])) || null;
  return {
    shop: shopK ? SHOP_KINDS[shopK].label : null,
    perDay: events > 0 ? events / days : null,
    events,
    days,
    source: base && appDays > 0 ? 'both' : base ? 'pingspam' : 'app',
    since: base ? base.since : null,
    appSeen,
    appRestocks: best ? best.restocks : 0,
    shopKind: kind || (base && BASELINE_SHOP[rule.id]) || (base && BASELINE_SHOP[norm(rule.match)]) || null,
    typical: best && best.seen > 0 ? best.stockSum / best.seen : 1,
  };
}

// "Can your garden afford this?": for each alerted item, what buying every
// one would cost per day against what you earn and keep. f = the money
// flows for the steadiest ready period.
function priceOf(rule, stats) {
  let price = null;
  let name = rule.label;
  for (const id of matchedIds(rule, stats)) {
    const it = stats.items[id];
    if (it.price == null) continue;
    if (price == null || it.price > price) {
      price = it.price;
      name = it.name || name;
    }
  }
  if (price == null) {
    const k = KNOWN[norm(rule.match)];
    if (k) {
      price = k.price;
      name = k.name;
    }
  }
  return { price, name };
}

function afford(settings, f) {
  const stats = migrateStats(settings.shopStats);
  const off = new Set((settings.alerts && settings.alerts.disabled) || []);
  const ok = Boolean(f && f.ok);
  const planned = new Set(planIds(settings));
  const out = [];
  for (const rule of alerts.allRules(settings).filter((r) => r.kind === 'item' && !off.has(r.id))) {
    const { price, name } = priceOf(rule, stats);
    if (price == null) continue;
    const r = rate(rule, stats);
    const costPerDay = r && r.perDay ? price * r.typical * r.perDay : null;
    let level = 'unknown';
    let shareOfEarned = null;
    let oneIn = null;
    if (costPerDay != null) {
      if (!ok) level = 'wait';
      else if (costPerDay <= f.keptPerDay) level = 'yes';
      else if (costPerDay <= f.earnedPerDay) level = 'cut';
      else level = 'no';
      if (ok && f.earnedPerDay > 0) {
        shareOfEarned = costPerDay / f.earnedPerDay;
        if (level === 'no') oneIn = Math.ceil(shareOfEarned);
      }
    }
    const coins = ok ? f.coinsNow : null;
    out.push({
      ruleId: rule.id,
      label: rule.label,
      name,
      price,
      rate: r,
      gapDays: r && r.perDay ? 1 / r.perDay : null,
      costPerDay,
      level,
      shareOfEarned,
      oneIn,
      keptPerDay: ok ? f.keptPerDay : null,
      earnedPerDay: ok ? f.earnedPerDay : null,
      haveIt: coins != null && coins >= price,
      daysToBank: coins != null && coins < price && f.keptPerDay > 0 ? (price - coins) / f.keptPerDay : null,
      planned: planned.has(rule.id),
    });
  }
  out.sort((a, b) => b.price - a.price);
  return out.slice(0, 12);
}

/* ---------------------------------------------------------------- *
 * The plan: things you're saving for, in order. The wallet is allotted to
 * them in that order, so "free to spend" is what's left after all of them.
 * ---------------------------------------------------------------- */

function planIds(settings) {
  const b = settings.budget && typeof settings.budget === 'object' ? settings.budget : {};
  const known = new Set(alerts.allRules(settings).filter((r) => r.kind === 'item').map((r) => r.id));
  return (Array.isArray(b.plan) ? b.plan : []).map(String).filter((id) => known.has(id));
}

// change: { add: ruleId } | { remove: ruleId } | { up: ruleId }
function setPlan(settings, change) {
  settings.budget = settings.budget && typeof settings.budget === 'object' ? settings.budget : {};
  let ids = planIds(settings);
  const c = change || {};
  if (c.add) {
    const id = String(c.add).slice(0, 80);
    if (!ids.includes(id) && alerts.allRules(settings).some((r) => r.kind === 'item' && r.id === id)) ids.push(id);
  }
  if (c.remove) ids = ids.filter((x) => x !== String(c.remove));
  if (c.up) {
    const i = ids.indexOf(String(c.up));
    if (i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
  }
  settings.budget.plan = ids.slice(0, 12);
  return settings.budget.plan;
}

// When the shop that sells this next opens. ctx.upcoming: the watcher's
// upcoming weather ({kind, possible, startsAt, name}); ctx.restocks: [{id, at}].
function nextOpening(kind, ctx, now) {
  const up = (ctx && ctx.upcoming) || [];
  const weatherKinds = { rain: 'Rain', snow: 'Snow', thunder: 'Thunderstorm', dawn: 'Dawn', amber: 'Amber Moon' };
  if (weatherKinds[kind]) {
    const sure = up.find((e) => e.kind === kind && Date.parse(e.startsAt) > now);
    if (sure) return { label: weatherKinds[kind], at: Date.parse(sure.startsAt), sure: true };
    const maybe = up.find((e) => !e.kind && Array.isArray(e.possible) && e.possible.includes(kind) && Date.parse(e.startsAt) > now);
    if (maybe) return { label: `${weatherKinds[kind]}?`, at: Date.parse(maybe.startsAt), sure: false };
    return null;
  }
  const rs = (ctx && ctx.restocks) || [];
  const r = rs.find((x) => shopKind(x.id) === kind);
  if (r && Date.parse(r.at) > now) return { label: `${SHOP_KINDS[kind] ? SHOP_KINDS[kind].label : 'shop'} restock`, at: Date.parse(r.at), sure: true };
  return null;
}

function plan(settings, f, ctx = {}) {
  const now = Number(ctx.now) || Date.now();
  const stats = migrateStats(settings.shopStats);
  const ok = Boolean(f && f.ok);
  const wallet = Number.isFinite(Number(ctx.wallet)) ? Number(ctx.wallet) : ok ? f.coinsNow : null;
  const kept = ok ? f.keptPerDay : null;
  const rules = alerts.allRules(settings);
  let remaining = wallet == null ? 0 : wallet;
  let cumulative = 0;
  const items = [];
  for (const id of planIds(settings)) {
    const rule = rules.find((r) => r.id === id);
    const { price, name } = priceOf(rule, stats);
    if (price == null) continue;
    const r = rate(rule, stats);
    const kind = r && r.shopKind ? r.shopKind : null;
    cumulative += price;
    const have = Math.max(0, Math.min(price, remaining));
    remaining = Math.max(0, remaining - have);
    const short = price - have;
    const funded = short <= 0;
    const daysToFund = funded ? 0 : kept > 0 ? (cumulative - wallet) / kept : null;
    const next = kind ? nextOpening(kind, ctx, now) : null;
    const haveByNext = next && wallet != null ? wallet + (kept > 0 ? (kept * (next.at - now)) / 86400000 : 0) : null;
    const chance = r && r.perDay && kind && SHOP_KINDS[kind] ? Math.min(1, r.perDay / SHOP_KINDS[kind].perDay) : null;
    items.push({
      ruleId: id,
      label: rule.label,
      name,
      price,
      have,
      pct: price > 0 ? have / price : 0,
      funded,
      short,
      daysToFund,
      fundedAt: daysToFund != null ? now + daysToFund * 86400000 : null,
      gapDays: r && r.perDay ? 1 / r.perDay : null,
      chancePerOpening: chance,
      shopLabel: r && r.shop ? r.shop : null,
      needTotal: cumulative,
      next: next ? Object.assign({}, next, { inMs: next.at - now, readyByThen: haveByNext != null ? haveByNext >= cumulative : null, haveByThen: haveByNext, shortByThen: haveByNext != null ? Math.max(0, cumulative - haveByNext) : null }) : null,
      // Funded before the next appearance is due, going by the average gap?
      likelyInTime: daysToFund != null && r && r.perDay ? daysToFund <= 1 / r.perDay : null,
    });
  }
  const reserved = wallet == null ? 0 : wallet - remaining;
  const target = items.find((i) => !i.funded) || null;
  return {
    items,
    wallet,
    reserved,
    free: wallet == null ? null : remaining,
    keptPerDay: kept,
    // Buying something now pushes the next unfunded thing back by this much.
    delayHoursPerB: kept > 0 ? (1e9 / kept) * 24 : null,
    target: target ? target.ruleId : null,
    totalPrice: items.reduce((a, i) => a + i.price, 0),
  };
}

/* ---------------------------------------------------------------- *
 * Foresight: "will I be able to buy what I want when it next shows up?"
 *
 * The wants are the plan, in priority order (the owner's default:
 * Moonbinder, Dawnbinder, Starweaver, Emberbloom, Dawnbreaker). Each one's
 * next appearance is taken as its average gap from now (the shops are
 * random; for random arrivals the average wait from any moment is the
 * average gap). Walking those dates in time order, coins grow at your
 * recent net-worth pace and each want is bought if you can afford it,
 * unless buying it would leave you short for something higher on the list
 * that comes later (a trade-off, not bought). "Safe to spend" is the most
 * you could spend now without any covered want becoming short.
 * ---------------------------------------------------------------- */

const DEFAULT_WANTS = ['moonbinder', 'dawnbinder', 'starweaver', 'emberbloom', 'dawnbreaker', 'mythicalegg', 'amberegg'];

// One icon per want, the same everywhere (chart, lists, chips, money box).
const ICONS = {
  moonbinder: '🌙', dawnbinder: '🌅', starweaver: '⭐', emberbloom: '🔥', dawnbreaker: '🌄',
  thunderspire: '⚡', mythicalegg: '🥚', amberegg: '🟠', legendaryegg: '🪺', windturner: '🌬️', firepit: '🏕️',
  ube: '🍠', milkcap: '🍄', marigold: '🌼', decor: '🪴',
};
const D_MS = 86400000;

// Coins a day your net worth has been growing by, over the last week
// (the unit this is all measured in); 0 when shrinking.
function pace(settings, ctx, now) {
  if (Number.isFinite(Number(ctx.pace))) return { perDay: Math.max(0, Number(ctx.pace)), measured: true, raw: Number(ctx.pace) };
  const g = growth(settings, ctx, 7, now);
  if (g.change == null || !(g.hours >= 1)) return { perDay: 0, measured: false, raw: null };
  const raw = (g.change / g.hours) * 24;
  return { perDay: Math.max(0, raw), measured: true, raw };
}

// The crops' side of the money, from the garden report under the "ready to
// sell" rule: what's sellable now, what's still growing (worth now, and at
// least worth once ready), and when that harvest is due.
function gardenParts(ctx) {
  const g = ctx.garden || {};
  // null / undefined means "not known" (Number(null) would read as 0 = now).
  const hours = g.harvestHours != null && Number.isFinite(Number(g.harvestHours)) ? Number(g.harvestHours) : null;
  return {
    ready: Number(g.readyValue) || 0,
    readyCount: Number(g.ready) || 0,
    growing: Number(g.growingValue) || 0,
    potential: Number(g.growingPotential) || 0,
    total: Number(g.total) || 0,
    harvestHours: hours,
  };
}

/* ---------------------------------------------------------------- *
 * "Buy everything": what buying every alerted item and every decoration
 * worth having, each time it shows up, costs a day. The line to beat.
 *
 * Decor from the wiki's list (1 Sep 2026), 100M and up (below that it
 * doesn't move the needle). How often each shows up: the pingspam counts
 * where the community pings it (Wind Turner, Wind Spinner, Cauldron, Mini
 * Wizard Tower, Mini Fairy Castle), blended with the app's own count of the
 * shops; for the rest (Stone Firepit, Mini Fairy Keep…) the app's own
 * count, and "not known yet" until it has one.
 * ---------------------------------------------------------------- */

const DECOR = [
  { id: 'minifairycastle', name: 'Mini Fairy Castle', price: 150e9, shop: 'decor' },
  { id: 'windturner', name: 'Wind Turner', price: 100e9, shop: 'thunder' },
  { id: 'firepit', name: 'Stone Firepit', price: 100e9, shop: 'amber' },
  { id: 'miniwizardtower', name: 'Mini Wizard Tower', price: 75e9, shop: 'decor' },
  { id: 'minifairykeep', name: 'Mini Fairy Keep', price: 25e9, shop: 'decor' },
  { id: 'windspinner', name: 'Wind Spinner', price: 10e9, shop: 'thunder' },
  { id: 'stonetorch', name: 'Stone Torch', price: 10e9, shop: 'amber' },
  { id: 'minifairyforge', name: 'Mini Fairy Forge', price: 5e9, shop: 'decor' },
  { id: 'strawscarecrow', name: 'Straw Scarecrow', price: 1e9, shop: 'decor' },
  { id: 'stonemoongate', name: 'Stone Moon Gate', price: 1e9, shop: 'amber' },
  { id: 'cauldron', name: 'Cauldron', price: 666e6, shop: 'thunder' },
  { id: 'minifairycottage', name: 'Mini Fairy Cottage', price: 500e6, shop: 'decor' },
  { id: 'marblefountain', name: 'Marble Fountain', price: 450e6, shop: 'rain' },
  { id: 'marbleknight', name: 'Marble Knight', price: 400e6, shop: 'decor' },
  { id: 'marbleblobling', name: 'Marble Blobling', price: 300e6, shop: 'decor' },
  { id: 'marblelamppost', name: 'Marble Lamp Post', price: 200e6, shop: 'decor' },
  { id: 'marblepedestal', name: 'Marble Pedestal', price: 180e6, shop: 'decor' },
  { id: 'marblebridge', name: 'Marble Bridge', price: 150e6, shop: 'decor' },
  { id: 'marblearch', name: 'Marble Arch', price: 100e6, shop: 'decor' },
  { id: 'moonwindchime', name: 'Moon Windchime', price: 100e6, shop: 'thunder' },
  { id: 'starwindchime', name: 'Star Windchime', price: 100e6, shop: 'thunder' },
];

const EVERYTHING_MIN_RESTOCKS = 10;

function everything(settings) {
  return cached(settings, () => everythingOf(settings));
}

function everythingOf(settings) {
  const stats = migrateStats(settings.shopStats);
  const rows = [];
  const seen = new Set();
  const add = (id, label, match, price, kind, ids) => {
    if (seen.has(id)) return;
    seen.add(id);
    const rule = { id, label, match, kind: 'item', ids };
    const r = rate(rule, stats);
    const known = priceOf(rule, stats).price;
    const p = known != null ? known : price;
    if (p == null) return;
    // A rate from the app's own count alone needs a fair sample (one opening
    // seen, one in stock, would read as "every opening").
    const thin = r && r.source === 'app' && (r.appRestocks || 0) < EVERYTHING_MIN_RESTOCKS;
    const perDay = r && r.perDay && !thin ? r.perDay : null;
    const typical = r && r.typical > 0 ? r.typical : 1;
    rows.push({ id, label, price: p, kind, perDay, typical, cost: perDay ? p * typical * perDay : 0, source: r ? r.source : null, restocks: r ? r.appRestocks : 0 });
  };
  for (const rule of alerts.allRules(settings).filter((x) => x.kind === 'item')) {
    const k = KNOWN[norm(rule.match)];
    add(rule.id, rule.label, rule.match, k ? k.price : null, DECOR.some((d) => d.id === rule.id) ? 'decor' : 'item', rule.ids);
  }
  for (const d of DECOR) add(d.id, d.name, d.name, d.price, 'decor');
  rows.sort((a, b) => b.cost - a.cost);
  const perDay = rows.reduce((a, r) => a + r.cost, 0);
  return {
    perDay,
    decorPerDay: rows.filter((r) => r.kind === 'decor').reduce((a, r) => a + r.cost, 0),
    rows,
    unknown: rows.filter((r) => r.perDay == null && r.price >= 1e9).map((r) => ({ label: r.label, price: r.price, restocks: r.restocks })),
  };
}

/* ---------------------------------------------------------------- *
 * Your money in the past, for the chart: wallet + ready-to-sell crops at
 * each half-hourly reading (the same measure the forecast starts from),
 * up to a week back, and the purchases worth marking on it (your wants,
 * or anything at least 1% of the biggest amount shown).
 * ---------------------------------------------------------------- */

const HISTORY_DAYS = 7;

function pastMoney(settings, now = Date.now(), days = HISTORY_DAYS) {
  const from = now - days * D_MS;
  const money = (Array.isArray(settings.moneyHistory) ? settings.moneyHistory : []).filter((p) => p && p.t >= from - 2 * H_MS && Number.isFinite(p.c));
  const worth = (Array.isArray(settings.worthHistory) ? settings.worthHistory : []).filter((p) => p && p.t >= from && p.t <= now && p.rv != null);
  const pts = [];
  let j = 0;
  for (const w of worth) {
    while (j + 1 < money.length && money[j + 1].t <= w.t + 15 * 60000) j += 1;
    const m = money[j];
    if (!m || Math.abs(m.t - w.t) > 2 * H_MS) continue;
    pts.push([(w.t - now) / D_MS, m.c + w.rv]);
  }
  if (pts.length < 2) return null;
  // Thin to about 160 points, keeping each bucket's first reading.
  const step = Math.max(1, Math.ceil(pts.length / 160));
  const line = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const top = Math.max(...line.map((p) => p[1]));
  const log = (settings.purchases && Array.isArray(settings.purchases.log)) ? settings.purchases.log : [];
  const buys = log
    .filter((e) => e && e.t >= from && e.t <= now && Number(e.coins) > 0)
    .filter((e) => (Array.isArray(e.rules) && e.rules.length) || e.coins >= top * 0.01)
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 12)
    .map((e) => ({ t: (e.t - now) / D_MS, at: e.t, name: e.name, coins: e.coins, ruleId: Array.isArray(e.rules) && e.rules.length ? e.rules[0] : null }))
    .sort((a, b) => a.t - b.t);
  return { line, buys, days: Math.max(0.25, -line[0][0]) };
}

/* ---------------------------------------------------------------- *
 * Harvest cycles, learned from your own history
 *
 * A harvest shows in the half-hourly records as the garden's worth
 * falling sharply while the lifetime "sold" total jumps. Between two
 * harvests is a cycle. From your recent cycles: how the garden's worth
 * climbs relative to what the harvest finally sold for (so "12 hours in,
 * gardens like yours are at 40% of their harvest"), and how long a cycle
 * takes. That predicts this cycle's harvest and, when the requirements
 * can't say when, its timing.
 * ---------------------------------------------------------------- */

const H_MS = 3600000;
const HARVEST_DROP = 0.4; // the garden loses at least 40% of its worth
const HARVEST_SOLD = 0.3; // and at least 30% of that shows up as sold
const CYCLES_WANTED = 3; // fully trusted after this many

function harvestCycles(settings) {
  const worth = (Array.isArray(settings.worthHistory) ? settings.worthHistory : []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  const money = (Array.isArray(settings.moneyHistory) ? settings.moneyHistory : []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.s)).sort((a, b) => a.t - b.t);
  const soldAt = (t) => {
    let best = null;
    for (const p of money) {
      if (p.t <= t) best = p;
      else break;
    }
    return best ? best.s + (best.f || 0) : null;
  };
  const soldAfter = (t) => {
    const p = money.find((x) => x.t >= t);
    return p ? p.s + (p.f || 0) : null;
  };
  // Harvests: a big drop between two readings no more than 3 h apart, with
  // the sold total rising by a good part of it around then. Drops spread
  // over neighbouring readings are merged.
  const harvests = [];
  for (let i = 1; i < worth.length; i += 1) {
    const a = worth[i - 1];
    const b = worth[i];
    if (b.t - a.t > 3 * H_MS || !(a.v > 0)) continue;
    const drop = a.v - b.v;
    if (drop < HARVEST_DROP * a.v) continue;
    const before = soldAt(a.t - H_MS);
    const after = soldAfter(b.t + 0.5 * H_MS);
    const sold = before != null && after != null ? after - before : null;
    if (sold == null || sold < HARVEST_SOLD * drop) continue;
    const last = harvests[harvests.length - 1];
    if (last && a.t - last.lowT <= 2 * H_MS) {
      last.lowT = b.t;
      last.lowV = b.v;
      last.sold = Math.max(last.sold, sold);
    } else {
      harvests.push({ peakT: a.t, peakV: a.v, lowT: b.t, lowV: b.v, sold });
    }
  }
  const cycles = [];
  for (let k = 1; k < harvests.length; k += 1) {
    const start = harvests[k - 1].lowT;
    const end = harvests[k].peakT;
    const hours = (end - start) / H_MS;
    if (hours < 1) continue;
    const pts = worth.filter((p) => p.t >= start && p.t <= end).map((p) => ({ h: (p.t - start) / H_MS, v: p.v }));
    cycles.push({ start, end, hours, sold: harvests[k].sold, peakV: harvests[k].peakV, points: pts });
  }
  return { harvests, cycles, lastEnd: harvests.length ? harvests[harvests.length - 1].lowT : null };
}

const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

function predictHarvest(settings, ctx = {}, now = Date.now()) {
  const parts = gardenParts(ctx);
  const hc = harvestCycles(settings);
  const learned = hc.cycles.slice(-5);
  const gardenNow = parts.ready + parts.growing;
  const elapsed = hc.lastEnd != null ? (now - hc.lastEnd) / H_MS : null;
  const typicalHours = median(learned.map((c) => c.hours));
  let ratio = null;
  if (learned.length && elapsed != null && gardenNow > 0) {
    // Where each past cycle stood at this point, as a share of its harvest.
    ratio = median(learned.map((c) => {
      if (!(c.sold > 0) || !c.points.length) return NaN;
      if (elapsed >= c.hours) return Math.min(1, c.peakV / c.sold);
      const near = c.points.reduce((m, p) => (!m || Math.abs(p.h - elapsed) < Math.abs(m.h - elapsed) ? p : m), null);
      return near.v / c.sold;
    }));
  }
  let predictedTotal = null;
  if (ratio != null && ratio > 0) {
    predictedTotal = ratio >= 1 ? gardenNow : gardenNow / Math.max(0.02, ratio);
    // Never beyond twice the best harvest learned (a guard against a
    // freshly planted garden's tiny value dividing into a huge guess).
    const best = Math.max(...learned.map((c) => c.sold));
    if (best > 0) predictedTotal = Math.min(predictedTotal, best * 2);
  }
  const floor = parts.potential;
  const predictedGrowing = Math.max(floor, predictedTotal != null ? predictedTotal - parts.ready : 0);
  const learnedRemaining = elapsed != null && typicalHours != null ? Math.max(1, typicalHours - elapsed) : null;
  const hours = parts.harvestHours != null ? parts.harvestHours : learnedRemaining;
  return {
    cycles: learned.length,
    cyclesWanted: CYCLES_WANTED,
    typicalHours,
    lastSold: learned.length ? learned[learned.length - 1].sold : hc.harvests.length ? hc.harvests[hc.harvests.length - 1].sold : null,
    harvestsSeen: hc.harvests.length,
    elapsedHours: elapsed,
    ratio,
    gardenNow,
    floor,
    predictedGrowing,
    predictedTotal: predictedTotal != null ? Math.max(predictedTotal, parts.ready + floor) : null,
    valueSource: predictedTotal != null && predictedGrowing > floor ? 'cycles' : 'floor',
    hours,
    hoursSource: parts.harvestHours != null ? 'requirements' : learnedRemaining != null ? 'cycles' : null,
    requirementHours: parts.harvestHours,
    cycleHours: learnedRemaining,
  };
}

/* ---------------------------------------------------------------- *
 * Estimated value
 *
 *   value(t) = ready now + (crops matured by t) × (worth of a ready crop)
 *   crops matured by t = maturing rate × t, capped at the crops that can
 *   still mature (the garden's crops not ready yet)
 *
 * "Ready" is the Money tab's rule (ripe, full size, gold/rainbow, weather,
 * moon). The rate is what you actually do: crops per hour crossing into
 * ready, from the half-hourly records (only increases count, so a harvest
 * doesn't make it negative; gaps over 2 h are left out). Until a few hours
 * of that exist it falls back to the requirement ETAs, then to your learned
 * cycles. A ready crop's worth is your ready crops' average right now, else
 * from the records, else the growing crops' floor.
 * ---------------------------------------------------------------- */

const RATE_MIN_HOURS = 3;

function maturingRate(settings, now = Date.now()) {
  const pts = (Array.isArray(settings.worthHistory) ? settings.worthHistory : [])
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.r) && p.t >= now - 48 * H_MS)
    .sort((a, b) => a.t - b.t);
  let gained = 0;
  let hours = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const dt = (pts[i].t - pts[i - 1].t) / H_MS;
    if (dt <= 0 || dt > 2) continue;
    hours += dt;
    gained += Math.max(0, pts[i].r - pts[i - 1].r);
  }
  // A ready crop's worth, from the records (for when few are ready now).
  const per = median(pts.filter((p) => p.r >= 5 && p.rv > 0).map((p) => p.rv / p.r));
  return { perHour: hours > 0 ? gained / hours : null, hours, gained, perCrop: per };
}

// Gold/Rainbow procs per hour from the hourly tally (settings.garden.hourly),
// over the last 24 h actually watched.
function procRate(settings, now = Date.now()) {
  const gd = settings.garden || {};
  const hourly = gd.hourly || {};
  const since = Number(gd.hourlySince) || null;
  if (!since) return { perHour: null, hours: 0, count: 0 };
  const from = Math.max(since, now - 24 * H_MS);
  // Hours the app actually watched (a reading in them, or a proc seen).
  let hours = 0;
  let count = 0;
  for (const [h, b] of Object.entries(hourly)) {
    if (Number(h) * H_MS + H_MS <= from || !b) continue;
    if (b.w || b.g || b.r) hours += 1;
    count += (b.g || 0) + (b.r || 0);
  }
  return { perHour: hours > 0 ? count / hours : null, hours, count };
}

function estimate(settings, ctx = {}, pred = null, now = Date.now()) {
  const parts = gardenParts(ctx);
  const R = parts.readyCount;
  const N = parts.total;
  const g0 = ctx.garden || {};
  const rule = Object.assign({ size: true, color: true, hydro: true, lunar: true }, ctx.readyRule || {});
  const missing = g0.missing || {};
  const steps = g0.stepHours || {};
  const petGold = Number(g0.goldPerHour) > 0 ? Number(g0.goldPerHour) : null;
  const procs = procRate(settings, now);
  // The cap: crops that CAN still mature. Leave out the ones stuck on a step
  // nothing will finish: short of full size with no size-boost pet out (its
  // time is unknown), or plain with nothing turning crops Gold/Rainbow.
  const sizeStuck = rule.size && missing.size > 0 && steps.size == null && g0.stepHours ? missing.size : 0;
  const goldStuck = rule.color && missing.color > 0 && !petGold && !(procs.count > 0) && g0.stepHours && steps.color == null ? missing.color : 0;
  const stuck = Math.max(sizeStuck, goldStuck);
  const G = Math.max(0, N - R - stuck);
  const obs = maturingRate(settings, now);
  // A ready crop's worth: the best of what's known, never below the growing
  // crops' own floor (their full-size-and-gold value is a real lower bound).
  const candidates = [];
  if (R >= 5 && parts.ready > 0) candidates.push({ v: parts.ready / R, src: 'ready' });
  else if (obs.perCrop) candidates.push({ v: obs.perCrop, src: 'history' });
  if (G > 0 && parts.potential > 0) candidates.push({ v: parts.potential / G, src: 'floor' });
  if (pred && pred.valueSource === 'cycles' && pred.predictedGrowing > 0 && G > 0) candidates.push({ v: pred.predictedGrowing / G, src: 'cycles' });
  const best = candidates.reduce((m, c) => (!m || c.v > m.v ? c : m), null);
  const perCrop = best ? best.v : null;
  const perCropSource = best ? best.src : null;
  // The rate: what you've actually been doing; else "all of them by the
  // predicted harvest" (requirements, or your cycles).
  let rate = null;
  let rateSource = null;
  // Gold/Rainbow is the slow, steady last step of the owner's process, so
  // while crops still need it, how fast they turn is how fast they mature.
  const colourBound = rule.color && missing.color > 0;
  if (obs.hours >= RATE_MIN_HOURS && (obs.gained > 0 || obs.hours >= 12)) {
    rate = obs.perHour;
    rateSource = 'observed';
  } else if (colourBound && procs.hours >= 1 && procs.count > 0) {
    rate = procs.perHour;
    rateSource = 'procs';
  } else if (colourBound && petGold) {
    rate = petGold;
    rateSource = 'pets';
  } else if (pred && pred.hours != null && pred.hours > 0 && G > 0) {
    rate = G / pred.hours;
    rateSource = pred.hoursSource;
  } else if (G === 0 && N > 0) {
    rate = 0;
    rateSource = 'full';
  }
  const usable = rate != null && perCrop != null && N > 0;
  const hoursToFull = usable ? (G === 0 ? 0 : rate > 0 ? G / rate : null) : null;
  return {
    usable,
    ready: R,
    readyValue: parts.ready,
    canMature: G,
    stuck,
    stuckWhy: stuck ? (sizeStuck >= goldStuck ? 'size' : 'color') : null,
    total: N,
    perCrop,
    perCropSource,
    rate,
    rateSource,
    observedHours: obs.hours,
    hoursToFull,
    fullAt: hoursToFull != null ? now + hoursToFull * H_MS : null,
    fullValue: perCrop != null ? parts.ready + G * perCrop : null,
    perDay: usable ? rate * 24 * perCrop : null,
  };
}

function foresight(settings, ctx = {}, extra = 0, now = Date.now()) {
  return cached(settings, () => foresightOf(settings, ctx, extra, now));
}

function foresightOf(settings, ctx, extra, now) {
  const stats = migrateStats(settings.shopStats);
  const rules = alerts.allRules(settings);
  const wallet = Number.isFinite(Number(ctx.wallet)) ? Number(ctx.wallet) : 0;
  const parts = gardenParts(ctx);
  // Coins you could have right now: the wallet plus crops ready to sell.
  // Crops still growing count only once they're ready (the harvest below).
  const W = wallet + parts.ready;
  const pred = predictHarvest(settings, ctx, now);
  const est = estimate(settings, ctx, pred, now);
  const mode = est.usable ? 'estimate' : 'harvest';
  const harvest = mode === 'harvest' && pred.predictedGrowing > 0 && pred.hours != null
    ? { t: pred.hours / 24, value: pred.predictedGrowing, at: now + pred.hours * 3600000, floor: pred.floor, valueSource: pred.valueSource, hoursSource: pred.hoursSource }
    : null;
  // When the garden will be full (every crop that can mature, matured):
  // after that, your usual pace (the next cycles).
  const tFull = mode === 'estimate' ? (est.hoursToFull != null ? est.hoursToFull / 24 : Infinity) : null;
  const p = pace(settings, ctx, now);
  const g = p.perDay;
  const wants = [];
  const unknown = [];
  planIds(settings).forEach((id, pri) => {
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;
    const { price, name } = priceOf(rule, stats);
    if (price == null) return;
    const r = rate(rule, stats);
    if (!r || !r.perDay) {
      unknown.push({ ruleId: id, label: rule.label, price, pri });
      return;
    }
    const t = 1 / r.perDay;
    wants.push({ ruleId: id, label: rule.label, name, price, pri, t, at: now + t * D_MS, gapDays: t, shop: r.shop || null });
  });
  const events = wants.slice().sort((a, b) => a.t - b.t);
  // The known harvest pays out when it's due; your usual pace (which is
  // what those cycles average to) carries on after it. Before it, growth
  // is the harvest itself, so it isn't counted twice.
  const h0 = harvest ? harvest.t : 0;
  // What comes in by day t (on top of what's available now). `incl`: count
  // the harvest step if t is exactly its time.
  const inflow = (t, incl) => {
    if (mode === 'estimate') {
      const matured = est.rate > 0 ? Math.min(est.canMature, est.rate * 24 * t) : 0;
      return est.perCrop * matured + (Number.isFinite(tFull) ? g * Math.max(0, t - tFull) : 0);
    }
    return (harvest && (incl ? t >= harvest.t : t > harvest.t) ? harvest.value : 0) + g * Math.max(0, t - h0);
  };
  const cashAt = (t, spentSoFar) => W - extra + inflow(t, true) - spentSoFar;
  let spent = 0;
  for (let k = 0; k < events.length; k += 1) {
    const e = events[k];
    const before = cashAt(e.t, spent);
    e.cashBefore = before;
    if (before < e.price) {
      e.status = 'short';
      e.short = e.price - before;
      continue;
    }
    // Would buying this now cost something higher on the list that comes later?
    const victim = events.slice(k + 1).find((f) => f.pri < e.pri && cashAt(f.t, spent) >= f.price && cashAt(f.t, spent + e.price) < f.price);
    if (victim) {
      e.status = 'tradeoff';
      e.costs = victim.label;
      continue;
    }
    e.status = 'ready';
    e.slack = before - e.price;
    spent += e.price;
    e.cashAfter = before - e.price;
  }
  const ready = events.filter((e) => e.status === 'ready');
  const short = events.filter((e) => e.status === 'short');
  const tradeoffs = events.filter((e) => e.status === 'tradeoff');
  const safe = short.length ? 0 : Math.max(0, Math.min(W - extra, ...ready.map((e) => e.slack)));
  // How much faster you'd need to grow to catch the most important short want.
  let needMore = null;
  const worst = short.slice().sort((a, b) => a.pri - b.pri)[0];
  if (worst) {
    const spentBefore = events.filter((e) => e.status === 'ready' && e.t < worst.t).reduce((a, e) => a + e.price, 0);
    const needed = (worst.price + spentBefore - (W - extra)) / worst.t;
    needMore = { label: worst.label, perDay: Math.max(0, needed - g) };
  }
  // Until the garden's report is in, the ready crops aren't known, and the
  // wallet alone would read "short": wait rather than show a wrong 0.
  const waitingFor = ctx.gardenLoaded === false ? 'garden' : !p.measured && !harvest ? 'pace' : null;
  const signal = waitingFor ? 'wait' : short.length ? 'save' : tradeoffs.length || safe < g ? 'careful' : 'open';
  const horizon = Math.max(events.length ? Math.max(...events.map((e) => e.t)) : 0, harvest ? harvest.t : 0, mode === 'estimate' && Number.isFinite(tFull) ? Math.min(tFull, 21) : 0);
  // The coins line for the chart: every break point, just before and just after.
  const bought = events.filter((e) => e.status === 'ready');
  const spentBefore = (t) => bought.filter((e) => e.t < t).reduce((a, e) => a + e.price, 0);
  const spentAt = (t) => bought.filter((e) => e.t <= t).reduce((a, e) => a + e.price, 0);
  const cashJust = (t, after) => W - extra + inflow(t, after) - (after ? spentAt(t) : spentBefore(t));
  const end = horizon * 1.06 || 1;
  // In estimate mode the line is a ramp: sample it, and mark when it's full.
  const samples = mode === 'estimate' ? Array.from({ length: 24 }, (_, i) => (end * i) / 24) : [];
  const fullMark = mode === 'estimate' && Number.isFinite(tFull) && tFull <= end ? [tFull] : [];
  const bps = [...new Set([0, ...events.map((e) => e.t), ...(harvest ? [harvest.t] : []), ...samples, ...fullMark, end])].sort((a, b) => a - b);
  const line = [];
  for (const t of bps) {
    line.push([t, cashJust(t, false)]);
    line.push([t, cashJust(t, true)]);
  }
  // Buy everything: the same coming in, and every alerted item and every
  // decoration worth having going out at its average rate. Above zero all
  // the way: you could buy it all. Where it would cross zero: when you'd
  // run out.
  const ever = everything(settings);
  const allAt = (t) => W - extra + inflow(t, true) - ever.perDay * t;
  const allLine = [...new Set([0, ...samples, ...fullMark, end, ...Array.from({ length: 12 }, (_, i) => (end * i) / 12)])].sort((a, b) => a - b).map((t) => [t, allAt(t)]);
  let runsOut = null;
  for (let i = 1; i < allLine.length; i += 1) {
    if (allLine[i][1] < 0 && allLine[i - 1][1] >= 0) {
      const [t0, v0] = allLine[i - 1];
      const [t1, v1] = allLine[i];
      runsOut = t0 + (t1 - t0) * (v0 / (v0 - v1));
      break;
    }
  }
  // What comes in a day, to set against it: value maturing while crops
  // mature (the estimate), else your usual pace.
  const inPerDay = mode === 'estimate' && est.perDay != null ? est.perDay : g;
  // Spend up to, over time: after each want you'll have bought, the most
  // you could spend then without losing anything covered later (if you've
  // spent nothing before). Nothing while a shortfall is still ahead:
  // spending before it only makes it deeper.
  const allowances = [];
  for (const e of bought) {
    const shortAhead = short.some((x) => x.t > e.t);
    const laterSlack = bought.filter((f) => f.t > e.t).map((f) => f.slack);
    const amount = shortAhead ? 0 : Math.max(0, Math.min(e.cashAfter, ...laterSlack));
    allowances.push({ label: e.label, ruleId: e.ruleId, at: e.at, t: e.t, amount });
  }
  return {
    everything: {
      perDay: ever.perDay,
      decorPerDay: ever.decorPerDay,
      inPerDay,
      canAll: runsOut == null && allLine[0][1] >= 0,
      runsOut: runsOut != null ? { t: runsOut, at: now + runsOut * D_MS } : null,
      line: allLine,
      rows: ever.rows.slice(0, 14),
      unknown: ever.unknown,
    },
    waitingFor,
    mode,
    estimate: Object.assign({}, est, { fullT: Number.isFinite(tFull) ? tFull : null }),
    wallet,
    available: W,
    garden: parts,
    harvest,
    prediction: pred,
    allowances,
    line,
    end,
    extra,
    pace: g,
    paceMeasured: p.measured,
    paceRaw: p.raw,
    events,
    unknown,
    safeToSpend: safe,
    signal,
    needMore,
    horizonDays: horizon,
    cashAtEnd: cashAt(horizon, spent),
  };
}

// "If I buy something for `price` now, what happens to my wants?"
function whatIf(settings, ctx, price, now = Date.now()) {
  return cached(settings, () => whatIfOf(settings, ctx, price, now));
}

function whatIfOf(settings, ctx, price, now) {
  const base = foresight(settings, ctx, 0, now);
  const after = foresight(settings, ctx, Math.max(0, Number(price) || 0), now);
  const lost = after.events.filter((e) => {
    const was = base.events.find((b) => b.ruleId === e.ruleId);
    return was && was.status === 'ready' && e.status !== 'ready';
  }).map((e) => ({ label: e.label, status: e.status, short: e.short || null, at: e.at, costs: e.costs || null }));
  // Already short for something you want? Then any spending makes that
  // shortfall deeper: say how much, for the most important one.
  let deepens = null;
  const baseShort = base.events.filter((e) => e.status === 'short').sort((a, b) => a.pri - b.pri)[0];
  if (!lost.length && baseShort && Number(price) > 0) {
    const now2 = after.events.find((e) => e.ruleId === baseShort.ruleId);
    deepens = { label: baseShort.label, at: baseShort.at, before: baseShort.short, after: now2 && now2.short != null ? now2.short : baseShort.short + Number(price) };
  }
  const verdict = lost.length ? 'breaks' : deepens ? 'deepens' : Number(price) <= base.safeToSpend ? 'safe' : 'tight';
  return {
    price: Number(price) || 0,
    verdict,
    lost,
    deepens,
    refillDays: base.pace > 0 ? (Number(price) || 0) / base.pace : null,
    safeToSpend: base.safeToSpend,
    after,
  };
}

// Puts the owner's default wants in place once (his order); anything else
// already in the plan follows them.
function seedWants(settings) {
  settings.budget = settings.budget && typeof settings.budget === 'object' ? settings.budget : {};
  if (settings.budget.wantsSeeded) {
    // Added later, each once, at the bottom: the Mythical Egg, then the Amber Egg.
    let changed = false;
    for (const [flag, id] of [['wantsMythic', 'mythicalegg'], ['wantsAmber', 'amberegg']]) {
      if (settings.budget[flag]) continue;
      settings.budget[flag] = true;
      const plan = Array.isArray(settings.budget.plan) ? settings.budget.plan.map(String) : [];
      if (!plan.includes(id)) settings.budget.plan = plan.concat([id]).slice(0, 12);
      changed = true;
    }
    return changed;
  }
  settings.budget.wantsMythic = true;
  settings.budget.wantsAmber = true;
  const have = Array.isArray(settings.budget.plan) ? settings.budget.plan.map(String) : [];
  settings.budget.plan = DEFAULT_WANTS.concat(have.filter((id) => !DEFAULT_WANTS.includes(id))).slice(0, 12);
  settings.budget.wantsSeeded = true;
  return true;
}

// The lines of the money box shown over the game.
function hudLines(v, fmt) {
  const n = fmt || ((x) => String(Math.round(x)));
  const p = v.plan;
  const lines = [];
  const gp = v.foresight && v.foresight.garden;
  if (p.wallet != null) lines.push({ text: `💰 ${n(p.wallet)}${gp && gp.ready > 0 ? ` + ${n(gp.ready)} ready` : ' in the bank'}`, strong: true });
  const t = p.items.find((i) => i.ruleId === p.target);
  // No saving-target / plan line on the overlay (taken off at the owner's request).
  void t;
  const fs = v.foresight;
  if (fs && fs.signal !== 'wait') {
    const sig = { open: '🟢 Open to spend', careful: '🟡 Careful', save: '🔴 Save' }[fs.signal];
    lines.push({ text: `${sig} · safe to spend ${n(fs.safeToSpend)}`, strong: true });
  } else if (p.free != null) {
    lines.push({ text: `Free to spend: ${n(p.free)}`, strong: true });
  }
  if (t && p.delayHoursPerB != null) lines.push({ text: `1B spent now = ${t.label} ~${fmtHoursShort(p.delayHoursPerB)} later` });
  return lines;
}

function fmtDaysShort(d) {
  if (d < 1 / 24) return 'under an hour';
  if (d < 1) return `${Math.max(1, Math.round(d * 24))} h`;
  if (d < 14) return `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'}`;
  if (d < 60) return `${Math.round(d / 7)} weeks`;
  return `${Math.round(d / 30)} months`;
}
function fmtHoursShort(h) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/* ---------------------------------------------------------------- *
 * Where the coins go: spending by category against what you earn
 * ---------------------------------------------------------------- */

const UNLOCK_MODES = ['auto', 'on', 'off'];
function options(settings) {
  const b = settings.budget && typeof settings.budget === 'object' ? settings.budget : {};
  const pct = Number(b.keepPct);
  const r = b.readyRule && typeof b.readyRule === 'object' ? b.readyRule : {};
  return {
    keepPct: Number.isFinite(pct) ? Math.max(0, Math.min(90, pct)) : 10,
    unlockMode: UNLOCK_MODES.includes(b.unlockMode) ? b.unlockMode : 'auto',
    readyRule: { size: r.size !== false, color: r.color !== false, hydro: r.hydro !== false, lunar: r.lunar !== false },
  };
}

function setOptions(settings, change) {
  settings.budget = settings.budget && typeof settings.budget === 'object' ? settings.budget : {};
  if (change && 'keepPct' in change) {
    const v = Number(change.keepPct);
    settings.budget.keepPct = Number.isFinite(v) ? Math.max(0, Math.min(90, Math.round(v))) : 10;
  }
  if (change && 'unlockMode' in change) settings.budget.unlockMode = UNLOCK_MODES.includes(change.unlockMode) ? change.unlockMode : 'auto';
  if (change && change.readyRule && typeof change.readyRule === 'object') {
    const cur = options(settings).readyRule;
    const next = Object.assign({}, cur);
    for (const k of ['size', 'color', 'hydro', 'lunar']) if (typeof change.readyRule[k] === 'boolean') next[k] = change.readyRule[k];
    settings.budget.readyRule = next;
  }
  return options(settings);
}

// Spending by category over the period f, the room left after a savings
// target, and where to cut if there isn't any.
function categories(settings, f) {
  if (!f || !f.ok) return null;
  const p = migratePurchases(settings.purchases);
  const stats = migrateStats(settings.shopStats);
  const sums = {};
  for (const c of CATS) sums[c] = 0;
  const d0 = Math.floor(f.from / DAY_MS);
  const d1 = Math.floor(f.to / DAY_MS);
  for (const [day, b] of Object.entries(p.days)) {
    const dn = Number(day);
    if (dn < d0 || dn > d1) continue;
    for (const [c, coins] of Object.entries(b)) sums[CATS.includes(c) ? c : 'other'] += Number(coins) || 0;
  }
  const observed = CATS.reduce((a, c) => a + sums[c], 0);
  // Spent in total (from the wallet maths) minus what was seen bought here.
  const elsewhere = Math.max(0, f.spent - observed);
  const perDay = 86400000 / Math.max(1, f.to - f.from);
  const share = (coins) => (f.earnedPerDay > 0 ? (coins * perDay) / f.earnedPerDay : null);
  // Alerted things per category: in stock vs bought, counted per item so a
  // thing two alerts cover (a firepit is also decor over 500M) counts once.
  const seenBought = {};
  const covered = new Set();
  for (const r of itemRules(settings)) for (const id of matchedIds(r, stats)) covered.add(id);
  for (const id of covered) {
    const it = stats.items[id];
    const c = categoryOf({ type: it.type, shop: it.shop, id, name: it.name });
    const sb = seenBought[c] || (seenBought[c] = { seen: 0, bought: 0 });
    sb.seen += it.seen;
    sb.bought += p.byItem[id] ? p.byItem[id].count : 0;
  }
  const rows = CATS.filter((c) => sums[c] > 0 || seenBought[c]).map((c) => ({
    cat: c,
    label: CAT_INFO[c].label,
    emoji: CAT_INFO[c].emoji,
    investment: CAT_INFO[c].investment,
    coins: sums[c],
    perDay: sums[c] * perDay,
    share: share(sums[c]),
    seen: seenBought[c] ? seenBought[c].seen : 0,
    bought: seenBought[c] ? seenBought[c].bought : 0,
  }));
  if (elsewhere > 0) rows.push({ cat: 'elsewhere', label: CAT_INFO.elsewhere.label, emoji: CAT_INFO.elsewhere.emoji, investment: false, coins: elsewhere, perDay: elsewhere * perDay, share: share(elsewhere), seen: 0, bought: 0 });
  rows.sort((a, b) => b.coins - a.coins);
  const opt = options(settings);
  const target = f.earnedPerDay * (opt.keepPct / 100);
  const room = f.keptPerDay - target;
  const cuttable = rows.filter((r) => !r.investment && r.cat !== 'elsewhere' && r.perDay > 0).sort((a, b) => b.perDay - a.perDay)[0] || null;
  return {
    rows,
    observed,
    elsewhere,
    keepPct: opt.keepPct,
    targetPerDay: target,
    roomPerDay: room,
    level: room >= 0 ? 'ok' : 'over',
    cut: room < 0 && cuttable ? { cat: cuttable.cat, label: cuttable.label, perDay: cuttable.perDay } : null,
  };
}

/* ---------------------------------------------------------------- *
 * Growth: net worth = wallet + garden, over time
 *
 * Late game runs in cycles (fill the garden, grow, mutate, harvest, sell):
 * the garden's worth climbs and then drops at harvest while the wallet
 * jumps. Net worth rides through that level, so it's what shows progress.
 * The garden here is the unpicked crops' worth (the worth chart's figure).
 * ---------------------------------------------------------------- */

// Wallet and garden points joined in time: each wallet reading takes the
// garden reading nearest to it (within 45 minutes).
function netWorthSeries(settings, days = 30, now = Date.now()) {
  const from = now - days * 86400000;
  const wallet = (Array.isArray(settings.moneyHistory) ? settings.moneyHistory : []).filter((p) => p && p.t >= from && Number.isFinite(p.c)).sort((a, b) => a.t - b.t);
  const garden = (Array.isArray(settings.worthHistory) ? settings.worthHistory : []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  const out = [];
  let j = 0;
  for (const w of wallet) {
    while (j + 1 < garden.length && Math.abs(garden[j + 1].t - w.t) <= Math.abs(garden[j].t - w.t)) j += 1;
    const g = garden[j];
    const gv = g && Math.abs(g.t - w.t) <= 45 * 60000 ? g.v : null;
    out.push({ t: w.t, wallet: w.c, garden: gv, total: w.c + (gv || 0) });
  }
  // Fill a missing garden reading from its neighbours, so a gap doesn't
  // look like the garden vanished.
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].garden != null) continue;
    const prev = out.slice(0, i).reverse().find((p) => p.garden != null);
    if (prev) {
      out[i].garden = prev.garden;
      out[i].total = out[i].wallet + prev.garden;
    }
  }
  return out;
}

// Now, and the change over the last `days` (from the earliest point in it).
function growth(settings, ctx = {}, days = 7, now = Date.now()) {
  const series = netWorthSeries(settings, 30, now);
  const live = Number.isFinite(Number(ctx.wallet)) ? { wallet: Number(ctx.wallet), garden: Number(ctx.gardenWorth) || 0 } : null;
  const last = series[series.length - 1] || null;
  const nowPoint = live ? { t: now, wallet: live.wallet, garden: live.garden, total: live.wallet + live.garden } : last;
  const start = series.find((p) => p.t >= now - days * 86400000) || null;
  const span = start && nowPoint ? nowPoint.t - start.t : 0;
  const ok = Boolean(start && nowPoint && span >= 3600000 && start.total > 0);
  return {
    now: nowPoint,
    start: ok ? start : null,
    change: ok ? nowPoint.total - start.total : null,
    pct: ok ? (nowPoint.total - start.total) / start.total : null,
    hours: span / 3600000,
    series: downsample(series, 90),
  };
}

function downsample(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/* ---------------------------------------------------------------- *
 * The money engine: income per day, this week against last week
 * ---------------------------------------------------------------- */

function incomeBetween(history, from, to) {
  const pts = (Array.isArray(history) ? history : []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.s)).sort((a, b) => a.t - b.t);
  const inside = pts.filter((p) => p.t >= from && p.t <= to);
  if (inside.length < 2) return null;
  const a = inside[0];
  const b = inside[inside.length - 1];
  const span = b.t - a.t;
  if (span < 3600000) return null;
  const earned = Math.max(0, (b.s - a.s) + ((b.f || 0) - (a.f || 0)));
  return { perDay: (earned * 86400000) / span, earned, hours: span / 3600000 };
}

function engine(settings, now = Date.now()) {
  const D = 86400000;
  const h = settings.moneyHistory;
  const thisWeek = incomeBetween(h, now - 7 * D, now);
  const lastWeek = incomeBetween(h, now - 14 * D, now - 7 * D);
  const days = daily(h, 14, now).map((d) => ({ t: d.t, earned: d.earned }));
  const best = days.reduce((m, d) => (d.earned != null && (!m || d.earned > m.earned) ? d : m), null);
  return {
    perDay: thisWeek ? thisWeek.perDay : null,
    hours: thisWeek ? thisWeek.hours : 0,
    lastWeekPerDay: lastWeek ? lastWeek.perDay : null,
    change: thisWeek && lastWeek && lastWeek.perDay > 0 ? (thisWeek.perDay - lastWeek.perDay) / lastWeek.perDay : null,
    days,
    best,
  };
}

/* ---------------------------------------------------------------- *
 * Invested vs spent, over a period
 * ---------------------------------------------------------------- */

function split(settings, f) {
  const cats = categories(settings, f);
  if (!cats) return null;
  const rows = cats.rows.map((r) => Object.assign({}, r, { investment: r.cat !== 'elsewhere' && Boolean(CAT_INFO[r.cat] && CAT_INFO[r.cat].investment) }));
  const invested = rows.filter((r) => r.investment).reduce((a, r) => a + r.coins, 0);
  const spent = rows.filter((r) => !r.investment && r.cat !== 'elsewhere').reduce((a, r) => a + r.coins, 0);
  const unseen = rows.filter((r) => r.cat === 'elsewhere').reduce((a, r) => a + r.coins, 0);
  const order = (r) => (r.cat === 'elsewhere' ? 99 : CATS.indexOf(r.cat));
  return { rows: rows.sort((a, b) => order(a) - order(b)), invested, spent, unseen, hours: f.hours };
}

/* ---------------------------------------------------------------- *
 * Your stage, and the one piece of advice for it
 *
 * The game's arc, in the owner's words: buy and sell ever dearer seeds;
 * build the pets that change how you farm; then farm whole gardens (grow to
 * max size, weather and moon mutations, gold/rainbow, harvest, sell).
 * Stage is read from what the garden looks like: under 1B net worth is the
 * seed ladder; a garden a quarter or more gold/rainbow is mutation farming;
 * between is pet building. The thresholds are guesses to tune.
 * ---------------------------------------------------------------- */

const STAGES = [
  { id: 'ladder', label: 'Seed ladder', emoji: '🌱', advice: 'Reinvest: buy the dearest seeds you can, sell, climb.' },
  { id: 'building', label: 'Building your pets', emoji: '🐾', advice: 'Celestials first when they show. Pets next. Decor last.' },
  { id: 'farming', label: 'Mutation farming', emoji: '✨', advice: 'Between harvests, keep a celestial\'s price ready.' },
];
const STAGE_LADDER_BELOW = 1e9;
const STAGE_FARMING_SHARE = 0.25;

function stage(ctx = {}, netWorth = 0) {
  const g = ctx.garden || {};
  const total = Number(g.total) || 0;
  const special = Number(g.special) || (Number(g.gold) || 0) + (Number(g.rainbow) || 0);
  const share = total > 0 ? special / total : 0;
  let id = 'building';
  if (netWorth < STAGE_LADDER_BELOW) id = 'ladder';
  else if (total >= 50 && share >= STAGE_FARMING_SHARE) id = 'farming';
  const i = STAGES.findIndex((x) => x.id === id);
  return Object.assign({ index: i, share, stages: STAGES.map((x) => ({ id: x.id, label: x.label, emoji: x.emoji })) }, STAGES[i]);
}

/* ---------------------------------------------------------------- *
 * Crop stage: where your crops are, from bare ground to harvest
 *
 * The owner's process, in order: plant → grow → full size → a weather
 * mutation → a moon mutation → gold/rainbow → ready to harvest. Each step
 * shows how many crops have reached it; "you are here" is the first step
 * (of those the Ready-means rule asks for) that fewer than 90% have, i.e.
 * the bottleneck. Steps the rule doesn't ask for are shown but skipped.
 * ---------------------------------------------------------------- */

const CROP_STEP_DONE = 0.9;

function cropStage(ctx = {}) {
  const g = ctx.garden || {};
  const total = Number(g.total) || 0;
  const have = g.have || {};
  const hours = g.stepHours || {};
  const rule = Object.assign({ size: true, color: true, hydro: true, lunar: true }, ctx.readyRule || {});
  const steps = [
    { id: 'planted', label: total ? 'Planted' : 'Barren', emoji: '🌰', count: total, required: true },
    { id: 'ripe', label: 'Grown', emoji: '🌿', count: Number(have.ripe) || 0, required: true, hours: hours.ripe },
    { id: 'size', label: 'Full size', emoji: '📏', count: Number(have.size) || 0, required: rule.size, hours: hours.size },
    { id: 'hydro', label: 'Weather', emoji: '🌧️', count: Number(have.hydro) || 0, required: rule.hydro, hours: hours.hydro },
    { id: 'lunar', label: 'Moon', emoji: '🌕', count: Number(have.lunar) || 0, required: rule.lunar, hours: hours.lunar },
    { id: 'color', label: 'Gold / Rainbow', emoji: '🌈', count: Number(have.color) || 0, required: rule.color, hours: hours.color },
    { id: 'ready', label: 'Ready', emoji: '🧺', count: Number(g.ready) || 0, required: true, hours: g.harvestHours },
  ];
  for (const st of steps) {
    st.share = total > 0 ? Math.min(1, st.count / total) : 0;
    st.left = Math.max(0, total - st.count);
    st.done = total > 0 && st.share >= CROP_STEP_DONE;
  }
  let index;
  if (!total) index = 0;
  else {
    index = steps.findIndex((st, i) => i > 0 && i < steps.length - 1 && st.required && !st.done);
    if (index < 0) index = steps.length - 1;
  }
  const here = steps[index];
  // What next, and when (weather and moon from the forecast).
  let next = null;
  if (!total) next = { text: 'Plant something to get started.' };
  else if (here.id === 'ready') next = { text: here.done ? 'Ready to harvest.' : `${here.left} crops to go.`, hours: here.done ? 0 : here.hours };
  else {
    const kind = here.id === 'hydro' && hours.nextHydro ? hours.nextHydro.name : here.id === 'lunar' && hours.nextLunar ? hours.nextLunar.name : null;
    next = { stepId: here.id, left: here.left, hours: here.hours != null ? here.hours : null, weather: kind, now: here.id === 'hydro' || here.id === 'lunar' ? here.hours === 0 : false };
  }
  return { total, steps, index, here: here.id, next };
}

/* ---------------------------------------------------------------- *
 * The whole card
 * ---------------------------------------------------------------- */

function view({ settings, now = Date.now(), ctx = {} }) {
  return cached(settings, () => buildView({ settings, now, ctx }));
}

function buildView({ settings, now, ctx }) {
  const periods = {};
  for (const d of [1, 7, 30]) {
    const f = flows(settings.moneyHistory, d, now);
    periods[d] = Object.assign(f, { verdict: verdict(f), categories: categories(settings, f) });
  }
  const p = migratePurchases(settings.purchases);
  // The longest period that is ready decides the "afford" times (steadier).
  const steady = periods[30].ok ? periods[30] : periods[7].ok ? periods[7] : periods[1];
  // The tab shows once enough has been measured: a day for most gardens,
  // two weeks when garden + wallet are worth over 1B (big accounts' numbers
  // take longer to settle: one 50B purchase skews a day). Then it stays
  // shown. The owner can also force it shown or hidden (Extras).
  const measuredHours = periods[30].hours || 0;
  const netWorth = (Number.isFinite(Number(ctx.wallet)) ? Number(ctx.wallet) : steady.ok ? steady.coinsNow : 0) + (Number(ctx.gardenWorth) || 0);
  const unlockDays = netWorth > 1e9 ? 14 : 1;
  const mode = options(settings).unlockMode;
  const earned = Boolean(settings.budget && settings.budget.unlocked) || measuredHours >= unlockDays * 24;
  const unlocked = mode === 'on' ? true : mode === 'off' ? false : earned;
  // The buy-everything meter: what you make a day against what buying
  // everything costs a day. "What you make" is this week's measured
  // earnings (the Money engine) when there are some, else what's maturing.
  const fsNow = foresight(settings, ctx, 0, now);
  fsNow.history = pastMoney(settings, now);
  const eng = engine(settings, now);
  if (fsNow.everything) {
    const E = fsNow.everything;
    const fromEarnings = eng.perDay != null && eng.perDay > 0;
    E.income = fromEarnings ? eng.perDay : E.inPerDay;
    E.incomeFrom = fromEarnings ? 'earnings' : 'maturing';
    E.ratio = E.perDay > 0 && E.income != null ? E.income / E.perDay : null;
    const b = settings.budget || {};
    E.best = Math.max(Number(b.everythingBest) || 0, E.ratio || 0) || null;
    E.crossedAt = b.everythingCrossedAt || null;
  }
  return {
    periods,
    purchases: {
      since: p.since,
      total: p.total,
      unknown: p.unknown,
      recent: p.log.slice(-6).reverse(),
    },
    patterns: patterns(settings),
    afford: afford(settings, steady),
    plan: plan(settings, steady, Object.assign({ now }, ctx)),
    daily: daily(settings.moneyHistory, 14, now),
    growth: { week: growth(settings, ctx, 7, now), month: growth(settings, ctx, 30, now) },
    engine: eng,
    split: split(settings, periods[7]),
    stage: stage(ctx, netWorth),
    cropStage: cropStage(ctx),
    foresight: fsNow,
    icons: ICONS,
    inStock: Array.isArray(ctx.inStock) ? ctx.inStock.slice(0, 12) : [],
    unlocked,
    unlockEarned: earned,
    unlockMode: mode,
    unlockDays,
    netWorth,
    measuredHours,
    options: options(settings),
    at: now,
  };
}

module.exports = { KNOWN, CATS, CAT_INFO, CELESTIAL, STAGES, DEFAULT_WANTS, ICONS, DECOR, everything, pastMoney, cropStage, gardenParts, harvestCycles, predictHarvest, maturingRate, procRate, estimate, foresight, whatIf, seedWants, categoryOf, netWorthSeries, growth, engine, split, stage, SHOP_KINDS, BASELINE, shopKind, emptyStats, migrateStats, record, recordMoney, flows, daily, verdict, migratePurchases, itemOfCommand, resetPurchases, PURCHASES_VERSION, recordPurchase, patterns, rate, afford, planIds, setPlan, nextOpening, plan, hudLines, categories, options, setOptions, view };
