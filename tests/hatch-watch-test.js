'use strict';
// The hatch countdown and egg locks (v0.69.0): what's within 5 hatches of a
// guarantee, closest first, and which eggs are locked.
const assert = require('assert');
const luck = require('../luck');

let n = 0;
const ok = (c, m) => { assert(c, m); n += 1; };

const l = luck.migrate({});
const thr = (key) => {
  const [type, source, target] = key.split(':');
  return luck.targets(type, source).find((t) => t.target === target).threshold;
};
// Thunder Wolf next; a Common Egg's Rainbow pet 3 away and Gold pet 5 away
// (v0.74.0: each egg's own); Fire Horse 40 away.
luck.set(l, 'egg:ThunderEgg:ThunderWolf', thr('egg:ThunderEgg:ThunderWolf') - 1);
luck.set(l, 'egg:CommonEgg:rainbow', thr('egg:CommonEgg:rainbow') - 3);
luck.set(l, 'egg:AmberEgg:FireHorse', thr('egg:AmberEgg:FireHorse') - 40);
luck.set(l, 'egg:CommonEgg:gold', thr('egg:CommonEgg:gold') - 5);
const v = luck.view(l);
const w = luck.hatchWatch(v, ['ThunderEgg']);
const names = w.rows.map((r) => r.name);
ok(names[0] === 'Thunder Wolf' && w.rows[0].primed && w.rows[0].left === 1, 'Thunder Wolf next, first: ' + names.join(', '));
ok(names.includes('Rainbow pet') && names.includes('Gold pet'), 'Rainbow (3) and Gold (5) are in');
ok(!names.includes('Fire Horse'), 'Fire Horse (40 away) is not');
ok(w.rows.find((r) => r.name === 'Rainbow pet').left === 3 && w.rows.find((r) => r.name === 'Gold pet').left === 5, 'how many to go');
ok(w.rows[0].locked === true && w.rows[0].egg === 'ThunderEgg' && w.rows[0].eggName === 'Thunder Egg', 'Thunder Egg flagged locked');
ok(w.rows.find((r) => r.name === 'Rainbow pet').eggName === 'Common Egg' && w.rows.find((r) => r.name === 'Rainbow pet').locked === false, 'Gold and Rainbow are on their egg (Common, not locked)');
ok(w.locks.join() === 'ThunderEgg', 'locks listed');
ok(luck.hatchWatch(v, [], 2).rows.map((r) => r.name).join() === 'Thunder Wolf', 'within 2: just the Thunder Wolf');
ok(luck.hatchWatch(v, ['thunderegg']).rows[0].locked, 'lock names match loosely');
console.log(`hatch watch: ${n} checks passed`);
