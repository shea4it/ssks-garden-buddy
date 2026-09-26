'use strict';
const assert = require('assert');
const budget = require('../budget');
const store = require('../store');

let n = 0;
const ok = (c, m) => { assert(c, m); n += 1; };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
const H = 3600000;
const D = 24 * H;
const base = () => ({ alerts: { custom: [], disabled: [] }, shopStats: budget.emptyStats(), moneyHistory: [], purchases: null });

/* 1. Counting the feed */
{
  const stats = budget.emptyStats();
  const feed = (seedRestock, amberOpen, moonStock) => ({
    shops: {
      seed: { open: true, nextRestockAt: seedRestock, items: [
        { itemId: 'Carrot', name: 'Carrot Seed', itemType: 'Seed', stock: 12, coinPrice: 10 },
        { itemId: 'StarCelestial', name: 'Starweaver Pod', itemType: 'Seed', stock: 0, coinPrice: 1e9 },
      ] },
      amber: { open: amberOpen, items: amberOpen ? [
        { itemId: 'MoonCelestial', name: 'Moonbinder Pod', itemType: 'Seed', stock: moonStock, coinPrice: 50e9 },
        { itemId: 'StoneFirepit', name: 'Stone Firepit', itemType: 'Decor', stock: 0, coinPrice: 100e9 },
      ] : [] },
    },
  });
  let t = 1000;
  ok(budget.record(stats, feed('2026-09-24T10:05:00Z', false), t) === 1, 'first poll: one seed restock');
  ok(budget.record(stats, feed('2026-09-24T10:05:00Z', false), t + 45000) === 0, 'same restock polled again: not counted');
  ok(budget.record(stats, feed('2026-09-24T10:10:00Z', false), t + 300000) === 1, 'next restock counted');
  ok(stats.items.Carrot.restocks === 2 && stats.items.Carrot.seen === 2 && stats.items.Carrot.stockSum === 24, 'carrot: 2 of 2, stock summed');
  ok(stats.items.StarCelestial.seen === 0 && stats.items.StarCelestial.price === 1e9, 'starweaver: listed, never in stock, price kept');
  ok(budget.record(stats, feed('2026-09-24T10:10:00Z', true, 0), t + 400000) === 1, 'amber opening counted');
  ok(budget.record(stats, feed('2026-09-24T10:10:00Z', true, 0), t + 445000) === 0, 'same opening polled again: not counted');
  budget.record(stats, feed('2026-09-24T10:10:00Z', false), t + 1000000);
  ok(budget.record(stats, feed('2026-09-24T10:10:00Z', true, 1), t + 2000000) === 1, 'second amber opening counted');
  ok(stats.items.MoonCelestial.restocks === 2 && stats.items.MoonCelestial.seen === 1 && stats.items.MoonCelestial.shop === 'amber', 'moonbinder: seen 1 of 2 amber openings');
  ok(stats.items.StoneFirepit.type === 'Decor' && stats.items.StoneFirepit.price === 100e9, 'decor item recorded with type and price');
  ok(budget.record(stats, { shops: null }, t) === 0 && budget.record(stats, null, t) === 0, 'bad feeds ignored');
  const big = budget.emptyStats();
  budget.record(big, { shops: { seed: { open: true, nextRestockAt: 'x', items: Array.from({ length: 600 }, (_, i) => ({ itemId: 'i' + i, name: 'n' + i, stock: 1, coinPrice: 1 })) } } }, 5);
  ok(Object.keys(big.items).length === 500, 'items capped at 500');
}

/* 2. Money history and flows */
{
  const s = base();
  const now = 100 * D;
  ok(budget.recordMoney(s, { coins: 1e9, sold: 5e9, found: 1e8 }, now - 2 * H) === true, 'first point kept');
  ok(budget.recordMoney(s, { coins: 1.2e9, sold: 5.3e9, found: 1e8 }, now - 2 * H + 60000) === false, 'a minute later: latest reading wins, no new point');
  ok(s.moneyHistory.length === 1 && s.moneyHistory[0].c === 1.2e9, 'updated in place');
  ok(budget.recordMoney(s, { coins: 'x', sold: 1 }, now) === false && s.moneyHistory.length === 1, 'bad sample ignored');
  budget.recordMoney(s, { coins: 0.7e9, sold: 8e9, found: 3e8 }, now); // earned 2.9B, wallet down 0.5B -> spent 3.4B
  const f = budget.flows(s.moneyHistory, 1, now);
  ok(f.ok && Math.round(f.hours) === 2, 'two hours ready');
  ok(f.earned === 2.9e9 && f.sold === 2.7e9 && f.found === 2e8, 'earned = sold + found: ' + f.earned);
  ok(f.kept === -0.5e9 && f.spent === 3.4e9 && f.unknownIn === 0, 'spent = earned - kept');
  near(f.earnedPerDay, 2.9e9 * 12, 1, 'earned per day (2 h -> x12)');
  near(f.spentPerDay, 3.4e9 * 12, 1, 'spent per day');
  near(f.keptPerDay, -0.5e9 * 12, 1, 'kept per day, negative');
  near(f.share, 3.4 / 2.9, 1e-9, 'share of earnings spent');
  ok(f.coinsNow === 0.7e9 && f.coinsStart === 1.2e9, 'wallet then and now');
  // Not ready
  ok(budget.flows([], 1, now).ok === false, 'nothing measured');
  ok(budget.flows([{ t: now - 600000, c: 1, s: 1, f: 0 }, { t: now, c: 1, s: 1, f: 0 }], 1, now).ok === false, 'ten minutes: still measuring');
  // Unknown income: wallet grew more than earnings explain.
  const g = budget.flows([{ t: now - D, c: 1e9, s: 0, f: 0 }, { t: now, c: 5e9, s: 1e9, f: 0 }], 1, now);
  ok(g.spent === 0 && g.unknownIn === 3e9, 'gift: spent clamped, from elsewhere noted');
  // Windows: 1 day vs 7 vs 30, and gaps count as time.
  const hist = [{ t: now - 20 * D, c: 0, s: 0, f: 0 }, { t: now - 5 * D, c: 10e9, s: 20e9, f: 0 }, { t: now - D, c: 12e9, s: 30e9, f: 0 }, { t: now, c: 11e9, s: 40e9, f: 0 }];
  const f1 = budget.flows(hist, 1, now), f7 = budget.flows(hist, 7, now), f30 = budget.flows(hist, 30, now);
  ok(f1.earned === 10e9 && f1.spent === 11e9 && Math.round(f1.hours) === 24, 'last day');
  ok(f7.earned === 20e9 && f7.spent === 19e9 && Math.round(f7.hours / 24) === 5, 'last week: from the point 5 days ago');
  ok(f30.earned === 40e9 && f30.spent === 29e9 && Math.round(f30.hours / 24) === 20, 'last month: whole history');
  near(f30.earnedPerDay, 2e9, 1, 'per day across gaps');
}

/* 3. Verdicts and tips */
{
  const now = 10 * D;
  const flows = (c0, c1, s1) => budget.flows([{ t: now - D, c: c0, s: 0, f: 0 }, { t: now, c: c1, s: s1, f: 0 }], 1, now);
  ok(budget.verdict(budget.flows([], 1, now)).level === 'wait', 'wait');
  ok(budget.verdict(flows(5e9, 5e9, 0)).level === 'quiet', 'quiet');
  // Spending ahead: earned 1B, wallet 10B -> 8B: spent 3B; net -2B/day; runway 4 days; cut 2B (67% of spend)
  let v = budget.verdict(flows(10e9, 8e9, 1e9));
  ok(v.level === 'short', 'short');
  near(v.runway, 4, 1e-9, 'runway 4 days');
  const cut = v.tips.find((t) => t.kind === 'cut');
  ok(cut && cut.perDay === 2e9 && Math.abs(cut.share - 2 / 3) < 1e-9, 'cut tip');
  ok(v.tips.some((t) => t.kind === 'runway' && Math.abs(t.days - 4) < 1e-9), 'runway tip');
  // Nearly even: earned 10B, kept +0.5B -> spent 9.5B (95%)
  v = budget.verdict(flows(1e9, 1.5e9, 10e9));
  ok(v.level === 'close' && v.tips[0].kind === 'room' && v.tips[0].perDay === 0.5e9, 'close, with the room tip');
  // Saving: earned 10B, kept +4B -> spent 6B
  v = budget.verdict(flows(1e9, 5e9, 10e9));
  ok(v.level === 'ok' && v.net === 4e9, 'ok');
  ok(v.tips.find((t) => t.kind === 'room').perDay === 4e9 && v.tips.find((t) => t.kind === 'month').total === 120e9, 'room and month tips');
  // Spending ahead with an empty wallet: no runway tip, still a cut tip
  v = budget.verdict(flows(1e9, 0, 1e9));
  ok(v.level === 'short' && !v.tips.some((t) => t.kind === 'runway') && v.tips.some((t) => t.kind === 'cut'), 'empty wallet');
}

