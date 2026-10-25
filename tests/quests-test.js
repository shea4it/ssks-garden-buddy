'use strict';
// Daily quests (v0.65.0): the game's quest data in words, rewards, the
// reset, help for each kind, and the record of past days. The first quests
// are the owner's, from his 12 Oct 2026 sample.
const q = require('../quests');

let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  n += 1;
};

const DQ = {
  dayUTC: '2026-10-12', tier: 4,
  quests: [
    { instanceId: '2026-10-12:0', difficulty: 'easy', objective: { kind: 'buyEggs', target: 1, eggId: 'RareEgg' }, progress: 1, reward: { kind: 'dust', amount: 1000 }, completedAt: 1791772860136, claimedAt: 1791772869364, refreshed: false },
    { instanceId: '2026-10-12:1', difficulty: 'medium', objective: { kind: 'harvestCrops', target: 15, minRarity: 'Divine' }, progress: 12, reward: { kind: 'coins', amount: 500000000 }, completedAt: null, claimedAt: null, refreshed: false },
    { instanceId: '2026-10-12:2:refreshed', difficulty: 'hard', objective: { kind: 'hatchEggs', target: 10 }, progress: 0, reward: { kind: 'coins', amount: 1000000000 }, completedAt: null, claimedAt: null, refreshed: true },
  ],
  bonusReward: { kind: 'tools', toolId: 'AmberlitPotion', quantity: 3 },
  bonusClaimedAt: null,
};
const now = Date.parse('2026-10-12T04:00:00Z');

// The game's words.
const T = (o) => q.objectiveText(o);
ok(T(DQ.quests[0].objective) === 'Buy 1 Rare Egg', T(DQ.quests[0].objective));
ok(T(DQ.quests[1].objective) === 'Harvest 15 Divine or rarer crops', T(DQ.quests[1].objective));
ok(T(DQ.quests[2].objective) === 'Hatch 10 eggs', T(DQ.quests[2].objective));
ok(T({ kind: 'harvestCrops', target: 1 }) === 'Harvest 1 crop', 'one crop');
ok(T({ kind: 'harvestCrops', target: 3, speciesId: 'DragonFruit', minSize: 90 }) === 'Harvest 3 Dragon Fruit crops of size 90+', T({ kind: 'harvestCrops', target: 3, speciesId: 'DragonFruit', minSize: 90 }));
ok(T({ kind: 'harvestCrops', target: 4, minMutations: 2 }) === 'Harvest 4 crops with 2+ mutations', 'min mutations');
ok(T({ kind: 'harvestCrops', target: 2, mutationId: 'Ambershine' }) === 'Harvest 2 Amberlit crops', 'game mutation id shown in plain words');
ok(T({ kind: 'sellForCoins', target: 2500000000 }) === 'Earn 2.5B coins selling crops', T({ kind: 'sellForCoins', target: 2500000000 }));
ok(T({ kind: 'sellForDust', target: 5000 }) === 'Earn 5,000 Magic Dust selling pets', 'dust');
ok(T({ kind: 'buySeeds', target: 1, speciesId: 'Carrot' }) === 'Buy 1 Carrot seed', 'a seed');
ok(T({ kind: 'plantSeeds', target: 5, minRarity: 'Rare' }) === 'Plant 5 Rare or rarer seeds', 'rarer seeds');
ok(T({ kind: 'waterPlants', target: 1 }) === 'Water a plant once' && T({ kind: 'waterPlants', target: 6 }) === 'Water plants 6 times', 'water');
ok(T({ kind: 'feedPets', target: 3 }) === 'Hand-feed pets 3 times', 'feed');
ok(T({ kind: 'logJournal', target: 2, category: 'pets' }) === 'Log 2 new pet journal entries' && T({ kind: 'logJournal', target: 1 }) === 'Log 1 new journal entry', 'journal');
ok(T({ kind: 'mutateCrops', target: 5, mutationId: 'Wet' }) === 'Have 5 crops turn Wet' && T({ kind: 'mutateCrops', target: 1 }) === 'Have a crop gain a mutation', 'mutate');
ok(T({ kind: 'triggerPetAbilities', target: 20, abilityGroup: 'coinFinder' }) === 'Have your pets find coins 20 times', 'coin finder');
ok(T({ kind: 'placeCrystals', target: 2 }) === 'Plant or fuse 2 shards', 'shards');
ok(T({ kind: 'somethingNew', target: 3 }) === 'Something New (3)', 'a kind the app has not seen reads sensibly');

