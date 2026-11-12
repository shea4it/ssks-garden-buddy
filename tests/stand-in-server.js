// A stand-in for magicgarden.gg: one page that opens a game socket, a Welcome
// with a tiny full state, then patches that bump numEggsHatched.
const https = require('https'); const fs = require('fs'); const { WebSocketServer } = require('ws');
const PAGE = `<!doctype html><html><head><title>Magic Garden (stand-in)</title></head><body><h1>stand-in</h1><script>
  const ws = new WebSocket('wss://magicgarden.gg/ws');
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'SocketOpened' })));
  let seq = 0; let executed = 0;
  ws.addEventListener('message', (ev) => { try { const m = JSON.parse(ev.data); if (m.type === 'Welcome') { seq = m.executedCommandSequence + 1; } if (m.executedCommandSequence != null) executed = m.executedCommandSequence; window.__seen = executed; } catch (e) {} });
  window.__gameSend = (cmd) => ws.send(JSON.stringify({ scopePath: ['Room','Quinoa'], type: 'QuinoaCommand', requestId: 'g' + seq, commandSequence: seq++, command: cmd }));
</script>
${Array.from({ length: 30 }, (_, i) => `<script src="/assets/chunk${String(i).padStart(2, '0')}-k3J9xQ2a.js"></script>`).join('')}
</body></html>`;
// The game's files (v0.66.0): 30 chunks, the last naming a data file that's
// only loaded when needed, the way the game's tables moved after the Haunt
// update. The reader has to go past 25 files and follow the name.
const CHUNK = (i) => `window.__chunks = (window.__chunks || 0) + 1;${i === 29 ? ' const later = () => import("./gamedata-Qm7Zp2Lx.js");' : ''}`;
const GAMEDATA = 'const P={Moth:{name:"Moth",maxScale:2,hoursToMature:96,maturitySellPrice:5e6},Snake:{name:"Snake",maxScale:2,hoursToMature:96},Toad:{name:"Toad",maxScale:2,hoursToMature:96},TestPetA:{name:"Test Pet A",maxScale:2,hoursToMature:12},TestPetB:{name:"Test Pet B",maxScale:2,hoursToMature:24}};'
  + 'const A={' + 'ABCDEFGHIJ'.split('').map((x) => `TestAbility${x}:{name:"Test Ability ${x}",trigger:"continuous",baseProbability:.3,baseParameters:{sizeIncrease:4}}`).join(',') + '};'
  + 'const E={SpookyEgg:{name:"Spooky Egg",secondsToHatch:43200,faunaSpawnWeights:{Moth:60,Snake:30,Toad:10}}};';