/* 4. Purchases */
{
  const s = base();
  budget.record(s.shopStats, { shops: {
    amber: { open: true, items: [
      { itemId: 'MoonCelestial', name: 'Moonbinder Pod', itemType: 'Seed', stock: 1, coinPrice: 50e9 },
      { itemId: 'StoneFirepit', name: 'Stone Firepit', itemType: 'Decor', stock: 1, coinPrice: 100e9 },
    ] },
    seed: { open: true, nextRestockAt: 'a', items: [{ itemId: 'Carrot', name: 'Carrot Seed', itemType: 'Seed', stock: 10, coinPrice: 10 }] },
  } }, 1);
  // Found by a value that is a known item id, wherever it sits in the command.
  const e1 = budget.recordPurchase(s, { at: 5000, command: { type: 'PurchaseShopItem', shopType: 'amber', productId: 'MoonCelestial' } }, 6000);
  ok(e1 && e1.id === 'MoonCelestial' && e1.name === 'Moonbinder Pod' && e1.coins === 50e9 && e1.qty === 1 && e1.t === 5000, 'moonbinder purchase priced from the feed');
  ok(e1.rules.includes('moonbinder') && !e1.rules.includes('decor'), 'matched the Moonbinder alert only');
  const e2 = budget.recordPurchase(s, { command: { type: 'BuyItem', itemId: 'StoneFirepit', quantity: 1 } });
  ok(e2.rules.includes('firepit') && e2.rules.includes('decor') && e2.coins === 100e9, 'firepit: named alert and decor-over-500M');
  const e3 = budget.recordPurchase(s, { command: { type: 'BuyItem', itemId: 'Carrot', count: 5 } });
  ok(e3.qty === 5 && e3.coins === 50 && e3.rules.length === 0, 'five carrots, no alert');
  // Not in the feed yet: the wiki price stands in, else unpriced.
  const e4 = budget.recordPurchase(s, { command: { type: 'BuyItem', itemId: 'Dawnbinder' } });
  ok(e4.coins === 10e9 && e4.name === 'Dawnbinder Pod' && e4.rules.includes('dawnbinder'), 'wiki price for an unseen item');
  const e5 = budget.recordPurchase(s, { command: { type: 'BuyItem', itemId: 'MysteryThing' } });
  ok(e5.coins === null && e5.name === 'Mystery Thing', 'unknown item: unpriced, readable name');
  ok(budget.recordPurchase(s, { command: { type: 'BuyItem', quantity: 2 } }) === null && s.purchases.unknown === 1, 'no item named: counted as unidentified');
  ok(s.purchases.total.count === 5 && s.purchases.total.coins === 160e9 + 50, 'totals');
  ok(s.purchases.byRule.moonbinder.count === 1 && s.purchases.byRule.decor.coins === 100e9, 'per-rule totals');
  for (let i = 0; i < 120; i += 1) budget.recordPurchase(s, { command: { type: 'BuyItem', itemId: 'Carrot' } });
  ok(s.purchases.log.length === 100 && s.purchases.total.count === 125, 'log capped at 100, totals keep counting');
  // Patterns: seen from the feed, bought here.
  const pats = budget.patterns(s);
  const mb = pats.find((r) => r.ruleId === 'moonbinder');
  ok(mb && mb.seen === 1 && mb.bought === 1 && mb.share === 1 && mb.coins === 50e9, 'moonbinder: 1 of 1');
  const dc = pats.find((r) => r.ruleId === 'decor');
  ok(dc && dc.seen === 1 && dc.bought === 1 && dc.price === 100e9, 'decor: the firepit');
  ok(!pats.some((r) => r.ruleId === 'ube'), 'never seen, never bought: not listed');
  ok(pats[0].ruleId === 'decor' || pats[0].ruleId === 'firepit', 'sorted by coins spent');
  budget.record(s.shopStats, { shops: { amber: { open: false, items: [] } } }, 2);
  budget.record(s.shopStats, { shops: { amber: { open: true, items: [{ itemId: 'MoonCelestial', name: 'Moonbinder Pod', itemType: 'Seed', stock: 1, coinPrice: 50e9 }] } } }, 3);
  ok(budget.patterns(s).find((r) => r.ruleId === 'moonbinder').share === 0.5, 'a second sighting without a buy: 50%');
  // Custom alerts count too, from the moment they exist (purchases are
  // attributed when they happen; earlier ones stay where they were).
  s.alerts.custom = [{ name: 'Carrot', tier: 'basic' }];
  budget.recordPurchase(s, { command: { type: 'BuyItem', itemId: 'Carrot', count: 3 } });
  const cc = budget.patterns(s).find((r) => r.ruleId === 'custom:carrot');
  ok(cc && cc.bought === 1 && cc.seen === 1 && cc.coins === 30, 'custom alert pattern');
}

/* 5. How often, and can your garden afford this */
{
  const rules = require('../alerts').RULES;
  const rule = (id) => rules.find((r) => r.id === id);
  const s = base();
  // Baseline only
  let r = budget.rate(rule('moonbinder'), budget.migrateStats(s.shopStats));
  ok(r && r.source === 'pingspam' && r.events === 9 && Math.abs(r.perDay - 0.0777) < 1e-4 && r.since === '2026-06-01', 'moonbinder from the pingspam baseline');
  ok(budget.rate(rule('firepit'), budget.migrateStats(s.shopStats)) === null, 'no baseline, nothing watched: unknown');
  // A custom alert for a baselined item finds it by name.
  ok(budget.rate({ id: 'custom:thunderspire', kind: 'item', match: 'thunderspire', label: 'Thunderspire', custom: true }, budget.migrateStats(s.shopStats)).events === 22, 'custom alert uses the baseline');
  // The app has watched 99 Amber openings (50 days' worth) and seen 4 Moonbinders: blended.
  s.shopStats.items.MoonCelestial = { name: 'Moonbinder Pod', type: 'Seed', shop: 'amber', price: 50e9, restocks: 99, seen: 4, stockSum: 4, firstAt: 1, lastSeenAt: 2 };
  r = budget.rate(rule('moonbinder'), budget.migrateStats(s.shopStats));
  ok(r.source === 'both' && r.events === 13 && Math.abs(r.days - (115.8 + 50)) < 1e-9, 'blended: 9+4 sightings over 115.8+50 days');
  near(r.perDay, 13 / 165.8, 1e-9, 'blended rate');
  // App only, nothing seen yet: known days, no rate.
  s.shopStats.items.StoneFirepit = { name: 'Stone Firepit', type: 'Decor', shop: 'amber', price: 100e9, restocks: 20, seen: 0, stockSum: 0, firstAt: 1, lastSeenAt: null };
  r = budget.rate(rule('firepit'), budget.migrateStats(s.shopStats));
  ok(r && r.perDay === null && r.appRestocks === 20 && r.source === 'app', 'watched but never in stock: no rate yet');
  s.shopStats.items.StoneFirepit.seen = 2; s.shopStats.items.StoneFirepit.stockSum = 2;
  r = budget.rate(rule('firepit'), budget.migrateStats(s.shopStats));
  near(r.perDay, 2 / (20 / 1.98), 1e-9, 'app-only rate: 2 in 20 Amber openings');
  ok(r.shop === 'Amber shop' && r.typical === 1, 'shop label and typical stock');
  // Unknown shop id: can't turn restocks into days.
  s.shopStats.items.Mystery = { name: 'Ube Seed', type: 'Seed', shop: 'weird', price: 1e6, restocks: 50, seen: 10, stockSum: 10, firstAt: 1, lastSeenAt: 2 };
  ok(budget.rate(rule('ube'), budget.migrateStats(s.shopStats)).source === 'pingspam', 'unknown shop: baseline only');

  // Afford: earned 20B/day, kept 5B/day, wallet 30B.
  const now = 10 * D;
  const f = budget.flows([{ t: now - D, c: 25e9, s: 0, f: 0 }, { t: now, c: 30e9, s: 20e9, f: 0 }], 1, now);
  ok(f.earnedPerDay === 20e9 && f.keptPerDay === 5e9, 'money for the afford checks');
  const a = budget.afford(s, f);
  const by = Object.fromEntries(a.map((x) => [x.ruleId, x]));
  ok(a.length <= 12 && a[0].price >= a[a.length - 1].price, 'dearest first, at most twelve');
  // Moonbinder: 50B x 13/165.8 per day = 3.92B/day <= kept 5B -> yes
  near(by.moonbinder.costPerDay, 50e9 * 13 / 165.8, 1, 'moonbinder cost per day');
  ok(by.moonbinder.level === 'yes' && by.moonbinder.haveIt === false && Math.abs(by.moonbinder.daysToBank - 4) < 1e-9, 'moonbinder: yes; 20B to go at 5B/day = 4 days');
  // Wind Turner: 100B x 0.1114 = 11.1B/day > kept, <= earned -> cut, 56% of earnings
  ok(by.windturner.level === 'cut' && Math.round(by.windturner.shareOfEarned * 100) === 56, 'wind turner: if you cut back');
  // Firepit: 100B x 2/(20/1.98) = 19.8B/day <= 20B earned -> cut (just). Make it 'no' with more sightings.
  ok(by.firepit.level === 'cut', 'firepit: barely within earnings');
  s.shopStats.items.StoneFirepit.seen = 5; s.shopStats.items.StoneFirepit.stockSum = 5;
  const a2 = Object.fromEntries(budget.afford(s, f).map((x) => [x.ruleId, x]));
  ok(a2.firepit.level === 'no' && a2.firepit.oneIn === 3 && Math.abs(a2.firepit.shareOfEarned - 2.475) < 1e-9, 'firepit: not every one, about 1 in 3');
  // Mythical egg: 1B x 1.08 = 1.08B/day -> yes; and 1B is in the bank.
  ok(a2.mythicalegg.level === 'yes' && a2.mythicalegg.haveIt === true, 'mythical egg: yes, and affordable now');
  // No money yet: costs known, verdict waits.
  const w = Object.fromEntries(budget.afford(s, budget.flows([], 1, now)).map((x) => [x.ruleId, x]));
  ok(w.moonbinder.level === 'wait' && w.moonbinder.costPerDay != null && w.moonbinder.haveIt === false && w.moonbinder.daysToBank === null, 'no money measured: wait');
  // Legendary egg: no baseline, nothing watched -> unknown, still listed with its price.
  ok(w.legendaryegg && w.legendaryegg.level === 'unknown' && w.legendaryegg.rate === null && w.legendaryegg.price === 100e6, 'unknown rate still listed');
  s.alerts.disabled = ['moonbinder'];
  ok(!budget.afford(s, f).some((x) => x.ruleId === 'moonbinder'), 'alerts switched off are left out');
}

