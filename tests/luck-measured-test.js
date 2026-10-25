'use strict';
// Measured, not guessed (v0.72.0): a Bad Luck Protection counter has a
// count only once the app has seen its result happen. Before that it waits.
const assert = require('assert');
const luck = require('../luck');

let n = 0;
const ok = (c, m) => { assert(c, m); n += 1; };
const thr = (key) => {
  const [type, source, target] = key.split(':');
  return luck.targets(type, source).find((t) => t.target === target).threshold;
};
const row = (l, key) => {
  const [type] = key.split(':');
  for (const g of luck.view(l).groups[type]) for (const r of g.rows) if (r.key === key) return r;
  return null;
};
const hatch = (l, species, mutations = []) => luck.onEgg(l, { eggId: 'ThunderEgg', species, mutations, at: Date.now() });

// 1. A fresh account: every counter waits, however many hatches go by.
const l = luck.migrate({});
for (let i = 0; i < 30; i += 1) hatch(l, 'Bee');
const wolf = row(l, 'egg:ThunderEgg:ThunderWolf');
ok(wolf && wolf.known === false && wolf.value === null && wolf.left === null && !wolf.primed, 'Thunder Wolf waits before the first one');
ok(row(l, 'egg:ThunderEgg:gold').known === false, "the Thunder Egg's Gold waits before the first one");
ok(luck.hatchWatch(luck.view(l), []).rows.length === 0, 'nothing waiting shows in the hatch countdown');
ok(luck.newlyPrimed(l).length === 0, 'nothing waiting is announced');

// 2. The first one: the count starts at zero, and the event says so.
const ev = hatch(l, 'ThunderWolf');
const first = ev.find((e) => e.target === 'ThunderWolf');
ok(first && first.first === true && first.after === null && first.forced === false, 'first Thunder Wolf: no "after N" claimed');
ok(row(l, 'egg:ThunderEgg:ThunderWolf').known && row(l, 'egg:ThunderEgg:ThunderWolf').value === 0, 'then it counts from zero');
for (let i = 0; i < 4; i += 1) hatch(l, 'Bee');
const w2 = row(l, 'egg:ThunderEgg:ThunderWolf');
ok(w2.value === 4 && w2.left === thr(w2.key) - 4, 'misses count after the first one');
const ev2 = hatch(l, 'ThunderWolf').find((e) => e.target === 'ThunderWolf');
ok(ev2.after === 5 && ev2.first === false, 'the second one says after 5 pulls');

// 3. A miss past the guarantee means hatches went unseen: back to waiting.
const k = 'egg:ThunderEgg:ThunderWolf';
luck.set(l, k, thr(k) - 1);
ok(row(l, k).primed, 'primed at the guarantee');
hatch(l, 'Bee');
const w3 = row(l, k);
ok(w3.known === false && w3.lost === 1, 'missed guarantee: waits again, not counting past it');

// 4. Old saves: counters never seen reset were guesses, so they wait;
// counters that have reset keep their count.
const old = luck.migrate({
  counters: {
    'pet:AnyEgg:gold': { v: 200, pulls: 180, hits: 0 },
    'egg:ThunderEgg:ThunderWolf': { v: 39, pulls: 39, hits: 0, est: true },
    'egg:UncommonEgg:Dragonfly': { v: 27, pulls: 300, hits: 2 },
  },
});
ok(old.version === 3 && old.startHalf === false, 'migrated, no halfway start');
ok(!old.counters['pet:AnyEgg:gold'] && old.retired['pet:AnyEgg:gold'], 'the one-count-for-every-egg Gold is retired (v0.74.0)');
ok(old.allHatches === 180, 'all hatches carried over from it: ' + old.allHatches);
ok(row(old, 'egg:ThunderEgg:ThunderWolf').known === false && !('est' in old.counters['egg:ThunderEgg:ThunderWolf']), 'the halfway Thunder Wolf guess waits');
ok(row(old, 'egg:UncommonEgg:Dragonfly').known && row(old, 'egg:UncommonEgg:Dragonfly').value === 27, 'Dragonfly (seen reset) keeps 27');
// Migrating again changes nothing.
luck.migrate(old);
ok(row(old, 'egg:UncommonEgg:Dragonfly').value === 27 && !old.counters['pet:AnyEgg:gold'] && luck.view(old).groups.pet.length === 0, 'second migrate is a no-op');

