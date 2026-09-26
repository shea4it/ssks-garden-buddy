/*
 * garden-observer.js
 *
 * Runs inside the game page, before the game's own code. It listens to the
 * messages the game already receives on its own connection (the full state
 * in "Welcome", then small patches in "RoomFrame"), keeps a read-only copy of
 * that state, and reports two things to the app:
 *
 *   - when one of your pets turns a crop Gold or Rainbow (from your activity log)
 *   - how many of your crops are Gold or Rainbow right now
 *
 * It changes nothing the game receives, with one exception: after the app
 * has sent a command of its own, the server's "done up to command N" count in
 * each update is translated into the game's own numbering (see "The server's
 * count, in the game's numbering"). The game gets the same socket object it
 * asked for.
 *
 * There is exactly one thing it can send: ApplyPetTeam, the same command the
 * game sends when you tap one of your own saved pet teams. That only happens
 * when you switch on weather teams in the app, or press a team's Apply
 * button. See "Sending a pet team" below for how it keeps the game's command
 * numbering intact.
 */
(function () {
  'use strict';

  if (window.__mgLoaderObserver) return;

  const NativeWebSocket = window.WebSocket;

  const obs = {
    state: null,
    selfPlayerId: null,
    sockets: 0,
    frames: 0,
    welcomes: 0,
    patchesApplied: 0,
    patchesFailed: 0,
    seenLog: null,
    recentPatches: [],
    recentActions: [],
    lastReport: 0,
    reportTimer: null,
    gameSocket: null,
    nativeSend: null,
    // Command numbering, shared with the game (see "Sending a pet team").
    nextSequence: 1,
    injected: 0,
    dropped: 0,
    // Server-side numbers of the app's own commands, and the places where a
    // game number was skipped (harvest lock fallback only). Used to show
    // the game the server's count in the game's own numbering.
    pageId: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    injectedSeqs: [],
    dropSeqs: [],
    translated: 0,
    harvestLock: { on: false, species: [], petFood: false },
    ownRequests: {},
    recentOutgoing: [],
  };
  window.__mgLoaderObserver = obs;

  function send(type, payload) {
    try {
      if (window.mgLoaderBridge) window.mgLoaderBridge.send(type, payload);
    } catch (err) {
      /* the app side isn't there; stay silent */
    }
  }

  /* ---------------------------------------------------------------- *
   * State copy: Welcome gives the full state, frames give JSON patches.
   * Patch paths come both with and without a /child prefix, so both
   * readings are tried, literal first, before creating anything.
   * ---------------------------------------------------------------- */

  function decode(seg) {
    return seg.replace(/~1/g, '/').replace(/~0/g, '~');
  }

  function split(path) {
    if (!path) return [];
    return path.split('/').slice(1).map(decode);
  }

  function walkToParent(root, segs, create) {
    let cur = root;
    for (let i = 0; i < segs.length - 1; i += 1) {
      if (cur == null || typeof cur !== 'object') return null;
      const key = segs[i];
      let next = Array.isArray(cur) ? cur[Number(key)] : cur[key];
      if (next == null || typeof next !== 'object') {
        if (!create) return null;
        next = /^\d+$/.test(segs[i + 1]) ? [] : {};
        if (Array.isArray(cur)) cur[Number(key)] = next;
        else cur[key] = next;
      }
      cur = next;
    }
    return cur && typeof cur === 'object' ? cur : null;
  }

  function resolve(path, create) {
    const literal = split(path);
    if (literal.length === 0) return { root: true };
    const corrected = literal[0] === 'child' ? literal.slice(1) : ['child', ...literal];

    for (const segs of [literal, corrected]) {
      if (!segs.length) continue;
      const parent = walkToParent(obs.state, segs, false);
      if (parent) return { parent, key: segs[segs.length - 1] };
    }
    if (create) {
      const parent = walkToParent(obs.state, literal, true);
      if (parent) return { parent, key: literal[literal.length - 1] };
    }
    return null;
  }

  function read(r) {
    return Array.isArray(r.parent) ? r.parent[Number(r.key)] : r.parent[r.key];
  }

  function put(r, value, insert) {
    if (Array.isArray(r.parent)) {
      if (r.key === '-') r.parent.push(value);
      else if (insert) r.parent.splice(Number(r.key), 0, value);
      else r.parent[Number(r.key)] = value;
    } else {
      r.parent[r.key] = value;
    }
  }

  function drop(r) {
    if (Array.isArray(r.parent)) r.parent.splice(Number(r.key), 1);
    else delete r.parent[r.key];
  }

  function applyPatch(p) {
    try {
      if (!p || typeof p.path !== 'string' || p.op === 'test') return;
      const op = p.op;
      const target = resolve(p.path, op === 'add' || op === 'replace' || op === 'move' || op === 'copy');
      if (!target) {
        obs.patchesFailed += 1;
        return;
      }
      if (target.root) {
        if (op !== 'remove') obs.state = p.value;
        obs.patchesApplied += 1;
        return;
      }
      if (op === 'add') put(target, p.value, true);
      else if (op === 'replace') put(target, p.value, false);
      else if (op === 'remove') drop(target);
      else if (op === 'move' || op === 'copy') {
        const from = resolve(p.from, false);
        if (!from || from.root) {
          obs.patchesFailed += 1;
          return;
        }
        let value = read(from);
        if (op === 'move') drop(from);
        else value = JSON.parse(JSON.stringify(value));
        put(resolve(p.path, true) || target, value, true);
      }
      obs.patchesApplied += 1;
    } catch (err) {
      obs.patchesFailed += 1;
    }
  }

  /* ---------------------------------------------------------------- *
   * Finding your own garden slot
   * ---------------------------------------------------------------- */

  function userSlots() {
    const s = obs.state;
    if (!s) return [];
    const slots =
      (s.child && s.child.data && s.child.data.userSlots) ||
      (s.data && s.data.userSlots) ||
      null;
    if (!slots) return [];
    return Array.isArray(slots) ? slots : Object.values(slots);
  }

  function mySlot() {
    const me = obs.selfPlayerId;
    if (!me) return null;
    for (const slot of userSlots()) {
      if (!slot || typeof slot !== 'object') continue;
      const d = slot.data || {};
      // The live game names it userId; the others are kept as fallbacks.
      if (
        slot.userId === me || d.userId === me ||
        slot.playerId === me || d.playerId === me ||
        slot.id === me || d.id === me
      ) return slot;
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * Pet procs. From a real sample, a proc looks like:
   *   { action: 'GoldGranter', parameters: { pet: {...},
   *     growSlot: { species, mutations: [..., 'Gold'] }, mutation: 'Gold' } }
   * Only Granter abilities count. Other entries can mention Gold too (a gold
   * pet eating from the trough, a gold crop being harvested), and those
   * aren't procs.
   * ---------------------------------------------------------------- */

  // A pet turning crops Gold or Rainbow. Two log shapes are understood: the
  // one first assumed ({ pet, mutation, growSlot }) and the live one seen in
  // Sep 2026 ({ targetMutation, growSlotsAffected: [...], speciesId }, with
  // the pet, when named, under pet / petId / petSpecies).
  function classify(entry) {
    const params = (entry && entry.parameters) || {};
    const action = String((entry && entry.action) || '');
    const target = String(params.targetMutation || params.mutation || '');
    const isGranter = /granter/i.test(action) || /^(gold|rainbow)$/i.test(target);
    if (!isGranter) return null;
    const mutation = target || action;
    const kind = /rainbow/i.test(mutation) ? 'rainbow' : /gold/i.test(mutation) ? 'gold' : null;
    if (!kind) return null;
    const pet = params.pet && typeof params.pet === 'object' ? params.pet : {};
    const petId = pet.id || pet.petId || params.petId || null;
    const petSpecies = pet.petSpecies || pet.species || params.petSpecies || null;
    const petName = pet.name || params.petName || petSpecies || (kind === 'gold' ? 'Gold Granter' : 'Rainbow Granter');
    const slots = Array.isArray(params.growSlotsAffected) ? params.growSlotsAffected : params.growSlot ? [params.growSlot] : [];
    return {
      kind,
      petId: String(petId || petName || 'pet'),
      petName: String(petName),
      species: String(petSpecies || ''),
      crop: String((slots[0] && slots[0].species) || ''),
      // when the game logged it (the rate chart buckets by this)
      at: Number(entry.timestamp) || null,
    };
  }

  // Coin Finder procs: the log records how many coins the pet turned up.
  function coinsOf(entry) {
    const params = entry && entry.parameters;
    const pet = params && params.pet;
    const coins = params && Number(params.coinsFound);
    if (!pet || !Number.isFinite(coins) || coins <= 0) return null;
    return {
      coins,
      petId: String(pet.id || pet.petId || pet.name || pet.petSpecies || 'pet'),
      petName: String(pet.name || pet.petSpecies || pet.species || 'A pet'),
      species: String(pet.petSpecies || pet.species || ''),
    };
  }

  // An egg hatching, as the game logs it:
  //   { action: 'hatchEgg', timestamp, parameters: { eggId: 'CommonEgg',
  //     pet: { id, petSpecies, mutations, abilities, targetScale, ... } } }
  function hatchOf(entry) {
    if (!entry || !/hatchegg/i.test(String(entry.action || ''))) return null;
    const params = entry.parameters || {};
    const pet = params.pet || {};
    if (!pet.petSpecies) return null;
    return {
      at: Number(entry.timestamp) || Date.now(),
      eggId: String(params.eggId || pet.sourceEggId || ''),
      petId: String(pet.id || ''),
      species: String(pet.petSpecies),
      mutations: Array.isArray(pet.mutations) ? pet.mutations.map(String) : [],
      abilities: Array.isArray(pet.abilities) ? pet.abilities.map(String) : [],
      targetScale: Number(pet.targetScale) || null,
      xp: Number(pet.xp) || 0,
    };
  }

  function checkActivity() {
    const slot = mySlot();
    const logs = slot && slot.data && Array.isArray(slot.data.activityLogs) ? slot.data.activityLogs : null;
    if (!logs) return;

    // This runs on every frame the game sends (other players walking about
    // included). The log itself rarely changes, so first a cheap look: the
    // same list with the same length and the same oldest and newest times
    // has nothing new in it (a new entry always has a newer time).
    let newest = 0;
    let oldest = Infinity;
    for (const e of logs) {
      const t = Number(e && e.timestamp) || 0;
      if (t > newest) newest = t;
      if (t < oldest) oldest = t;
    }
    const sig = logs.length + '|' + oldest + '|' + newest;
    if (obs.seenLog && logs === obs.lastLogs && sig === obs.lastLogSig) return;
    obs.lastLogs = logs;
    obs.lastLogSig = sig;

    const keys = logs.map((e) => {
      try {
        return JSON.stringify(e);
      } catch (err) {
        return '';
      }
    });

    // Right after connecting, everything already in the log is history, but
    // the hatches in it are passed on so the pity tracker can catch up on any
    // it missed (say you hatched on your phone while the app was closed).
    if (!obs.seenLog) {
      obs.seenLog = new Set(keys);
      const backlog = logs.map(hatchOf).filter(Boolean);
      const times = logs.map((e) => Number(e && e.timestamp)).filter((t) => Number.isFinite(t) && t > 0);
      send('hatchBacklog', {
        hatches: backlog,
        eggsHatched: eggsHatched(),
        oldestLogAt: times.length ? Math.min(...times) : null,
        connection: obs.pageId + ':' + obs.welcomes,
      });
      return;
    }

    for (let i = 0; i < logs.length; i += 1) {
      if (obs.seenLog.has(keys[i])) continue;
      const hit = classify(logs[i]);
      if (hit) send('petMutation', hit);
      const coins = coinsOf(logs[i]);
      if (coins) send('petCoins', coins);
      const hatched = hatchOf(logs[i]);
      if (hatched) send('hatch', Object.assign({ eggsHatched: eggsHatched() }, hatched));
    }
    obs.seenLog = new Set(keys);
  }

  /* ---------------------------------------------------------------- *
   * Crop counts: every fruit on every plant in your garden, and how many are
   * Gold, Rainbow, or either.
   * ---------------------------------------------------------------- */

  function isCrop(o) {
    return (
      o &&
      typeof o === 'object' &&
      !Array.isArray(o) &&
      Array.isArray(o.mutations) &&
      (typeof o.species === 'string' || typeof o.speciesId === 'string' || typeof o.cropSpecies === 'string')
    );
  }

  function mutationKey(raw) {
    var m = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    var aliases = window.__MG_MUTATION_ALIASES || {};
    return aliases[m] || m;
  }

  function tally(root, name, accept) {
    const b = {
      name, total: 0, gold: 0, rainbow: 0, special: 0, value: 0,
      unpriced: 0, unpricedSpecies: {}, unknownMutations: [],
      // how many crops carry each mutation, by normalised name
      mutations: {},
      // the same, under the game's own names (to spot a wrong alias)
      rawMutations: {},
      // crops that are ready to harvest (only those can catch weather)
      mature: 0, matureKnown: false,
      // size runs 50 to 100 in the game; 100 is the max
      sized: 0, sizeSum: 0, sizeMin: null, atMax: 0,
      // Ready to sell under your rule (see obs.readyRule) vs still growing:
      // their value now, and at least what the growing ones will be worth
      // once ready (full size, and Gold if colour is required).
      ready: 0, readyValue: 0, growingValue: 0, growingPotential: 0,
      missing: { grow: 0, size: 0, color: 0, hydro: 0, lunar: 0 },
      // How many crops have reached each step, whatever the rule says (the
      // Money tab's crop-stage track).
      have: { ripe: 0, size: 0, hydro: 0, lunar: 0, color: 0 },
      ripeBy: null,
    };
    const now = Date.now();
    const rule = obs.readyRule;
    const HYDRO = ['wet', 'chilled', 'frozen', 'thunderstruck', 'thundercharged'];
    const LUNAR = ['dawnlit', 'amberlit', 'dawnbound', 'amberbound'];
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 12) return;
      if (isCrop(node)) {
        if (!accept(node)) return;
        b.total += 1;
        const v = window.__MG_CROP_VALUE ? window.__MG_CROP_VALUE(node, b) : 0;
        b.value += v;
        const seen = {};
        for (const raw of node.mutations) {
          const rawKey = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
          b.rawMutations[rawKey] = (b.rawMutations[rawKey] || 0) + 1;
          const key = mutationKey(raw);
          if (seen[key]) continue;
          seen[key] = true;
          b.mutations[key] = (b.mutations[key] || 0) + 1;
        }
        if (seen.gold) b.gold += 1;
        if (seen.rainbow) b.rainbow += 1;
        if (seen.gold || seen.rainbow) b.special += 1;
        const end = Number(node.endTime);
        if (Number.isFinite(end) && end > 0) {
          b.matureKnown = true;
          if (end <= now) b.mature += 1;
        }
        const size = Number(node.size);
        if (Number.isFinite(size) && size > 0) {
          b.sized += 1;
          b.sizeSum += size;
          b.sizeMin = b.sizeMin == null ? size : Math.min(b.sizeMin, size);
          if (size >= 99.999) b.atMax += 1;
        }
        // Ready to sell? Always: ripe. Then whatever your rule asks for.
        const unripe = Number.isFinite(end) && end > now;
        if (!unripe) b.have.ripe += 1;
        if (Number.isFinite(size) && size >= 99.999) b.have.size += 1;
        if (HYDRO.some((k) => seen[k])) b.have.hydro += 1;
        if (LUNAR.some((k) => seen[k])) b.have.lunar += 1;
        if (seen.gold || seen.rainbow) b.have.color += 1;
        const need = {
          grow: unripe,
          size: rule.size && Number.isFinite(size) && size > 0 && size < 99.999,
          color: rule.color && !(seen.gold || seen.rainbow),
          hydro: rule.hydro && !HYDRO.some((k) => seen[k]),
          lunar: rule.lunar && !LUNAR.some((k) => seen[k]),
        };
        if (!need.grow && !need.size && !need.color && !need.hydro && !need.lunar) {
          b.ready += 1;
          b.readyValue += v;
        } else {
          b.growingValue += v;
          for (const k of Object.keys(need)) if (need[k]) b.missing[k] += 1;
          if (unripe) b.ripeBy = Math.max(b.ripeBy || 0, end);
          if (window.__MG_CROP_VALUE) {
            const proj = Object.assign({}, node, {
              size: need.size ? 100 : node.size,
              mutations: need.color ? node.mutations.concat(['Gold']) : node.mutations,
            });
            b.growingPotential += Math.max(v, window.__MG_CROP_VALUE(proj, { unpriced: 0, unpricedSpecies: {}, unknownMutations: [] }));
          } else {
            b.growingPotential += v;
          }
        }
        return;
      }
      for (const value of Object.values(node)) visit(value, depth + 1);
    };
    visit(root, 0);
    return b;
  }

  function cropStats() {
    const slot = mySlot();
    if (!slot || !slot.data) return null;
    return [tally(slot.data.garden, 'garden', () => true)].filter((b) => b.total > 0);
  }

  /* ---------------------------------------------------------------- *
   * Pet hunger. Species have very different maximums (a sample showed a
   * Pig fed to 50,000 and a Snail around 450), so rather than guess a
   * maximum, this measures how fast each pet's hunger is falling and
   * works out how long until it hits zero. Feeding resets the measurement.
   * ---------------------------------------------------------------- */

  const petTrack = {};

  function petHunger() {
    const slot = mySlot();
    const pets = slot && slot.data && Array.isArray(slot.data.petSlots) ? slot.data.petSlots : [];
    const now = Date.now();
    const out = [];
    const active = new Set();
    for (const p of pets) {
      if (!p || typeof p.hunger !== 'number' || !p.id) continue;
      active.add(p.id);
      const tr = petTrack[p.id] || (petTrack[p.id] = { samples: [] });
      const last = tr.samples[tr.samples.length - 1];
      if (last && p.hunger > last[1] + 1) tr.samples = []; // just fed
      if (!tr.samples.length || p.hunger !== tr.samples[tr.samples.length - 1][1]) tr.samples.push([now, p.hunger]);
      while (tr.samples.length > 2 && now - tr.samples[0][0] > 10 * 60 * 1000) tr.samples.shift();
      const first = tr.samples[0];
      let secondsLeft = null;
      if (p.hunger <= 0) secondsLeft = 0;
      else if (first && now - first[0] >= 30000 && first[1] > p.hunger) {
        const perSecond = (first[1] - p.hunger) / ((now - first[0]) / 1000);
        secondsLeft = Math.round(p.hunger / perSecond);
      }
      out.push({
        id: String(p.id),
        name: String(p.name || p.petSpecies || 'Your pet'),
        species: String(p.petSpecies || ''),
        hunger: p.hunger,
        secondsLeft,
        abilities: Array.isArray(p.abilities) ? p.abilities.map(String) : [],
        mutations: Array.isArray(p.mutations) ? p.mutations.map(String) : [],
        xp: Number(p.xp) || 0,
        targetScale: Number(p.targetScale) || null,
      });
    }
    for (const id of Object.keys(petTrack)) if (!active.has(id)) delete petTrack[id];
    return out;
  }

  // What's in the feeding trough(s): inventory.storages entries with
  // decorId 'FeedingTrough', each holding crop items.
  function troughContents() {
    const slot = mySlot();
    const storages = slot && slot.data && slot.data.inventory && slot.data.inventory.storages;
    const troughs = Array.isArray(storages) ? storages.filter((s) => s && s.decorId === 'FeedingTrough') : [];
    const species = [];
    for (const t of troughs) {
      for (const item of Array.isArray(t.items) ? t.items : []) {
        if (item && item.species) species.push(String(item.species));
      }
    }
    return { present: troughs.length > 0, species };
  }

  // Your saved pet teams, as the game stores them: {id, name, members:[{petId}]}.
  function petTeams() {
    const slot = mySlot();
    const teams = slot && slot.data && Array.isArray(slot.data.petTeams) ? slot.data.petTeams : [];
    const out = [];
    for (const t of teams) {
      if (!t || !t.id) continue;
      const members = (Array.isArray(t.members) ? t.members : [])
        .filter((m) => m && m.petId)
        .map((m) => ({ petId: String(m.petId), species: String(m.petSpecies || ''), name: m.name ? String(m.name) : null }));
      out.push({ id: String(t.id), name: String(t.name || 'Team'), members });
    }
    return out;
  }

  // Every pet you own: the ones out, and the ones in your inventory and pet
  // hutch, found by shape (an object with petSpecies and an abilities list).
  function allPets() {
    const slot = mySlot();
    const d = (slot && slot.data) || {};
    const out = [];
    const seen = {};
    const add = (p, where) => {
      if (!p || typeof p !== 'object' || !p.id || !p.petSpecies || seen[p.id]) return;
      seen[p.id] = true;
      out.push({
        id: String(p.id),
        species: String(p.petSpecies),
        name: p.name ? String(p.name) : null,
        xp: Number(p.xp) || 0,
        targetScale: Number(p.targetScale) || null,
        mutations: Array.isArray(p.mutations) ? p.mutations.map(String) : [],
        abilities: Array.isArray(p.abilities) ? p.abilities.map(String) : [],
        where,
      });
    };
    for (const p of Array.isArray(d.petSlots) ? d.petSlots : []) add(p, 'out');
    const inv = d.inventory || {};
    for (const p of Array.isArray(inv.items) ? inv.items : []) add(p, 'inventory');
    for (const st of Array.isArray(inv.storages) ? inv.storages : []) {
      const where = /hutch/i.test(String((st && st.decorId) || '')) ? 'hutch' : 'storage';
      for (const p of (st && Array.isArray(st.items)) ? st.items : []) add(p, where);
    }
    return out;
  }

  // Crops that have just started growing: each one is a Bad Luck Protection
  // "pull" for its plant (see luck.js). A crop is known by its plant, slot and
  // start time, so moving a potted plant into the garden doesn't make it new.
  // The first look after connecting only records what's there.
  obs.cropKeys = null;
  function cropPulls() {
    const slot = mySlot();
    const d = (slot && slot.data) || {};
    const found = [];
    const add = (plant) => {
      if (!plant || typeof plant !== 'object' || !Array.isArray(plant.slots)) return;
      const plantSpecies = String(plant.species || plant.plantSpecies || '');
      plant.slots.forEach((c, i) => {
        if (!c || typeof c !== 'object' || !c.species || !c.startTime) return;
        found.push({
          key: plantSpecies + '|' + (c.slotId != null ? c.slotId : i) + '|' + c.startTime,
          plant: plantSpecies || String(c.species),
          crop: String(c.species),
          slotId: c.slotId != null ? Number(c.slotId) : i,
          mutations: Array.isArray(c.mutations) ? c.mutations.map(String) : [],
          at: Number(c.startTime) || Date.now(),
        });
      });
    };
    const g = d.garden || {};
    for (const o of Object.values(g.tileObjects || {})) add(o);
    const inv = d.inventory || {};
    for (const o of Array.isArray(inv.items) ? inv.items : []) add(o);
    const keys = new Set(found.map((f) => f.key));
    if (!obs.cropKeys) {
      obs.cropKeys = keys;
      return;
    }
    const fresh = found.filter((f) => !obs.cropKeys.has(f.key));
    obs.cropKeys = keys;
    // A sanity cap: a sudden flood means something else changed (a big
    // reload of the garden), not hundreds of crops sprouting at once.
    if (fresh.length && fresh.length <= 120) send('cropPulls', { crops: fresh.map((f) => { delete f.key; return f; }) });
  }

  // The room lives at the top of the state; on the live server it's under
  // `child.data`, so look there too.
  function roomData() {
    const s = obs.state || {};
    if (s.data && (s.data.roomId || Array.isArray(s.data.players))) return s.data;
    if (s.child && s.child.data && (s.child.data.roomId || Array.isArray(s.child.data.players))) return s.child.data;
    return s.data || {};
  }
  function roomInfo() {
    const d = roomData();
    const players = Array.isArray(d.players) ? d.players.filter(Boolean) : [];
    const connected = players.filter((p) => p && p.isConnected !== false).length;
    return { roomId: d.roomId ? String(d.roomId) : null, players: players.length, connected };
  }

  function eggsHatched() {
    const slot = mySlot();
    const n = slot && slot.data && slot.data.stats && slot.data.stats.player && slot.data.stats.player.numEggsHatched;
    return Number.isFinite(Number(n)) ? Number(n) : null;
  }

  function quinoaData() {
    const s = obs.state;
    return (s && s.child && s.child.data) || (s && s.data) || {};
  }

  function report() {
    obs.lastReport = Date.now();
    try {
      spotMap();
    } catch (err) {
      /* the map must never get in the way */
    }
    try {
      if (mySlot()) cropPulls();
    } catch (err) {
      /* never get in the way */
    }
    const slot = mySlot();
    // What you've bought in each shop's current restock (the game keeps this
    // itself: exact ids and counts). The app turns changes into purchases.
    const shopPurchases = (() => {
      const sp = slot && slot.data && slot.data.shopPurchases;
      if (!sp || typeof sp !== 'object') return null;
      const out = {};
      for (const [shop, info] of Object.entries(sp).slice(0, 20)) {
        if (!info || typeof info !== 'object' || !info.restockId) continue;
        const purchases = {};
        for (const [id, n] of Object.entries(info.purchases && typeof info.purchases === 'object' ? info.purchases : {}).slice(0, 60)) purchases[String(id).slice(0, 60)] = Math.floor(Number(n) || 0);
        out[String(shop).slice(0, 20)] = { restockId: String(info.restockId).slice(0, 60), purchases };
      }
      return out;
    })();
    // Me, for the room-sharing option: the game's own id, and a display
    // name if the room state has one anywhere obvious.
    const self = (() => {
      const me = obs.selfPlayerId;
      if (!me) return null;
      let name = null;
      try {
        const room = roomData();
        const p = (Array.isArray(room.players) ? room.players : []).find((x) => x && String(x.id || x.playerId || x.userId) === String(me));
        const pick = (o) => (o && (o.name || o.displayName || o.username || o.playerName)) ? String(o.name || o.displayName || o.username || o.playerName) : null;
        name = pick(p);
        if (!name && room.chat && room.chat.playerCosmeticInfos) name = pick(room.chat.playerCosmeticInfos[me]);
      } catch (err) {
        name = null;
      }
      return { id: String(me).slice(0, 80), name: name ? name.slice(0, 60) : null };
    })();
    send('status', {
      connected: obs.welcomes > 0,
      foundSelf: Boolean(slot),
      self,
      shopPurchases,
      hasActivityLog: Boolean(slot && slot.data && Array.isArray(slot.data.activityLogs)),
      crops: cropStats() || [],
      pets: petHunger(),
      trough: troughContents(),
      wallet: (() => {
        const slot = mySlot();
        const d = (slot && slot.data) || {};
        return { coins: Number(d.coinsCount) || 0, dust: Number(d.magicDustCount) || 0 };
      })(),
      teams: petTeams(),
      // Unique per page load and connection (the counter alone restarts at 1).
      session: obs.pageId + ':' + obs.welcomes,
      allPets: allPets(),
      // What's on each garden spot (0-199, row by row, 20 across), for the
      // open-spot map: p plant, e egg, d decoration, o anything else.
      gardenTiles: (() => {
        const sl = mySlot();
        const tiles = (sl && sl.data && sl.data.garden && sl.data.garden.tileObjects) || {};
        const out = {};
        for (const [k, o] of Object.entries(tiles)) {
          if (!o || typeof o !== 'object') continue;
          const t = String(o.objectType || '').toLowerCase();
          const kind = /plant/.test(t) || Array.isArray(o.slots) ? 'p' : /egg/.test(t) ? 'e' : /decor/.test(t) ? 'd' : 'o';
          out[k] = [kind, String(o.species || o.eggId || o.decorId || '').slice(0, 40)];
        }
        return out;
      })(),
      gardenSpecies: (() => {
        const sl = mySlot();
        const tiles = (sl && sl.data && sl.data.garden && sl.data.garden.tileObjects) || {};
        const set = {};
        for (const o of Object.values(tiles)) {
          if (!o || !Array.isArray(o.slots)) continue;
          for (const c of o.slots) if (c && c.species) set[String(c.species)] = true;
        }
        return Object.keys(set).sort();
      })(),
      seeds: (() => {
        const sl = mySlot();
        const inv = (sl && sl.data && sl.data.inventory) || {};
        const silo = (Array.isArray(inv.storages) ? inv.storages : []).find((st) => st && /seed/i.test(String(st.decorId || '')));
        return { inventory: seedStacks(inv.items), silo: seedStacks(silo && silo.items) };
      })(),
      room: roomInfo(),
      eggsHatched: eggsHatched(),
      // The game's lifetime stats (earnings, harvests, ability triggers...).
      lifetime: (() => {
        const sl = mySlot();
        const st = sl && sl.data && sl.data.stats;
        if (!st || typeof st !== 'object') return null;
        return { player: st.player || null, petAbility: st.petAbility || null };
      })(),
      capsulePulls: (() => {
        const sl = mySlot();
        const c = sl && sl.data && sl.data.stats && sl.data.stats.capsulePulls;
        return c && typeof c === 'object' ? c : null;
      })(),
      weather: (() => {
        const w = quinoaData().weather;
        return w == null ? null : typeof w === 'string' ? w : String(w.name || w.weatherId || w.id || JSON.stringify(w)).slice(0, 60);
      })(),
      connection: obs.welcomes,
      canSend: Boolean(obs.gameSocket && obs.gameSocket.readyState === 1),
      frames: obs.frames,
      patchesFailed: obs.patchesFailed,
    });
  }

  let spotTimer = null;
  function onStateChanged() {
    checkActivity();
    // The hand map follows a hotbar change quickly, but not on every frame:
    // once per quarter second at most, off the message handler.
    if (!spotTimer) {
      spotTimer = setTimeout(() => {
        spotTimer = null;
        try {
          spotMap();
        } catch (err) {
          /* never in the way */
        }
      }, 250);
    }
    // Crop counts can wait a couple of seconds; no need to recount every frame.
    if (!obs.reportTimer) {
      const wait = Math.max(0, 2000 - (Date.now() - obs.lastReport));
      obs.reportTimer = setTimeout(() => {
        obs.reportTimer = null;
        report();
      }, wait);
    }
  }

  /* ---------------------------------------------------------------- *
   * Listening to the game's socket
   * ---------------------------------------------------------------- */

  // A short rolling memory of what changed recently, only used by the sample.
  function remember(p) {
    try {
      if (!p || typeof p.path !== 'string') return;
      if (/\/userSlots\/\d+\//.test(p.path) && !/\/(position|steppedTiles)/.test(p.path)) {
        // Only the first 300 characters are kept, so a big list or object is
        // summarised rather than written out in full first.
        const val = p.value === undefined ? null : p.value;
        let v;
        if (Array.isArray(val) && val.length > 20) v = `[array of ${val.length}] ` + JSON.stringify(val.slice(0, 2));
        else if (val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length > 30) v = `{object with ${Object.keys(val).length} keys: ${Object.keys(val).slice(0, 12).join(', ')}}`;
        else v = JSON.stringify(val);
        obs.recentPatches.push({ op: p.op, path: p.path, value: v && v.length > 300 ? v.slice(0, 300) + '...' : v });
        if (obs.recentPatches.length > 80) obs.recentPatches.shift();
      }
      if (/lastActionEvent/.test(p.path)) {
        obs.recentActions.push({ at: Date.now(), path: p.path, value: p.value });
        if (obs.recentActions.length > 15) obs.recentActions.shift();
      }
    } catch (err) {
      /* sample-only; never matters */
    }
  }

  function onMessage(event) {
    const data = event.data;
    if (typeof data !== 'string' || data.charCodeAt(0) !== 123) return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // For samples: which kinds of message arrive, their field names, and any
    // field that looks like a command count (names and numbers only).
    try {
      const shapes = obs.incomingShape || (obs.incomingShape = {});
      const t = String(msg.type || '?').slice(0, 40);
      const entry = shapes[t] || (shapes[t] = { count: 0, keys: [], counts: {} });
      entry.count += 1;
      for (const k of Object.keys(msg)) if (entry.keys.length < 20 && entry.keys.indexOf(k) < 0) entry.keys.push(k);
      const scan = (o, path, depth) => {
        if (!o || typeof o !== 'object' || depth > 2) return;
        for (const k of Object.keys(o).slice(0, 40)) {
          if (/sequence|seq$|executed/i.test(k)) entry.counts[path + k] = typeof o[k] === 'number' ? o[k] : typeof o[k];
          else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) scan(o[k], path + k + '.', depth + 1);
        }
      };
      if (t !== 'Welcome') scan(msg, '', 0);
    } catch (err) {
      /* diagnostics only */
    }

    if (msg.type === 'QuinoaCommandResult' && msg.requestId && obs.neutered[msg.requestId]) {
      delete obs.neutered[msg.requestId];
      // If the server says it couldn't even read the command, or that the
      // numbering is off, it didn't count it: switch to dropping blocked
      // harvests (and renumbering) for the rest of this session.
      if (msg.ok === false && /sequence|invalid_message|malformed|parse/i.test(String(msg.code || ''))) {
        obs.lockMode = 'drop';
        // That command didn't count, so the server is one behind: renumber
        // from here on to match it.
        obs.nextSequence = Math.max(1, obs.nextSequence - 1);
        obs.dropped += 1;
        obs.dropSeqs.push(obs.nextSequence);
        send('harvestLockFallback', { code: String(msg.code || '') });
      }
    }
    if (msg.type === 'QuinoaCommandResult' && msg.requestId && obs.pendingBuys[msg.requestId]) {
      const buy = obs.pendingBuys[msg.requestId];
      delete obs.pendingBuys[msg.requestId];
      if (msg.ok !== false) {
        const slot = mySlot();
        send('purchase', {
          at: buy.at,
          command: buy.command,
          coinsAfter: slot && slot.data ? Number(slot.data.coinsCount) || null : null,
        });
      }
    }
    if (msg.type === 'QuinoaCommandResult') {
      obs.recentResults = obs.recentResults || [];
      obs.recentResults.push({ at: Date.now(), command: msg.commandType || null, ok: msg.ok !== false, code: msg.code ? String(msg.code).slice(0, 60) : null });
      if (obs.recentResults.length > 30) obs.recentResults.shift();
      const mine = msg.requestId && obs.ownRequests[msg.requestId];
      if (mine) {
        delete obs.ownRequests[msg.requestId];
        send('commandResult', { what: mine, ok: msg.ok !== false, code: msg.code ? String(msg.code) : null });
        const waiter = obs.ownWaiters[msg.requestId];
        if (waiter) {
          delete obs.ownWaiters[msg.requestId];
          waiter({ ok: msg.ok !== false, code: msg.code ? String(msg.code) : null });
        }
      }
      return;
    }

    if (msg.type === 'Welcome') {
      // The server says which command number it ran last; the next one sent
      // (by the game or by us) must be that plus one.
      const executed = Number(msg.executedCommandSequence);
      obs.nextSequence = Number.isFinite(executed) && executed >= 0 ? executed + 1 : 1;
      obs.injected = 0;
      obs.dropped = 0;
      obs.injectedSeqs = [];
      obs.dropSeqs = [];
      obs.ownRequests = {};
      obs.pendingBuys = {};
      if (event.target && typeof event.target.send === 'function') obs.gameSocket = event.target;
      obs.frames += 1;
      obs.welcomes += 1;
      obs.state = msg.fullState || null;
      obs.selfPlayerId = msg.selfPlayerId || msg.playerId || obs.selfPlayerId;
      obs.seenLog = null;
      obs.cropKeys = null;
      onStateChanged();
      // Give the game a few seconds to finish loading its scripts first.
      setTimeout(readCatalog, 8000);
    } else if (msg.type === 'RoomFrame' || msg.type === 'PartialState') {
      obs.frames += 1;
      if (!obs.state) return;
      const patches = (msg.state && msg.state.patches) || msg.patches || [];
      if (!Array.isArray(patches) || !patches.length) return;
      for (const p of patches) {
        applyPatch(p);
        remember(p);
      }
      onStateChanged();
    }
  }

  /* ---------------------------------------------------------------- *
   * Sending a pet team
   *
   * The server numbers the game's commands (commandSequence) and needs them
   * gapless: if a number is skipped or used twice, it refuses that command
   * and everything after it. The game keeps its own counter, which can't see
   * anything we send. So:
   *
   *   - Until the app sends something, it only watches the game's numbers go
   *     by. What goes over the wire is exactly what the game wrote.
   *   - Once the app has sent a command, it renumbers the game's later
   *     commands from its own counter, so the numbers stay in one unbroken
   *     line. The next reconnect (Welcome) starts everyone fresh.
   *
   * This is the same approach Arie's Mod uses for its pet teams.
   * ---------------------------------------------------------------- */

  function watchOutgoing(ws, data) {
    if (ws !== obs.gameSocket || typeof data !== 'string' || data.indexOf('"QuinoaCommand"') < 0) return data;
    try {
      const env = JSON.parse(data);
      if (!env || env.type !== 'QuinoaCommand') return data;
      obs.recentOutgoing.push({
        at: Date.now(),
        command: env.command && env.command.type,
        sequence: env.commandSequence,
        renumbered: obs.injected > 0 || obs.dropped > 0,
      });
      if (obs.recentOutgoing.length > 20) obs.recentOutgoing.shift();
      // Every kind of command the game has sent (names and counts only), for
      // the sample: it shows what the game calls a purchase.
      if (env.command && env.command.type) {
        const ct = String(env.command.type).slice(0, 40);
        obs.commandTypes[ct] = (obs.commandTypes[ct] || 0) + 1;
        // The first example of each command's shape (field names and short
        // values), so a sample shows what the game calls things.
        if (!obs.commandShapes[ct] && Object.keys(obs.commandShapes).length < 40) {
          const shape = {};
          for (const [k, v] of Object.entries(env.command)) {
            if (k === 'type') continue;
            shape[k] = typeof v === 'string' ? v.slice(0, 40) : typeof v === 'number' || typeof v === 'boolean' ? v : Array.isArray(v) ? `[array of ${v.length}]` : v && typeof v === 'object' ? '{object}' : String(v);
          }
          obs.commandShapes[ct] = shape;
        }
      }
      // A purchase: remembered until the server answers, then reported to
      // the app (spending tracker). Only what's needed to name the item.
      if (env.command && /buy|purchase/i.test(String(env.command.type || '')) && env.requestId) {
        const c = env.command;
        const pick = {};
        for (const k of Object.keys(c)) {
          const v = c[k];
          if ((typeof v === 'string' && v.length <= 80) || typeof v === 'number' || typeof v === 'boolean') pick[k] = v;
        }
        obs.pendingBuys[env.requestId] = { at: Date.now(), command: pick };
        const ids = Object.keys(obs.pendingBuys);
        if (ids.length > 30) for (const id of ids.slice(0, ids.length - 30)) delete obs.pendingBuys[id];
      }
      // Harvest lock. A blocked harvest is still sent, but pointed at a crop
      // spot that doesn't exist, so the server itself refuses it (as it
      // refuses any bad click). That keeps the game's command count and the
      // server's in step: dropping it instead left the game a command ahead
      // for the rest of the session, and it then replayed its own moves over
      // the real garden (plants swapping back after pot swaps). The game
      // gets the server's real refusal and undoes its pick-up.
      if (env.command && env.command.type === 'HarvestCrop') {
        const blocked = harvestBlocked(env.command);
        if (blocked) {
          const entry = obs.recentOutgoing[obs.recentOutgoing.length - 1];
          entry.blocked = true;
          showBlocked(blocked);
          send('harvestBlocked', blocked);
          if (obs.lockMode === 'drop') {
            // Fallback, if the server ever showed it doesn't count refusals.
            obs.dropped += 1;
            obs.dropSeqs.push(obs.nextSequence);
            refuse(ws, env);
            return null;
          }
          env.command = Object.assign({}, env.command, { slotsIndex: NO_SUCH_SPOT });
          entry.neutered = true;
          obs.neutered[env.requestId] = true;
          data = JSON.stringify(env);
        }
      }
      // "Never sell pet food": a sale that would take crops your pets eat
      // and that aren't locked is not sent. There's nothing in a sale to
      // point elsewhere, so it is dropped and the game gets a refusal (the
      // same fallback path the harvest lock has), and the count translation
      // keeps the game's command numbering in step.
      if (env.command && obs.harvestLock.petFood && /sell/i.test(String(env.command.type || '')) && !/pet/i.test(String(env.command.type || ''))) {
        const crops = obs.autoLocking ? [] : foodInSale(env.command);
        if (crops.length) {
          const entry = obs.recentOutgoing[obs.recentOutgoing.length - 1];
          entry.blocked = true;
          entry.sellBlocked = true;
          obs.sellsBlocked = (obs.sellsBlocked || 0) + 1;
          // The game's own sale is refused (so its bag display reverts);
          // the pet food is locked; then the same sale is sent again.
          const sale = {};
          for (const [k, v] of Object.entries(env.command)) if (typeof v !== 'object' || v === null) sale[k] = v;
          obs.dropped += 1;
          obs.dropSeqs.push(obs.nextSequence);
          refuse(ws, env, String(env.command.type).slice(0, 40), 'blocked_by_pet_food_guard');
          autoLockAndSell(crops, sale);
          return null;
        }
      }
      if (obs.injected === 0 && obs.dropped === 0) {
        const n = Number(env.commandSequence);
        if (Number.isFinite(n) && n >= obs.nextSequence) obs.nextSequence = n + 1;
        return data;
      }
      env.commandSequence = obs.nextSequence;
      obs.nextSequence += 1;
      return JSON.stringify(env);
    } catch (err) {
      return data;
    }
  }

  function requestId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (err) {
      /* fall through */
    }
    return Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
  }

  /* ---------------------------------------------------------------- *
   * Harvest lock. While it's on, the game's harvest commands go to a crop
   * spot that doesn't exist, so the server refuses them and nothing is
   * harvested. Protected crops are never harvested, lock or no lock. The
   * lock never sends a command of its own; it only redirects the game's
   * own harvests.
   * ---------------------------------------------------------------- */

  function normId(x) {
    return String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Which crop a HarvestCrop points at: { slot: tile key, slotsIndex: the
  // crop's slotId (not its position; sparse plants skip numbers) }.
  function harvestTarget(cmd) {
    const sl = mySlot();
    const tiles = (sl && sl.data && sl.data.garden && sl.data.garden.tileObjects) || {};
    const tile = tiles[cmd.slot] || tiles[String(cmd.slot)];
    if (!tile) return null;
    const slots = Array.isArray(tile.slots) ? tile.slots : [];
    const crop = slots.find((c) => c && c.slotId === cmd.slotsIndex) || slots[cmd.slotsIndex] || null;
    if (!crop) return null;
    return { plant: String(tile.species || ''), crop: String(crop.species || tile.species || '') };
  }

  // The game plays the pick-up the moment you harvest and then waits for
  // the server's answer. A stopped harvest never reaches the server, so the
  // game is handed the answer the server gives when it refuses a command,
  // right away: it undoes the pick-up at once and doesn't sit waiting.
  // A crop spot no plant has (plants have a few dozen at most).
  const NO_SUCH_SPOT = 4095;
  obs.neutered = {};
  obs.lockMode = 'neuter';
  obs.pendingBuys = {};
  obs.commandTypes = {};
  obs.commandShapes = {};

  function refuse(ws, env, commandType, code) {
    const reply = JSON.stringify({
      type: 'QuinoaCommandResult',
      requestId: env.requestId,
      commandType: commandType || 'HarvestCrop',
      ok: false,
      code: code || 'blocked_by_harvest_lock',
    });
    setTimeout(() => {
      try {
        ws.dispatchEvent(new MessageEvent('message', { data: reply }));
      } catch (err) {
        /* the game will catch up by itself */
      }
    }, 0);
  }

  function harvestBlocked(cmd) {
    const lock = obs.harvestLock || {};
    const target = harvestTarget(cmd);
    // Only real garden crops. A harvest that doesn't point at a crop in the
    // garden (part of placing a pot, say) is let through.
    if (!target) return null;
    const what = target.crop;
    if (lock.on) return { reason: 'lock', crop: what };
    const list = (lock.species || []).map(normId);
    if (list.length && target && (list.includes(normId(target.crop)) || list.includes(normId(target.plant)))) {
      return { reason: 'protected', crop: what };
    }
    return null;
  }

  // A small badge in the game's corner while the lock is on, and a brief
  // note when a harvest is stopped. On this screen only.
  function lockBadge() {
    let el = document.getElementById('__mgHarvestLock');
    const on = obs.harvestLock && obs.harvestLock.on;
    if (!on) {
      if (el) el.remove();
      return;
    }
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = '__mgHarvestLock';
      el.textContent = '🔒 Harvest lock';
      el.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483646;pointer-events:none;background:rgba(42,27,54,.85);color:#f6f1f8;font:600 12px system-ui,sans-serif;padding:5px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.18)';
      document.body.appendChild(el);
    }
  }

  const nz = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // "Pet food" is whatever you carry in pots: the species of every potted
  // plant in your bag (a potted plant is an inventory item with a slots
  // array; that's how the game marks them). Crops of those species that
  // aren't locked (right-click in the bag; the game's field is named
  // favoritedItemIds) are what a sale must not take.
  function pottedSpecies(inv) {
    const out = [];
    for (const it of Array.isArray(inv.items) ? inv.items : []) {
      if (it && typeof it === 'object' && Array.isArray(it.slots) && it.species) out.push(nz(it.species));
    }
    return out;
  }

  // A crop in the bag: anything with a species that isn't a potted plant,
  // a seed, a tool, an egg, a pet or a decoration. Generous on purpose:
  // missing a crop would let it be sold.
  function isProduce(it) {
    if (!it || typeof it !== 'object' || !it.species) return false;
    if (Array.isArray(it.slots)) return false;
    const t = String(it.itemType || '');
    if (/produce|crop|fruit|harvest/i.test(t)) return true;
    return !/seed|tool|egg|decor|pet|plant/i.test(t);
  }

  // Crops in your bag that are pet food and aren't locked, as
  // [{species, count}]. If the sale names items, only those count. What the
  // check saw is kept for the sample.
  function foodInSale(cmd) {
    const slot = mySlot();
    const inv = (slot && slot.data && slot.data.inventory) || {};
    const fav = new Set((Array.isArray(inv.favoritedItemIds) ? inv.favoritedItemIds : []).map(String));
    const favNz = new Set([...fav].map(nz));
    const potted = pottedSpecies(inv);
    const isFood = (species) => {
      const c = nz(species);
      return potted.some((p) => c === p || c.startsWith(p) || p.startsWith(c));
    };
    let only = null;
    for (const k of ['itemIds', 'ids', 'items']) if (Array.isArray(cmd[k])) only = new Set(cmd[k].map(String));
    for (const k of ['itemId', 'id', 'species']) if (typeof cmd[k] === 'string') only = new Set([cmd[k]]);
    const counts = {};
    let produceSeen = 0;
    let foodSeen = 0;
    for (const it of Array.isArray(inv.items) ? inv.items : []) {
      if (!isProduce(it)) continue;
      produceSeen += 1;
      if (only && !only.has(String(it.id)) && !only.has(String(it.species))) continue;
      if (!isFood(it.species)) continue;
      foodSeen += 1;
      if (fav.has(String(it.species)) || fav.has(String(it.id)) || favNz.has(nz(it.species))) continue;
      const q = Math.max(1, Math.floor(Number(it.quantity) || 1));
      counts[it.species] = (counts[it.species] || 0) + q;
    }
    const crops = Object.entries(counts).map(([species, count]) => ({ species: String(species).slice(0, 40), count }));
    obs.lastSaleCheck = { at: Date.now(), command: String(cmd.type || '').slice(0, 40), items: (inv.items || []).length, produceSeen, potted, foodSeen, favourites: fav.size, blocked: crops };
    return crops;
  }

  // Sends one of our commands and waits for the server's answer.
  obs.ownWaiters = {};
  function sendAndWait(command, what, ms) {
    return new Promise((resolve) => {
      const r = sendCommand(command, what);
      if (!r.ok) {
        resolve({ ok: false, code: r.reason });
        return;
      }
      const t = setTimeout(() => {
        delete obs.ownWaiters[r.requestId];
        resolve({ ok: false, code: 'no answer' });
      }, ms || 2500);
      obs.ownWaiters[r.requestId] = (res) => {
        clearTimeout(t);
        resolve(res);
      };
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function lockedNow(species) {
    const slot = mySlot();
    const ids = (slot && slot.data && slot.data.inventory && slot.data.inventory.favoritedItemIds) || [];
    return Array.isArray(ids) && ids.some((x) => nz(x) === nz(species));
  }

  // Locks one crop kind (the game's right-click lock: ToggleLockItem). The
  // field that names the crop isn't documented, so the likely ones are
  // tried until the bag shows the lock; the one that worked is remembered.
  const LOCK_FIELDS = ['itemId', 'species', 'id'];
  async function lockSpecies(species) {
    if (lockedNow(species)) return true;
    const fields = obs.lockField ? [obs.lockField].concat(LOCK_FIELDS.filter((f) => f !== obs.lockField)) : LOCK_FIELDS;
    for (const field of fields) {
      const cmd = { type: 'ToggleLockItem' };
      cmd[field] = species;
      const res = await sendAndWait(cmd, 'Lock:' + species);
      if (!res.ok) continue; // the server refused this shape: try the next
      for (let i = 0; i < 20; i += 1) {
        if (lockedNow(species)) {
          if (obs.lockField !== field) {
            obs.lockField = field;
            send('lockField', { field });
          }
          return true;
        }
        await sleep(100);
      }
      // Accepted but the bag doesn't show it: don't send more (a second
      // toggle could undo a lock that just hasn't shown yet).
      return false;
    }
    return false;
  }

  // Locks every unlocked pet-food crop, then sends the sale the game
  // wanted. If a lock can't be made, nothing is sold.
  async function autoLockAndSell(crops, sale) {
    if (obs.autoLocking) return;
    obs.autoLocking = true;
    const locked = [];
    const failed = [];
    try {
      for (const c of crops) {
        if (await lockSpecies(c.species)) locked.push(c.species);
        else failed.push(c.species);
      }
      if (!failed.length) {
        const r = sendCommand(sale, 'Sell:after-lock');
        showBlocked({ reason: 'petfood-locked', crops });
        send('sellGuard', { ok: true, locked, resent: r.ok, command: String(sale.type || '').slice(0, 40) });
      } else {
        showBlocked({ reason: 'petfood-failed', crops, failed });
        send('sellGuard', { ok: false, locked, failed, command: String(sale.type || '').slice(0, 40) });
      }
      if (obs.lastSaleCheck) obs.lastSaleCheck.autoLock = { locked, failed, field: obs.lockField || null };
    } catch (err) {
      send('sellGuard', { ok: false, locked, failed: crops.map((c) => c.species), error: String((err && err.message) || err).slice(0, 80) });
    } finally {
      obs.autoLocking = false;
    }
  }

  function showBlocked(b) {
    if (!document.body) return;
    const note = document.createElement('div');
    const name = b.crop ? b.crop.replace(/([a-z])([A-Z])/g, '$1 $2') : 'crop';
    if (b.reason === 'petfood-locked' || b.reason === 'petfood-failed') {
      const pretty = (x) => String(x).replace(/([a-z])([A-Z])/g, '$1 $2');
      const list = (b.crops || []).slice(0, 4).map((c) => pretty(c.species) + ' ×' + c.count).join(', ');
      note.textContent = b.reason === 'petfood-locked'
        ? '🐾 Kept your pet food: locked ' + list + (b.crops.length > 4 ? '…' : '') + ', sold the rest.'
        : '🐾 Couldn\'t lock ' + (b.failed || []).map(pretty).join(', ') + ', so nothing was sold. Right-click to lock it, then sell again.';
      note.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:rgba(42,27,54,.94);color:#fff;font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:10px;max-width:70vw;text-align:center;transition:opacity .4s;';
      document.body.appendChild(note);
      setTimeout(() => { note.style.opacity = '0'; }, 4200);
      setTimeout(() => note.remove(), 4800);
      return;
    }
    if (b.reason === 'petfood') {
      const list = (b.crops || []).slice(0, 4).map((c) => c.species.replace(/([a-z])([A-Z])/g, '$1 $2') + ' ×' + c.count).join(', ');
      note.textContent = '🐾 Not sold: your pets eat ' + list + (b.crops.length > 4 ? '…' : '') + '. Right-click them in your bag to lock them, then sell again.';
      note.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:rgba(42,27,54,.94);color:#fff;font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:10px;max-width:70vw;text-align:center;transition:opacity .4s;';
      document.body.appendChild(note);
      setTimeout(() => { note.style.opacity = '0'; }, 4200);
      setTimeout(() => note.remove(), 4800);
      return;
    }
    note.textContent = b.reason === 'lock' ? '🔒 Harvest lock has blocked harvesting' : '🔒 ' + name + ' is protected';
    note.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:rgba(42,27,54,.92);color:#fff;font:700 15px system-ui,sans-serif;padding:8px 16px;border-radius:10px;transition:opacity .4s;';
    document.body.appendChild(note);
    setTimeout(() => { note.style.opacity = '0'; }, 1100);
    setTimeout(() => note.remove(), 1600);
  }

  /* Open-spot map over the game: a small picture of your garden (20 across,
   * 10 down, two beds side by side) in the bottom-right corner, open spots
   * bright, shown while the thing in your hand is a pot (a potted plant, or
   * an empty planter pot). Nothing is sent; it only reads the state. */
  obs.spotMapOn = true;
  let spotBox = null;
  let spotCells = null;
  let spotLast = '';

  // The item in your hand: the inventory entry at the selected index.
  function heldItem() {
    const slot = mySlot();
    if (!slot || !slot.data) return null;
    const items = (slot.data.inventory && slot.data.inventory.items) || [];
    const idx = Number(slot.notAuthoritative_selectedItemIndex);
    if (!Number.isFinite(idx)) return null;
    return items[idx] || null;
  }

  function isPot(it) {
    if (!it || typeof it !== 'object') return false;
    if (Array.isArray(it.slots)) return true; // a potted plant
    const t = String(it.itemType || '') + ' ' + String(it.species || '') + ' ' + String(it.toolId || it.id || '');
    return /planter|pot\b/i.test(t);
  }

  function spotMap() {
    const held = obs.spotMapOn ? heldItem() : null;
    const want = Boolean(held && isPot(held));
    if (!want) {
      if (spotBox) spotBox.style.display = 'none';
      spotLast = '';
      return;
    }
    if (!spotBox) {
      spotBox = document.createElement('div');
      spotBox.id = 'mg-spot-map';
      spotBox.setAttribute('aria-hidden', 'true');
      spotBox.style.cssText = 'pointer-events:none;'
        + 'background:rgba(20,14,28,.82);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 7px 5px;'
        + 'font:11px/1.2 system-ui,sans-serif;color:#eee;box-shadow:0 4px 14px rgba(0,0,0,.35);';
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(10,7px) 6px repeat(10,7px);grid-auto-rows:7px;gap:1px;';
      spotCells = [];
      for (let r = 0; r < 10; r += 1) {
        for (let c = 0; c < 21; c += 1) {
          const cell = document.createElement('i');
          if (c === 10) {
            cell.style.cssText = 'display:block;';
            grid.appendChild(cell);
            continue;
          }
          cell.style.cssText = 'display:block;border-radius:1px;background:#3a3040;';
          grid.appendChild(cell);
          spotCells.push(cell);
        }
      }
      const label = document.createElement('div');
      label.style.cssText = 'margin-top:4px;color:#cfd;opacity:.9;';
      spotBox.appendChild(grid);
      spotBox.appendChild(label);
      cornerStack().appendChild(spotBox);
    }
    const slot = mySlot();
    const tiles = (slot && slot.data && slot.data.garden && slot.data.garden.tileObjects) || {};
    let open = 0;
    const colours = [];
    for (let i = 0; i < 200; i += 1) {
      const o = tiles[i] || tiles[String(i)];
      let col = '#5ee87a'; // open
      if (o && typeof o === 'object') {
        const t = String(o.objectType || '').toLowerCase();
        col = /plant/.test(t) || Array.isArray(o.slots) ? '#3a3040' : /egg/.test(t) ? '#6b5a2a' : /decor/.test(t) ? '#4a3d6b' : '#3a3040';
      } else {
        open += 1;
      }
      colours.push(col);
    }
    const key = colours.join(',');
    if (key !== spotLast) {
      spotLast = key;
      for (let i = 0; i < 200; i += 1) spotCells[i].style.background = colours[i];
      spotBox.lastChild.textContent = open ? open + ' open spot' + (open === 1 ? '' : 's') : 'no open spots';
    }
    spotBox.style.display = '';
  }

  // The bottom-right corner: the money box on top, the hand map below it.
  let corner = null;
  function cornerStack() {
    if (corner && corner.isConnected) return corner;
    corner = document.createElement('div');
    corner.id = 'mg-corner';
    corner.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483645;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px;';
    (document.body || document.documentElement).appendChild(corner);
    return corner;
  }

  /* The money box: what the app worked out about your plan, as plain lines
   * (the app writes them; this only shows them). */
  let hudBox = null;
  obs.setBudgetHud = function setBudgetHud(data) {
    const shown = Boolean(data && data.shown && Array.isArray(data.lines) && data.lines.length);
    if (!shown) {
      if (hudBox) hudBox.style.display = 'none';
      return;
    }
    if (!hudBox) {
      hudBox = document.createElement('div');
      hudBox.id = 'mg-money-box';
      hudBox.setAttribute('aria-hidden', 'true');
      hudBox.style.cssText = 'pointer-events:none;max-width:250px;box-sizing:border-box;'
        + 'background:rgba(20,14,28,.84);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 9px;'
        + 'font:12px/1.35 system-ui,sans-serif;color:#eee;box-shadow:0 4px 14px rgba(0,0,0,.35);white-space:normal;overflow-wrap:anywhere;';
      cornerStack().insertBefore(hudBox, cornerStack().firstChild);
    }
    while (hudBox.firstChild) hudBox.removeChild(hudBox.firstChild);
    for (const l of data.lines.slice(0, 6)) {
      const row = document.createElement('div');
      row.textContent = String((l && l.text) || l || '').slice(0, 90);
      if (l && l.strong) row.style.fontWeight = '600';
      hudBox.appendChild(row);
    }
    hudBox.style.display = '';
  };

  // What "ready to sell" means (the Money tab's chips): ripe always, plus
  // full size, Gold/Rainbow, a weather mutation, a moon mutation.
  obs.readyRule = { size: true, color: true, hydro: true, lunar: true };
  obs.setReadyRule = function setReadyRule(r) {
    const x = r && typeof r === 'object' ? r : {};
    obs.readyRule = { size: x.size !== false, color: x.color !== false, hydro: x.hydro !== false, lunar: x.lunar !== false };
    try {
      report();
    } catch (err) {
      /* ignore */
    }
  };

  obs.setSpotMap = function setSpotMap(on) {
    obs.spotMapOn = on !== false;
    try {
      spotMap();
    } catch (err) {
      /* ignore */
    }
  };

  obs.setHarvestLock = function setHarvestLock(lock) {
    obs.harvestLock = {
      on: Boolean(lock && lock.on),
      species: Array.isArray(lock && lock.species) ? lock.species.map(String).slice(0, 100) : [],
      // "Never sell pet food": crops of the plants you carry in pots.
      petFood: Boolean(lock && lock.petFood),
    };
    if (lock && typeof lock.lockField === 'string' && LOCK_FIELDS.includes(lock.lockField)) obs.lockField = lock.lockField;
    lockBadge();
    return obs.harvestLock;
  };

  /* ---------------------------------------------------------------- *
   * "Coming back" after being bumped by another device: a countdown card
   * over the game's own "logged in elsewhere" screen, drawn here because
   * the buttons need to reach the app. Screen only.
   * ---------------------------------------------------------------- */

  let reclaimTimer = null;
  obs.showReclaim = function showReclaim(info) {
    obs.hideReclaim();
    if (!document.body) return;
    const box = document.createElement('div');
    box.id = '__mgReclaim';
    box.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;background:rgba(42,27,54,.96);color:#f6f1f8;font:14px system-ui,sans-serif;padding:14px 18px;border-radius:14px;border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 40px rgba(0,0,0,.4);text-align:center;min-width:280px;';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:4px;';
    title.textContent = '📱 Playing on another device';
    const line = document.createElement('div');
    line.style.cssText = 'opacity:.85;margin-bottom:10px;';
    const row = document.createElement('div');
    const button = (label, act, main) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'margin:0 4px;padding:7px 14px;border-radius:9px;border:1px solid rgba(255,255,255,.2);cursor:pointer;font:600 13px system-ui,sans-serif;' +
        (main ? 'background:#47624c;color:#eafbec;' : 'background:transparent;color:#f6f1f8;');
      b.addEventListener('click', () => send('reclaim', { act }));
      return b;
    };
    row.appendChild(button('Come back now', 'now', true));
    if (!info.manual) row.appendChild(button('Stay away', 'stay', false));
    box.appendChild(title);
    box.appendChild(line);
    box.appendChild(row);
    document.body.appendChild(box);
    const tick = () => {
      if (info.manual) {
        line.textContent = info.message || "Press Come back when you're done over there.";
        return;
      }
      const s = Math.max(0, Math.round((info.until - Date.now()) / 1000));
      line.textContent = `Coming back here in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}. The other device will be logged out then.`;
    };
    tick();
    reclaimTimer = setInterval(tick, 500);
  };
  obs.hideReclaim = function hideReclaim() {
    clearInterval(reclaimTimer);
    const old = document.getElementById('__mgReclaim');
    if (old) old.remove();
  };

  // Sends one game command with the next command number. Only the few
  // commands below ever go through here.
  function sendCommand(command, what) {
    const ws = obs.gameSocket;
    if (!ws || ws.readyState !== 1) return { ok: false, reason: 'not connected to the game' };
    const id = requestId();
    const envelope = {
      scopePath: ['Room', 'Quinoa'],
      type: 'QuinoaCommand',
      requestId: id,
      commandSequence: obs.nextSequence,
      command,
    };
    obs.nextSequence += 1;
    obs.injected += 1;
    obs.injectedSeqs.push(envelope.commandSequence);
    obs.ownRequests[id] = what;
    obs.recentOutgoing.push({ at: Date.now(), command: command.type, sequence: envelope.commandSequence, fromApp: true });
    try {
      (obs.nativeSend || ws.send).call(ws, JSON.stringify(envelope));
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err) };
    }
    return { ok: true, sequence: envelope.commandSequence, requestId: id };
  }

  // Swaps in one of your saved teams, exactly as tapping it in the game does.
  obs.applyPetTeam = function applyPetTeam(teamId) {
    const team = petTeams().find((t) => t.id === String(teamId));
    if (!team) return { ok: false, reason: 'that team no longer exists' };
    const r = sendCommand({ type: 'ApplyPetTeam', teamId: team.id }, 'ApplyPetTeam:' + team.id);
    return r.ok ? Object.assign(r, { team: team.name }) : r;
  };

  // Seeds in your inventory (not the Seed Silo), by species.
  function seedStacks(items) {
    const out = {};
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || !it.species || (it.itemType && !/seed/i.test(String(it.itemType)))) continue;
      if (Array.isArray(it.slots)) continue; // a potted plant, not a seed
      const q = Math.max(0, Math.floor(Number(it.quantity) || 0));
      if (q > 0) out[String(it.species)] = (out[String(it.species)] || 0) + q;
    }
    return out;
  }

  obs.seedCount = function seedCount(species) {
    const slot = mySlot();
    const inv = (slot && slot.data && slot.data.inventory) || {};
    return seedStacks(inv.items)[String(species)] || 0;
  };

  // Throws one seed into the wishing well, as the game does when you do it by
  // hand. Only if that seed is in your inventory.
  obs.wishSeed = function wishSeed(species) {
    if (!obs.seedCount(species)) return { ok: false, reason: 'no ' + species + ' seeds in your inventory' };
    return sendCommand({ type: 'Wish', itemId: String(species) }, 'Wish:' + species);
  };

  try {
    const proto = NativeWebSocket.prototype;
    obs.nativeSend = proto.send;
    proto.send = function (data) {
      const args = Array.prototype.slice.call(arguments);
      try {
        args[0] = watchOutgoing(this, data);
      } catch (err) {
        /* never get in the game's way */
      }
      if (args[0] === null) return undefined; // a harvest the lock stopped
      return obs.nativeSend.apply(this, args);
    };
  } catch (err) {
    /* sending teams just won't be available */
  }

  /* ---------------------------------------------------------------- *
   * The server's count, in the game's numbering.
   *
   * Every RoomFrame carries executedCommandSequence: how far the server has
   * got. The game compares it with its own count to know which of its moves
   * are done. After the app sends a command of its own (a team swap, the
   * seed deleter), the server's numbers run ahead of the game's by however
   * many the app sent, and the game would think moves are done before they
   * are. So on the way in, that one number is translated back:
   *   game count = server count - app commands up to it + skipped ones up to it
   * Nothing changes until the app has sent something, and nothing but that
   * number ever changes.
   * ---------------------------------------------------------------- */

  function gameCount(serverCount) {
    let n = serverCount;
    for (const s of obs.injectedSeqs) if (s <= serverCount) n -= 1;
    for (const s of obs.dropSeqs) if (s <= serverCount) n += 1;
    return n;
  }

  function translateEvent(ev) {
    try {
      if (!ev || ev.__mgTranslated) return ev;
      if (!obs.injectedSeqs.length && !obs.dropSeqs.length) return ev;
      const data = ev.data;
      if (typeof data !== 'string' || data.indexOf('"executedCommandSequence"') < 0) return ev;
      if (data.indexOf('"type":"Welcome"') >= 0) return ev;
      const fixed = data.replace(/"executedCommandSequence":(\d+)/g, (m, n) => '"executedCommandSequence":' + gameCount(Number(n)));
      if (fixed === data) return ev;
      Object.defineProperty(ev, 'data', { value: fixed, configurable: true });
      Object.defineProperty(ev, '__mgTranslated', { value: true });
      obs.translated += 1;
    } catch (err) {
      /* the game gets it as it was */
    }
    return ev;
  }

  // The game's message listeners on its socket get the translated event.
  // The app's own listener (added first) keeps seeing the server's numbers.
  function shieldGameListeners(ws) {
    const wrapped = new WeakMap();
    const wrap = (listener) => {
      if (!listener || (typeof listener !== 'function' && typeof listener.handleEvent !== 'function')) return listener;
      if (!wrapped.has(listener)) {
        wrapped.set(listener, function (ev) {
          const e = translateEvent(ev);
          return typeof listener === 'function' ? listener.call(this, e) : listener.handleEvent(e);
        });
      }
      return wrapped.get(listener);
    };
    const add = ws.addEventListener;
    const remove = ws.removeEventListener;
    ws.addEventListener = function (type, listener, options) {
      return add.call(this, type, type === 'message' ? wrap(listener) : listener, options);
    };
    ws.removeEventListener = function (type, listener, options) {
      return remove.call(this, type, type === 'message' && listener && wrapped.has(listener) ? wrapped.get(listener) : listener, options);
    };
    const desc = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage');
    if (desc && desc.set && desc.get) {
      let handler = null;
      Object.defineProperty(ws, 'onmessage', {
        configurable: true,
        get() {
          return handler;
        },
        set(fn) {
          handler = typeof fn === 'function' ? fn : null;
          desc.set.call(ws, handler ? wrap(handler) : null);
        },
      });
    }
  }

  function ObservedWebSocket(url, protocols) {
    const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    try {
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', (ev) => {
        // 4250 / 4300: this session was replaced by a login somewhere else
        // (the codes the game uses for that; other mods treat them the same).
        if (obs.gameSocket === ws && ev && (ev.code === 4250 || ev.code === 4300)) {
          send('superseded', { code: ev.code, reason: String(ev.reason || '').slice(0, 120) });
        }
        if (obs.gameSocket === ws) {
          obs.gameSocket = null;
          obs.injected = 0;
          obs.dropped = 0;
          obs.injectedSeqs = [];
          obs.dropSeqs = [];
          obs.nextSequence = 1;
        }
      });
      shieldGameListeners(ws);
      obs.sockets += 1;
    } catch (err) {
      /* never get in the game's way */
    }
    return ws;
  }
  ObservedWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket);
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    try {
      if (!(k in ObservedWebSocket)) ObservedWebSocket[k] = NativeWebSocket[k];
    } catch (err) {
      /* inherited anyway */
    }
  }
  window.WebSocket = ObservedWebSocket;

  /* ---------------------------------------------------------------- *
   * The game's own data tables (pets, abilities, eggs), read once per page
   * load from the game's script files, which the browser already has. See
   * game-data.js. Read-only; if it finds nothing the app uses its own tables.
   * ---------------------------------------------------------------- */

  obs.catalog = null;
  obs.catalogTried = false;

  // What the reader saw, for "Save a sample for Claude": which script files
  // there were, which it read, and what it found. Only file names and sizes.
  obs.catalogDebug = { tried: false, urls: [], read: [], error: null, found: null };

  async function readCatalog() {
    if (obs.catalogTried || !window.__MG_PARSE_GAME_CODE) return;
    obs.catalogTried = true;
    const dbg = obs.catalogDebug;
    dbg.tried = true;
    dbg.at = Date.now();
    try {
      const urls = [];
      const addUrl = (u) => {
        try {
          const url = new URL(u, location.href);
          // The game's own files, wherever they're served from (the page's
          // site or a content server): anything that looks like a script.
          if (/^https?:$/.test(url.protocol) && /\.m?js(\?|$)/.test(url.pathname) && urls.indexOf(url.href) < 0) urls.push(url.href);
        } catch (err) {
          /* not a URL */
        }
      };
      for (const e of performance.getEntriesByType('resource')) addUrl(e.name);
      for (const el of document.querySelectorAll('script[src], link[rel="modulepreload"]')) addUrl(el.src || el.href);
      // Our own site's files first, then the likely names.
      const rank = (u) => (u.startsWith(location.origin) ? 2 : 0) + (/main|index|quinoa|app|game/i.test(u) ? 1 : 0);
      urls.sort((a, b) => rank(b) - rank(a));
      dbg.urls = urls.slice(0, 40).map((u) => u.replace(/\?.*$/, '').slice(-120));
      const best = { pets: {}, abilities: {}, eggs: {} };
      for (const url of urls.slice(0, 25)) {
        const entry = { url: url.replace(/\?.*$/, '').slice(-120) };
        dbg.read.push(entry);
        try {
          const sameSite = url.startsWith(location.origin);
          const res = await fetch(url, sameSite ? { credentials: 'same-origin' } : { mode: 'cors', credentials: 'omit' });
          entry.status = res.status;
          if (!res.ok) continue;
          const text = await res.text();
          entry.size = text.length;
          entry.anchors = {
            hoursToMature: text.indexOf('hoursToMature') >= 0,
            baseProbability: text.indexOf('baseProbability') >= 0,
            faunaSpawnWeights: text.indexOf('faunaSpawnWeights') >= 0,
          };
          if (!entry.anchors.hoursToMature && !entry.anchors.baseProbability) continue;
          const found = window.__MG_PARSE_GAME_CODE(text);
          entry.parsed = { pets: Object.keys(found.pets).length, abilities: Object.keys(found.abilities).length, eggs: Object.keys(found.eggs).length };
          Object.assign(best.pets, found.pets);
          Object.assign(best.abilities, found.abilities);
          Object.assign(best.eggs, found.eggs);
          if (Object.keys(best.pets).length >= 5 && Object.keys(best.abilities).length >= 10) break;
        } catch (err) {
          entry.error = String((err && err.message) || err).slice(0, 120);
        }
      }
      dbg.found = { pets: Object.keys(best.pets).length, abilities: Object.keys(best.abilities).length, eggs: Object.keys(best.eggs).length };
      if (dbg.found.pets || dbg.found.abilities) {
        obs.catalog = best;
        send('catalog', best);
      }
    } catch (err) {
      dbg.error = String((err && err.message) || err).slice(0, 200);
    }
  }

  // A heartbeat, so the app can tell "quiet garden" apart from "lost contact".
  setInterval(() => {
    if (obs.welcomes > 0) report();
  }, 15000);

  /* ---------------------------------------------------------------- *
   * A trimmed snapshot of the data's shape, for fixing the detection
   * if the game names things differently than expected.
   * ---------------------------------------------------------------- */

  function shape(value, depth) {
    if (value == null || typeof value !== 'object') {
      return typeof value === 'string' && value.length > 80 ? value.slice(0, 80) + '...' : value;
    }
    if (depth <= 0) return Array.isArray(value) ? `[array of ${value.length}]` : '{...}';
    if (Array.isArray(value)) {
      const out = value.slice(0, 2).map((v) => shape(v, depth - 1));
      if (value.length > 2) out.push(`...and ${value.length - 2} more`);
      return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) out[k] = shape(v, depth - 1);
    return out;
  }

  // A few full crop-like objects from your slot, with where they were found.
  function cropExamples() {
    const slot = mySlot();
    if (!slot || !slot.data) return null;
    const found = [];
    const visit = (node, path, depth) => {
      if (found.length >= 6 || !node || typeof node !== 'object' || depth > 12) return;
      if (!Array.isArray(node) && Array.isArray(node.mutations)) {
        found.push({ path, object: shape(node, 3) });
        return;
      }
      for (const [k, v] of Object.entries(node)) visit(v, path + '/' + k, depth + 1);
    };
    visit(slot.data, 'data', 0);
    return found;
  }

  obs.sample = function sample() {
    const slot = mySlot();
    const logs = slot && slot.data && slot.data.activityLogs;
    return {
      takenAt: new Date().toISOString(),
      sockets: obs.sockets,
      frames: obs.frames,
      welcomes: obs.welcomes,
      patchesApplied: obs.patchesApplied,
      patchesFailed: obs.patchesFailed,
      selfPlayerId: obs.selfPlayerId,
      stateTop: shape(obs.state, 3),
      slotIds: userSlots().map((s) => s && { userId: s.userId, playerId: s.playerId, keys: Object.keys(s), dataKeys: s.data ? Object.keys(s.data) : null }),
      foundMySlot: Boolean(slot),
      mySlot: shape(slot, 7),
      mySlotLastActionEvent: slot ? slot.lastActionEvent : null,
      mySlotPetSlotInfos: slot ? shape(slot.petSlotInfos, 5) : null,
      recentActivity: Array.isArray(logs) ? logs.slice(-15) : null,
      recentActions: obs.recentActions.slice(-15),
      recentSlotChanges: obs.recentPatches.slice(-80),
      cropExamples: cropExamples(),
      cropStats: cropStats(),
      weather: quinoaData().weather === undefined ? '(missing)' : quinoaData().weather,
      weatherWindow: shape(quinoaData().weatherWindow, 3),
      petTeams: shape(slot && slot.data && slot.data.petTeams, 5),
      catalogDebug: obs.catalogDebug,
      // Every crop in the garden and pots, counted by plant and crop id, with
      // the slot numbers each sits in (to tell Thunderpeels from Stormcaps).
      cropCensus: (() => {
        const out = {};
        const add = (o) => {
          if (!o || !Array.isArray(o.slots)) return;
          for (const c of o.slots) {
            if (!c || !c.species) continue;
            const k = String(o.species || '?') + ' > ' + String(c.species);
            const e = out[k] || (out[k] = { count: 0, slots: [] });
            e.count += 1;
            if (c.slotId != null && e.slots.indexOf(c.slotId) < 0 && e.slots.length < 40) e.slots.push(c.slotId);
          }
        };
        const d0 = (slot && slot.data) || {};
        for (const o of Object.values((d0.garden && d0.garden.tileObjects) || {})) add(o);
        for (const o of ((d0.inventory && d0.inventory.items) || [])) add(o);
        for (const k of Object.keys(out)) out[k].slots.sort((a, b) => a - b);
        return out;
      })(),
      // Anything that looks like the game's Bad Luck Protection counters,
      // wherever it keeps them (added to the game Sept 2026).
      luck: (() => {
        const found = {};
        const look = (obj, where, depth) => {
          if (!obj || typeof obj !== 'object' || depth > 4) return;
          for (const [k, v] of Object.entries(obj)) {
            if (/luck|pity|miss|guarant|protect|streak/i.test(k)) found[where + k] = shape(v, 4);
            else if (v && typeof v === 'object' && !Array.isArray(v)) look(v, where + k + '.', depth + 1);
          }
        };
        look(slot && slot.data, 'slot.', 0);
        look(quinoaData(), 'game.', 1);
        return found;
      })(),
      // Only the kind and number of each command, never its contents.
      recentOutgoing: obs.recentOutgoing.slice(-20),
      // The server's answers to recent commands (type, ok, code only).
      recentResults: (obs.recentResults || []).slice(-30),
      incomingShape: obs.incomingShape || null,
      lockMode: obs.lockMode,
      commandTypes: obs.commandTypes,
      commandShapes: obs.commandShapes,
      // One whole example of each kind of activity-log entry (the log itself
      // is cut short in a sample), so its real shape can be checked.
      activityKinds: (() => {
        try {
          const out = {};
          for (const e of (slot && slot.data && Array.isArray(slot.data.activityLogs) ? slot.data.activityLogs : [])) {
            const a = String((e && e.action) || '?').slice(0, 40);
            if (!out[a] && Object.keys(out).length < 30) out[a] = shape(e, 5);
          }
          return out;
        } catch (err) {
          return 'error';
        }
      })(),
      held: (() => {
        try {
          const it = heldItem();
          return it && typeof it === 'object' ? { keys: Object.keys(it).slice(0, 20), itemType: it.itemType, species: it.species, potted: Array.isArray(it.slots), isPot: isPot(it) } : it;
        } catch (err) {
          return 'error';
        }
      })(),
      countTranslation: { appCommands: obs.injectedSeqs.length, skipped: obs.dropSeqs.length, framesTranslated: obs.translated },
      harvestLock: obs.harvestLock,
      sellsBlocked: obs.sellsBlocked || 0,
      lastSaleCheck: obs.lastSaleCheck || null,
      // One example of each kind of thing in the bag (field names, short
      // values), so the sale guard's reading of the bag can be checked.
      inventoryShapes: (() => {
        try {
          const inv = (slot && slot.data && slot.data.inventory) || {};
          const out = {};
          for (const it of Array.isArray(inv.items) ? inv.items : []) {
            if (!it || typeof it !== 'object') continue;
            const kind = String(it.itemType || (Array.isArray(it.slots) ? 'potted' : 'unknown')).slice(0, 20);
            if (out[kind]) continue;
            const ex = {};
            for (const [k, v] of Object.entries(it)) ex[k] = typeof v === 'string' ? v.slice(0, 30) : typeof v === 'number' || typeof v === 'boolean' ? v : Array.isArray(v) ? `[array of ${v.length}]` : v && typeof v === 'object' ? '{object}' : String(v);
            out[kind] = ex;
          }
          return out;
        } catch (err) {
          return 'error';
        }
      })(),
      nextSequence: obs.nextSequence,
      appCommandsSent: obs.injected,
    };
  };
})();