/* 5b. Where the coins go */
{
  const s = base();
  const now = 30 * D; // (not 20: a purchase at exactly time 0 would read as "no time")
  budget.record(s.shopStats, { shops: {
    amber: { open: true, items: [
      { itemId: 'MoonCelestial', name: 'Moonbinder Pod', itemType: 'Seed', stock: 1, coinPrice: 50e9 },
      { itemId: 'StoneFirepit', name: 'Stone Firepit', itemType: 'Decor', stock: 1, coinPrice: 100e9 },
      { itemId: 'AmberEgg', name: 'Amber Egg', itemType: 'Egg', stock: 1, coinPrice: 2e9 },
    ] },
    tool: { open: true, nextRestockAt: 'a', items: [{ itemId: 'XPPotion', name: 'XP Potion', itemType: 'Tool', stock: 1, coinPrice: 5e6 }] },
  } }, now - 3 * D);
  ok(budget.categoryOf({ type: 'Seed' }) === 'seeds' && budget.categoryOf({ type: 'Egg' }) === 'eggs' && budget.categoryOf({ type: 'Decor' }) === 'decor' && budget.categoryOf({ type: 'Tool' }) === 'tools', 'category from the feed type');
  ok(budget.categoryOf({ id: 'WindTurner' }) === 'decor' && budget.categoryOf({ id: 'MythicalEgg' }) === 'eggs' && budget.categoryOf({ name: 'Cacao Bean' }) === 'seeds' && budget.categoryOf({ shop: 'egg' }) === 'eggs' && budget.categoryOf({}) === 'other', 'category from the name, the wiki table, or the shop');
  // Purchases over three days: 50B seeds, 100B decor, 2B eggs, 5M tools; plus one 20 days ago (outside a week).
  budget.recordPurchase(s, { at: now - 2.5 * D, command: { type: 'Buy', itemId: 'MoonCelestial' } }, now);
  budget.recordPurchase(s, { at: now - 2 * D, command: { type: 'Buy', itemId: 'StoneFirepit' } }, now);
  budget.recordPurchase(s, { at: now - 1 * D, command: { type: 'Buy', itemId: 'AmberEgg' } }, now);
  budget.recordPurchase(s, { at: now - 0.5 * D, command: { type: 'Buy', itemId: 'XPPotion' } }, now);
  budget.recordPurchase(s, { at: now - 20 * D, command: { type: 'Buy', itemId: 'AmberEgg' } }, now);
  ok(s.purchases.log[0].cat === 'celestials' && s.purchases.log[1].cat === 'decor' && s.purchases.log[2].cat === 'eggs' && s.purchases.log[3].cat === 'tools', 'purchases carry a category');
  ok(Object.keys(s.purchases.days).length === 4, 'day buckets (two purchases share a day)');
  // Money over the last 7 days: earned 200B, wallet 100B -> 40B (kept -60B): spent 260B, of which 152.005B was seen bought here.
  s.moneyHistory = [{ t: now - 7 * D, c: 100e9, s: 0, f: 0 }, { t: now, c: 40e9, s: 200e9, f: 0 }];
  const f = budget.flows(s.moneyHistory, 7, now);
  const c = budget.categories(s, f);
  ok(c && c.observed === 152.005e9 && Math.abs(c.elsewhere - 107.995e9) < 1 && c.keepPct === 10, 'observed vs elsewhere: ' + c.elsewhere);
  const byCat = Object.fromEntries(c.rows.map((r) => [r.cat, r]));
  ok(byCat.decor.coins === 100e9 && byCat.celestials.coins === 50e9 && byCat.eggs.coins === 2e9 && byCat.tools.coins === 5e6 && byCat.elsewhere, 'per category, the old purchase excluded');
  near(byCat.decor.perDay, 100e9 / 7, 1, 'per day over the week');
  near(byCat.decor.share, (100e9 / 7) / (200e9 / 7), 1e-9, 'share of earnings');
  ok(byCat.celestials.investment === true && byCat.decor.investment === false, 'celestials are investment');
  ok(byCat.eggs.seen === 1 && byCat.eggs.bought >= 1 && byCat.decor.seen === 1 && byCat.decor.bought === 1 && byCat.celestials.seen === 1 && byCat.celestials.bought === 1, 'alerted things in stock vs bought per category (the Amber Egg is an alert now), the firepit counted once though two alerts cover it');
  // Room: kept -60B over 7 d = -8.57B/day; target 10% of 28.57B = 2.86B -> over by 11.4B; trim decor.
  ok(c.level === 'over' && Math.abs(c.roomPerDay - (-60e9 / 7 - 0.1 * 200e9 / 7)) < 1 && c.cut && c.cut.cat === 'decor', 'over budget, trim decor');
  // A cheaper week: earned 200B, kept +50B -> room = 50B/7 - 2.86B = 4.29B/day
  s.moneyHistory = [{ t: now - 7 * D, c: 100e9, s: 0, f: 0 }, { t: now, c: 150e9, s: 200e9, f: 0 }];
  const c2 = budget.categories(s, budget.flows(s.moneyHistory, 7, now));
  ok(c2.level === 'ok' && Math.abs(c2.roomPerDay - (50e9 / 7 - 20e9 / 7)) < 1 && c2.cut === null && c2.elsewhere === 0, 'room to spend, nothing to trim, nothing elsewhere');
  // Savings target
  ok(budget.setOptions(s, { keepPct: 25 }).keepPct === 25 && budget.categories(s, budget.flows(s.moneyHistory, 7, now)).keepPct === 25, 'keep 25%');
  ok(budget.setOptions(s, { keepPct: 500 }).keepPct === 90 && budget.setOptions(s, { keepPct: 'x' }).keepPct === 10, 'bounds and bad input');
  ok(budget.categories(s, budget.flows([], 1, now)) === null, 'no money: no categories');
}

/* 6. The whole view */
{
  const s = base();
  const now = 10 * D;
  let v = budget.view({ settings: s, now });
  ok(v.periods[1].verdict.level === 'wait' && v.periods[7].verdict.level === 'wait' && v.patterns.length === 0 && v.purchases.total.count === 0, 'empty view');
  s.moneyHistory = [{ t: now - 3 * D, c: 1e9, s: 0, f: 0 }, { t: now - D, c: 4e9, s: 6e9, f: 0 }, { t: now, c: 3e9, s: 10e9, f: 0 }]; // day: -1B; week: +2B on 10B earned
  v = budget.view({ settings: s, now });
  ok(v.periods[1].verdict.level === 'short' && v.periods[7].verdict.level === 'ok', 'a bad day inside a good week');
  ok(v.periods[30].hours === v.periods[7].hours, 'month = week when the history is 3 days');
  ok(v.afford.length > 0 && v.afford.some((a) => a.level === 'yes' || a.level === 'cut' || a.level === 'no'), 'afford has verdicts once money is measured');
  ok(v.periods[7].categories && v.periods[1].categories && v.options.keepPct === 10, 'categories per period, options in the view');
}

/* 7. store round trip */
{
  const fs = require('fs'); const path = require('path'); const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-'));
  store.init(dir);
  const s = store.get();
  s.shopStats = budget.emptyStats();
  budget.record(s.shopStats, { shops: { seed: { open: true, nextRestockAt: 'a', items: [{ itemId: 'X', name: 'X', stock: 1, coinPrice: 5 }] } } }, 1);
  budget.recordMoney(s, { coins: 1, sold: 2, found: 3 }, 4);
  budget.recordPurchase(s, { command: { type: 'BuyItem', itemId: 'X' } }, 5);
  store.flush(); store.init(dir);
  const r = store.get();
  ok(r.shopStats.items.X.seen === 1 && r.moneyHistory[0].f === 3 && r.purchases.log[0].coins === 5, 'new keys survive a save/load');
}