// 5. Capsules catch up in batches: waiting until a rare drops.
const c = luck.migrate({});
const stats = (opens, spores) => ({ DawnCapsule: { numOpens: opens, speciesPulled: spores ? { Dawnbreaker: spores } : {} } });
luck.onCapsuleStats(c, stats(100, 0));
luck.onCapsuleStats(c, stats(110, 0));
ok(row(c, 'capsule:DawnCapsule:Dawnbreaker').known === false, 'capsule waits before the first Dawnbreaker');
const capEv = luck.onCapsuleStats(c, stats(115, 1)).find((e) => e.target === 'Dawnbreaker');
ok(capEv && capEv.first && capEv.after === null, 'first Dawnbreaker: count starts now');
luck.onCapsuleStats(c, stats(118, 1));
ok(row(c, 'capsule:DawnCapsule:Dawnbreaker').value === 3, 'then counts opens');
// 6. Counts you typed are yours (v0.72.1): upgrading a save from before
// 0.72.0 keeps them. The owner's numbers from his 0.71.0 sample.
const owner = () => ({
  counters: {
    'pet:AnyEgg:rainbow': { v: 1227, est: false, pulls: 180, hits: 0 },
    'pet:AnyEgg:gold': { v: 200, est: false, pulls: 180, hits: 0 },
    'egg:MythicalEgg:Capybara': { v: 20, est: false, pulls: 15, hits: 0 },
    'egg:ThunderEgg:ThunderWolf': { v: 39, est: true, pulls: 19, hits: 0 },
    'egg:CommonEgg:Bee': { v: 12, est: false, pulls: 12, hits: 0 },
    'egg:UncommonEgg:Dragonfly': { v: 27, est: false, pulls: 86, hits: 6 },
  },
});
const up = luck.migrate(owner());
ok(up.retired['pet:AnyEgg:rainbow'].typed && up.retired['pet:AnyEgg:rainbow'].v === 1227, 'the typed every-egg Rainbow count is kept aside, retired (1227)');
ok(row(up, 'egg:CommonEgg:rainbow').known === false && row(up, 'egg:ThunderEgg:gold').known === false, "each egg's Gold and Rainbow wait");
ok(row(up, 'egg:MythicalEgg:Capybara').typed && row(up, 'egg:MythicalEgg:Capybara').value === 20, 'the typed Capybara count stays');
ok(!row(up, 'egg:ThunderEgg:ThunderWolf').known, 'the halfway Thunder Wolf guess waits');
ok(!row(up, 'egg:CommonEgg:Bee').known, 'a count the app started at zero waits');
ok(row(up, 'egg:UncommonEgg:Dragonfly').known && !row(up, 'egg:UncommonEgg:Dragonfly').typed, 'a measured count is measured, not typed');
ok(up.recovered && up.recovered.from === 'upgrade', 'nothing to bring back from a backup after an upgrade');
ok(luck.hatchWatch(luck.view(up), []).rows.every((r) => r.name !== 'Gold pet'), 'Gold not in the countdown');

// 7. Saves 0.72.0 already reset: recover() brings the typed counts back from
// a backup made before it, plus every pull counted since.
const reset = owner();
for (const c of Object.values(reset.counters)) { c.known = (c.hits || 0) > 0; if (!c.known) c.v = 0; delete c.est; }
reset.version = 2;
const now72 = luck.migrate(reset);
ok(!now72.recovered, '0.72.0 saves have not been checked yet');
now72.counters['egg:MythicalEgg:Capybara'].pulls += 3; // 3 Mythical Eggs since the backup
const back = luck.recover(now72, owner());
ok(back.length === 1 && back[0].key === 'egg:MythicalEgg:Capybara' && back[0].v === 23, 'the typed Capybara comes back at 20 + 3 (the retired every-egg counts are not brought back): ' + JSON.stringify(back));
ok(row(now72, 'egg:MythicalEgg:Capybara').typed && row(now72, 'egg:MythicalEgg:Capybara').value === 23, 'and counts as known');
ok(luck.recover(now72, { version: 2, counters: owner().counters }).length === 0, 'a backup from 0.72.0 or later is not used');
ok(luck.recover(now72, owner()).length === 0, 'recovering again changes nothing (Capybara is known now)');
// Too many pulls since: past the guarantee, so it stays waiting.
const late = luck.migrate(Object.assign(owner(), { version: 2 }));
for (const c of Object.values(late.counters)) { if (!(c.hits > 0)) { c.v = 0; c.known = false; } }
late.counters['egg:MythicalEgg:Capybara'].pulls += 30;
ok(luck.recover(late, owner()).length === 0 && !row(late, 'egg:MythicalEgg:Capybara').known, 'a count that would be past its guarantee stays waiting');

// 8. Typing: known and yours; cleared waits; a real hit makes it measured.
const t8 = luck.migrate({});
luck.set(t8, 'egg:ThunderEgg:ThunderWolf', 12);
ok(row(t8, 'egg:ThunderEgg:ThunderWolf').known && row(t8, 'egg:ThunderEgg:ThunderWolf').typed && row(t8, 'egg:ThunderEgg:ThunderWolf').value === 12, 'a typed count is known and yours');
hatch(t8, 'Bat');
ok(row(t8, 'egg:ThunderEgg:ThunderWolf').value === 13, 'and counts on');
luck.set(t8, 'egg:ThunderEgg:ThunderWolf', '');
ok(!row(t8, 'egg:ThunderEgg:ThunderWolf').known, 'cleared, it waits');
luck.set(t8, 'egg:ThunderEgg:ThunderWolf', 5);
hatch(t8, 'ThunderWolf');
ok(row(t8, 'egg:ThunderEgg:ThunderWolf').known && !row(t8, 'egg:ThunderEgg:ThunderWolf').typed, 'a real Thunder Wolf makes it measured');

