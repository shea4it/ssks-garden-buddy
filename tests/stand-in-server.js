// A stand-in for magicgarden.gg: one page that opens a game socket, a Welcome
// with a tiny full state, then patches that bump numEggsHatched.
const https = require('https'); const fs = require('fs'); const { WebSocketServer } = require('ws');
const PAGE = `<!doctype html><html><head><title>Magic Garden (stand-in)</title></head><body><h1>stand-in</h1><script>
  const ws = new WebSocket('wss://magicgarden.gg/ws');
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'SocketOpened' })));
  let seq = 0; let executed = 0;
  ws.addEventListener('message', (ev) => { try { const m = JSON.parse(ev.data); if (m.type === 'Welcome') { seq = m.executedCommandSequence + 1; } if (m.executedCommandSequence != null) executed = m.executedCommandSequence; window.__seen = executed; } catch (e) {} });
  window.__gameSend = (cmd) => ws.send(JSON.stringify({ scopePath: ['Room','Quinoa'], type: 'QuinoaCommand', requestId: 'g' + seq, commandSequence: seq++, command: cmd }));
</script></body></html>`;
const state = { child: { data: { roomId: 'TEST', players: [{ id: 'me', name: 'Tester', isConnected: true }], weather: 'Sunny',
  userSlots: [{ userId: 'me', data: { userId: 'me', coinsCount: 2e9, magicDustCount: 0,
    activityLogs: [{ action: 'hatchEgg', timestamp: Date.now() - 60000, parameters: { eggId: 'CommonEgg', pet: { id: 'pet-1', petSpecies: 'Worm', mutations: [], abilities: [], targetScale: 1 } } }],
    stats: { player: { numEggsHatched: 40, totalEarningsSellCrops: 2.5e9, totalEarningsSellPet: 0.5e9 }, petAbility: { GoldGranter: 500, RainbowGranter: 140 }, capsulePulls: {} },
    garden: { tileObjects: { 5: { objectType: 'Plant', species: 'Carrot', slots: [
      { species: 'Carrot', mutations: ['Gold', 'Wet', 'Dawnlit'], size: 100, endTime: Date.now() - 60000 },
      { species: 'Carrot', mutations: ['Gold'], size: 100, endTime: Date.now() - 60000 },
      { species: 'Pumpkin', mutations: [], size: 70, endTime: Date.now() + 3 * 3600000 },
    ] }, 27: { objectType: 'Egg', eggId: 'CommonEgg' } } },
    // Pots: Tulip, Eggplant, Apple. Crops: Carrot x12 (no pot: not pet food),
    // Eggplant x5 (pet food, not favourited), Apple x4 (pet food, favourited), Cactus x2.
    inventory: { items: [{ id: 'pot-1', itemType: 'Plant', species: 'Tulip', slots: [] }, { id: 'seed-1', itemType: 'Seed', species: 'Carrot', quantity: 3 },
      { id: 'pot-2', itemType: 'Plant', species: 'Eggplant', slots: [] }, { id: 'pot-3', itemType: 'Plant', species: 'Apple', slots: [] },
      { id: 'crop-1', itemType: 'Produce', species: 'Carrot', quantity: 12 }, { id: 'crop-2', itemType: 'Produce', species: 'Cactus', quantity: 2 },
      { id: 'crop-3', itemType: 'Produce', species: 'Apple', quantity: 4 }, { id: 'crop-4', species: 'Eggplant', size: 50, mutations: [] }, { id: 'crop-5', species: 'Eggplant', size: 50, mutations: [] },
      { id: 'crop-6', itemType: 'Produce', species: 'Eggplant', quantity: 3 }],
      storages: [], favoritedItemIds: ['Apple'] },
    petSlots: [{ id: 'pet-1', petSpecies: 'Worm', hunger: 400, mutations: [], abilities: [] }],
    petTeams: [
      { id: 'teamA', name: 'Farm team', members: [{ petId: 'pet-1', petSpecies: 'Worm' }] },
      { id: 'teamB', name: 'Dawn team', members: [{ petId: 'pet-2', petSpecies: 'Bunny' }] },
    ] },
    notAuthoritative_selectedItemIndex: 1 }] } } };