/* 8. The plan and the money box */
{
  const s = base();
  const now = 40 * D;
  // Earned 20B/day, kept 5B/day, wallet 30B.
  s.moneyHistory = [{ t: now - D, c: 25e9, s: 0, f: 0 }, { t: now, c: 30e9, s: 20e9, f: 0 }];
  const f = budget.flows(s.moneyHistory, 1, now);
  ok(budget.planIds(s).length === 0, 'empty plan');
  budget.setPlan(s, { add: 'moonbinder' });
  budget.setPlan(s, { add: 'dawnbinder' });
  budget.setPlan(s, { add: 'nonsense' });
  budget.setPlan(s, { add: 'amber' }); // a weather rule, not an item
  ok(budget.planIds(s).join(',') === 'moonbinder,dawnbinder', 'only item alerts join the plan');
  budget.setPlan(s, { up: 'dawnbinder' });
  ok(budget.planIds(s).join(',') === 'dawnbinder,moonbinder', 'move up');
  budget.setPlan(s, { up: 'dawnbinder' });
  ok(budget.planIds(s).join(',') === 'dawnbinder,moonbinder', 'already first');
  const ctx = { now, wallet: 30e9, upcoming: [
    { name: 'Lunar event', kind: null, possible: ['dawn', 'amber'], startsAt: new Date(now + 2 * H).toISOString() },
    { name: 'Amber Moon', kind: 'amber', startsAt: new Date(now + 6 * H).toISOString() },
    { name: 'Thunderstorm', kind: 'thunder', startsAt: new Date(now + 40 * 60000).toISOString() },
  ], restocks: [{ id: 'seed', at: new Date(now + 3 * 60000).toISOString() }] };
  let p = budget.plan(s, f, ctx);
  ok(p.wallet === 30e9 && p.items.length === 2, 'two items, wallet from the game');
  const [db, mb] = p.items;
  ok(db.price === 10e9 && db.have === 10e9 && db.funded && db.daysToFund === 0 && db.needTotal === 10e9, 'dawnbinder: first in line, funded');
  ok(mb.price === 50e9 && mb.have === 20e9 && !mb.funded && Math.abs(mb.pct - 0.4) < 1e-9 && mb.needTotal === 60e9, 'moonbinder gets the rest: 20B of 50B');
  near(mb.daysToFund, 30e9 / 5e9, 1e-9, 'six days to fund the whole plan');
  ok(p.reserved === 30e9 && p.free === 0 && p.target === 'moonbinder', 'everything earmarked, nothing free, target is the moonbinder');
  near(p.delayHoursPerB, 4.8, 1e-9, '1B spent = 4.8 h later at 5B/day');
  // Next chances
  ok(db.next && db.next.sure === false && db.next.label === 'Dawn?' && db.next.inMs === 2 * H && db.next.readyByThen === true, 'dawnbinder: next lunar event in 2 h, shown as "Dawn?", ready');
  ok(mb.next && mb.next.sure === true && mb.next.label === 'Amber Moon' && mb.next.inMs === 6 * H && mb.next.readyByThen === false, 'moonbinder: announced Amber Moon in 6 h, not ready');
  near(mb.next.shortByThen, 60e9 - (30e9 + 5e9 * 0.25), 1, 'short by then: 60B needed, 31.25B by then');
  ok(Math.abs(mb.chancePerOpening - 0.0777 / 1.98) < 1e-4 && mb.likelyInTime === true && mb.shopLabel === 'Amber shop', 'chance per Amber Moon; funded before the average gap (13 d); shop named');
  ok(budget.nextOpening('seed', ctx, now).label === 'Seed shop restock' && budget.nextOpening('egg', ctx, now) === null && budget.nextOpening('thunder', ctx, now).sure, 'restock and weather lookups');
  // A fat wallet: all funded, free money.
  p = budget.plan(s, f, Object.assign({}, ctx, { wallet: 75e9 }));
  ok(p.items.every((i) => i.funded) && p.free === 15e9 && p.target === null, 'funded plan leaves 15B free');
  // No money measured: still allots the wallet, no timings.
  const p0 = budget.plan(s, budget.flows([], 1, now), { now, wallet: 30e9 });
  ok(p0.items[1].daysToFund === null && p0.delayHoursPerB === null && p0.free === 0, 'no rate: no days');
  // Remove
  budget.setPlan(s, { remove: 'dawnbinder' });
  ok(budget.planIds(s).join(',') === 'moonbinder', 'removed');
  // HUD lines
  const v = budget.view({ settings: s, now, ctx });
  const lines = budget.hudLines(v, (x) => Math.round(x / 1e9) + 'B').map((l) => l.text);
  ok(lines[0] === '💰 30B in the bank', 'bank line: ' + lines[0]);
  ok(!lines.some((l) => /saved|plan funded/.test(l)), 'no saving-target line on the overlay');
  ok(!lines.some((l) => l.startsWith('⏱')), 'no next-opening line in the money box');
  ok(/^(🟢 Open to spend|🟡 Careful|🔴 Save) · safe to spend \d/.test(lines[1]) && /^1B spent now = Moonbinder ~5 h later$/.test(lines[2]), 'signal + delay lines: ' + lines.slice(2).join(' | '));
  ok(v.afford.find((a) => a.ruleId === 'moonbinder').planned === true && v.afford.find((a) => a.ruleId === 'dawnbinder').planned === false, 'afford rows know what is planned');
}
console.log(`budget: ${n} checks passed`);

/* 9. Day by day */
{
  const now = 30 * D + 10 * H; // 10:00 on day 30
  const hist = [
    { t: 27 * D + 20 * H, c: 10e9, s: 0, f: 0 },      // day 27 evening
    { t: 28 * D + 2 * H, c: 11e9, s: 2e9, f: 0 },     // day 28: +2B earned, wallet +1B -> spent 1B
    { t: 28 * D + 22 * H, c: 9e9, s: 5e9, f: 1e9 },   // day 28 later: cumulative
    { t: 30 * D + 9 * H, c: 12e9, s: 8e9, f: 1e9 },   // day 30 (nothing on day 29)
  ];
  const d = budget.daily(hist, 4, now);
  ok(d.length === 4 && d[0].day === 27 && d[3].day === 30, 'four days ending today');
  ok(d[0].earned === null, 'day 27: no point before it, nothing to compare');
  ok(d[1].earned === 6e9 && d[1].kept === -1e9 && d[1].spent === 7e9, 'day 28: last point before vs last inside: earned 6B, wallet 10B -> 9B, spent 7B');
  ok(d[2].earned === null, 'day 29: no reading that day');
  ok(d[3].earned === 3e9 && d[3].kept === 3e9 && d[3].spent === 0, 'day 30: 3B earned, all kept');
  ok(budget.daily([], 14, now).length === 0 && budget.daily([hist[0]], 14, now).length === 0, 'needs two points');
  const v = budget.view({ settings: Object.assign(base(), { moneyHistory: hist }), now });
  ok(Array.isArray(v.daily) && v.daily.length === 14, 'the view carries 14 days');
  console.log(`budget (daily): ok`);
}

/* 10. Unlocking, and purchases from the game's per-restock tally */
{
  const now = 30 * D;
  const s = base();
  let v = budget.view({ settings: s, now });
  ok(v.unlocked === false && v.measuredHours === 0, 'nothing measured: locked');
  s.moneyHistory = [{ t: now - 20 * H, c: 1, s: 1, f: 0 }, { t: now, c: 2, s: 2, f: 0 }];
  v = budget.view({ settings: s, now });
  ok(v.unlocked === false && Math.round(v.measuredHours) === 20, '20 h: still locked');
  s.moneyHistory = [{ t: now - 25 * H, c: 1, s: 1, f: 0 }, { t: now, c: 2, s: 2, f: 0 }];
  v = budget.view({ settings: s, now });
  ok(v.unlocked === true, '25 h: unlocked');
  s.moneyHistory = [];
  s.budget = { unlocked: true };
  ok(budget.view({ settings: s, now }).unlocked === true, 'once unlocked, stays unlocked');
  // Over 1B net worth: two weeks instead of a day.
  const rich = base();
  rich.moneyHistory = [{ t: now - 25 * H, c: 2e9, s: 0, f: 0 }, { t: now, c: 2e9, s: 1e9, f: 0 }];
  let vr = budget.view({ settings: rich, now, ctx: { wallet: 2e9 } });
  ok(vr.unlockDays === 14 && vr.unlocked === false && vr.netWorth === 2e9, 'wallet 2B: 14 days, 25 h is not enough');
  vr = budget.view({ settings: rich, now, ctx: { wallet: 0.4e9, gardenWorth: 0.7e9 } });
  ok(vr.unlockDays === 14 && vr.netWorth === 1.1e9, 'garden + wallet over 1B counts');
  vr = budget.view({ settings: rich, now, ctx: { wallet: 0.4e9, gardenWorth: 0.5e9 } });
  ok(vr.unlockDays === 1 && vr.unlocked === true, 'under 1B: a day is enough');
  rich.moneyHistory = [{ t: now - 15 * D, c: 2e9, s: 0, f: 0 }, { t: now, c: 2e9, s: 1e9, f: 0 }];
  ok(budget.view({ settings: rich, now, ctx: { wallet: 2e9 } }).unlocked === true, '15 days: unlocked');
  // Overrides from Extras.
  const o = base();
  ok(budget.setOptions(o, { unlockMode: 'on' }).unlockMode === 'on' && budget.view({ settings: o, now }).unlocked === true, 'forced shown');
  ok(budget.setOptions(o, { unlockMode: 'off' }).unlockMode === 'off' && budget.view({ settings: Object.assign(o, { budget: Object.assign(o.budget, { unlocked: true }) }), now }).unlocked === false, 'forced hidden even when earned');
  ok(budget.setOptions(o, { unlockMode: 'nonsense' }).unlockMode === 'auto', 'bad mode: automatic');
  // A nested purchase command (the real shape: {shop, item: {...}}) is understood.
  const s2 = base();
  budget.record(s2.shopStats, { shops: { egg: { open: true, nextRestockAt: 'x', items: [{ itemId: 'LegendaryEgg', name: 'Legendary Egg', itemType: 'Egg', stock: 1, coinPrice: 100e6 }] } } }, 1);
  const e = budget.recordPurchase(s2, { command: { type: 'PurchaseShopItem', shop: 'egg', item: { itemId: 'LegendaryEgg', quantity: 2 } } });
  ok(e && e.id === 'LegendaryEgg' && e.qty === 2 && e.coins === 200e6 && e.cat === 'eggs' && e.rules.includes('legendaryegg'), 'nested purchase command: ' + JSON.stringify(e));
  console.log('budget (unlock, nested purchase): ok');
}

