// Times the Money calculations with a heavy, realistic history (a month of
// readings, 400 shop items, 800 purchases). Run: node tests/bench-budget.js
// A heavy but realistic settings file: a month of half-hourly readings,
// ~400 shop items seen, 800 purchases; time budget.view and its parts.
const budget = require('../budget');
const D = 86400000; const H = 3600000; const now = Date.now();
const s = { alerts: { custom: [], disabled: [] }, shopStats: budget.emptyStats(), moneyHistory: [], worthHistory: [], purchases: { v: budget.PURCHASES_VERSION, log: [] }, budget: {}, garden: { hourly: {}, hourlySince: now - 14 * D } };
budget.seedWants(s);
for (let i = 0; i < 30 * 48; i += 1) {
  const t = now - 30 * D + i * 30 * 60000;
  s.moneyHistory.push({ t, c: 30e9 + i * 1e8, s: i * 2e8, f: i * 1e6 });
  s.worthHistory.push({ t, v: 400e9 + (i % 48) * 1e9, r: 100 + (i % 48), rv: (100 + (i % 48)) * 3.4e9, n: 270 });
}
const shops = ['seed', 'egg', 'tool', 'decor', 'thunder', 'amber', 'rain', 'snow', 'dawn'];
for (let k = 0; k < 400; k += 1) {
  s.shopStats.items['Item' + k] = { name: 'Item ' + k, type: k % 5 ? 'Seed' : 'Decor', shop: shops[k % shops.length], price: 1e6 * (k + 1), seen: 20 + k % 50, restocks: 400, stockSum: 30, firstSeenAt: now - 20 * D, lastSeenAt: now };
}
for (let k = 0; k < 800; k += 1) s.purchases.log.push({ t: now - (k / 800) * 30 * D, id: 'Item' + (k % 400), name: 'Item ' + (k % 400), qty: 1, coins: 1e7 * (k % 30), cat: 'seeds', rules: [] });
for (let h = 0; h < 14 * 24; h += 1) s.garden.hourly[Math.floor(now / H) - h] = { g: h % 4, r: h % 7 === 0 ? 1 : 0, w: 1 };
const garden = { total: 270, ready: 121, readyValue: 410e9, growingValue: 76e9, growingPotential: 144e9, missing: { grow: 3, size: 10, color: 94, hydro: 3, lunar: 81 }, have: {}, harvestHours: null, goldPerHour: 1.21, stepHours: { size: null, color: 77 } };
const ctx = { wallet: 36e9, gardenWorth: 487e9, garden, pace: 0, gardenLoaded: true, readyRule: { size: true, color: true, hydro: true, lunar: true } };
const time = (name, fn, n = 20) => { fn(); const t0 = process.hrtime.bigint(); for (let i = 0; i < n; i += 1) fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n; console.log(name.padEnd(22), ms.toFixed(2), 'ms'); return ms; };
time('view (all of it)', () => budget.view({ settings: s, ctx, now }));
time('foresight', () => budget.foresight(s, ctx, 0, now));
time('everything', () => budget.everything(s));
time('pastMoney', () => budget.pastMoney(s, now));
time('whatIf', () => budget.whatIf(s, ctx, 5e9, now));
time('flows (7d)', () => budget.flows(s.moneyHistory, 7, now));
time('patterns', () => budget.patterns(s));
time('growth week', () => budget.growth(s, ctx, 7, now));
time('engine', () => budget.engine(s, now));
time('predictHarvest', () => budget.predictHarvest(s, ctx, now));
time('maturingRate', () => budget.maturingRate(s, now));
time('afford', () => budget.afford(s, budget.flows(s.moneyHistory, 7, now)));