const state = { child: { data: { roomId: 'TEST', players: [{ id: 'me', name: 'Tester', isConnected: true }], weather: 'Sunny',
  userSlots: [{ userId: 'me', data: { userId: 'me', coinsCount: 2e9, magicDustCount: 0,
    activityLogs: [{ action: 'hatchEgg', timestamp: Date.now() - 60000, parameters: { eggId: 'CommonEgg', pet: { id: 'pet-1', petSpecies: 'Worm', mutations: [], abilities: [], targetScale: 1 } } }],
    stats: { player: { numEggsHatched: 40, totalEarningsSellCrops: 2.5e9, totalEarningsSellPet: 0.5e9, numDailyQuestsCompleted: 4, numDailyQuestsRefreshed: 1, numEasyDailyQuestsCompleted: 2, numMediumDailyQuestsCompleted: 1, numHardDailyQuestsCompleted: 1, totalCoinsFromDailyQuests: 1.5e9, totalDustFromDailyQuests: 2000, numSpookyQuestsCompleted: 2 }, petAbility: { GoldGranter: 500, RainbowGranter: 140 }, capsulePulls: {} },
    // Daily quests (v0.65.0), shaped like the live game's.
    dailyQuests: { dayUTC: new Date().toISOString().slice(0, 10), tier: 2, quests: [
      { instanceId: 'q0', difficulty: 'easy', objective: { kind: 'harvestCrops', target: 2, speciesId: 'Carrot' }, progress: 0, reward: { kind: 'dust', amount: 500 }, completedAt: null, claimedAt: null, refreshed: false },
      { instanceId: 'q1', difficulty: 'medium', objective: { kind: 'hatchEggs', target: 3 }, progress: 1, reward: { kind: 'coins', amount: 2e8 }, completedAt: null, claimedAt: null, refreshed: false },
      { instanceId: 'q2', difficulty: 'hard', objective: { kind: 'triggerPetAbilities', target: 30, abilityGroup: 'coinFinder' }, progress: 30, reward: { kind: 'coins', amount: 5e8 }, completedAt: Date.now() - 600000, claimedAt: null, refreshed: true },
    ], bonusReward: { kind: 'tools', toolId: 'GoldPotion', quantity: 1 }, bonusClaimedAt: null },
    // The Haunt Quest (v0.66.0), shaped like the live game's.
    spookyQuest: { dayUTC: new Date().toISOString().slice(0, 10), target: 8, progress: 3, reward: { kind: 'avatarCosmetic', cosmeticFilename: 'Mid_BlackCat.png', alternate: { kind: 'decor', decorId: 'HauntLamp', quantity: 1 } }, completedAt: null, claimedAt: null },
    journal: { produce: { Carrot: { variantsLogged: [{ variant: 'Normal', createdAt: 1 }, { variant: 'Gold', createdAt: 2 }] } }, pets: { Worm: { variantsLogged: [{ variant: 'Normal', createdAt: 1 }] } } },
    garden: { tileObjects: { 44: { objectType: 'Shard', shardId: 'HungerShard', id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e' }, 5: { objectType: 'Plant', species: 'Carrot', slots: [
      { species: 'Carrot', mutations: ['Gold', 'Wet', 'Dawnlit'], size: 100, endTime: Date.now() - 60000 },
      { species: 'Carrot', mutations: ['Gold'], size: 100, endTime: Date.now() - 60000 },
      { species: 'Pumpkin', mutations: [], size: 70, endTime: Date.now() + 3 * 3600000 },
    ] }, 27: { objectType: 'Egg', eggId: 'CommonEgg', plantedAt: Date.now() - 900000, maturedAt: Date.now() - 300000 } } },
    // Pots: Tulip, Eggplant, Apple. Crops: Carrot x12 (no pot: not pet food),
    // Eggplant x5 (pet food, not favourited), Apple x4 (pet food, favourited), Cactus x2.
    inventory: { items: [{ id: 'pot-1', itemType: 'Plant', species: 'Tulip', slots: [] }, { id: 'pot-4', itemType: 'Plant', species: 'Tulip', slots: [] }, { id: 'pot-5', itemType: 'Plant', species: 'Daffodil', slots: [] }, { id: 'seed-1', itemType: 'Seed', species: 'Carrot', quantity: 3 }, { id: 'seed-2', itemType: 'Seed', species: 'Tomato', quantity: 5 },
      { id: 'pot-2', itemType: 'Plant', species: 'Eggplant', slots: [] }, { id: 'pot-3', itemType: 'Plant', species: 'Apple', slots: [] },
      { id: 'crop-1', itemType: 'Produce', species: 'Carrot', quantity: 12 }, { id: 'crop-2', itemType: 'Produce', species: 'Cactus', quantity: 2 },
      { id: 'crop-3', itemType: 'Produce', species: 'Apple', quantity: 4 }, { id: 'crop-4', species: 'Eggplant', size: 50, mutations: [] }, { id: 'crop-5', species: 'Eggplant', size: 50, mutations: [] },
      { id: 'crop-6', itemType: 'Produce', species: 'Eggplant', quantity: 3 }],
      // A pet hutch, the game's way (v0.56.5): a storage keyed by decorId.
      storages: [{ decorId: 'PetHutch', capacitySlots: 30, items: [{ id: 'pet-3', itemType: 'Pet', petSpecies: 'Sheep', hunger: 400, mutations: [], abilities: [] }, { id: 'pet-4', itemType: 'Pet', petSpecies: 'Horse', hunger: 400, mutations: [], abilities: [] }] }], favoritedItemIds: ['Apple'] },
    petSlots: [{ id: 'pet-1', petSpecies: 'Worm', hunger: 400, mutations: [], abilities: [] }],
    petTeams: [
      { id: 'teamA', name: 'Farm team', members: [{ petId: 'pet-1', petSpecies: 'Worm' }] },
      { id: 'teamB', name: 'Dawn team', members: [{ petId: 'pet-2', petSpecies: 'Bunny' }] },
    ] },
    // What's in your hand, the way the game says it now (v0.54.5): by id.
    heldItem: { itemId: 'Carrot', decorRotation: 0 } }] } } };