// Rewards and the reset.
ok(q.rewardText(DQ.bonusReward) === '🧪 3× Amberlit Potion', q.rewardText(DQ.bonusReward));
ok(q.rewardText({ kind: 'coins', amount: 500000000 }) === '💰 500M coins', 'coins reward');
ok(q.rewardText({ kind: 'dust', amount: 1000 }) === '✨ 1,000 Magic Dust', 'dust reward');
ok(q.nextReset(now) === Date.parse('2026-10-13T00:00:00Z'), 'next reset is the next 00:00 UTC');
ok(q.cropRarity('Ube') === 'Divine' && q.cropRarity('ThunderCelestial') === 'Celestial' && q.cropRarity('Carrot') === 'Common', 'crop rarities from game ids');

// The view, with help.
const plants = [
  { i: 0, sp: 'Ube', s: [['gold', 100, 1, 1], ['', 80, 0, 1]] },
  { i: 1, sp: 'Sunflower', s: [['wet', 100, 1, 1], ['', 100, 1, 1]] },
  { i: 2, sp: 'Carrot', s: [['', 100, 1, 1]] },
  { i: 3, sp: 'ThunderCelestial', s: [['thunderstruck', 100, 1, 1]] },
];
const eggs = [{ egg: 'LegendaryEgg', at: now - 1000 }, { egg: 'LegendaryEgg', at: now + 3600000 }, { egg: 'RareEgg', at: now - 5 }];
const v = q.view(DQ, { now, plants, eggs, clock: (ms) => new Date(ms).toISOString().slice(11, 16) });
ok(v.loaded && v.tier === 4 && !v.stale, 'loaded, tier 4, today');
ok(v.quests.map((x) => x.state).join() === 'claimed,open,open', `states ${v.quests.map((x) => x.state)}`);
ok(v.quests[1].pct === 80 && v.quests[1].reward === '💰 500M coins', 'progress and reward');
ok(v.quests[2].refreshed, 'the re-rolled quest says so');
ok(v.quests[1].help === '4 ripe ones in your garden: enough to finish.', `harvest help: ${v.quests[1].help}`);
ok(v.quests[2].help === '3 growing in your garden, 2 ready to hatch.', `egg help: ${v.quests[2].help}`);
ok(v.bonus.state === 'open' && v.bonus.remaining === 2 && v.toClaim === 0 && v.left === 2, 'bonus: 2 to go');
ok(v.quests[0].help === '', 'no help on a quest that is done');

// With a harvest rule (Gold or Rainbow): what it lets through.
const vr = q.view(DQ, { now, plants, eggs, readyRule: { on: true, color: 'goldOrRainbow' } });
ok(vr.quests[1].help === '4 ripe in your garden, 1 of them ready by your harvest rule.', `harvest help with a rule: ${vr.quests[1].help}`);
const vr2 = q.view(DQ, { now, plants, eggs, readyRule: { on: true, color: 'any' } });
ok(vr2.quests[1].help === '4 ripe ones in your garden: enough to finish.', 'a rule of "anything" reads as no rule');

// Ready to claim; the bonus ready; a day that's over.
const done = JSON.parse(JSON.stringify(DQ));
done.quests[1].completedAt = now;
done.quests[2].completedAt = now;
const v2 = q.view(done, { now });
ok(v2.quests[1].state === 'ready' && v2.bonus.state === 'ready' && v2.toClaim === 3, `ready to claim ${v2.toClaim}`);
const v3 = q.view(DQ, { now: now + 86400000 });
ok(v3.stale && v3.left === 0, 'yesterday\'s quests: stale');
ok(!q.view(null, { now }).loaded, 'no quest data: not loaded');