/* 11. Resetting purchases, and the one-time clear of old records */
{
  const s = base();
  budget.record(s.shopStats, { shops: { egg: { open: true, nextRestockAt: 'x', items: [{ itemId: 'LegendaryEgg', name: 'Legendary Egg', itemType: 'Egg', stock: 1, coinPrice: 100e6 }] } } }, 1);
  budget.recordPurchase(s, { command: { type: 'Buy', itemId: 'LegendaryEgg' } }, 5);
  ok(s.purchases.v === 2 && s.purchases.total.count === 1 && budget.patterns(s)[0].bought === 1, 'fresh record is v2 with a purchase');
  budget.resetPurchases(s, 99);
  ok(s.purchases.total.count === 0 && s.purchases.log.length === 0 && Object.keys(s.purchases.byRule).length === 0 && Object.keys(s.purchases.days).length === 0 && s.purchases.since === 99 && s.purchases.v === 2, 'reset clears everything but keeps the version');
  ok(budget.patterns(s)[0].seen === 1 && budget.patterns(s)[0].bought === 0, 'the shop\'s seen count survives; bought is zero');
  // An old record (no version) reads as v1: the app clears it once on start.
  const old = budget.migratePurchases({ total: { count: 7, coins: 1 }, log: [] });
  ok(old.v === 1, 'old records are v1');
  ok(budget.migratePurchases(null).v === 2, 'no record at all: starts at v2');
  console.log('budget (reset): ok');
}

/* 12. Net worth, the engine, invested vs spent, the stage */
{
  const now = 40 * D;
  const s = base();
  // A late-game cycle: the garden climbs while the wallet holds, then a harvest
  // turns garden into coins. Net worth should ride through level-ish.
  s.moneyHistory = [
    { t: now - 6 * D, c: 10e9, s: 0, f: 0 },
    { t: now - 3 * D, c: 10e9, s: 0, f: 0 },
    { t: now - 1 * D, c: 60e9, s: 50e9, f: 0 },   // harvest: sold 50B
    { t: now, c: 58e9, s: 50e9, f: 0 },
  ];
  s.worthHistory = [
    { t: now - 6 * D + 60000, v: 40e9 },
    { t: now - 3 * D - 60000, v: 55e9 },
    { t: now - 1 * D, v: 5e9 },                   // harvested
    { t: now - 20 * 60000, v: 8e9 },
  ];
  const ser = budget.netWorthSeries(s, 30, now);
  ok(ser.length === 4 && ser[0].total === 50e9 && ser[1].total === 65e9 && ser[2].total === 65e9 && ser[3].total === 66e9, 'net worth rides through the harvest: ' + ser.map((p) => p.total / 1e9).join(','));
  const g = budget.growth(s, { wallet: 58e9, gardenWorth: 8e9 }, 7, now);
  ok(g.now.total === 66e9 && g.start.total === 50e9 && g.change === 16e9 && Math.abs(g.pct - 0.32) < 1e-9, 'growth over the week: +16B, 32%');
  ok(budget.growth(base(), {}, 7, now).change === null, 'nothing measured: no change');
  // Engine: 50B earned over the last 7 days; nothing the week before.
  const e = budget.engine(s, now);
  ok(e.perDay != null && Math.abs(e.perDay - 50e9 / 6) < 1e6 && e.change === null && e.days.length === 14, 'engine this week; no week before to compare');
  s.moneyHistory.unshift({ t: now - 13 * D, c: 1e9, s: -20e9, f: 0 }, { t: now - 8 * D, c: 1e9, s: -10e9, f: 0 });
  const e2 = budget.engine(s, now);
  ok(e2.lastWeekPerDay != null && e2.change != null && e2.change > 0, 'engine vs last week: up');
  // Invested vs spent: a celestial and an egg are invested, decor is spent.
  const s3 = base();
  budget.record(s3.shopStats, { shops: { amber: { open: true, items: [
    { itemId: 'MoonCelestial', name: 'Moonbinder Pod', itemType: 'Seed', stock: 1, coinPrice: 50e9 },
    { itemId: 'StoneFirepit', name: 'Stone Firepit', itemType: 'Decor', stock: 1, coinPrice: 100e9 },
    { itemId: 'AmberEgg', name: 'Amber Egg', itemType: 'Egg', stock: 1, coinPrice: 2e9 },
  ] } } }, now - 3 * D);
  for (const id of ['MoonCelestial', 'StoneFirepit', 'AmberEgg']) budget.recordPurchase(s3, { at: now - D, command: { type: 'Buy', itemId: id } }, now);
  s3.moneyHistory = [{ t: now - 7 * D, c: 200e9, s: 0, f: 0 }, { t: now, c: 50e9, s: 10e9, f: 0 }]; // spent 160B
  const sp = budget.split(s3, budget.flows(s3.moneyHistory, 7, now));
  ok(sp.invested === 52e9 && sp.spent === 100e9 && sp.unseen === 8e9, 'invested 52B (celestial + egg), spent 100B (decor), 8B not seen: ' + [sp.invested, sp.spent, sp.unseen].join(','));
  ok(sp.rows[0].cat === 'celestials' && sp.rows[sp.rows.length - 1].cat === 'elsewhere', 'celestials first, not-seen last');
  // Stage.
  ok(budget.stage({ garden: { total: 270, special: 173 } }, 0.5e9).id === 'ladder', 'under 1B: seed ladder');
  ok(budget.stage({ garden: { total: 270, special: 20 } }, 50e9).id === 'building', 'rich but few mutations: building pets');
  const st = budget.stage({ garden: { total: 270, gold: 82, rainbow: 91 } }, 510e9);
  ok(st.id === 'farming' && st.index === 2 && st.stages.length === 3 && /celestial/.test(st.advice), 'a quarter or more gold/rainbow: mutation farming');
  // The view carries all of it.
  const v = budget.view({ settings: s3, now, ctx: { wallet: 50e9, gardenWorth: 0, garden: { total: 10, special: 0 } } });
  ok(v.growth && v.growth.week && v.engine && v.split && v.stage && v.stage.id === 'building', 'the view has growth, engine, split, stage');
  console.log('budget (growth, engine, split, stage): ok');
}

/* 13. Foresight: will I afford what I want when it next shows up? */
{
  const now = 50 * D;
  const s = base();
  ok(budget.seedWants(s) === true && budget.planIds(s).join(',') === 'moonbinder,dawnbinder,starweaver,emberbloom,dawnbreaker,mythicalegg,amberegg', 'default wants in the owner\'s order, Mythical Egg then Amber Egg last');
  ok(budget.seedWants(s) === false, 'seeded once only');
  // Someone seeded before the Mythical Egg was added gets it once, at the bottom.
  const old = base(); old.budget = { wantsSeeded: true, plan: ['moonbinder', 'windturner'] };
  ok(budget.seedWants(old) === true && budget.planIds(old).join(',') === 'moonbinder,windturner,mythicalegg,amberegg' && budget.seedWants(old) === false, 'Mythical and Amber Eggs added once for an existing list');
  const had = base(); had.budget = { wantsSeeded: true, wantsMythic: true, plan: ['moonbinder', 'mythicalegg'] };
  ok(budget.seedWants(had) === true && budget.planIds(had).join(',') === 'moonbinder,mythicalegg,amberegg', 'someone who already had the Mythical Egg gets just the Amber Egg');
  // The worked cases below use the original five.
  s.budget.plan = ['moonbinder', 'dawnbinder', 'starweaver', 'emberbloom', 'dawnbreaker'];
  const byId = (f) => Object.fromEntries(f.events.map((e) => [e.ruleId, e]));
  // Comfortable: 30B in the bank, growing 5B a day.
  let f = budget.foresight(s, { wallet: 30e9, pace: 5e9 }, 0, now);
  ok(f.events.map((e) => e.ruleId).join(',') === 'dawnbreaker,dawnbinder,emberbloom,starweaver,moonbinder', 'walked in time order: ' + f.events.map((e) => e.ruleId).join(','));
  ok(f.events.every((e) => e.status === 'ready') && f.signal === 'open', 'everything covered: open to spend');
  ok(f.safeToSpend === 30e9, 'safe to spend: the Moonbinder\'s slack is 33.3B, capped at the 30B in the wallet');
  // Short: 5B, growing 2B a day: the Moonbinder is out of reach.
  f = budget.foresight(s, { wallet: 5e9, pace: 2e9 }, 0, now);
  let e = byId(f);
  ok(e.moonbinder.status === 'short' && e.dawnbinder.status === 'ready' && f.signal === 'save' && f.safeToSpend === 0, 'short for the Moonbinder: save, nothing safe to spend');
  ok(f.needMore && f.needMore.label === 'Moonbinder' && f.needMore.perDay > 2e9 && f.needMore.perDay < 2.5e9, 'grow ~2.35B a day more to catch it: ' + (f.needMore && f.needMore.perDay / 1e9));
  // Trade-off: 40B, growing 1B a day: buying the early Dawnbinder would cost the Moonbinder.
  f = budget.foresight(s, { wallet: 40e9, pace: 1e9 }, 0, now);
  e = byId(f);
  ok(e.dawnbinder.status === 'tradeoff' && e.dawnbinder.costs === 'Moonbinder' && e.moonbinder.status === 'ready', 'Dawnbinder is a trade-off against the Moonbinder');
  ok(f.signal === 'careful' && f.safeToSpend > 1.5e9 && f.safeToSpend < 2e9, 'careful, ~1.8B safe: ' + f.safeToSpend / 1e9);
  // What if I buy a 2B decoration now? Breaks the Moonbinder.
  let w = budget.whatIf(s, { wallet: 40e9, pace: 1e9 }, 2e9, now);
  ok(w.verdict === 'breaks' && w.lost.length === 1 && w.lost[0].label === 'Starweaver' && w.lost[0].status === 'tradeoff' && w.lost[0].costs === 'Moonbinder' && w.after.events.find((x) => x.ruleId === 'moonbinder').status === 'ready', 'a 2B decoration costs the Starweaver (priority keeps the Moonbinder)');
  w = budget.whatIf(s, { wallet: 40e9, pace: 1e9 }, 1e9, now);
  ok(w.verdict === 'safe' && w.lost.length === 0 && w.refillDays === 1, 'a 1B one is safe, back in a day');
  w = budget.whatIf(s, { wallet: 30e9, pace: 5e9 }, 10e9, now);
  ok(w.verdict === 'safe', 'rich: 10B decor is safe');
  // Unknown rates are listed, not guessed; no pace yet is "wait".
  s.budget.plan = ['moonbinder', 'firepit'];
  f = budget.foresight(s, { wallet: 1e9 }, 0, now);
  ok(f.unknown.length === 1 && f.unknown[0].label === 'Firepit' && f.signal === 'wait', 'unknown rate listed; no pace measured: wait');
  console.log('budget (foresight): ok');
}
{
  // Already short: any spend deepens the most important shortfall.
  const s = base();
  budget.seedWants(s);
  s.budget.plan = ['moonbinder', 'dawnbinder', 'starweaver', 'emberbloom', 'dawnbreaker'];
  const w = budget.whatIf(s, { wallet: 5e9, pace: 2e9 }, 0.5e9, 50 * D);
  ok(w.verdict === 'deepens' && w.deepens.label === 'Moonbinder' && Math.abs(w.deepens.after - w.deepens.before - 0.5e9) < 1e6, 'in Save mode a 500M buy deepens the Moonbinder shortfall by 500M');
  console.log('budget (deepens): ok');
}

