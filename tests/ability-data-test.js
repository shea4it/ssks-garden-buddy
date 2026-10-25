'use strict';
// Ability data (v0.67.3): granted mutations from the game's own catalog
// are named the way the app spells them, so a Rainbow Granter counts toward
// Rainbow (the team summary, Best pets for…) even when the catalog wraps the
// name in backticks.
const assert = require('assert');
const ad = require('../ability-data');

let n = 0;
const ok = (c, m) => { assert(c, m); n += 1; };

ok(ad.mutationName('`Rainbow`') === 'Rainbow' && ad.mutationName('gold') === 'Gold' && ad.mutationName('Ambershine') === 'Amberlit', 'mutation names cleaned');
ok(ad.goalOf({ grants: '`Rainbow`' }) === 'rainbow' && ad.goalOf({ grants: '`Gold`' }) === 'gold', 'backticked Gold/Rainbow go to their goals');
ok(ad.goalOf({ grants: '`Wet`' }) === 'grant:Wet' && ad.goalOf({ grants: 'Thunderstruck' }) === 'grant:Thunderstruck', 'weather granters keep their goal names');

// The live catalog as the game sends it.
ad.setLive({ abilities: {
  RainbowGranter: { name: 'Rainbow Granter', chance: 0.72, params: { grantedMutations: ['`Rainbow`'] } },
  GoldGranter: { name: 'Gold Granter', chance: 0.72, params: { grantedMutations: ['`Gold`'] } },
  RainGranter: { name: 'Rain Granter', chance: 10, params: { grantedMutations: ['`Wet`'] } },
} });
const sum = ad.summarise([
  { id: 'a', name: 'Pig', strength: 89, abilities: ['RainbowGranter', 'GoldGranter'] },
  { id: 'b', name: 'Duck', strength: 80, abilities: ['RainGranter'] },
], {});
const goals = sum.totals.map((t) => t.goal);
ok(goals.includes('rainbow') && goals.includes('gold'), 'the team summary has Rainbow and Gold: ' + goals.join(','));
ok(goals.includes('grant:Wet'), 'and the Wet granter: ' + goals.join(','));
const rb = sum.totals.find((t) => t.goal === 'rainbow');
ok(/turns Rainbow|Rainbow/.test(rb.text) && !/`/.test(rb.text) && rb.label === '🌈 Rainbow crops', 'reads "a crop turns Rainbow …": ' + rb.text);
ok(sum.rows.every((r) => !/`/.test(r.text) && !/`/.test(r.goal)), 'no backticks anywhere');
console.log(`ability data: ${n} checks passed`);