// Help: the shop, pets, coins.
const shops = { egg: { open: true, nextRestockAt: new Date(now + 600000).toISOString(), items: [{ itemId: 'RareEgg', name: 'Rare Egg', stock: 0 }, { itemId: 'LegendaryEgg', name: 'Legendary Egg', stock: 2 }] } };
const buy = (eggId) => q.helpFor({ objective: { kind: 'buyEggs', target: 1, eggId }, progress: 0 }, { now, shops, clock: (ms) => new Date(ms).toISOString().slice(11, 16) });
ok(buy('LegendaryEgg') === 'In the shop now (2 left).', buy('LegendaryEgg'));
ok(buy('RareEgg') === 'Sold out · the shop restocks at 04:10.', buy('RareEgg'));
const pets = [{ species: 'Pig', strength: 100, abilities: ['CoinFinderI'] }, { species: 'Bat', strength: 50, abilities: ['ThunderCoinFinder'] }];
const r = q.abilityRate(pets, 'coinFinder', 'clear');
ok(Math.abs(r.perMin - 0.35) < 1e-9 && r.who.join() === 'Pig', `coin finders on a clear day: ${r.perMin}`);
const rt = q.abilityRate(pets, 'coinFinder', 'thunder');
ok(Math.abs(rt.perMin - (0.35 + 0.35 * 0.5)) < 1e-9, `and in a thunderstorm the Bat too: ${rt.perMin}`);
const coinHelp = q.helpFor({ objective: { kind: 'triggerPetAbilities', target: 20, abilityGroup: 'coinFinder' }, progress: 6 }, { now, pets, weatherKind: 'clear' });
ok(/Pig\): about 40 min to go/.test(coinHelp), coinHelp);

// The record of past days.
const days = {};
ok(q.recordDay(days, DQ) && !q.recordDay(days, DQ), 'a day is recorded once, again only when it changes');
ok(days['2026-10-12'].quests[2].rerolled && days['2026-10-12'].bonus === '🧪 3× Amberlit Potion', 'what the day was');
days['2026-10-11'] = { quests: [], bonusClaimed: true };
days['2026-10-10'] = { quests: [], bonusClaimed: true };
days['2026-10-09'] = { quests: [], bonusClaimed: false };
const h = q.historySummary(days, '2026-10-12');
ok(h.streak === 2 && h.fullDays === 2, `streak ${h.streak}, full days ${h.fullDays}`);
for (let i = 0; i < 40; i += 1) q.recordDay(days, Object.assign({}, DQ, { dayUTC: `2026-11-${String(i + 1).padStart(2, '0')}` }));
ok(Object.keys(days).length === 30, `kept to 30 days (${Object.keys(days).length})`);

// The Haunt Quest (v0.66.0), his of 17 Oct 2026.
const SQ = { dayUTC: '2026-10-17', target: 8, progress: 3, reward: { kind: 'avatarCosmetic', cosmeticFilename: 'Mid_BlackCat.png', alternate: { kind: 'decor', decorId: 'HauntLamp', quantity: 1 } }, completedAt: null, claimedAt: null };
const hn = Date.parse('2026-10-17T03:00:00Z');
const clk = (ms) => new Date(ms).toISOString().slice(11, 16);
const ends = Date.parse('2026-11-10T00:00:00Z');
const rain = { kind: 'rain', name: 'Rain', startsAt: new Date(hn + 600000).toISOString(), endsAt: new Date(hn + 1200000).toISOString() };
let hv = q.hauntView(SQ, { now: hn, night: { known: true, next: hn + 3600000 }, weather: [rain], ends, clock: clk });
ok(hv.text === 'Snap 8 haunts with your Camera' && hv.progress === 3 && hv.pct === 38, `haunt quest: ${hv.text} ${hv.progress}/${hv.target}`);
ok(hv.reward === '👕 Black Cat outfit (or a Haunt Lamp if you have it)', hv.reward);
ok(hv.help === 'Haunts come out at night and in weather. Next chance: Rain at 03:10.', hv.help);
hv = q.hauntView(SQ, { now: hn, night: { on: true, endsAt: hn + 900000 }, ends, clock: clk });
ok(hv.help === "It's night: haunts are out now (until 03:15). Snap them with your Camera.", hv.help);
hv = q.hauntView(SQ, { now: hn + 650000, night: { known: true, next: hn + 3600000 }, weather: [rain], ends, clock: clk });
ok(/^Rain is on: haunts are out now/.test(hv.help), hv.help);
hv = q.hauntView(Object.assign({}, SQ, { progress: 8, completedAt: hn }), { now: hn, ends });
ok(hv.state === 'ready' && hv.help === '', 'done: ready to claim');
ok(q.hauntView(SQ, { now: ends + 1, ends }) === null, 'after the event: nothing');
ok(q.hauntView(null, { now: hn, ends }).loaded === false, 'no haunt quest yet: not loaded');
console.log(`quests: ${n} checks passed`);