/* 14. The crops' lifecycle: ready counts now, growing counts at its harvest */
{
  const now = 60 * D;
  const s = base();
  budget.seedWants(s);
  s.budget.plan = ['moonbinder', 'dawnbinder', 'starweaver', 'emberbloom', 'dawnbreaker'];
  const garden = { total: 100, ready: 30, readyValue: 20e9, growingValue: 100e9, growingPotential: 180e9, harvestHours: 12 };
  let f = budget.foresight(s, { wallet: 5e9, pace: 2e9, garden }, 0, now);
  ok(f.available === 25e9 && f.wallet === 5e9 && f.garden.ready === 20e9, 'available now = wallet 5B + ready crops 20B (growing 100B not counted)');
  ok(f.mode === 'estimate' && f.harvest === null, 'the estimate drives it (requirement timing known)');
  const e14 = f.estimate;
  ok(e14.canMature === 70 && e14.rateSource === 'requirements' && Math.abs(e14.rate - 70 / 12) < 1e-9, '70 crops can mature, all by the 12 h the requirements give');
  ok(e14.perCropSource === 'floor' && Math.abs(e14.perCrop - 180e9 / 70) < 1, 'a ready crop\'s worth: the growing floor (2.57B) beats the ready average (0.67B)');
  ok(Math.abs(e14.fullValue - 200e9) < 1 && Math.abs(e14.fullT - 0.5) < 1e-9, 'full in half a day: 20B ready + 180B');
  const at05 = f.line.filter((p) => Math.abs(p[0] - 0.5) < 1e-9);
  ok(at05.length === 2 && Math.abs(at05[0][1] - 205e9) < 1e3, 'the line has ramped to 25B + 180B at full');
  ok(f.events.every((e) => e.status === 'ready') && f.signal === 'open', 'with the estimate everything is covered');
  // Before the garden is full there's no pace growth (maturing *is* that growth).
  f = budget.foresight(s, { wallet: 5e9, pace: 2e9, garden: Object.assign({}, garden, { harvestHours: 72 }) }, 0, now);
  const db = f.events.find((e) => e.ruleId === 'dawnbreaker');
  const expectDb = 25e9 + (180e9 / 70) * Math.min(70, (70 / 72) * 24 * db.t);
  ok(Math.abs(db.cashBefore - expectDb) < 1e3, 'an event before full: available + crops matured by then, no pace: ' + db.cashBefore / 1e9);
  // Harvest timing unknown: growing crops aren't counted at all; the pace runs from now.
  f = budget.foresight(s, { wallet: 5e9, pace: 2e9, garden: Object.assign({}, garden, { harvestHours: null }) }, 0, now);
  const db2 = f.events.find((e) => e.ruleId === 'dawnbreaker');
  ok(f.harvest === null && f.available === 25e9 && Math.abs(db2.cashBefore - (25e9 + 2e9 * db2.t)) < 1, 'no timing: growing ignored, the pace runs from now');
  // Safe to spend can include selling ready crops, never growing ones.
  f = budget.foresight(s, { wallet: 5e9, pace: 0.001, garden: Object.assign({}, garden, { harvestHours: 1 }) }, 0, now);
  ok(f.safeToSpend <= 25e9 && f.safeToSpend > 5e9, 'safe to spend can use ready crops: ' + f.safeToSpend / 1e9);
  // The rule's options.
  ok(budget.options(s).readyRule.hydro === true && budget.setOptions(s, { readyRule: { hydro: false } }).readyRule.hydro === false && budget.options(s).readyRule.lunar === true, 'ready rule defaults on; one switch changes one part');
  console.log('budget (lifecycle): ok');
}

/* 15. Harvest cycles and the predicted harvest; spend up to over time */
{
  const now = 100 * D;
  const s = base();
  // A lead-in, then four harvests 24.5 h apart; each cycle climbs 1B → 100B over 24 h.
  const worth = [];
  const money = [];
  let sold = 0;
  const start0 = now - (4 * 24.5 + 12) * H;
  for (let i = 0; i < 5; i += 1) {
    const st = start0 + i * 24.5 * H;
    const last = i === 4; // the current cycle, 12 h in
    for (let h = 0; h <= (last ? 12 : 24); h += 0.5) {
      const t = st + h * H;
      if (t > now) break;
      worth.push({ t, v: 1e9 + 99e9 * (h / 24) });
      money.push({ t, c: 5e9, s: sold, f: 0 });
    }
    if (!last) sold += 99e9; // sold at the next cycle's first reading
  }
  s.worthHistory = worth;
  s.moneyHistory = money;
  const hc = budget.harvestCycles(s);
  ok(hc.harvests.length === 4 && hc.cycles.length === 3, 'four harvests, three full cycles: ' + hc.harvests.length + '/' + hc.cycles.length);
  ok(hc.cycles.every((c) => Math.abs(c.hours - 24) < 0.01 && Math.abs(c.sold - 99e9) < 1), 'each cycle 24 h, sold 99B');
  const garden = { total: 100, ready: 0, readyValue: 0, growingValue: 50.5e9, growingPotential: 20e9, harvestHours: null };
  let p = budget.predictHarvest(s, { garden }, now);
  ok(p.cycles === 3 && Math.abs(p.elapsedHours - 12) < 0.01 && Math.abs(p.ratio - 50.5 / 99) < 1e-6, '12 h in, past cycles were at 51% of their harvest');
  ok(Math.abs(p.predictedGrowing - 99e9) < 1e6 && p.valueSource === 'cycles', 'predicted harvest ≈ 99B (well above the 20B floor): ' + p.predictedGrowing / 1e9);
  ok(Math.abs(p.hours - 12) < 0.01 && p.hoursSource === 'cycles', 'no requirement timing: 12 h left of a typical 24 h cycle');
  p = budget.predictHarvest(s, { garden: Object.assign({}, garden, { harvestHours: 6 }) }, now);
  ok(p.hours === 6 && p.hoursSource === 'requirements' && Math.abs(p.cycleHours - 12) < 0.01, 'requirement timing wins; the cycles\' 12 h is kept alongside');
  // No history: the floor, and no timing unless the requirements give one.
  p = budget.predictHarvest(base(), { garden }, now);
  ok(p.cycles === 0 && p.predictedGrowing === 20e9 && p.valueSource === 'floor' && p.hours === null, 'no cycles yet: the floor, no timing');
  // The foresight uses it.
  s.budget = { plan: ['moonbinder'] };
  const f = budget.foresight(s, { wallet: 5e9, pace: 1e9, garden }, 0, now);
  ok(f.mode === 'estimate' && f.estimate.perCropSource === 'cycles' && f.estimate.rateSource === 'cycles' && Math.abs(f.estimate.fullValue - 99e9) < 1e6 && Math.abs(f.estimate.fullT - 0.5) < 1e-6 && f.prediction.cycles === 3, 'foresight: the cycles give ~99B, full in half a day');
  ok(f.events[0].status === 'ready', 'the Moonbinder is covered by the estimate');
  // Spend up to, over time.
  const s2 = base();
  s2.budget = { plan: ['moonbinder', 'dawnbinder', 'starweaver', 'emberbloom', 'dawnbreaker'] };
  const f2 = budget.foresight(s2, { wallet: 30e9, pace: 5e9 }, 0, now);
  ok(f2.allowances.length === 5 && f2.allowances.every((a, i, arr) => i === 0 || a.amount >= arr[i - 1].amount - 1), 'spend-up-to grows over time: ' + f2.allowances.map((a) => (a.amount / 1e9).toFixed(1)).join(','));
  const mb = f2.events.find((e) => e.ruleId === 'moonbinder');
  ok(Math.abs(f2.allowances[f2.allowances.length - 1].amount - mb.cashAfter) < 1, 'after the last want: everything left');
  const f3 = budget.foresight(s2, { wallet: 5e9, pace: 2e9 }, 0, now);
  const mbT = f3.events.find((e) => e.ruleId === 'moonbinder').t;
  ok(f3.events.find((e) => e.ruleId === 'moonbinder').status === 'short' && f3.allowances.length > 0 && f3.allowances.every((a) => a.t < mbT && a.amount === 0), 'short for the Moonbinder: nothing to spend before it (it would only deepen the gap)');
  console.log('budget (cycles): ok');
}
{
  // Before the garden's report arrives: wait, don't show a wrong 0 (the owner's case:
  // 36B wallet alone reads short for the 50B Moonbinder).
  const s = base();
  budget.seedWants(s);
  let f = budget.foresight(s, { wallet: 35982699984, pace: 0, gardenLoaded: false }, 0, 50 * D);
  ok(f.waitingFor === 'garden' && f.signal === 'wait', 'no garden yet: waiting for it');
  f = budget.foresight(s, { wallet: 35982699984, pace: 0, gardenLoaded: true, garden: { total: 270, ready: 121, readyValue: 410667500000, growingValue: 76591180000, growingPotential: 143951250000, harvestHours: null } }, 0, 50 * D);
  ok(f.waitingFor === null && f.signal === 'open' && Math.round(f.safeToSpend / 1e9) === 383, 'with the garden (his sample): open, ~383B safe (385B less a 2B Amber Egg now on the list)');
  console.log('budget (waiting for the garden): ok');
}

