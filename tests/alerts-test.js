'use strict';
const assert = require('assert');
const alerts = require('../alerts');
let n = 0; const ok = (c, m) => { assert(c, m); n += 1; };
const settings = { alerts: { disabled: [], custom: [], quietHours: null } };
const w = alerts.createWatcher({ getSettings: () => settings, onAlerts: () => {}, onStatus: () => {}, fetchImpl: async () => ({ ok: false }) });
w._state.firstPoll = false;
const T = Date.parse('2026-09-25T20:00:00Z');
const storm = (open, stock, extra) => ({ shops: {
  seed: { open: true, nextRestockAt: '2026-09-25T20:05:00Z', items: [{ itemId: 'Carrot', name: 'Carrot Seed', stock: 5 }] },
  thunder: Object.assign({ open, items: open ? [{ itemId: 'ThunderCelestial', name: 'Thunder Celestial Pod', itemType: 'Seed', stock, coinPrice: 3e9 }, { itemId: 'Milkcap', name: 'Milkcap Spore', stock: 1 }] : [] }, extra || {}),
}, weather: { current: null, upcoming: [] } });

// 1. The game's id matches even when the shop's name isn't "Thunderspire".
ok(alerts.nameMatches({ itemId: 'ThunderCelestial', name: 'Thunder Celestial Pod' }, 'thunderspire', ['ThunderCelestial']), 'matched by the game id');
ok(alerts.nameMatches({ itemId: 'x', name: 'Thunderspire Pod' }, 'thunderspire', ['ThunderCelestial']), 'still matched by name');
ok(!alerts.nameMatches({ itemId: 'ThunderCelestialShroomPlant', name: 'Storm Shroom' }, 'thunderspire', ['ThunderCelestial']), 'a different id is not matched by the id list');

// 2. First storm: fires once, not again on the next poll of the same opening.
let fired = w._evaluate(storm(true, 1), T);
ok(fired.some((f) => f.ruleId === 'thunderspire') && fired.some((f) => f.ruleId === 'milkcap'), 'first storm: Thunderspire and Milkcap fire');
fired = w._evaluate(storm(true, 1), T + 45000);
ok(!fired.some((f) => f.ruleId === 'thunderspire'), 'same opening again: quiet');
// 3. Storm ends; the next storm's Thunderspire fires again (this was the bug).
w._evaluate(storm(false, 0), T + 600000);
fired = w._evaluate(storm(true, 1), T + 4 * 3600000);
ok(fired.some((f) => f.ruleId === 'thunderspire'), 'a later storm: fires again');
// 4. A feed that gives a restock id is keyed by it.
fired = w._evaluate(storm(true, 1, { restockId: 'thunder:2' }), T + 8 * 3600000);
ok(fired.some((f) => f.ruleId === 'thunderspire') && w._state.recentFired.slice(-1)[0].key.includes('restockId=thunder:2'), 'restockId keys it');
// 5. Diagnostics name what's in stock and which rule it hit (the feed is what loop() last fetched).
w._state.last = storm(true, 1, { restockId: 'thunder:2' });
const d = w.diagnostics();
ok(d.shops.thunder && d.shops.thunder.inStock.find((i) => i.itemId === 'ThunderCelestial').rule === 'thunderspire' && d.recentFired.length >= 3, 'diagnostics: in-stock items with their rule');
console.log(`alerts: ${n} checks passed`);