state.child.data.userSlots[0].data.shopPurchases = { egg: { restockId: 'egg:1', startedAtMs: Date.now(), purchases: { CommonEgg: 1 } }, seed: { restockId: 'seed:1', startedAtMs: Date.now(), purchases: {} } };
// A late-game garden (v0.73.1, the freeze test): MG_BIG_GARDEN=1 fills the
// garden from tests/fixtures/big-garden.json (191 plants, 57 pets), and
// potting / replanting answer the game's way, with small patches.
// First-run walkthroughs (v0.78.0, tests/first-run.js): MG_FIXTURE=newplayer
// is a brand-new account (a few coins, three plants, no pets, nothing
// hatched); MG_FIXTURE=veteran is the big garden with a late-game wallet.
// Either way the harness's scripted patches after connecting are left out.
const FIXTURE = process.env.MG_FIXTURE || '';
const BIG = Boolean(process.env.MG_BIG_GARDEN) || FIXTURE === 'veteran';
if (FIXTURE === 'newplayer') {
  const d = state.child.data.userSlots[0].data;
  const plant = (sp, ripe, grow) => ({ objectType: 'plant', species: sp, plantedAt: Date.now() - 1800000, maturedAt: Date.now() - (ripe ? 60000 : -grow), slots: [{ species: sp, startTime: Date.now() - 1800000, endTime: ripe ? Date.now() - 60000 : Date.now() + grow, size: ripe ? 62 : 40, mutations: [], slotId: 0 }] });
  Object.assign(d, {
    coinsCount: 1850,
    magicDustCount: 0,
    activityLogs: [{ action: 'plantSeed', timestamp: Date.now() - 1800000, parameters: { species: 'Carrot' } }],
    stats: { player: { numEggsHatched: 0, totalEarningsSellCrops: 240, totalEarningsSellPet: 0, numDailyQuestsCompleted: 0, numDailyQuestsRefreshed: 0, numEasyDailyQuestsCompleted: 0, numMediumDailyQuestsCompleted: 0, numHardDailyQuestsCompleted: 0, totalCoinsFromDailyQuests: 0, totalDustFromDailyQuests: 0, numSpookyQuestsCompleted: 0 }, petAbility: {}, capsulePulls: {} },
    journal: { produce: { Carrot: { variantsLogged: [{ variant: 'Normal', createdAt: Date.now() - 1700000 }] } }, pets: {} },
    garden: { tileObjects: { 30: plant('Carrot', true), 31: plant('Carrot', false, 20 * 60000), 32: plant('Strawberry', false, 50 * 60000) } },
    inventory: { items: [{ id: 'seed-1', itemType: 'Seed', species: 'Carrot', quantity: 4 }, { id: 'crop-1', itemType: 'Produce', species: 'Carrot', size: 55, mutations: [] }], storages: [], favoritedItemIds: [] },
    petSlots: [],
    petTeams: [],
    shopPurchases: { seed: { restockId: 'seed:1', startedAtMs: Date.now(), purchases: { Carrot: 2 } } },
  });
  d.dailyQuests.quests = [
    { instanceId: 'q0', difficulty: 'easy', objective: { kind: 'harvestCrops', target: 5, speciesId: 'Carrot' }, progress: 1, reward: { kind: 'coins', amount: 500 }, completedAt: null, claimedAt: null, refreshed: false },
    { instanceId: 'q1', difficulty: 'easy', objective: { kind: 'hatchEggs', target: 1 }, progress: 0, reward: { kind: 'dust', amount: 100 }, completedAt: null, claimedAt: null, refreshed: false },
    { instanceId: 'q2', difficulty: 'medium', objective: { kind: 'harvestCrops', target: 10, speciesId: 'Strawberry' }, progress: 0, reward: { kind: 'coins', amount: 2000 }, completedAt: null, claimedAt: null, refreshed: false },
  ];
  d.spookyQuest = Object.assign({}, d.spookyQuest, { progress: 0 });
  state.child.data.userSlots[0].heldItem = null;
}
if (BIG) {
  const fx = JSON.parse(fs.readFileSync(__dirname + '/fixtures/big-garden.json', 'utf8'));
  const RAW = { gold: 'Gold', rainbow: 'Rainbow', wet: 'Wet', chilled: 'Chilled', frozen: 'Frozen', thunderstruck: 'Thunderstruck', thundercharged: 'Thundercharged', dawnlit: 'Dawnlit', dawnbound: 'Dawncharged', amberlit: 'Ambershine', amberbound: 'Ambercharged' };
  const d = state.child.data.userSlots[0].data;
  const tiles = {};
  for (const p of fx.plants) {
    const sp = p.sp || 'Carrot';
    tiles[p.i] = { objectType: 'plant', species: sp, plantedAt: Date.now() - 86400000, maturedAt: Date.now() - 3600000, slots: p.s.map((x, k) => ({ species: sp, startTime: Date.now() - 86400000, endTime: x[2] ? Date.now() - 60000 : Date.now() + 3600000, size: x[1], mutations: String(x[0] || '').split(',').filter(Boolean).map((m) => RAW[m] || m), slotId: k })) };
  }
  d.garden.tileObjects = tiles;
  const pet = (p) => ({ id: p.id, petSpecies: p.species, xp: p.xp, targetScale: p.targetScale, mutations: p.mutations || [], abilities: p.abilities || [], hunger: 40000, name: null });
  d.petSlots = fx.pets.filter((p) => p.where === 'out').map(pet);
  d.inventory.storages[0].items = fx.pets.filter((p) => p.where !== 'out').map((p) => Object.assign({ itemType: 'Pet' }, pet(p)));
  d.activityLogs = d.activityLogs.concat(Array.from({ length: 60 }, (x, k) => ({ action: 'harvest', timestamp: Date.now() - 600000 + k * 1000, parameters: { crops: [{ id: 'c' + k, species: 'Ube', itemType: 'Produce', size: 100, mutations: ['Gold', 'Thundercharged', 'Ambercharged'] }] } })));
  if (FIXTURE === 'veteran') {
    d.coinsCount = 36e9;
    d.stats.player.numEggsHatched = 3444;
    d.stats.player.totalEarningsSellCrops = 4.2e12;
    // Teams of real pets from the big garden.
    const ids = fx.pets.map((p) => p.id);
    d.petTeams = [
      { id: 'vt1', name: 'farm team', members: ids.slice(0, 3).map((id) => ({ petId: id })) },
      { id: 'vt2', name: 'sell team', members: ids.slice(3, 6).map((id) => ({ petId: id })) },
      { id: 'vt3', name: 'dawn team', members: ids.slice(6, 9).map((id) => ({ petId: id })) },
    ];
    state.child.data.players = [{ id: 'me', name: 'Tester', isConnected: true }].concat(['Ada', 'Bo', 'Cy', 'Di'].map((n) => ({ id: n, name: n, isConnected: true })));
  }
}
let pottedSeq = 0;
const srv = https.createServer({ key: fs.readFileSync(__dirname + '/key.pem'), cert: fs.readFileSync(__dirname + '/cert.pem') }, (req, res) => {
  // The community list's collect-state, for the room-sharing test: records the body.
  if (req.method === 'POST' && req.url.startsWith('/collect-state')) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { fs.appendFileSync((process.env.MG_TEST_DIR || __dirname) + '/server.log', JSON.stringify({ in: 'collect-state', body: JSON.parse(raw) }) + '\n'); } catch (e) { /* ignore */ }
      res.statusCode = 204; res.end();
    });
    return;
  }
  if (req.url.startsWith('/platform/v1/shops')) {
    // The seed shop "restocks" 4 s after every poll (so the watcher polls again
    // right away and counts a fresh restock each time); the Amber shop is open
    // the whole time with a Moonbinder in stock.
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ shops: {
      seed: { open: true, nextRestockAt: new Date(Date.now() + 4000).toISOString(), items: [
        { itemId: 'Carrot', name: 'Carrot Seed', itemType: 'Seed', stock: 10, coinPrice: 10 },
        { itemId: 'StarCelestial', name: 'Starweaver Pod', itemType: 'Seed', stock: 0, coinPrice: 1e9 },
      ] },
      egg: { open: true, nextRestockAt: new Date(Date.now() + 4000).toISOString(), items: [
        { itemId: 'LegendaryEgg', name: 'Legendary Egg', itemType: 'Egg', stock: 1, coinPrice: 100e6 },
        { itemId: 'CommonEgg', name: 'Common Egg', itemType: 'Egg', stock: 5, coinPrice: 50000 },
      ] },
      spooky: { open: true, items: [
        { itemId: 'SpookyEgg', name: 'Spooky Egg', itemType: 'Egg', stock: 1, coinPrice: 800e6 },
      ] },
      amber: { open: true, items: [
        { itemId: 'MoonCelestial', name: 'Moonbinder Pod', itemType: 'Seed', stock: 1, coinPrice: 50e9 },
        { itemId: 'StoneFirepit', name: 'Stone Firepit', itemType: 'Decor', stock: 0, coinPrice: 100e9 },
        { itemId: 'MarblePedestal', name: 'Marble Pedestal', itemType: 'Decor', stock: 1, coinPrice: 2e9 },
      ] },
    }, weather: { current: null, upcoming: [
      { weatherId: 'AmberMoon', name: 'Amber Moon', startsAt: new Date(Date.now() + 2 * 3600000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600000 + 600000).toISOString() },
    ] } }));
  }
  if (req.url.startsWith('/assets/')) {
    res.setHeader('content-type', 'text/javascript');
    const mc = /chunk(\d+)-/.exec(req.url);
    if (mc) return res.end(CHUNK(Number(mc[1])));
    if (req.url.startsWith('/assets/gamedata-')) return res.end(GAMEDATA);
    res.statusCode = 404;
    return res.end('');
  }
  if (req.url.startsWith('/api/rooms/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ numPlayers: 1 })); }
  if (req.url.startsWith('/releases')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ tag_name: 'v0.1.0', assets: [] })); }
  res.setHeader('content-type', 'text/html'); res.end(PAGE);
});
const wss = new WebSocketServer({ server: srv });
let serverSeq = 0;
let hatchSeq = 0;
wss.on('connection', (ws) => {
  const log = (m) => fs.appendFileSync((process.env.MG_TEST_DIR || __dirname) + '/server.log', JSON.stringify(m) + '\n'); const _send = ws.send.bind(ws); ws.send = (d) => { if (ws.readyState === 1) _send(d); };
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    log({ in: m.type, seq: m.commandSequence, cmd: m.command && m.command.type, teamId: m.command && m.command.teamId, slot: m.command && m.command.slot, plantItemId: m.command && m.command.plantItemId });
    if (m.type === 'SocketOpened') {
      ws.send(JSON.stringify({ type: 'Welcome', selfPlayerId: 'me', executedCommandSequence: 10, fullState: state }));
      serverSeq = 10;
      // The big garden's background traffic, like a live room: pets' hunger
      // and XP every second (v0.73.1).
      if (BIG) {
        let tick = 0;
        const bg = setInterval(() => {
          if (ws.readyState !== 1) return clearInterval(bg);
          tick += 1;
          const d = state.child.data.userSlots[0].data;
          const patches = [];
          d.petSlots.forEach((p, k) => {
            p.hunger = Math.max(0, (p.hunger || 40000) - 3);
            p.xp = (p.xp || 0) + 1;
            patches.push({ op: 'replace', path: '/child/data/userSlots/0/data/petSlots/' + k + '/hunger', value: p.hunger }, { op: 'replace', path: '/child/data/userSlots/0/data/petSlots/' + k + '/xp', value: p.xp });
          });
          ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches } }));
          if (tick % 5 === 0) ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/currentTime', value: Date.now() }] } }));
        }, 1000);
      }
      // The harness's scripted patches (not for the first-run fixtures).
      if (!FIXTURE) {
      // 6 s later the game's own hatch total goes up by 2 with no log entries (dropped off the log).
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/stats/player/numEggsHatched', value: 42 }] } })), 6000);
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/coinsCount', value: 1.5e9 }] } })), 9000);
      // 8 s: a Legendary Egg bought in the egg shop's current restock (the game's own tally grows).
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/shopPurchases/egg/purchases', value: { CommonEgg: 1, LegendaryEgg: 1 } }] } })), 8000);
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/heldItem', value: { itemId: 'pot-1', decorRotation: 0 } }] } })), 21000);
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/heldItem', value: { itemId: 'Carrot', decorRotation: 0 } }] } })), 26000);
      }
    } else if (m.type === 'QuinoaCommand') {
      serverSeq = m.commandSequence;
      // The big garden's potting and replanting, as the live game patches
      // them (v0.73.1): the tile goes, the pot joins the bag, the activity
      // log gets an entry; and back.
      const U = '/child/data/userSlots/0';
      if (BIG && m.command.type === 'SetSelectedItem') {
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: true }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: U + '/heldItem/itemId', value: m.command.itemId || null }] } }));
        return;
      }
      if (BIG && (m.command.type === 'PotPlant' || m.command.type === 'PlantGardenPlant')) {
        const d = state.child.data.userSlots[0].data;
        const tiles = d.garden.tileObjects;
        const k = String(m.command.slot);
        const patches = [];
        let ok = false;
        const logEntry = (action, plant) => {
          d.activityLogs.push({ action, timestamp: Date.now(), parameters: { plant } });
          patches.push({ op: 'add', path: U + '/data/activityLogs/' + (d.activityLogs.length - 1), value: d.activityLogs[d.activityLogs.length - 1] });
          if (d.activityLogs.length > 100) {
            d.activityLogs.shift();
            patches.push({ op: 'remove', path: U + '/data/activityLogs/0' });
          }
        };
        if (m.command.type === 'PotPlant' && tiles[k] && tiles[k].objectType === 'plant') {
          const item = Object.assign({ id: m.command.plantItemId || 'potted-' + (pottedSeq += 1), itemType: 'Plant' }, tiles[k]);
          delete item.objectType;
          delete tiles[k];
          d.inventory.items.push(item);
          patches.push({ op: 'remove', path: U + '/data/garden/tileObjects/' + k }, { op: 'add', path: U + '/data/inventory/items/' + (d.inventory.items.length - 1), value: item });
          logEntry('potPlant', item);
          ok = true;
        } else if (m.command.type === 'PlantGardenPlant' && !tiles[k]) {
          const j = d.inventory.items.findIndex((it) => it && it.itemType === 'Plant' && it.id === m.command.itemId);
          if (j >= 0) {
            const item = d.inventory.items.splice(j, 1)[0];
            tiles[k] = Object.assign({ objectType: 'plant' }, item);
            delete tiles[k].id;
            delete tiles[k].itemType;
            patches.push({ op: 'remove', path: U + '/data/inventory/items/' + j }, { op: 'add', path: U + '/data/garden/tileObjects/' + k, value: tiles[k] });
            logEntry('plantGardenPlant', tiles[k]);
            ok = true;
          }
        }
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok }));
        if (ok) ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches } }));
        return;
      }
      // Swapping teams: the pets out become that team's members.
      if (m.command.type === 'ApplyPetTeam') {
        const d = state.child.data.userSlots[0].data;
        const team = d.petTeams.find((t) => t.id === m.command.teamId);
        if (team) {
          // As the game does (v0.72.2): the team's pets come out of the hutch
          // and the ones that were out go into it.
          const hutch = (d.inventory.storages || []).find((x) => x.decorId === 'PetHutch');
          const ids = team.members.map((x) => x.petId);
          const goingIn = d.petSlots.filter((p) => !ids.includes(p.id));
          d.petSlots = team.members.map((x) => {
            const inHutch = hutch ? hutch.items.find((p) => p.id === x.petId) : null;
            const was = d.petSlots.find((p) => p.id === x.petId);
            const pet = Object.assign({ hunger: 400, mutations: [], abilities: [] }, inHutch || was || {}, { id: x.petId, petSpecies: x.petSpecies });
            delete pet.itemType;
            return pet;
          });
          if (hutch) hutch.items = hutch.items.filter((p) => !ids.includes(p.id)).concat(goingIn.map((p) => Object.assign({ itemType: 'Pet' }, p)));
        }
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: Boolean(team) }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/petSlots', value: d.petSlots }, { op: 'replace', path: '/child/data/userSlots/0/data/inventory/storages', value: d.inventory.storages }] } }));
        return;
      }
      // Planting a potted plant (v0.57.0). The real game's command for this
      // hasn't been seen yet; this stand-in name and shape test that the app
      // learns whatever the game uses from a hand-planted pot.
      if (m.command.type === 'PlantGardenPlant') {
        const d = state.child.data.userSlots[0].data;
        const tiles = d.garden.tileObjects;
        const k = String(m.command.slot);
        const pot = d.inventory.items.find((it) => it && it.itemType === 'Plant' && it.id === m.command.itemId);
        const ok = Boolean(pot) && !tiles[k] && Number(k) >= 0 && Number(k) < 200;
        if (ok) {
          tiles[k] = { objectType: 'plant', species: pot.species, slots: [{ species: pot.species, mutations: [], size: 60, endTime: Date.now() - 1000 }] };
          d.inventory.items = d.inventory.items.filter((it) => it !== pot);
        }
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok }));
        if (ok) ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/garden/tileObjects', value: tiles }, { op: 'replace', path: '/child/data/userSlots/0/data/inventory/items', value: d.inventory.items }] } }));
        return;
      }
      // Planting a seed (v0.56.15), as the game does: into an open spot, one
      // seed fewer in the bag; refused if the spot is taken or no seed is left.
      if (m.command.type === 'PlantSeed') {
        const slot = state.child.data.userSlots[0];
        const d = slot.data;
        const tiles = d.garden.tileObjects;
        const k = String(m.command.slot);
        const seed = d.inventory.items.find((it) => it && it.itemType === 'Seed' && it.species === m.command.species && it.quantity > 0);
        const ok = Boolean(seed) && !tiles[k] && Number(k) >= 0 && Number(k) < 200;
        if (ok) {
          tiles[k] = { objectType: 'plant', species: seed.species, slots: [{ species: seed.species, mutations: [], size: 50, endTime: Date.now() + 600000 }] };
          seed.quantity -= 1;
          if (seed.quantity <= 0) d.inventory.items = d.inventory.items.filter((it) => it !== seed);
        }
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok }));
        if (ok) ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/garden/tileObjects', value: tiles }, { op: 'replace', path: '/child/data/userSlots/0/data/inventory/items', value: d.inventory.items }] } }));
        return;
      }
      // Swapping a pet with one in the hutch (v0.56.5), as the game does:
      // the pet in that slot goes into the hutch, the hutch pet comes out.
      if (m.command.type === 'SwapPetFromStorage') {
        const d = state.child.data.userSlots[0].data;
        const store = (d.inventory.storages || []).find((x) => x.decorId === m.command.storageId);
        const k = d.petSlots.findIndex((p) => p.id === m.command.petSlotId);
        const j = store ? store.items.findIndex((p) => p.id === m.command.storagePetId) : -1;
        const ok = k >= 0 && j >= 0;
        if (ok) {
          const goingIn = d.petSlots[k];
          d.petSlots[k] = Object.assign({}, store.items[j]);
          store.items[j] = Object.assign({ itemType: 'Pet' }, goingIn);
        }
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/petSlots', value: d.petSlots }, { op: 'replace', path: '/child/data/userSlots/0/data/inventory/storages', value: d.inventory.storages }] } }));
        return;
      }
      // Test hook (v0.57.6): move this player. The game sends movement as
      // QuinoaMovementBatch; this stand-in's layout (segments with the player
      // id and a path of points) is a guess the app's reader must cope with.
      if (m.command.type === '__movePlayer') {
        ws.send(JSON.stringify({ type: 'QuinoaMovementBatch', segments: [{ playerId: 'me', seq: Date.now(), path: [{ x: m.command.x - 1, y: m.command.y, t: Date.now() - 300 }, { x: m.command.x, y: m.command.y, t: Date.now() }] }, { playerId: 'someone-else', path: [{ x: 99, y: 99 }] }], activities: [], removedPlayers: [] }));
        return;
      }
      // Renaming a pet (v0.75.0). The live game's command isn't known: this
      // stand-in's own { petItemId, name } is what the app has to learn from
      // the game sending it once. An empty or over-long name is refused.
      if (m.command.type === 'RenamePet') {
        const d = state.child.data.userSlots[0].data;
        const lists = [d.petSlots, d.inventory.items].concat((d.inventory.storages || []).map((x) => x.items));
        const name = typeof m.command.name === 'string' ? m.command.name.trim() : '';
        let pet = null;
        for (const l of lists) pet = pet || (l || []).find((p) => p && p.id === m.command.petItemId && p.petSpecies);
        const ok = Boolean(pet) && name.length > 0 && name.length <= 20;
        if (ok) pet.name = name;
        log({ renamed: m.command.petItemId, name, ok, seq: m.commandSequence });
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok, code: ok ? undefined : 'invalid_name' }));
        if (ok) ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/petSlots', value: d.petSlots }, { op: 'replace', path: '/child/data/userSlots/0/data/inventory', value: d.inventory }] } }));
        return;
      }
      // Test hook (v0.75.0): a hatch, as the game shows one: the pet joins
      // the bag with no name, the hatch total goes up and the log gets an
      // entry, all in one frame. double: a Double Hatch's extra pet too (in
      // the total, not in the log).
      if (m.command.type === '__TestHatch') {
        const d = state.child.data.userSlots[0].data;
        // (An ability each, so the app can rank them by Pet Power, v0.77.0.)
        const mk = (sp) => ({ id: 'hatched-' + (hatchSeq += 1), itemType: 'Pet', petSpecies: sp, name: null, hunger: 400, xp: 0, mutations: m.command.mutations || [], abilities: ['SellBoostI'], targetScale: 1 });
        const pet = mk(m.command.species || 'Turtle');
        if (m.command.name) pet.name = m.command.name;
        const pets = [pet].concat(m.command.double ? [mk(m.command.double)] : []);
        d.inventory.items = d.inventory.items.concat(pets);
        // (The 6 s patch above shows 42 without changing this state.)
        d.stats.player.numEggsHatched = Math.max(d.stats.player.numEggsHatched, 42) + pets.length;
        d.activityLogs = d.activityLogs.concat([{ action: 'hatchEgg', timestamp: Date.now(), parameters: { eggId: 'CommonEgg', pet } }]);
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: true }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [
          { op: 'replace', path: '/child/data/userSlots/0/data/inventory/items', value: d.inventory.items },
          { op: 'replace', path: '/child/data/userSlots/0/data/stats/player/numEggsHatched', value: d.stats.player.numEggsHatched },
          { op: 'replace', path: '/child/data/userSlots/0/data/activityLogs', value: d.activityLogs },
        ] } }));
        return;
      }
      // Test hook: add activity-log entries (e.g. a pet turning a crop Gold).
      if (m.command.type === '__TestLog') {
        const d = state.child.data.userSlots[0].data;
        d.activityLogs = d.activityLogs.concat(m.command.entries || []);
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: true }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/activityLogs', value: d.activityLogs }] } }));
        return;
      }
      // Test hook: set lifetime pet-ability counters (e.g. GoldGranter).
      if (m.command.type === '__TestStat') {
        const d = state.child.data.userSlots[0].data;
        Object.assign(d.stats.petAbility, m.command.values || {});
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: true }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/stats/petAbility', value: Object.assign({}, d.stats.petAbility) }] } }));
        return;
      }
      // Test hook: change the weather.
      if (m.command.type === '__TestWeather') {
        state.child.data.weather = m.command.weather;
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: true }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/weather', value: m.command.weather }] } }));
        return;
      }
      // The right-click lock: this stand-in only understands { species } (so
      // the app has to find the field name), and echoes the new locked list.
      // Sell All, as the real game did it (Sept 2026): every crop whose own id
      // isn't in the lock list is sold; a kind's name in the list keeps nothing.
      if (m.command.type === 'SellAllCrops') {
        const inv = state.child.data.userSlots[0].data.inventory;
        const locked = new Set(inv.favoritedItemIds);
        const isCrop = (it) => it && it.species && !Array.isArray(it.slots) && !/seed|tool|egg|decor|pet|plant/i.test(String(it.itemType || ''));
        inv.items = inv.items.filter((it) => !isCrop(it) || locked.has(String(it.id)));
        log({ afterSell: inv.items.filter(isCrop).map((it) => it.id + ':' + it.species) });
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: true }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/inventory/items', value: inv.items.slice() }] } }));
        return;
      }
      // The lock: the real game accepted itemId with any text and toggled that
      // text in the lock list. (A field it doesn't know is refused here.)
      if (m.command.type === 'ToggleLockItem') {
        const key = typeof m.command.itemId === 'string' ? m.command.itemId : null;
        if (!key) {
          ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: false, code: 'bad_command' }));
          ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [] } }));
          return;
        }
        const inv = state.child.data.userSlots[0].data.inventory;
        inv.favoritedItemIds = inv.favoritedItemIds.includes(key) ? inv.favoritedItemIds.filter((x) => x !== key) : inv.favoritedItemIds.concat([key]);
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: true }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/inventory/favoritedItemIds', value: inv.favoritedItemIds.slice() }] } }));
        return;
      }
      ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: true }));
      ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [] } }));
    }
  });
});
srv.listen(8443, '127.0.0.1', () => console.log('stand-in on 8443'));