/* 16. The estimated value: an observed maturing rate, the cap, the best per-crop worth */
{
  const now = 200 * D;
  const s = base();
  // 12 h of readings: ready count climbing 100 → 124 (2 per hour), with a
  // harvest in the middle that drops it to 10 and climbs back (only the
  // increases count), and one 3-hour gap (left out).
  const w = [];
  let r = 100;
  for (let h = 12; h >= 0; h -= 0.5) {
    const t = now - h * H;
    if (h < 8 && h > 5) continue; // the gap
    w.push({ t, v: 500e9, r, rv: r * 3e9, n: 270 });
    r += 1;
  }
  w[10].r = 10; // a harvest...
  for (let i = 11; i < w.length; i += 1) w[i].r = w[i - 1].r + 1; // ...and it climbs again
  s.worthHistory = w;
  const m = budget.maturingRate(s, now);
  ok(m.hours === 9 && m.gained === 17 && Math.abs(m.perHour - 17 / 9) < 1e-9, 'observed: 17 crops matured in 9 h (the 3-hour gap left out; the harvest half-hour gains nothing, never negative)');
  const garden = { total: 270, ready: 121, readyValue: 410.7e9, growingValue: 76.6e9, growingPotential: 144e9, harvestHours: null };
  const e = budget.estimate(s, { garden }, null, now);
  ok(e.usable && e.rateSource === 'observed' && e.canMature === 149 && e.perCropSource === 'ready' && Math.abs(e.perCrop - 410.7e9 / 121) < 1, 'his garden: 149 can mature, ~3.39B each (ready average beats the 0.97B floor)');
  ok(Math.abs(e.hoursToFull - 149 / m.perHour) < 1e-6 && Math.abs(e.fullValue - (410.7e9 + 149 * 410.7e9 / 121)) < 1, 'full in ~75 h at ~2/h: ~916B');
  ok(Math.abs(e.perDay - m.perHour * 24 * 410.7e9 / 121) < 1, 'value per day as crops mature');
  // The cap: past full, the estimate stops growing from maturing; the pace takes over.
  s.budget = { plan: ['moonbinder'] };
  const f = budget.foresight(s, { wallet: 36e9, pace: 1e9, garden, gardenLoaded: true }, 0, now);
  const full = f.estimate.fullT;
  const cashAtFull = f.line.find((p) => Math.abs(p[0] - full) < 1e-9)[1];
  const last = f.line[f.line.length - 1];
  ok(Math.abs(cashAtFull - (36e9 + e.fullValue)) < 1e6, 'at full: wallet + everything the garden can hold');
  ok(Math.abs(last[1] - cashAtFull - 1e9 * (last[0] - full) + 50e9) < 1e6, 'after full: the pace (1B a day), not more maturing (the cap), minus the 50B Moonbinder bought on the way');
  // Too few readings: fall back (no timing known → not usable).
  const e2 = budget.estimate(base(), { garden }, null, now);
  ok(!e2.usable && e2.rate === null, 'no readings and no timing: not usable yet');
  // Everything ready: full now.
  const e3 = budget.estimate(base(), { garden: { total: 50, ready: 50, readyValue: 100e9, growingValue: 0, growingPotential: 0 } }, null, now);
  ok(e3.usable && e3.hoursToFull === 0 && e3.rateSource === 'full', 'everything ready: full now');
  console.log('budget (estimate): ok');
}

/* 17. Crop stage: from bare ground to harvest */
{
  // His sample: 270 crops; 267 grown, 260 full size, 267 with weather, 189 with a moon
  // mutation, 176 gold/rainbow, 121 ready. The bottleneck is the moon.
  const ctx = { readyRule: { size: true, color: true, hydro: true, lunar: true }, garden: { total: 270, ready: 121, have: { ripe: 267, size: 260, hydro: 267, lunar: 189, color: 176 }, harvestHours: null, stepHours: { ripe: 1, size: null, hydro: 0, lunar: 2.5, color: 77, nextLunar: { name: 'Amber Moon', startsAt: 'x' } } } };
  let c = budget.cropStage(ctx);
  ok(c.steps.length === 7 && c.steps.map((x) => x.id).join(',') === 'planted,ripe,size,hydro,lunar,color,ready', 'seven steps in the owner\'s order');
  ok(c.here === 'lunar' && c.index === 4, 'you are here: the moon (189/270 = 70%, the first under 90%)');
  ok(c.steps[2].done && c.steps[3].done && !c.steps[5].done, 'full size and weather done (≥ 90%), gold/rainbow not yet');
  ok(c.next.stepId === 'lunar' && c.next.left === 81 && c.next.hours === 2.5 && c.next.weather === 'Amber Moon', 'next: 81 crops need a moon mutation, Amber Moon in 2.5 h');
  // The rule skips the moon: then gold/rainbow is the bottleneck.
  c = budget.cropStage(Object.assign({}, ctx, { readyRule: { lunar: false } }));
  ok(c.here === 'color' && !c.steps[4].required, 'moon not required: gold/rainbow is where you are');
  // Barren, and all done.
  c = budget.cropStage({ garden: { total: 0 } });
  ok(c.index === 0 && c.steps[0].label === 'Barren' && /Plant/.test(c.next.text), 'barren garden');
  c = budget.cropStage({ garden: { total: 50, ready: 50, have: { ripe: 50, size: 50, hydro: 50, lunar: 50, color: 50 } } });
  ok(c.here === 'ready' && c.steps[6].done && c.next.text === 'Ready to harvest.', 'everything ready');
  console.log('budget (crop stage): ok');
}

/* 18. His garden before any readings: the pets' gold rate drives it; stuck crops left out */
{
  const now = 300 * D;
  const s = base();
  budget.seedWants(s);
  const garden = { total: 270, ready: 121, readyValue: 410.6675e9, growingValue: 76.59e9, growingPotential: 143.95e9,
    missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, have: { ripe: 267, size: 260, hydro: 267, lunar: 189, color: 176 },
    harvestHours: null, goldPerHour: 1.21, stepHours: { ripe: 1, size: null, hydro: 0, lunar: 2.5, color: 77.4 } };
  const ctx = { wallet: 36e9, garden, pace: 0, gardenLoaded: true, readyRule: { size: true, color: true, hydro: true, lunar: true } };
  const e = budget.estimate(s, ctx, budget.predictHarvest(s, ctx, now), now);
  ok(e.usable && e.rateSource === 'pets' && e.rate === 1.21, 'no readings yet: the pets\' own gold rate (1.21 crops/hour)');
  ok(e.stuck === 10 && e.stuckWhy === 'size' && e.canMature === 139, '10 crops short of full size with no size pet can\'t mature: 139 can');
  ok(Math.abs(e.perDay - 1.21 * 24 * 410.6675e9 / 121) < 1e6, 'value maturing ~98.6B a day: ' + (e.perDay / 1e9).toFixed(1));
  ok(Math.abs(e.hoursToFull - 139 / 1.21) < 1e-6 && Math.abs(e.fullValue - (410.6675e9 + 139 * 410.6675e9 / 121)) < 1e6, 'full in ~115 h at ~882B');
  const f = budget.foresight(s, ctx, 0, now);
  ok(f.mode === 'estimate' && f.line[f.line.length - 1][1] > f.line[0][1] + 300e9, 'the line rises (no longer flat): ' + (f.line[0][1] / 1e9).toFixed(0) + ' → ' + (f.line[f.line.length - 1][1] / 1e9).toFixed(0));
  // Once procs are being counted, they come first.
  s.garden = { hourly: { [Math.floor(now / H) - 1]: { g: 3, r: 0 }, [Math.floor(now / H)]: { g: 1, r: 1 } }, hourlySince: now - 2 * H };
  const e2 = budget.estimate(s, ctx, null, now);
  ok(e2.rateSource === 'procs' && Math.abs(e2.rate - 5 / 2) < 1e-9, 'procs counted over 2 h: 2.5 an hour, ahead of the pets\' figure');
  console.log('budget (his garden, before readings): ok');
}