state.child.data.userSlots[0].data.shopPurchases = { egg: { restockId: 'egg:1', startedAtMs: Date.now(), purchases: { CommonEgg: 1 } }, seed: { restockId: 'seed:1', startedAtMs: Date.now(), purchases: {} } };
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
      amber: { open: true, items: [
        { itemId: 'MoonCelestial', name: 'Moonbinder Pod', itemType: 'Seed', stock: 1, coinPrice: 50e9 },
        { itemId: 'StoneFirepit', name: 'Stone Firepit', itemType: 'Decor', stock: 0, coinPrice: 100e9 },
        { itemId: 'MarblePedestal', name: 'Marble Pedestal', itemType: 'Decor', stock: 1, coinPrice: 2e9 },
      ] },
    }, weather: { current: null, upcoming: [
      { weatherId: 'AmberMoon', name: 'Amber Moon', startsAt: new Date(Date.now() + 2 * 3600000).toISOString(), endsAt: new Date(Date.now() + 2 * 3600000 + 600000).toISOString() },
    ] } }));
  }
  if (req.url.startsWith('/api/rooms/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ numPlayers: 1 })); }
  if (req.url.startsWith('/releases')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ tag_name: 'v0.1.0', assets: [] })); }
  res.setHeader('content-type', 'text/html'); res.end(PAGE);
});
const wss = new WebSocketServer({ server: srv });
let serverSeq = 0;
wss.on('connection', (ws) => {
  const log = (m) => fs.appendFileSync((process.env.MG_TEST_DIR || __dirname) + '/server.log', JSON.stringify(m) + '\n'); const _send = ws.send.bind(ws); ws.send = (d) => { if (ws.readyState === 1) _send(d); };
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    log({ in: m.type, seq: m.commandSequence, cmd: m.command && m.command.type, teamId: m.command && m.command.teamId });
    if (m.type === 'SocketOpened') {
      ws.send(JSON.stringify({ type: 'Welcome', selfPlayerId: 'me', executedCommandSequence: 10, fullState: state }));
      serverSeq = 10;
      // 6 s later the game's own hatch total goes up by 2 with no log entries (dropped off the log).
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/stats/player/numEggsHatched', value: 42 }] } })), 6000);
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/coinsCount', value: 1.5e9 }] } })), 9000);
      // 8 s: a Legendary Egg bought in the egg shop's current restock (the game's own tally grows).
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/shopPurchases/egg/purchases', value: { CommonEgg: 1, LegendaryEgg: 1 } }] } })), 8000);
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/notAuthoritative_selectedItemIndex', value: 0 }] } })), 21000);
      setTimeout(() => ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/notAuthoritative_selectedItemIndex', value: 1 }] } })), 26000);
    } else if (m.type === 'QuinoaCommand') {
      serverSeq = m.commandSequence;
      // Swapping teams: the pets out become that team's members.
      if (m.command.type === 'ApplyPetTeam') {
        const d = state.child.data.userSlots[0].data;
        const team = d.petTeams.find((t) => t.id === m.command.teamId);
        if (team) d.petSlots = team.members.map((x) => ({ id: x.petId, petSpecies: x.petSpecies, hunger: 400, mutations: [], abilities: [] }));
        ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: Boolean(team) }));
        ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [{ op: 'replace', path: '/child/data/userSlots/0/data/petSlots', value: d.petSlots }] } }));
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
      if (m.command.type === 'ToggleLockItem') {
        if (typeof m.command.species !== 'string') {
          ws.send(JSON.stringify({ type: 'QuinoaCommandResult', requestId: m.requestId, commandType: m.command.type, ok: false, code: 'bad_command' }));
          ws.send(JSON.stringify({ type: 'RoomFrame', executedCommandSequence: serverSeq, state: { patches: [] } }));
          return;
        }
        const inv = state.child.data.userSlots[0].data.inventory;
        inv.favoritedItemIds = inv.favoritedItemIds.includes(m.command.species) ? inv.favoritedItemIds.filter((x) => x !== m.command.species) : inv.favoritedItemIds.concat([m.command.species]);
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
