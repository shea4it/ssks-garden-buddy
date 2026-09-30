'use strict';

// Tests for harvest-rule.js: harvest mode's rule (groups that must all
// match; any one in a group; an empty group means any).
const rule = require('../harvest-rule');

let n = 0;
function ok(cond, what) {
  n += 1;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
}

// The owner's example: Amberbound, Thundercharged, Gold or Rainbow, full size.
const mine = { on: true, color: 'goldOrRainbow', hydro: ['thundercharged'], lunar: ['amberbound'], size: true };

ok(rule.miss(['rainbow', 'thundercharged', 'amberbound'], 100, mine) === null, 'a full-size Rainbow Thundercharged Amberbound crop can be harvested');
ok(rule.miss(['gold', 'thundercharged', 'amberbound'], 100, mine) === null, 'Gold counts as well as Rainbow');
ok(rule.miss(['thundercharged', 'amberbound'], 100, mine) === 'not Gold or Rainbow', 'no Gold or Rainbow: kept, and it says why');
ok(rule.miss(['rainbow', 'frozen', 'amberbound'], 100, mine) === 'not Thundercharged', 'Frozen instead of Thundercharged: kept');
ok(rule.miss(['rainbow', 'thundercharged', 'amberlit'], 100, mine) === 'not Amberbound', 'Amberlit (not yet bound): kept');
ok(rule.miss(['rainbow', 'thundercharged', 'amberbound'], 97, mine) === 'not full size', 'not full size: kept');
ok(rule.miss(['rainbow', 'thundercharged', 'amberbound'], 99.9995, mine) === null, 'full size is the app\'s own test (99.999 and up)');

// Any one in a group will do; nothing picked means any.
const either = { on: true, hydro: ['frozen', 'thundercharged'], lunar: ['amberbound', 'dawnbound'] };
ok(rule.miss(['frozen', 'dawnbound'], 60, either) === null, 'Frozen and Dawnbound pass "Frozen or Thundercharged" and "Amberbound or Dawnbound"');
ok(rule.miss(['wet', 'dawnbound'], 60, either) === 'not Frozen or Thundercharged', 'Wet fails "Frozen or Thundercharged"');
ok(rule.miss([], 50, { on: true }) === null, 'an empty rule lets anything through');
ok(rule.miss(['gold'], 100, { color: 'rainbow' }) === 'not Rainbow', 'Rainbow only: Gold is kept');

// Tidying what's saved or sent.
const c = rule.clean({ on: true, color: 'purple', hydro: ['Thundercharged', 'lava', 'thundercharged'], lunar: ['amberbound'], size: 'yes' });
ok(c.on === true && c.color === 'any' && c.hydro.join() === 'thundercharged' && c.lunar.join() === 'amberbound' && c.size === false, 'clean: unknown colour -> any, unknown and repeated mutations dropped, size only when true');
ok(rule.clean(null).on === false, 'clean: nothing saved -> off');

// In words.
ok(rule.describe(mine) === 'Gold or Rainbow · Thundercharged · Amberbound · full size', `describe: ${rule.describe(mine)}`);
ok(rule.describe({}) === 'anything', 'describe: an empty rule is "anything"');

// What matches now, on the owner's garden (ripe crops only).
{
  const fx = require('./fixtures/garden-layout.json');
  const all = rule.count(fx.plants, { on: true });
  const got = rule.count(fx.plants, mine);
  ok(all.crops === all.ripe && all.crops > 0, 'an empty rule matches every ripe crop');
  ok(got.crops > 0 && got.crops < all.crops && got.value > 0 && got.plants > 0, `the owner's rule matches some of their crops (${got.crops} of ${all.ripe} on ${got.plants} plants)`);
  console.log(`  owner's garden: ${got.crops} of ${all.ripe} ripe crops on ${got.plants} plants match (${(got.value / 1e9).toFixed(1)}B)`);
}

console.log(`harvest-rule: ${n} checks passed`);