/* 19. Buy everything: every alerted item and every decoration worth having */
{
  const s = base();
  budget.seedWants(s);
  const ev = budget.everything(s);
  const row = (id) => ev.rows.find((r) => r.id === id);
  ok(Math.abs(row('windturner').cost / (100e9 * 0.1114) - 1) < 0.005 && row('windturner').kind === 'decor', 'Wind Turner: 100B every ~9 days ≈ 11.1B a day');
  ok(Math.abs(row('minifairycastle').cost / (150e9 * 0.0868) - 1) < 0.005 && Math.abs(row('miniwizardtower').cost / (75e9 * 0.1814) - 1) < 0.005, 'the Castle ≈ 13B a day, the Tower ≈ 13.6B a day');
  ok(Math.abs(row('moonbinder').cost / (50e9 * 0.0777) - 1) < 0.005 && row('moonbinder').kind === 'item', 'wants are in it too (Moonbinder ≈ 3.9B a day)');
  ok(ev.rows.filter((r) => r.id === 'windturner').length === 1, 'the Wind Turner alert and the decor list count it once');
  ok(ev.unknown.some((u) => u.label === 'Stone Firepit' || u.label === 'Firepit') && ev.unknown.some((u) => u.label === 'Mini Fairy Keep'), 'decor without any count yet is listed as not known (Stone Firepit, Mini Fairy Keep)');
  ok(ev.perDay > 45e9 && ev.perDay < 60e9, 'everything with known rates ≈ ' + (ev.perDay / 1e9).toFixed(1) + 'B a day');
  // The app's own count fills in the Firepit, but only with a fair sample.
  const stats = s.shopStats;
  const fpItem = (stock, restocks, seen) => { stats.items.StoneFirepit = { name: 'Stone Firepit', type: 'Decor', shop: 'amber', price: 100e9, seen, restocks, stockSum: stock * seen, firstSeenAt: 1, lastSeenAt: 2 }; };
  fpItem(1, 1, 1);
  let fp = budget.everything(s).rows.find((r) => /firepit/i.test(r.label));
  ok(fp && fp.perDay === null, 'seen once in one opening: not enough to go on (would read as 198B a day)');
  fpItem(1, 40, 2);
  fp = budget.everything(s).rows.find((r) => /firepit/i.test(r.label));
  ok(fp && Math.abs(fp.perDay - 2 / (40 / 1.98)) < 1e-9 && fp.source === 'app', 'in stock 2 of 40 Amber openings: ~0.1 a day, ~9.9B a day for the Firepit');
  delete stats.items.StoneFirepit;
  // On the chart: his garden (≈ 98.6B a day maturing) can afford it all; a small one runs out.
  const H0 = 3600000;
  const garden = { total: 270, ready: 121, readyValue: 410.6675e9, growingValue: 76.59e9, growingPotential: 143.95e9, missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, harvestHours: null, goldPerHour: 1.21, stepHours: { size: null } };
  let f = budget.foresight(s, { wallet: 36e9, garden, pace: 0, gardenLoaded: true, readyRule: {} }, 0, 400 * D);
  ok(f.everything && f.everything.canAll === true && f.everything.runsOut === null && f.everything.line.length > 10, 'his garden: buying everything stays above zero');
  f = budget.foresight(s, { wallet: 20e9, pace: 1e9, gardenLoaded: true }, 0, 400 * D);
  ok(f.everything.canAll === false && f.everything.runsOut && f.everything.runsOut.t > 0 && f.everything.runsOut.t < 1, '20B and 1B a day: buying everything runs out within a day (~' + (f.everything.runsOut.t * 24).toFixed(1) + ' h)');
  console.log('budget (everything): ok');
}

/* 20. The buy-everything meter */
{
  const now = 500 * D;
  const s = base();
  budget.seedWants(s);
  const garden = { total: 270, ready: 121, readyValue: 410.6675e9, growingValue: 76.59e9, growingPotential: 143.95e9, missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, harvestHours: null, goldPerHour: 1.21, stepHours: { size: null } };
  const ctx = { wallet: 36e9, garden, pace: 0, gardenLoaded: true, readyRule: {} };
  let e = budget.view({ settings: s, ctx, now }).foresight.everything;
  ok(e.incomeFrom === 'maturing' && Math.abs(e.ratio - e.income / e.perDay) < 1e-9 && e.ratio > 1.8, 'no earnings yet: what\'s maturing a day (98.6B) against everything (51.1B): ' + Math.round(e.ratio * 100) + '%');
  s.budget.everythingBest = 2.5;
  s.budget.everythingCrossedAt = now - 3 * D;
  e = budget.view({ settings: s, ctx, now }).foresight.everything;
  ok(e.best === 2.5 && e.crossedAt === now - 3 * D, 'your best and when you crossed come from settings');
  console.log('budget (meter): ok');
}

/* 21. The past, for the chart: wallet + ready crops, and purchases worth marking */
{
  const now = 600 * D;
  const s = base();
  s.moneyHistory = [];
  s.worthHistory = [];
  for (let i = 0; i <= 7 * 48; i += 1) {
    const t = now - 7 * D + i * 30 * 60000;
    const harvested = i >= 3.5 * 48;
    s.moneyHistory.push({ t, c: harvested ? 130e9 : 30e9, s: 0, f: 0 });
    s.worthHistory.push({ t, v: 200e9, r: 10, rv: harvested ? (i - 3.5 * 48) * 1e9 : 100e9 + i * 1e9, n: 20 });
  }
  s.purchases = { log: [
    { t: now - 2 * D, id: 'MoonCelestial', name: 'Moonbinder', qty: 1, coins: 50e9, rules: ['moonbinder'] },
    { t: now - 1 * D, id: 'Carrot', name: 'Carrot Seed', qty: 1, coins: 5e6, rules: [] },
  ] };
  const h = budget.pastMoney(s, now);
  ok(h && h.line.length > 100 && h.line.length <= 170 && Math.abs(h.line[0][0] + 7) < 0.01 && h.line[h.line.length - 1][0] <= 0, 'a week of points, thinned, ending at now');
  ok(Math.abs(h.line[0][1] - 130e9) < 1e6, 'a week ago: 30B in the wallet + 100B ready = 130B');
  ok(h.buys.length === 1 && h.buys[0].ruleId === 'moonbinder' && Math.abs(h.buys[0].t + 2) < 1e-9, 'the Moonbinder is marked 2 days ago; a 5M seed isn\'t');
  ok(budget.pastMoney({ moneyHistory: [], worthHistory: [] }, now) === null, 'nothing recorded: no past line');
  const v = budget.view({ settings: s, ctx: { wallet: 130e9, pace: 0, gardenLoaded: true }, now });
  ok(v.foresight.history && v.foresight.history.line.length === h.line.length, 'the Money tab gets it with the forecast');
  console.log('budget (history): ok');
}

/* 22. The cache changes nothing but speed */
{
  const now = 700 * D;
  const s = base();
  budget.seedWants(s);
  for (let k = 0; k < 60; k += 1) s.shopStats.items['Item' + k] = { name: k % 3 ? 'Item ' + k : 'Mini Fairy Castle', type: k % 3 ? 'Seed' : 'Decor', shop: k % 2 ? 'decor' : 'thunder', price: 1e6 * (k + 1), seen: 3 + (k % 5), restocks: 40, stockSum: 4, firstSeenAt: now - 9 * D, lastSeenAt: now };
  const garden = { total: 270, ready: 121, readyValue: 410e9, growingValue: 76e9, growingPotential: 144e9, missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, harvestHours: null, goldPerHour: 1.21, stepHours: { size: null } };
  const ctx = { wallet: 36e9, garden, pace: 0, gardenLoaded: true, readyRule: {} };
  const alone = JSON.stringify(budget.everything(s));
  const inView = JSON.stringify(budget.view({ settings: s, ctx, now }).foresight.everything.rows);
  ok(JSON.stringify(JSON.parse(alone).rows.slice(0, 14)) === inView, 'the buy-everything rows are the same inside the view and on their own');
  const f1 = JSON.stringify(budget.foresight(s, ctx, 0, now));
  const f2 = JSON.stringify(budget.foresight(s, ctx, 0, now));
  const w = budget.whatIf(s, ctx, 5e9, now);
  ok(f1 === f2 && JSON.stringify(w.after.events.map((e) => e.ruleId)).length > 2, 'the forecast is the same called twice, and a what-if still works');
  ok(budget.view({ settings: s, ctx, now }).foresight.everything.perDay === JSON.parse(alone).perDay, 'and the same total');
  console.log('budget (cache): ok');
}