// 9. Finding the last backup made before 0.72.0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const backup = require('../backup');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-bk-'));
const write = (name, luckData, age) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify({ kind: backup.KIND, savedAt: new Date(Date.now() - age * 86400000).toISOString(), settings: { luck: luckData } }));
  const t = (Date.now() - age * 86400000) / 1000;
  fs.utimesSync(f, t, t);
};
write('auto-2026-10-17.json', owner(), 1);
write('auto-2026-10-18.json', Object.assign(owner(), { version: 2 }), 0);
write('auto-2026-10-16.json', { counters: {} }, 2);
fs.writeFileSync(path.join(dir, 'notes.json'), '{}');
const pre = (st) => Boolean(st.luck && st.luck.counters && !(st.luck.version >= 2));
const found = backup.newestWhere(dir, pre);
ok(found && found.name === 'auto-2026-10-17.json' && found.settings.luck.counters['pet:AnyEgg:rainbow'].v === 1227, 'the newest backup from before 0.72.0: ' + (found && found.name));
ok(backup.newestWhere(path.join(dir, 'nope'), pre) === null, 'no backups folder: nothing');
fs.rmSync(dir, { recursive: true, force: true });

// 10. Gold and Rainbow pets per egg (v0.74.0, the game's help: "Nothing is
// account-wide"): a Common Egg's Gold says nothing about a Thunder Egg's.
const pe = luck.migrate({});
const egg = (eggId, species, mutations = []) => luck.onEgg(pe, { eggId, species, mutations, at: Date.now() });
egg('CommonEgg', 'Worm', ['Gold']);
for (let i = 0; i < 199; i += 1) egg('CommonEgg', 'Worm');
ok(row(pe, 'egg:CommonEgg:gold').known && row(pe, 'egg:CommonEgg:gold').primed, "199 Common Eggs after a Gold: the Common Egg's next is Gold");
ok(!row(pe, 'egg:ThunderEgg:gold').known, "the Thunder Egg's Gold isn't touched");
ok(luck.hatchWatch(luck.view(pe), []).rows.some((r) => r.key === 'egg:CommonEgg:gold' && r.eggName === 'Common Egg' && r.name === 'Gold pet'), 'the warning names the egg');
ok(luck.describePrimed({ type: 'egg', source: 'CommonEgg', target: 'gold' }) === 'Your next Common Egg is a guaranteed Gold pet', 'the heads-up names the egg');
egg('ThunderEgg', 'ThunderWolf');
ok(row(pe, 'egg:CommonEgg:gold').primed, 'a Thunder Egg in between leaves it due');
egg('CommonEgg', 'Snail', ['Gold']);
ok(row(pe, 'egg:CommonEgg:gold').value === 0, 'the forced Gold resets it');
ok(pe.allHatches === 202, 'every hatch counted for the hatch check: ' + pe.allHatches);

// 11. The rarer one wins; the other stays due (the game's help).
const cw = luck.migrate({});
luck.set(cw, 'egg:AmberEgg:FireHorse', thr('egg:AmberEgg:FireHorse') - 1);
luck.set(cw, 'egg:AmberEgg:gold', thr('egg:AmberEgg:gold') - 1);
luck.onEgg(cw, { eggId: 'AmberEgg', species: 'Phoenix', mutations: ['Rainbow'], at: Date.now() });
ok(row(cw, 'egg:AmberEgg:FireHorse').known && row(cw, 'egg:AmberEgg:FireHorse').value === thr('egg:AmberEgg:FireHorse'), 'Phoenix (rarer) came: Fire Horse stays due, still counting');
ok(row(cw, 'egg:AmberEgg:gold').known && row(cw, 'egg:AmberEgg:gold').primed, 'Rainbow (rarer) came: Gold stays due');
luck.onEgg(cw, { eggId: 'AmberEgg', species: 'Rooster', mutations: [], at: Date.now() });
ok(!row(cw, 'egg:AmberEgg:FireHorse').known && !row(cw, 'egg:AmberEgg:gold').known, 'a plain hatch while due: those pulls went unseen, so they wait again');
// Capsules: a Dawnbreaker Spore holds a due Ube Seed back.
const cc = luck.migrate({});
const cap = (opens, spores, ube) => ({ DawnCapsule: { numOpens: opens, speciesPulled: Object.assign({}, spores ? { Dawnbreaker: spores } : {}, ube ? { Ube: ube } : {}) } });
luck.onCapsuleStats(cc, cap(10, 0, 0));
luck.set(cc, 'capsule:DawnCapsule:Ube', thr('capsule:DawnCapsule:Ube') - 1);
luck.onCapsuleStats(cc, cap(11, 1, 0));
ok(row(cc, 'capsule:DawnCapsule:Ube').known && row(cc, 'capsule:DawnCapsule:Ube').value === thr('capsule:DawnCapsule:Ube'), 'Dawnbreaker came: the due Ube Seed waits, still counting');
luck.onCapsuleStats(cc, cap(12, 1, 1));
ok(row(cc, 'capsule:DawnCapsule:Ube').value === 0, 'then the Ube Seed comes');

console.log(`luck (measured): ${n} checks passed`);
