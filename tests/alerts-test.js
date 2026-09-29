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

// 6. v0.50: your own level for a built-in item alert reaches the watcher,
// custom items keep theirs, the old "alarm" level reads as Huge, and a
// removed (disabled) alert doesn't fire.
const lv = { alerts: { disabled: ['milkcap'], custom: [{ name: 'Lychee', tier: 'alarm' }, { name: 'Kiwi' }], levels: { thunderspire: 'basic', moonbinder: 'nonsense' }, quietHours: {} } };
const rules = alerts.publicRules(lv);
const R = (id) => rules.find((r) => r.id === id);
ok(R('thunderspire').tier === 'basic' && R('thunderspire').defaultTier === 'big', 'a built-in takes your level and remembers its own');
ok(R('moonbinder').tier === 'legendary', 'an unknown level is ignored');
ok(R('custom:lychee').tier === 'epic' && R('custom:kiwi').tier === 'named', 'custom: alarm reads as Huge; no level reads as Callout');
ok(R('starweaver').tier === 'epic' && R('starweaver').sound === 'klaxon' && R('mythicalegg').sound === 'egg', 'Starweaver keeps its klaxon; eggs their wobble');
ok(R('thunder').tier === 'weather' && !('levels' in R('thunder')), 'weather rules are untouched');
const w2 = alerts.createWatcher({ getSettings: () => lv, onAlerts: () => {}, onStatus: () => {}, fetchImpl: async () => ({ ok: false }) });
w2._state.firstPoll = false;
fired = w2._evaluate(storm(true, 1), T);
const ts = fired.find((f) => f.ruleId === 'thunderspire');
ok(ts && ts.tier === 'basic' && ts.sound === null, 'the fired alert carries your level');
ok(!fired.some((f) => f.ruleId === 'milkcap'), 'a removed alert stays quiet');
ok(alerts.levelOf('alarm', 'x') === 'epic' && alerts.levelOf('big', 'x') === 'big' && alerts.levelOf('zzz', 'named') === 'named', 'levelOf');

// 7. An item picked from the dropdown carries the game's id, so it still
// rings if the shop's display name changes.
const pick = { alerts: { disabled: [], custom: [{ name: 'Dawn Egg', tier: 'big', itemId: 'DawnEgg' }], levels: {}, quietHours: {} } };
const w3 = alerts.createWatcher({ getSettings: () => pick, onAlerts: () => {}, onStatus: () => {}, fetchImpl: async () => ({ ok: false }) });
w3._state.firstPoll = false;
const feed = { shops: { dawn: { open: true, restockId: 'd1', items: [{ itemId: 'DawnEgg', name: 'Egg of the Dawn', stock: 1, coinPrice: 5e8 }] } }, weather: { current: null, upcoming: [] } };
const f3 = w3._evaluate(feed, T);
ok(f3.some((f) => f.ruleId === 'custom:dawnegg' && f.tier === 'big'), 'picked item matched by its game id after a rename');
w3._state.last = feed;
ok(w3.listed().length === 1 && w3.listed()[0].shop === 'dawn' && w3.listed()[0].price === 5e8, 'listed(): every item a shop lists');
console.log(`alerts: ${n} checks passed`);
