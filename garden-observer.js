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

  // Which garden slot in the room is yours (v0.57.10): a different room can
  // put your garden somewhere else in the world, so "you are here" learns
  // each slot separately.
  function mySlotIndex() {
    const s = mySlot();
    const all = userSlots();
    const i = s ? all.indexOf(s) : -1;
    return i >= 0 ? i : null;
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

  // What's on a garden spot: [kind, name]. kind: p plant, e egg,
  // d decoration, s shard (hunger / XP / strength…), o anything else. The
  // name comes from whichever field holds it (species, eggId, decorId, or
  // any other "…Id" that isn't a random unique id), else the object's type.
  function tileKind(o) {
    const t = String((o && o.objectType) || '').toLowerCase();
    const looksUnique = (v) => /^[0-9a-f-]{16,}$/i.test(v);
    let name = '';
    for (const k of ['species', 'eggId', 'decorId', 'shardId', 'itemId', 'consumableId', 'name']) {
      if (typeof o[k] === 'string' && o[k] && !looksUnique(o[k])) {
        name = o[k];
        break;
      }
    }
    if (!name) {
      for (const [k, v] of Object.entries(o)) {
        if (/Id$/.test(k) && typeof v === 'string' && v && !looksUnique(v)) {
          name = v;
          break;
        }
      }
    }
    if (!name) name = String(o.objectType || '');
    const kind = /plant/.test(t) || Array.isArray(o.slots) ? 'p' : /egg/.test(t) ? 'e' : /decor/.test(t) ? 'd' : /shard/i.test(t + ' ' + name) ? 's' : 'o';
    return [kind, String(name).slice(0, 40)];
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
      ready: 0, readyValue: 0, growingValue: 0, growingPotential: 0, ripeValue: 0,
      missing: { grow: 0, size: 0, color: 0, hydro: 0, lunar: 0 },
      // How many crops have reached each step, whatever the rule says (the
      // Money tab's crop-stage track).
      have: { ripe: 0, size: 0, hydro: 0, lunar: 0, color: 0 },
      // Any weather / moon / colour mutation at all, per crop (v0.56.14): the
      // Mutations over time chart's totals. (`have` is your harvest rule's.)
      any: { hydro: 0, lunar: 0, color: 0 },
      ripeBy: null,
    };
    const now = Date.now();
    const rule = readyRuleNow();
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
        if (!unripe) {
          b.have.ripe += 1;
          // What harvesting everything ripe right now would fetch (v0.53.14).
          b.ripeValue += v;
        }
        if (Number.isFinite(size) && size >= 99.999) b.have.size += 1;
        // Each step as your rule asks for it (v0.54.7): with Thundercharged or
        // Frozen picked, a Wet crop hasn't done the weather step.
        if (HYDRO.some((k) => seen[k])) b.any.hydro += 1;
        if (LUNAR.some((k) => seen[k])) b.any.lunar += 1;
        if (seen.gold || seen.rainbow) b.any.color += 1;
        if ((rule.hydro.length ? rule.hydro : HYDRO).some((k) => seen[k])) b.have.hydro += 1;
        if ((rule.lunar.length ? rule.lunar : LUNAR).some((k) => seen[k])) b.have.lunar += 1;
        if (rule.color === 'rainbow' ? seen.rainbow : seen.gold || seen.rainbow) b.have.color += 1;
        // "Ready" is your harvest rule (v0.54.7: one definition everywhere;
        // it was a separate rule on the Money tab): ripe, then each group
        // you set (in a group any one will do; an empty group means any).
        const need = {
          grow: unripe,
          size: rule.size && Number.isFinite(size) && size > 0 && size < 99.999,
          color: rule.color === 'rainbow' ? !seen.rainbow : rule.color === 'goldOrRainbow' ? !(seen.gold || seen.rainbow) : false,
          hydro: rule.hydro.length ? !rule.hydro.some((k) => seen[k]) : false,
          lunar: rule.lunar.length ? !rule.lunar.some((k) => seen[k]) : false,
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
              mutations: need.color ? node.mutations.concat([rule.color === 'rainbow' ? 'Rainbow' : 'Gold']) : node.mutations,
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
      if (last && p.hunger > last[1] + 1) {
        tr.lastMeal = p.hunger - last[1]; // how much one meal refilled (v0.58.0)
        tr.eatAt = last[1]; // how low it got before eating (v0.59.0)
        tr.samples = []; // just fed
      }
      if (!tr.samples.length || p.hunger !== tr.samples[tr.samples.length - 1][1]) tr.samples.push([now, p.hunger]);
      while (tr.samples.length > 2 && now - tr.samples[0][0] > 10 * 60 * 1000) tr.samples.shift();
      const first = tr.samples[0];
      let secondsLeft = null;
      let perSecond = tr.perSecond || null;
      if (p.hunger <= 0) secondsLeft = 0;
      else if (first && now - first[0] >= 30000 && first[1] > p.hunger) {
        perSecond = (first[1] - p.hunger) / ((now - first[0]) / 1000);
        tr.perSecond = perSecond;
        secondsLeft = Math.round(p.hunger / perSecond);
      }
      out.push({
        id: String(p.id),
        name: String(p.name || p.petSpecies || 'Your pet'),
        species: String(p.petSpecies || ''),
        hunger: p.hunger,
        secondsLeft,
        perSecond: perSecond || null,
        lastMeal: tr.lastMeal || null,
        eatAt: tr.eatAt == null ? null : tr.eatAt,
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

  /* How long the app's own work on the game page takes (v0.73.1; the owner's
   * game froze while he moved plants): each job timed, and the browser's
   * long tasks (50 ms+) noted with how much of each was the app's. In the
   * sample. */
  const PERF_JOBS = {};
  const perfSpans = [];
  obs.perf = { since: Date.now(), longTasks: { count: 0, maxMs: 0, oursMs: 0, recent: [] } };
  function perfTimed(name, fn) {
    return function timed() {
      const t0 = performance.now();
      try {
        return fn.apply(this, arguments);
      } finally {
        const t1 = performance.now();
        const j = PERF_JOBS[name] || (PERF_JOBS[name] = { n: 0, total: 0, max: 0 });
        j.n += 1;
        j.total += t1 - t0;
        j.max = Math.max(j.max, t1 - t0);
        if (t1 - t0 >= 2) {
          perfSpans.push([t0, t1, name]);
          if (perfSpans.length > 200) perfSpans.shift();
        }
      }
    };
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const lt = obs.perf.longTasks;
        const end = e.startTime + e.duration;
        let ours = 0;
        const by = {};
        for (const [a, b, name] of perfSpans) {
          const o = Math.min(b, end) - Math.max(a, e.startTime);
          if (o > 0) {
            ours += o;
            by[name] = Math.round((by[name] || 0) + o);
          }
        }
        lt.count += 1;
        lt.maxMs = Math.max(lt.maxMs, Math.round(e.duration));
        lt.oursMs += ours;
        lt.recent.push({ at: Date.now(), ms: Math.round(e.duration), oursMs: Math.round(ours), by });
        if (lt.recent.length > 30) lt.recent.shift();
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch (err) {
    obs.perf.longTasks = null;
  }
  obs.perfView = function perfView() {
    const r = (x) => Math.round(x * 10) / 10;
    const jobs = {};
    for (const [k, j] of Object.entries(PERF_JOBS)) jobs[k] = { n: j.n, avgMs: j.n ? r(j.total / j.n) : 0, maxMs: r(j.max), totalS: r(j.total / 1000) };
    const lt = obs.perf.longTasks;
    return { minutes: r((Date.now() - obs.perf.since) / 60000), jobs, longTasks: lt && { count: lt.count, maxMs: lt.maxMs, oursS: r(lt.oursMs / 1000), recent: lt.recent.slice() } };
  };

  const report = perfTimed('report', reportJob);
  function reportJob() {
    obs.lastReport = Date.now();
    try {
      mapUpdate();
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
          out[k] = tileKind(o);
        }
        return out;
      })(),
      // Crops in your inventory (harvested, not sold yet), valued the same
      // way as the garden's, for checking the app's values against real
      // sales (v0.53.15). `sized` says how many have a size the valuation
      // can read; `shape` is one such item's keys, for the sample.
      // Potted plants and seeds in the bag, for the action bar's menu (v0.57.0).
      bag: (() => { try { return obs.bagSummary ? obs.bagSummary() : null; } catch (err) { return null; } })(),
      // The garden tile you're standing on (v0.57.6), and how far learning is.
      meTile: obs.meTile == null ? null : obs.meTile,
      meGap: obs.meGap == null ? null : obs.meGap,
      calib: (() => { try { return obs.calibInfo ? obs.calibInfo() : null; } catch (err) { return null; } })(),
      inventoryCrops: (() => {
        try {
          const sl = mySlot();
          const items = (sl && sl.data && sl.data.inventory && sl.data.inventory.items) || [];
          let n = 0;
          let v = 0;
          let sized = 0;
          let shape = null;
          for (const it of items) {
            if (!isCrop(it)) continue;
            n += 1;
            if (Number.isFinite(Number(it.size)) && Number(it.size) > 0) sized += 1;
            if (!shape) shape = Object.keys(it).slice(0, 20);
            v += window.__MG_CROP_VALUE ? window.__MG_CROP_VALUE(it, { unpriced: 0, unpricedSpecies: {}, unknownMutations: [] }) : 0;
          }
          return { n, v: Math.round(v), sized, shape };
        } catch (err) {
          return null;
        }
      })(),
      // Each plant on its tile, for the Garden map's to-do (garden-plan.js):
      // { i: tile, sp: species, s: [[mutations, size, ripe 0/1, value]] }.
      gardenPlants: (() => {
        const sl = mySlot();
        const tiles = (sl && sl.data && sl.data.garden && sl.data.garden.tileObjects) || {};
        const now = Date.now();
        const out = [];
        for (const [k, o] of Object.entries(tiles)) {
          if (!o || !Array.isArray(o.slots) || !o.slots.length) continue;
          const s = [];
          for (const c of o.slots) {
            if (!isCrop(c)) continue;
            const end = Number(c.endTime);
            const v = window.__MG_CROP_VALUE ? window.__MG_CROP_VALUE(c, { unpriced: 0, unpricedSpecies: {}, unknownMutations: [] }) : 0;
            s.push([c.mutations.map(mutationKey).join(','), Math.round((Number(c.size) || 0) * 10) / 10, Number.isFinite(end) && end > now ? 0 : 1, Math.round(v)]);
          }
          out.push({ i: Number(k), sp: String(o.species || (o.slots[0] && o.slots[0].species) || ''), s });
        }
        return out;
      })(),
      // Daily quests (v0.65.0): today's three, as the game keeps them, and
      // its own lifetime quest counters.
      dailyQuests: (() => {
        try {
          const sl = mySlot();
          const dq = sl && sl.data && sl.data.dailyQuests;
          return dq && typeof dq === 'object' ? JSON.parse(JSON.stringify(dq)) : null;
        } catch (err) {
          return null;
        }
      })(),
      // The Haunt Quest (v0.66.0): snap haunts with the Camera.
      spookyQuest: (() => {
        try {
          const sl = mySlot();
          const sq = sl && sl.data && sl.data.spookyQuest;
          return sq && typeof sq === 'object' ? JSON.parse(JSON.stringify(sq)) : null;
        } catch (err) {
          return null;
        }
      })(),
      questStats: (() => {
        try {
          const p = (mySlot() || {}).data;
          const st = p && p.stats && p.stats.player;
          if (!st || st.numDailyQuestsCompleted == null) return null;
          const num = (k) => Number(st[k]) || 0;
          return {
            completed: num('numDailyQuestsCompleted'), rerolled: num('numDailyQuestsRefreshed'),
            easy: num('numEasyDailyQuestsCompleted'), medium: num('numMediumDailyQuestsCompleted'), hard: num('numHardDailyQuestsCompleted'),
            coins: num('totalCoinsFromDailyQuests'), dust: num('totalDustFromDailyQuests'),
            haunts: num('numSpookyQuestsCompleted'),
          };
        } catch (err) {
          return null;
        }
      })(),
      // Eggs growing in the garden and when each hatches (for egg quests).
      gardenEggs: (() => {
        const sl = mySlot();
        const tiles = (sl && sl.data && sl.data.garden && sl.data.garden.tileObjects) || {};
        const out = [];
        for (const o of Object.values(tiles)) {
          if (!o || typeof o !== 'object' || !o.eggId) continue;
          const at = Number(o.maturedAt || o.endTime || o.hatchAt);
          out.push({ egg: String(o.eggId), at: Number.isFinite(at) && at > 0 ? at : null });
        }
        return out;
      })(),
      // The Garden Journal: how many entries are logged, crops and pets.
      journal: (() => {
        try {
          const j = (mySlot() || {}).data;
          const jr = j && j.journal;
          if (!jr || typeof jr !== 'object') return null;
          const count = (group) => Object.values(group || {}).reduce((a, e) => a + (e && Array.isArray(e.variantsLogged) ? e.variantsLogged.length : 0), 0);
          return { crops: count(jr.produce), pets: count(jr.pets), cropKinds: Object.keys(jr.produce || {}).length, petKinds: Object.keys(jr.pets || {}).length };
        } catch (err) {
          return null;
        }
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
          mapUpdate();
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

  const onMessage = perfTimed('frames', onMessageJob);
  function onMessageJob(event) {
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
      // Daily quests (v0.64.2): how the game sends them, for the sample.
      // A message about quests is kept whole (the last few, cut short);
      // the Welcome only for its quest-looking parts.
      if (/quest|journal|reward|streak/i.test(t)) {
        const q = obs.questMessages || (obs.questMessages = []);
        q.push({ at: Date.now(), type: t, body: data.slice(0, 6000) });
        if (q.length > 6) q.shift();
      } else if (t === 'Welcome') {
        const hit = {};
        for (const k of Object.keys(msg)) if (/quest|journal|reward|streak/i.test(k)) hit[k] = msg[k];
        if (Object.keys(hit).length) obs.questWelcome = JSON.stringify(hit).slice(0, 8000);
      }
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

    if (msg.type === 'QuinoaMovementSnapshot' || msg.type === 'QuinoaMovementBatch') {
      try { noteMovement(msg); } catch (err) { /* never in the way */ }
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
      // The lineup you had out (v0.56.5): a pet swap restarts the wait for
      // it to settle; doing something else means you've moved on.
      noteCommandForLineup(env.command);
      try { learnPotCommand(env.command); } catch (err) { /* never in the way */ }
      try { calibrateFrom(env.command); } catch (err) { /* never in the way */ }
      try { notePlanted(env.command); } catch (err) { /* never in the way */ }
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
      // Egg locks (v0.69.0): a hatch of an egg you've locked never reaches
      // the server. It's dropped, the game gets a refusal (so it doesn't
      // wait) and the count translation keeps the numbering in step, as the
      // pet-food guard does. While any egg is locked, a hatch the app can't
      // put a name to is stopped too; try again a moment later.
      if (env.command && env.command.type === 'HatchEgg') {
        try { noteHatching(); } catch (err) { /* never in the way */ }
      }
      if (env.command && env.command.type === 'HatchEgg' && (obs.eggLock || []).length) {
        const egg = eggAtSlot(env.command.slot);
        if (!egg || eggLocked(egg)) {
          const entry = obs.recentOutgoing[obs.recentOutgoing.length - 1];
          entry.blocked = true;
          obs.hatchesBlocked = (obs.hatchesBlocked || 0) + 1;
          obs.dropped += 1;
          obs.dropSeqs.push(obs.nextSequence);
          refuse(ws, env, 'HatchEgg', 'blocked_by_egg_lock');
          showEggLocked(egg);
          send('hatchBlocked', { egg: egg || '' });
          return null;
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
  /* What was just planted where (v0.59.7). Planting a potted plant shows in
   * the game at once, but the app's copy of the garden only has it when the
   * server confirms, a moment later. A harvest in between (plant a potted
   * Ube, pick it straight away) found an empty tile and was let through. So
   * the pot's plant is noted by tile from the bag as the command goes out,
   * and a harvest there in the next few seconds goes by it. */
  obs.pendingPlants = {};
  function notePlanted(cmd) {
    if (!cmd || typeof cmd !== 'object') return;
    const pc = obs.potCommand || {};
    if (cmd.type !== 'PlantGardenPlant' && cmd.type !== pc.type) return;
    const id = cmd[pc.idKey || 'itemId'] || cmd.itemId;
    const slot = cmd[pc.slotKey || 'slot'];
    if (id == null || slot == null) return;
    const item = bagItems().find((it) => it && String(it.id) === String(id));
    if (!item) return;
    obs.pendingPlants[String(slot)] = { at: Date.now(), tile: { objectType: 'plant', species: item.species, slots: Array.isArray(item.slots) ? item.slots : [] } };
  }
  function harvestTarget(cmd) {
    const sl = mySlot();
    const tiles = (sl && sl.data && sl.data.garden && sl.data.garden.tileObjects) || {};
    const pending = obs.pendingPlants[String(cmd.slot)];
    const fresh = pending && Date.now() - pending.at < 10000 ? pending.tile : null;
    const tile = tiles[cmd.slot] || tiles[String(cmd.slot)] || fresh;
    if (!tile) return null;
    const slots = Array.isArray(tile.slots) ? tile.slots : [];
    const crop = slots.find((c) => c && c.slotId === cmd.slotsIndex) || slots[cmd.slotsIndex] || null;
    if (!crop) return null;
    return { plant: String(tile.species || ''), crop: String(crop.species || tile.species || ''), cropObj: crop };
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
    // A harvest it can't identify (v0.59.7: fail closed). While the lock, a
    // protected crop or harvest mode is on, not knowing what it is mustn't
    // mean letting it through: it's stopped, and you try again a moment
    // later, when the app has caught up. (Planting a pot sends no harvest.)
    if (!target) {
      const guarded = lock.on || (lock.species || []).length > 0 || (lock.mode && lock.mode.on);
      return guarded ? { reason: 'unknown', crop: '' } : null;
    }
    const what = target.crop;
    // Harvest mode first (v0.57.3): while it's on, only its rule decides;
    // the lock and protections step aside (they're kept as they are, and
    // apply again the moment harvest mode goes off).
    if (lock.mode && lock.mode.on) {
      const why = harvestMiss(target.cropObj, lock.mode);
      return why ? { reason: 'mode', crop: what, why } : null;
    }
    if (lock.on) return { reason: 'lock', crop: what };
    // A crop is protected by its own species (v0.57.3). The plant's species
    // only counts when the crop's isn't known: a Thunderspire grows
    // Thunderpeel (ThunderCelestial, the plant's own id) and Stormcap
    // (ThunderCelestialShroomPlant), so going by the plant made protecting
    // Thunderpeel protect Stormcap too.
    const list = (lock.species || []).map(normId);
    const own = normId(target.crop);
    if (list.length && (own ? list.includes(own) : list.includes(normId(target.plant)))) {
      return { reason: 'protected', crop: what };
    }
    return null;
  }

  /* Harvest mode's rule (the same as harvest-rule.js in the app): groups
   * that must all match; within a group any one will do; an empty group
   * means any. Returns why a crop doesn't match, or null when it does. */
  const HV_NAMES = { wet: 'Wet', chilled: 'Chilled', frozen: 'Frozen', thunderstruck: 'Thunderstruck', thundercharged: 'Thundercharged', dawnlit: 'Dawnlit', dawnbound: 'Dawnbound', amberlit: 'Amberlit', amberbound: 'Amberbound' };
  function harvestMiss(crop, mode) {
    const keys = new Set((crop && Array.isArray(crop.mutations) ? crop.mutations : []).map(mutationKey));
    const hydro = Array.isArray(mode.hydro) ? mode.hydro : [];
    const lunar = Array.isArray(mode.lunar) ? mode.lunar : [];
    if (mode.color === 'rainbow' && !keys.has('rainbow')) return 'not Rainbow';
    if (mode.color === 'goldOrRainbow' && !keys.has('gold') && !keys.has('rainbow')) return 'not Gold or Rainbow';
    if (hydro.length && !hydro.some((x) => keys.has(x))) return 'not ' + hydro.map((x) => HV_NAMES[x] || x).join(' or ');
    if (lunar.length && !lunar.some((x) => keys.has(x))) return 'not ' + lunar.map((x) => HV_NAMES[x] || x).join(' or ');
    if (mode.size && !(Number(crop && crop.size) >= 99.999)) return 'not full size';
    return null;
  }
  function harvestWords(mode) {
    const bits = [];
    if (mode.color === 'rainbow') bits.push('Rainbow');
    if (mode.color === 'goldOrRainbow') bits.push('Gold or Rainbow');
    if ((mode.hydro || []).length) bits.push(mode.hydro.map((x) => HV_NAMES[x] || x).join(' or '));
    if ((mode.lunar || []).length) bits.push(mode.lunar.map((x) => HV_NAMES[x] || x).join(' or '));
    if (mode.size) bits.push('full size');
    return bits.length ? bits.join(' · ') : 'anything';
  }

  // A small badge in the game's corner while the lock is on, and a brief
  // note when a harvest is stopped. On this screen only.
  function lockBadge() {
    let el = document.getElementById('__mgHarvestLock');
    const on = obs.harvestLock && obs.harvestLock.on;
    const mode = obs.harvestLock && obs.harvestLock.mode && obs.harvestLock.mode.on ? obs.harvestLock.mode : null;
    if (!on && !mode) {
      if (el) el.remove();
      return;
    }
    // Harvest mode wins over the lock (v0.57.3), and looks engaged: red.
    const text = mode ? '🧺 HARVESTING UNLOCKED · ' + harvestWords(mode) : '🔒 Harvest lock';
    const bg = mode ? 'rgba(200,40,48,.92)' : 'rgba(42,27,54,.85)';
    if (el) {
      el.textContent = text;
      el.style.background = bg;
    }
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = '__mgHarvestLock';
      el.textContent = text;
      el.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483646;pointer-events:none;background:' + bg + ';color:#f6f1f8;font:600 12px system-ui,sans-serif;padding:5px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.18)';
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
      // Locked means the crop's own id is in the lock list. A kind's name in
      // the list (like "Cabbage") doesn't keep a crop from being sold: the
      // game took a locked-by-name Cabbage in Sept 2026. Only a crop with no
      // id at all falls back to its name.
      if (it.id != null ? fav.has(String(it.id)) : fav.has(String(it.species)) || favNz.has(nz(it.species))) continue;
      const q = Math.max(1, Math.floor(Number(it.quantity) || 1));
      const c = counts[it.species] || (counts[it.species] = { count: 0, ids: [] });
      c.count += q;
      if (it.id != null) c.ids.push(String(it.id));
      else c.noId = true;
    }
    const crops = Object.entries(counts).map(([species, c]) => ({ species: String(species).slice(0, 40), count: c.count, ids: c.ids, noId: Boolean(c.noId) }));
    obs.lastSaleCheck = { at: Date.now(), command: String(cmd.type || '').slice(0, 40), items: (inv.items || []).length, produceSeen, potted, foodSeen, favourites: fav.size, blocked: crops.map((c) => ({ species: c.species, count: c.count, ids: c.ids.length, noId: c.noId })) };
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
  function lockList() {
    const slot = mySlot();
    const ids = (slot && slot.data && slot.data.inventory && slot.data.inventory.favoritedItemIds) || [];
    return Array.isArray(ids) ? ids.map(String) : [];
  }
  function inBag(id) {
    const slot = mySlot();
    const items = (slot && slot.data && slot.data.inventory && slot.data.inventory.items) || [];
    return Array.isArray(items) && items.some((it) => it && String(it.id) === String(id));
  }

  // Locks one crop item (the game's right-click lock: ToggleLockItem) by its
  // own id, and waits until the bag's lock list shows that id. The field is
  // itemId (the game accepts it); id is tried if that's ever refused. A
  // kind's name is never sent: it doesn't keep crops, and a toggle by name
  // could flip the lock on that kind's seeds.
  const LOCK_FIELDS = ['itemId', 'id'];
  async function lockItem(id) {
    if (lockList().includes(String(id))) return true;
    const fields = obs.lockField && LOCK_FIELDS.includes(obs.lockField) ? [obs.lockField].concat(LOCK_FIELDS.filter((f) => f !== obs.lockField)) : LOCK_FIELDS;
    for (const field of fields) {
      const cmd = { type: 'ToggleLockItem' };
      cmd[field] = String(id);
      const res = await sendAndWait(cmd, 'Lock:' + String(id).slice(0, 12));
      if (!res.ok) continue; // the server refused this shape: try the next
      for (let i = 0; i < 20; i += 1) {
        if (lockList().includes(String(id))) {
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

  // Unlocks one item the guard locked (v0.57.11). ToggleLockItem toggles,
  // so it's only sent while the item shows as locked, and waits until the
  // lock list no longer has it.
  async function unlockItem(id) {
    if (!lockList().includes(String(id))) return true;
    const field = obs.lockField && LOCK_FIELDS.includes(obs.lockField) ? obs.lockField : LOCK_FIELDS[0];
    const cmd = { type: 'ToggleLockItem' };
    cmd[field] = String(id);
    const res = await sendAndWait(cmd, 'Unlock:' + String(id).slice(0, 12));
    if (!res.ok) return false;
    for (let i = 0; i < 20; i += 1) {
      if (!lockList().includes(String(id))) return true;
      await sleep(100);
    }
    return false;
  }
  // The pet food the guard locked for a sale goes back to how it was
  // (v0.57.11): only items the guard locked; ones you locked stay locked.
  async function unlockAfterSale(ids) {
    let n = 0;
    for (const id of ids) if (inBag(id) && (await unlockItem(id))) n += 1;
    return n;
  }

  // Locks every unlocked pet-food crop, then sends the sale the game
  // wanted, then unlocks what it locked (so the food can go in the trough).
  // If a lock can't be made, nothing is sold.
  async function autoLockAndSell(crops, sale) {
    if (obs.autoLocking) return;
    obs.autoLocking = true;
    const locked = [];
    const failed = [];
    const byGuard = [];
    try {
      for (const c of crops) {
        let all = !c.noId && c.ids.length > 0;
        for (const id of c.ids) {
          const was = lockList().includes(String(id));
          if (!(await lockItem(id))) all = false;
          else if (!was) byGuard.push(String(id));
        }
        if (all) locked.push(c.species);
        else failed.push(c.species);
      }
      // If locks ever failed to hold, the app no longer re-sends sales: it
      // stops them and asks for a hand lock instead.
      if (obs.locksUntrusted && !failed.length) failed.push(...locked.splice(0));
      if (!failed.length) {
        const r = sendCommand(sale, 'Sell:after-lock');
        // Then make sure: every crop that was locked should still be here.
        await sleep(1500);
        const gone = crops.filter((c) => c.ids.some((id) => !inBag(id))).map((c) => c.species);
        const unlocked = await unlockAfterSale(byGuard);
        if (gone.length) {
          obs.locksUntrusted = true;
          showBlocked({ reason: 'petfood-failed', crops, failed: gone });
          send('sellGuard', { ok: false, soldAnyway: gone, locked, unlocked, resent: r.ok, command: String(sale.type || '').slice(0, 40) });
        } else {
          showBlocked({ reason: 'petfood-locked', crops, unlocked: unlocked > 0 });
          send('sellGuard', { ok: true, locked, unlocked, resent: r.ok, command: String(sale.type || '').slice(0, 40) });
        }
      } else {
        // Not sold: whatever the guard locked goes back as it was.
        const unlocked = await unlockAfterSale(byGuard);
        showBlocked({ reason: 'petfood-failed', crops, failed });
        send('sellGuard', { ok: false, locked, failed, unlocked, command: String(sale.type || '').slice(0, 40) });
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
    // The celestials by the names players know (the game's ids are
    // ThunderCelestial and so on).
    const CELESTIAL = { thundercelestialshroomplant: 'Stormcap', thundercelestial: 'Thunderpeel', dawncelestial: 'Dawnbinder', mooncelestial: 'Moonbinder', starcelestial: 'Starweaver' };
    const name = b.crop ? CELESTIAL[String(b.crop).toLowerCase()] || b.crop.replace(/([a-z])([A-Z])/g, '$1 $2') : 'crop';
    if (b.reason === 'petfood-locked' || b.reason === 'petfood-failed') {
      const pretty = (x) => String(x).replace(/([a-z])([A-Z])/g, '$1 $2');
      const list = (b.crops || []).slice(0, 4).map((c) => pretty(c.species) + ' ×' + c.count).join(', ');
      note.textContent = b.reason === 'petfood-locked'
        ? '🐾 Kept your pet food: ' + list + (b.crops.length > 4 ? '…' : '') + ', sold the rest' + (b.unlocked ? '; unlocked again for the trough.' : '.')
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
    if (b.reason === 'mode') {
      // Sweeping the garden: one note that updates, not dozens stacking.
      let el = document.getElementById('__mgHarvestNote');
      if (!el) {
        el = document.createElement('div');
        el.id = '__mgHarvestNote';
        el.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:rgba(42,27,54,.92);color:#fff;font:700 14px system-ui,sans-serif;padding:7px 14px;border-radius:10px;transition:opacity .3s;';
        document.body.appendChild(el);
      }
      el.textContent = '🧺 Kept ' + name + ': ' + b.why;
      el.style.opacity = '1';
      clearTimeout(el.__t);
      el.__t = setTimeout(() => { el.style.opacity = '0'; }, 900);
      return;
    }
    note.textContent = b.reason === 'lock' ? '🔒 Harvest lock has blocked harvesting'
      : b.reason === 'unknown' ? '🔒 Stopped a harvest the app couldn\'t identify yet: try again in a moment'
        : '🔒 ' + name + ' is protected';
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

  // The item in your hand. The game now says so by id (v0.54.5, seen in the
  // owner's sample): slot.heldItem = { itemId, decorRotation }, and picking
  // something up sends SetSelectedItem { itemId: 'PlanterPot' }. A tool is
  // matched by its toolId, a potted plant (or egg, decor...) by its own id.
  // Before, it was notAuthoritative_selectedItemIndex, an index into the
  // inventory, which is kept as a fallback for older games.
  function heldItem() {
    const slot = mySlot();
    if (!slot || !slot.data) return null;
    const items = (slot.data.inventory && slot.data.inventory.items) || [];
    const h = slot.heldItem;
    if (h && typeof h === 'object' && 'itemId' in h) {
      const id = h.itemId;
      if (id == null || id === '') return null;
      const found = items.find((it) => it && typeof it === 'object' && (it.id === id || it.toolId === id || it.decorId === id || it.eggId === id || (it.itemType !== 'Produce' && it.species === id)));
      return found || { itemId: String(id), toolId: String(id) };
    }
    const idx = Number(slot.notAuthoritative_selectedItemIndex);
    if (!Number.isFinite(idx)) return null;
    return items[idx] || null;
  }

  function isPot(it) {
    if (!it || typeof it !== 'object') return false;
    // A potted plant, however the game shapes it (v0.53.11: more shapes).
    if (Array.isArray(it.slots) || Array.isArray(it.growSlots) || /^(plant|pottedplant)$/i.test(String(it.itemType || ''))) return true;
    const t = String(it.itemType || '') + ' ' + String(it.species || '') + ' ' + String(it.toolId || it.id || '');
    return /planter|potted|pot\b/i.test(t);
  }

  /* One map over the game (v0.54.3): what it shows follows what you're
   * doing, most pressing first:
   *   1. holding a pot: open spots,
   *   2. an Amber Moon or Dawn, with that binder: the binder map,
   *   3. riding an Ostrich or Phoenix: what to ride over,
   *   4. a Thunder Wolf out with Thunderstruck crops left: where they are,
   *   5. an Ostrich or Phoenix out: its crops to capture.
   * When more than one applies, little tabs in its title switch between them
   * (a pick holds until something new comes up). Each view is a model: a
   * title, a count on the right, a line, a key and the 200 tiles' looks; one
   * box draws whichever is up, in one place, folded or not as you left it. */
  function binderMapStyle() {
    const st = document.createElement('style');
    st.id = 'mg-binder-style';
    st.textContent = '@keyframes mgBindPulse{0%,100%{box-shadow:0 0 0 1px var(--g),0 0 6px 1px var(--g)}50%{box-shadow:0 0 0 1px var(--g),0 0 2px 0 var(--g)}}'
      + '#mg-map i.pulse{animation:mgBindPulse 1.1s ease-in-out infinite}'
      + '@media (prefers-reduced-motion:reduce){#mg-map i.pulse{animation:none}}'
      // The map sizes itself, whatever the game's page does (v0.56.8: the
      // game counts padding inside widths, which squeezed the grid out of a
      // 290 px box): 289 px of grid + 20 padding + 2 border = 311.
      + '#mg-map,#mg-map *{box-sizing:border-box}'
      // Views fade into each other instead of snapping (v0.56.9).
      + '#mg-map i{transition:background-color .25s ease,box-shadow .25s ease}'
      // You are here (v0.57.6).
      // A dot with a dark edge (shows on any colour) and a white / gold pulse.
      + '#mg-map i.mg-me{outline:2px solid #fff;outline-offset:1px;position:relative;z-index:2;animation:mgMe 1.2s ease-in-out infinite}'
      + '#mg-map i.mg-me::after{content:"";position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:#fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.75)}'
      + '@keyframes mgMe{50%{outline-color:#ffd35c}}'
      + '@media (prefers-reduced-motion:reduce){#mg-map i.mg-me{animation:none}}'
      + '@media (prefers-reduced-motion:reduce){#mg-map i{transition:none}}'
      + '.mg-map-head{touch-action:none}'
      + '.mg-map-head .mg-title::before{content:"\\25BE";display:inline-block;width:12px;opacity:.55;font-weight:400}'
      + '.mg-folded .mg-map-head .mg-title::before{content:"\\25B8"}'
      + '.mg-folded .mg-tabs{display:none!important}'
      + '.mg-folded>*:not(.mg-map-head){display:none!important}'
      + '.mg-folded .mg-map-head{margin-bottom:0!important}'
      + '.mg-tab{font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:8px;background:rgba(255,255,255,.12);color:#ddd;cursor:pointer;line-height:16px}'
      + '.mg-tab:hover{background:rgba(255,255,255,.22)}';
    (document.head || document.documentElement).appendChild(st);
  }
  let MAP = null;
  let mapLast = '';
  let mapTick = null;
  obs.mapPick = null;
  obs.mapPickSet = '';
  obs.mapCtx = null;
  obs.riding = false;
  // The binder map first during its event (v0.54.6): it shows the open spots
  // too while you hold a pot, so picking one up doesn't hide the binders.
  const MAP_ORDER = ['binder', 'spots', 'harvest', 'ride', 'thunder', 'capture'];
  // One calm base for every view (v0.56.9): empty ground, plants and other
  // things look the same in all of them, so switching views only changes
  // what's highlighted. Highlights are a little softer, and glows are
  // see-through.
  // v0.56.12: solid steps, no outlines: the box (#16101d), empty ground a
  // step lighter, plants and things lighter again.
  const MAP_BASE = { empty: '#251d2f', plant: '#342b40', thing: '#3e344b', ringPlant: '#463b55' };
  const softGlow = (c) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c || ''));
    return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},.55)` : c;
  };
  const tilesOf = (slot) => (slot && slot.data && slot.data.garden && slot.data.garden.tileObjects) || {};
  const tileAt = (tiles, i) => tiles[i] || tiles[String(i)];
  const ripeCrops = (t, now) => (Array.isArray(t.slots) ? t.slots : []).filter((c) => isCrop(c) && !(Number.isFinite(Number(c.endTime)) && Number(c.endTime) > now));

  // What you've held lately (v0.54.3): each change of the selected slot, the
  // item at that index as the inventory lists it and as a favourites-first
  // hotbar would, and whether each counts as a pot. In a saved sample, so how
  // the game numbers its slots can be checked against a real pot in hand.
  obs.heldLog = [];
  // Starts as something no hand can be, so the first look is always noted
  // (v0.54.5: it started as undefined, which a missing field also is, so a
  // renamed field was never noted at all).
  let heldKeyLast = '\u0000unseen';
  function noteHeld() {
    const slot = mySlot();
    if (!slot) return;
    const idx = slot.notAuthoritative_selectedItemIndex;
    const key = JSON.stringify([slot.heldItem === undefined ? '(no heldItem)' : slot.heldItem, idx === undefined ? '(no index)' : idx]);
    if (key === heldKeyLast) return;
    heldKeyLast = key;
    const got = heldItem();
    const inv = (slot.data && slot.data.inventory) || {};
    const items = Array.isArray(inv.items) ? inv.items : [];
    const favs = Array.isArray(inv.favoritedItemIds) ? inv.favoritedItemIds : [];
    const idOf = (it) => it && typeof it === 'object' && (it.id || it.species || it.toolId || it.decorId || it.eggId);
    const favFirst = favs.map((f) => items.find((it) => idOf(it) === f)).filter(Boolean).concat(items.filter((it) => !favs.includes(idOf(it))));
    const sum = (it) => (it && typeof it === 'object' ? { itemType: it.itemType, toolId: it.toolId, species: it.species, keys: Object.keys(it).slice(0, 12), pot: isPot(it) } : it || null);
    const n = Number(idx);
    obs.heldLog.push({ at: Date.now(), heldItem: slot.heldItem === undefined ? '(none)' : slot.heldItem, index: idx === undefined ? '(none)' : idx, count: items.length, resolved: sum(got), asListed: Number.isFinite(n) ? sum(items[n]) : null, favouritesFirst: Number.isFinite(n) ? sum(favFirst[n]) : null });
    if (obs.heldLog.length > 12) obs.heldLog.shift();
  }

  // 1. Open spots, while you hold a pot.
  const SPOT_COL = { open: '#6fd68a', p: MAP_BASE.plant, e: MAP_BASE.thing, d: MAP_BASE.thing, s: MAP_BASE.thing };
  function spotModel(force) {
    const held = obs.spotMapOn ? heldItem() : null;
    if (!force && (!held || !isPot(held))) return null;
    const tiles = tilesOf(mySlot());
    let open = 0;
    const looks = [];
    for (let i = 0; i < 200; i += 1) {
      const t = tileAt(tiles, i);
      if (t && typeof t === 'object') looks.push({ bg: SPOT_COL[tileKind(t)[0]] || SPOT_COL.p });
      else {
        open += 1;
        looks.push({ bg: SPOT_COL.open, glow: SPOT_COL.open });
      }
    }
    return {
      ctx: 'spots', icon: '🪴', chip: `${open}`, title: '🪴 Open spots', right: open ? `${open} open` : 'none open', rightColor: open ? SPOT_COL.open : '#cbb',
      sum: open ? `${open} open spot${open === 1 ? '' : 's'}${held && isPot(held) ? ' for this pot' : ''}: the glowing ${open === 1 ? 'one' : 'ones'}.` : 'No open spots: every tile has something on it. Pot a plant to free one.',
      key: [[SPOT_COL.open, SPOT_COL.open, 'open'], [MAP_BASE.plant, '', 'taken']],
      looks,
    };
  }

  // 1b. Harvest mode (v0.54.4): what your rule lets you harvest.
  function harvestModel() {
    const mode = obs.harvestLock && obs.harvestLock.mode && obs.harvestLock.mode.on && !obs.harvestLock.on ? obs.harvestLock.mode : null;
    if (!mode) return null;
    const tiles = tilesOf(mySlot());
    const now = Date.now();
    let crops = 0;
    let plants = 0;
    const looks = [];
    for (let i = 0; i < 200; i += 1) {
      const t = tileAt(tiles, i);
      if (t && typeof t === 'object' && Array.isArray(t.slots)) {
        const n = ripeCrops(t, now).filter((c) => !harvestMiss(c, mode)).length;
        crops += n;
        if (n) plants += 1;
        looks.push(n ? { bg: '#79cf98', glow: '#79cf98' } : { bg: MAP_BASE.plant });
      } else looks.push({ bg: t && typeof t === 'object' ? MAP_BASE.thing : MAP_BASE.empty });
    }
    return {
      ctx: 'harvest', icon: '🧺', chip: `${crops}`, title: '🧺 Harvesting unlocked', right: `${crops} to harvest`, rightColor: '#79cf98',
      sum: `Only ${harvestWords(mode)}: ${crops} crop${crops === 1 ? '' : 's'} on ${plants} plant${plants === 1 ? '' : 's'}. Everything else is kept.`,
      key: [['#79cf98', '#79cf98', 'has crops to harvest'], [MAP_BASE.plant, '', 'nothing that matches']],
      looks,
    };
  }

  // 2. The binder map, during an Amber Moon (Moonbinder) or a Dawn (Dawnbinder).
  obs.binderOn = true;
  obs.binderEvent = null;
  const B_COL = {
    amber: { lit: '#f0b35e', glow: '#f0b35e', bound: '#3d3428', other: '#a05a86', otherDim: '#43303f', ring: 'rgba(233,213,255,.85)', name: 'Amber', other_name: 'Dawn', binder: 'Moonbinder', title: '🌕 Amber Moon' },
    dawn: { lit: '#cdb2ef', glow: '#b98ae6', bound: '#3a3348', other: '#a0703e', otherDim: '#433a30', ring: 'rgba(216,180,254,.9)', name: 'Dawn', other_name: 'Amber', binder: 'Dawnbinder', title: '🌅 Dawn' },
  };
  function isBinderOf(tile, kind) {
    const sp = String((tile && tile.species) || '');
    return kind === 'amber' ? /moon(celestial|binder)/i.test(sp) : /dawn(celestial|binder)/i.test(sp);
  }
  function ring(i) {
    const row = Math.floor(i / 20);
    const col = i % 20;
    const side = col < 10 ? 0 : 1;
    const out = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const r = row + dr;
        const c = col + dc;
        if ((dr || dc) && r >= 0 && r <= 9 && c >= 0 && c <= 19 && (c < 10 ? 0 : 1) === side) out.push(r * 20 + c);
      }
    }
    return out;
  }
  function binderModel(forceKind) {
    const ev = forceKind ? { kind: forceKind, endsAt: null } : obs.binderOn && obs.binderEvent && (!obs.binderEvent.endsAt || obs.binderEvent.endsAt > Date.now()) ? obs.binderEvent : null;
    if (!ev) return null;
    const tiles = tilesOf(mySlot());
    const binders = [];
    for (let i = 0; i < 200; i += 1) {
      const t = tileAt(tiles, i);
      if (t && Array.isArray(t.slots) && isBinderOf(t, ev.kind)) binders.push(i);
    }
    if (!binders.length) return null;
    const C = B_COL[ev.kind];
    const near = new Set();
    for (const bi of binders) for (const n of ring(bi)) near.add(n);
    const now = Date.now();
    const lit = `${ev.kind}lit`;
    const bound = `${ev.kind}bound`;
    const other = ev.kind === 'amber' ? /^dawn(lit|bound)$/ : /^amber(lit|bound)$/;
    const count = { litIn: 0, litOut: 0, otherIn: 0, openIn: 0 };
    const states = [];
    for (let i = 0; i < 200; i += 1) {
      const t = tileAt(tiles, i);
      const inRing = near.has(i);
      let s = 'thing';
      let binderLit = false;
      if (binders.includes(i)) {
        s = 'binder';
        binderLit = ripeCrops(t, now).some((c) => c.mutations.some((m) => mutationKey(m) === lit));
        if (binderLit && inRing) count.litIn += 1;
      } else if (!t || typeof t !== 'object') s = 'open';
      else if (Array.isArray(t.slots)) {
        let hasLit = false;
        let hasBound = false;
        let hasOther = false;
        for (const c of ripeCrops(t, now)) {
          for (const m of c.mutations) {
            const k = mutationKey(m);
            if (k === lit) hasLit = true;
            else if (k === bound) hasBound = true;
            else if (other.test(k)) hasOther = true;
          }
        }
        s = hasLit ? 'lit' : hasOther ? 'other' : hasBound ? 'bound' : 'plain';
      }
      if (s === 'lit') count[inRing ? 'litIn' : 'litOut'] += 1;
      else if (s === 'open' && inRing) count.openIn += 1;
      else if (s === 'other' && inRing) count.otherIn += 1;
      states.push({ s, inRing, binderLit });
    }
    // The other moon's crops in a binder spot only need moving when more lit
    // crops are waiting than there are open binder spots for them.
    const swap = count.litOut > count.openIn;
    // A pot in your hand: every open spot shows, the ones beside a binder
    // brightest (a plant put there binds).
    const held = obs.spotMapOn ? heldItem() : null;
    // The Garden tab's card always shows the open spots (v0.57.4: planning).
    const potInHand = Boolean(forceKind) || Boolean(held && isPot(held));
    let openAll = 0;
    const looks = states.map(({ s, inRing, binderLit }) => {
      const L = { bg: MAP_BASE.empty, glow: '', pulse: false, edge: inRing ? `inset 0 0 0 1.5px ${C.ring}` : '' };
      if (s === 'binder') Object.assign(L, { bg: '#eadcf7', glow: binderLit ? C.glow : '#c084fc', edge: binderLit ? `inset 0 0 0 2px ${C.lit}` : '' });
      else if (s === 'open') {
        openAll += 1;
        if (inRing) Object.assign(L, potInHand ? { bg: '#a9e9c0', glow: '#6fd68a' } : { bg: '#2c5a40', glow: '#6fd68a' });
        else if (potInHand) Object.assign(L, { bg: '#4aa56e', glow: '#6fd68a' });
      }
      else if (s === 'lit') Object.assign(L, { bg: C.lit, glow: C.glow, pulse: !inRing });
      else if (s === 'other') Object.assign(L, inRing && swap ? { bg: C.other, glow: C.glow, pulse: true } : { bg: C.otherDim });
      else if (s === 'bound') L.bg = C.bound;
      else if (s === 'plain') L.bg = inRing ? MAP_BASE.ringPlant : MAP_BASE.plant;
      else L.bg = MAP_BASE.thing;
      return L;
    });
    const bits = [];
    if (potInHand) bits.push(openAll ? `🪴 ${openAll} open${count.openIn ? `, ${count.openIn} beside the ${C.binder}` : ''}` : '🪴 No open spots');
    bits.push(`${count.litIn} binding`);
    if (count.litOut) bits.push(`${count.litOut} to move in`);
    if (count.otherIn && swap) bits.push(`${count.otherIn} ${C.other_name} to swap out`);
    if (count.openIn && !potInHand) bits.push(`${count.openIn} open spot${count.openIn === 1 ? '' : 's'}`);
    const left = ev.endsAt ? Math.max(0, Math.round((ev.endsAt - Date.now()) / 1000)) : null;
    return {
      ctx: 'binder', icon: ev.kind === 'amber' ? '🌕' : '🌅', chip: `${count.litOut || count.litIn}`, tick: true,
      title: C.title, right: left != null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : '', rightColor: '#ffd35c',
      sum: bits.join(' · '),
      // Only what's on the map (v0.56.10), finished crops marked done.
      key: [
        ['#eadcf7', '#c084fc', C.binder],
        (count.litIn || count.litOut) && [C.lit, C.glow, `${C.name}lit (binding)`],
        count.litOut && [C.lit, C.glow, 'move in', true],
        states.some((x) => x.s === 'bound') && [C.bound, '', `${C.name}bound (done)`],
        states.some((x) => x.s === 'other') && (swap ? [C.other, C.glow, `${C.other_name} (swap out)`, true] : [C.otherDim, '', `${C.other_name} crops`]),
        ...(potInHand ? [count.openIn && ['#a9e9c0', '#6fd68a', 'open, beside a binder'], openAll > count.openIn && ['#4aa56e', '#6fd68a', 'open']] : [count.openIn && ['#2c5a40', '#6fd68a', 'open spot']]),
      ].filter(Boolean),
      looks,
    };
  }

  // 3 and 5. An Ostrich (Dawn Capture) or Phoenix (Amber Capture), ridden or out.
  obs.mountOn = true;
  const M_COL = {
    dawn: { lit: '#cdb2ef', bound: '#7d68a3', glow: '#b98ae6', ride: '🐦 Riding the Ostrich', out: '🐦 Ostrich out', pet: 'Ostrich', name: 'Dawn', boundNote: 'Dawnbound (2 capsules)' },
    amber: { lit: '#f0b35e', bound: '#7a5a32', glow: '#f0b35e', ride: '🔥 Riding the Phoenix', out: '🔥 Phoenix out', pet: 'Phoenix', name: 'Amber', boundNote: 'Amberbound (2 capsules, loses ×10)' },
  };
  function findPet(slot, id) {
    const d = (slot && slot.data) || {};
    const pools = [d.petSlots, d.inventory && d.inventory.items];
    for (const st of Object.values((d.inventory && d.inventory.storages) || {})) pools.push(st && st.items);
    for (const pool of pools) for (const p of Array.isArray(pool) ? pool : []) if (p && p.id === id) return p;
    return null;
  }
  function captureKind(pet) {
    const abil = (pet && Array.isArray(pet.abilities) ? pet.abilities : []).join(' ');
    if (/dawncapture/i.test(abil)) return 'dawn';
    if (/ambercapture/i.test(abil)) return 'amber';
    const sp = String((pet && (pet.petSpecies || pet.species)) || '');
    if (/ostrich/i.test(sp)) return 'dawn';
    if (/phoenix/i.test(sp)) return 'amber';
    return null;
  }
  function captureNow(slot) {
    const id = slot && slot.riddenPetId;
    if (id) {
      const k = captureKind(findPet(slot, id));
      if (k) return { kind: k, riding: true };
    }
    for (const p of (slot && slot.data && Array.isArray(slot.data.petSlots) && slot.data.petSlots) || []) {
      const k = captureKind(p);
      if (k) return { kind: k, riding: false };
    }
    return null;
  }
  function captureModel() {
    const slot = obs.mountOn ? mySlot() : null;
    const now0 = slot ? captureNow(slot) : null;
    if (!now0) return null;
    const C = M_COL[now0.kind];
    const tiles = tilesOf(slot);
    const now = Date.now();
    let crops = 0;
    let caps = 0;
    let litN = 0;
    let boundN = 0;
    const looks = [];
    for (let i = 0; i < 200; i += 1) {
      const t = tileAt(tiles, i);
      if (t && typeof t === 'object' && Array.isArray(t.slots)) {
        let lit = 0;
        let bound = 0;
        for (const c of ripeCrops(t, now)) {
          for (const m of c.mutations) {
            const k = mutationKey(m);
            if (k === `${now0.kind}lit`) lit += 1;
            else if (k === `${now0.kind}bound`) bound += 1;
          }
        }
        crops += lit + bound;
        caps += lit + bound * 2;
        litN += lit;
        boundN += bound;
        looks.push(lit || bound ? { bg: lit ? C.lit : C.bound, glow: lit ? C.glow : '' } : { bg: MAP_BASE.plant });
      } else looks.push({ bg: t && typeof t === 'object' ? MAP_BASE.thing : MAP_BASE.empty });
    }
    return {
      ctx: now0.riding ? 'ride' : 'capture', icon: now0.kind === 'dawn' ? '🐦' : '🔥', chip: `${caps}`,
      title: now0.riding ? C.ride : C.out, right: `${caps} capsule${caps === 1 ? '' : 's'}`, rightColor: C.glow,
      sum: !crops ? `No ${C.name} crops in your garden to capture.`
        : now0.riding ? `${crops} ${C.name} crop${crops === 1 ? '' : 's'}: ${litN} ${C.name}lit, ${boundN} ${C.name}bound. Ride over the ones to capture.`
          : `${crops} ${C.name} crop${crops === 1 ? '' : 's'}: ${litN} ${C.name}lit, ${boundN} ${C.name}bound. Keep the ${C.pet} near the ones to capture.`,
      key: [[C.lit, C.glow, `${C.name}lit (1 capsule)`], [C.bound, '', C.boundNote], [MAP_BASE.plant, '', 'nothing to capture']],
      looks,
    };
  }

  // 4. The Thunderstruck finder, while a Thunder Wolf (Thundercharger) is out.
  obs.thunderOn = true;
  const T_COL = { struck: '#9fd654', charged: '#34402f', other: MAP_BASE.plant, open: MAP_BASE.empty, thing: MAP_BASE.thing };
  function thunderPetOut(slot) {
    const pets = (slot && slot.data && Array.isArray(slot.data.petSlots) && slot.data.petSlots) || [];
    return pets.some((p) => p && Array.isArray(p.abilities) && p.abilities.some((x) => /thundercharger/i.test(String(x))));
  }
  function thunderModel(force) {
    const slot = force || obs.thunderOn ? mySlot() : null;
    if (!slot || (!force && !thunderPetOut(slot))) return null;
    const tiles = tilesOf(slot);
    const now = Date.now();
    let struck = 0;
    let plants = 0;
    let charged = 0;
    const looks = [];
    for (let i = 0; i < 200; i += 1) {
      const t = tileAt(tiles, i);
      if (t && typeof t === 'object' && Array.isArray(t.slots)) {
        let s = 0;
        let c = 0;
        for (const cr of ripeCrops(t, now)) {
          for (const m of cr.mutations) {
            const k = mutationKey(m);
            if (k === 'thunderstruck') s += 1;
            else if (k === 'thundercharged') c += 1;
          }
        }
        struck += s;
        charged += c;
        if (s) plants += 1;
        looks.push(s ? { bg: T_COL.struck, glow: T_COL.struck } : { bg: c ? T_COL.charged : T_COL.other });
      } else looks.push({ bg: t && typeof t === 'object' ? T_COL.thing : T_COL.open });
    }
    if (!struck) return null;
    return {
      ctx: 'thunder', icon: '⚡', chip: `${struck}`, title: '⚡ Thunderstruck finder', right: `${struck} left`, rightColor: T_COL.struck,
      sum: `${struck} Thunderstruck on ${plants} plant${plants === 1 ? '' : 's'} · ${charged} already charged. Keep the Wolf near the glowing ones.`,
      key: [[T_COL.struck, T_COL.struck, 'Thunderstruck: bring the Wolf'], charged && [T_COL.charged, '', 'Thundercharged (done)'], [T_COL.other, '', 'no Thunderstruck']].filter(Boolean),
      looks,
    };
  }

  /* Keep the map on the game (v0.67.2): the view picked in the Garden tab
   * stays up even when nothing calls for a map. Everything else works as
   * before: open spots, the binder map and the finders still come up when
   * they apply and go first; the kept view is then a tab beside them. The
   * value view comes ready-made from the app (it knows what crops are worth). */
  obs.mapPin = { on: false, view: 'spots', value: null };
  const PIN_NONE = { spots: 'No open spots: every tile has something on it.', thunder: 'No Thunderstruck crops right now.', dawn: 'No Dawnbinder in your garden.', amber: 'No Moonbinder in your garden.', value: 'Garden values show up once the app has read your crops.' };
  const PIN_TITLE = { spots: '🪴 Open spots', thunder: '⚡ Thunderstruck finder', dawn: '🌅 Dawn binder', amber: '🌕 Amber binder', value: '💰 Garden value' };
  function pinnedModel() {
    const view = obs.mapPin.view;
    let m = null;
    if (view === 'spots') m = spotModel(true);
    else if (view === 'thunder') m = thunderModel(true);
    else if (view === 'dawn' || view === 'amber') m = binderModel(view);
    else if (view === 'value' && obs.mapPin.value && Array.isArray(obs.mapPin.value.looks)) {
      const v = obs.mapPin.value;
      m = {
        title: PIN_TITLE.value, right: v.right || '', rightColor: '#ffd35c', sum: v.sum || '', key: v.key || [],
        looks: v.looks.map((l) => (l && l.v ? { bg: l.v, glow: l.gem ? '#ffd35c' : '' } : { bg: l && l.k ? MAP_BASE.thing : MAP_BASE.empty })),
      };
    }
    if (!m) {
      // Nothing to show for that view right now: the plain garden, and why.
      const tiles = tilesOf(mySlot());
      const looks = [];
      for (let i = 0; i < 200; i += 1) {
        const t = tileAt(tiles, i);
        looks.push({ bg: t && typeof t === 'object' ? (Array.isArray(t.slots) ? MAP_BASE.plant : MAP_BASE.thing) : MAP_BASE.empty });
      }
      m = { title: PIN_TITLE[view] || '🗺️ Garden map', right: '', sum: PIN_NONE[view] || '', key: [], looks };
    }
    return Object.assign({}, m, { ctx: 'pin', icon: '📌', chip: (PIN_TITLE[view] || '').split(' ')[0] || '🗺️', tick: false, pinned: true });
  }
  obs.setMapPin = function setMapPin(p) {
    const v = p && typeof p === 'object' ? p : {};
    if (typeof v.on === 'boolean') obs.mapPin.on = v.on;
    if (['spots', 'thunder', 'dawn', 'amber', 'value'].includes(v.view)) obs.mapPin.view = v.view;
    if ('value' in v) obs.mapPin.value = v.value && typeof v.value === 'object' ? v.value : null;
    try {
      mapUpdate();
    } catch (err) {
      /* never in the way */
    }
  };

  // The one map: work out every view that applies, show the most pressing
  // (or the one picked by its tab), with tabs for the rest.
  const mapUpdate = perfTimed('maps', mapUpdateJob);
  // Each view's model timed on its own too (v0.73.1).
  const MAP_MODELS = [['spots', () => spotModel()], ['harvest', () => harvestModel()], ['binder', () => binderModel()], ['capture', () => captureModel()], ['thunder', () => thunderModel()]].map(([n, f]) => perfTimed('map:' + n, f));
  const mapExtras = perfTimed('map:extras', () => {
    noteHeld();
    try { lineupCheck(); } catch (err) { /* never in the way */ }
    if (teamBtn && !(obs.mapPos && obs.mapPos['mg-team-btn'])) {
      try { placeTeamButton(); } catch (err) { /* never in the way */ }
    }
    if (plantBtn) {
      try { plantButton(); } catch (err) { /* never in the way */ }
    }
    if (barEl) {
      try { renderBar(); } catch (err) { /* never in the way */ }
    }
  });
  // The map's squares and its title, each timed (v0.73.1).
  const mapCells = perfTimed('map:cells', (m) => {
    const look = JSON.stringify([m.ctx, m.looks, m.sum, m.key]);
    if (look !== mapLast) {
      mapLast = look;
      m.looks.forEach((l, i) => {
        const cell = MAP.cells[i];
        // Every square solid (v0.56.12: outlined, see-through empty squares
        // were busy and let the moving game show through); empty ground has
        // its own tone instead.
        cell.style.background = l.bg;
        cell.style.setProperty('--g', l.glow || 'transparent');
        // Empty ground keeps a slight, soft inner glow (v0.56.13): diffuse,
        // not a hard outline, on a solid square.
        const ground = l.bg === MAP_BASE.empty && !l.glow && !l.edge;
        cell.style.boxShadow = [l.edge, ground ? 'inset 0 0 3px rgba(255,255,255,.13)' : '', l.glow && !l.pulse ? `0 0 5px 0 ${softGlow(l.glow)}` : ''].filter(Boolean).join(',');
        cell.className = l.pulse ? 'pulse' : '';
        cell.style.position = l.glow ? 'relative' : '';
        cell.style.zIndex = l.glow ? '1' : '';
      });
      MAP.sum.textContent = m.sum;
      const sw = ([bg, gl, text, pulse]) => `<span style="display:inline-flex;align-items:center;gap:4px"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${bg};${gl ? `box-shadow:0 0 5px 1px ${gl};` : ''}${pulse ? 'outline:1px dashed #fff;outline-offset:1px;' : ''}"></i>${text}</span>`;
      MAP.key.innerHTML = m.key.map(sw).join('');
    }
    // You are here (v0.57.6): after the cells exist, so the ring shows the
    // moment the map does, not only on your next step.
    if (meCell && !meCell.isConnected) meCell = null;
    try { showMe(); } catch (err) { /* never in the way */ }
  });
  const mapHead = perfTimed('map:head', (m, others) => {
    // The title: this view, its count, and a tab for each other view.
    const headKey = [m.title, m.right, others.map((x) => `${x.ctx}:${x.chip}`).join(',')].join('|');
    if (MAP.head.__k !== headKey) {
      MAP.head.__k = headKey;
      MAP.head.innerHTML = '';
      // Row 1: the view's title (cut short if it must) and its count.
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';
      const a = document.createElement('span');
      a.className = 'mg-title';
      a.textContent = m.title;
      a.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      const r = document.createElement('span');
      r.textContent = m.right;
      r.style.cssText = `font-weight:600;white-space:nowrap;color:${m.rightColor || '#eee'};`;
      row.appendChild(a);
      row.appendChild(r);
      // Row 2: a tab for each other view; there (empty) even when none.
      const tabs = document.createElement('div');
      tabs.className = 'mg-tabs';
      tabs.style.cssText = 'display:flex;gap:4px;height:18px;margin-top:3px;overflow:hidden;';
      for (const x of others) {
        const tab = document.createElement('span');
        tab.className = 'mg-tab';
        tab.dataset.ctx = x.ctx;
        tab.title = `Show: ${x.title}`;
        tab.textContent = `${x.icon} ${x.chip}`;
        tabs.appendChild(tab);
      }
      MAP.head.appendChild(row);
      MAP.head.appendChild(tabs);
    }
  });
  function mapUpdateJob() {
    mapExtras();
    // The map's cells were rebuilt: the old ring's cell is gone with them.
    if (meCell && !meCell.isConnected) meCell = null;
    try { showMe(); } catch (err) { /* never in the way */ }
    const models = [];
    for (const fn of MAP_MODELS) {
      try {
        const m = fn();
        if (m) models.push(m);
      } catch (err) {
        /* one view failing never takes the others down */
      }
    }
    models.sort((x, y) => MAP_ORDER.indexOf(x.ctx) - MAP_ORDER.indexOf(y.ctx));
    // The kept view comes last, unless the same map is already up.
    if (obs.mapPin.on) {
      try {
        const pm = pinnedModel();
        if (!models.some((x) => x.title === pm.title)) models.push(pm);
      } catch (err) {
        /* never in the way */
      }
    }
    obs.riding = models.some((m) => m.ctx === 'ride');
    const set = models.map((m) => m.ctx).join(',');
    // A pick holds until something new comes up (a pot in hand, an event):
    // it notes which views were up on the first update after the tap.
    if (obs.mapPick && obs.mapPickSet === null) obs.mapPickSet = set;
    if (obs.mapPick && (set !== obs.mapPickSet || !models.some((m) => m.ctx === obs.mapPick))) obs.mapPick = null;
    const m = models.find((x) => x.ctx === obs.mapPick) || models[0] || null;
    if (!m) {
      if (MAP) MAP.box.style.display = 'none';
      obs.mapCtx = null;
      mapLast = '';
      clearInterval(mapTick);
      mapTick = null;
      return;
    }
    if (!MAP) MAP = miniMapBox('mg-map');
    if (MAP.box.dataset.ctx && MAP.box.dataset.ctx !== m.ctx && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      for (const el of [MAP.sum, MAP.key]) {
        el.style.transition = 'none';
        el.style.opacity = '.3';
        setTimeout(() => {
          el.style.transition = 'opacity .25s ease';
          el.style.opacity = '1';
        }, 30);
      }
    }
    obs.mapCtx = m.ctx;
    MAP.box.dataset.ctx = m.ctx;
    const others = models.filter((x) => x !== m);
    mapCells(m);
    mapHead(m, others);
    MAP.box.style.display = '';
    mapPlaceTimed(MAP.box);
    if (m.tick && !mapTick) mapTick = setInterval(() => { try { mapUpdate(); } catch (err) { /* never in the way */ } }, 1000);
    if (!m.tick && mapTick) {
      clearInterval(mapTick);
      mapTick = null;
    }
  }
  /* The lineup you had out (v0.56.5): \"last team\" is the last three pets
   * you had out, saved team or not. When a new lineup counts as a team, the
   * one before is \"last\". Putting it back: a saved team with exactly those
   * pets goes out the game's own way (ApplyPetTeam); otherwise each missing
   * pet comes out of the hutch (SwapPetFromStorage, as when you do it by
   * hand). A pet in your bag can't be put out by the app yet: it says so
   * and changes nothing.
   *
   * When a lineup counts (v0.72.2, the owner: no waiting, and swapping pets
   * one by one in the hutch never makes the in-between lineups teams):
   * - the Pet Hutch window closes (whatever's out then is the team);
   * - a whole team goes out at once: one of your saved teams from the game,
   *   or the app's own swap (as soon as the game shows it out);
   * - you do something that isn't a pet swap (harvest, plant, buy, sell...);
   * - you press the swap button: what's out is your team, so it goes back
   *   to the one before.
   * No timer. While the app's own swap is still landing (a second or so) a
   * press says so instead of swapping on half-moved pets. */
  const PET_SWAP = /^(SwapPetFromStorage|ApplyPetTeam|PlacePet|PickupPet|StorePet|SwapPet|RemovePet|EquipPet|UnequipPet)$/;
  const MOVE_ON = /^(HarvestCrop|PlantSeed|PlantEgg|GrowEgg|HatchEgg|PurchaseShopItem|SellAllCrops|SellPet|PotPlant|PlantGardenPlant|Wish|FeedPet|Thundercharge|RidePet|DismountPet|WaterPlant|PutItemInStorage|RetrieveItemFromStorage)$/;
  const EXPECT_MS = 6000;
  obs.lineups = { settled: null, last: null, lastLabel: null };
  obs.hutch = { open: false, opened: 0, closed: 0 };
  let petSwapAt = 0;
  let movedOnAt = 0;
  // A whole team on its way out: { key, at }. Counts once it's out.
  let expect = null;
  function inFlight() {
    if (expect && Date.now() - expect.at > EXPECT_MS) expect = null;
    return Boolean(expect);
  }
  function noteCommandForLineup(cmd) {
    const t = String((cmd && cmd.type) || '');
    if (PET_SWAP.test(t)) petSwapAt = Date.now();
    else if (MOVE_ON.test(t)) movedOnAt = Date.now();
    // One of your saved teams from the game's own team list: a whole team.
    if (t === 'ApplyPetTeam' && cmd.teamId != null && !inFlight()) {
      const team = petTeams().find((x) => String(x.id) === String(cmd.teamId));
      const ids = team ? (team.members || []).map((m) => String(m.petId)).filter(Boolean).sort() : [];
      if (ids.length) expect = { key: ids.join(','), at: Date.now() };
    }
    setTimeout(() => {
      try { lineupCheck(); } catch (err) { /* never in the way */ }
    }, 50);
  }
  function petsOut() {
    const slot = mySlot();
    const pets = (slot && slot.data && Array.isArray(slot.data.petSlots)) ? slot.data.petSlots : [];
    return pets.filter((p) => p && p.id).map((p) => String(p.id)).sort();
  }
  function petStorages() {
    const slot = mySlot();
    const st = slot && slot.data && slot.data.inventory && slot.data.inventory.storages;
    return (Array.isArray(st) ? st : Object.values(st || {})).filter((s) => s && typeof s === 'object');
  }
  function speciesOf(id) {
    const slot = mySlot();
    const p = slot ? findPet(slot, id) : null;
    const sp = String((p && (p.petSpecies || p.species)) || 'a pet');
    return sp.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  function lineupLabel(ids) {
    if (!ids || !ids.length) return null;
    const team = petTeams().find((t) => (t.members || []).map((m) => String(m.petId)).sort().join(',') === ids.join(','));
    return team ? team.name : ids.map(speciesOf).join(', ');
  }
  // The game's Pet Hutch window, open? Its window has "Hutch" in it (the
  // game's own name for it); looked for among dialogs and modals only, never
  // the app's own boxes, and only while it's on screen.
  const HUTCH_SEL = '[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="drawer" i]';
  function hutchOpen() {
    for (const el of document.querySelectorAll(HUTCH_SEL)) {
      // The words first (no layout needed); size and visibility only for a
      // window that says "hutch" (v0.73.1).
      if (!/hutch/i.test(String(el.textContent || '').slice(0, 4000))) continue;
      if (el.closest && el.closest('[id^="mg-"], [id^="__mg"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 80 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      return true;
    }
    return false;
  }
  // What's out now counts as your team; the one before becomes last.
  function settle(ids) {
    if (!ids || !ids.length) return false;
    const cur = obs.lineups.settled ? obs.lineups.settled.join(',') : null;
    if (ids.join(',') === cur) return false;
    const last = obs.lineups.settled || obs.lineups.last;
    obs.lineups = { settled: ids, last, lastLabel: lineupLabel(last) };
    send('lineup', obs.lineups);
    return true;
  }
  // What a press brings back: pets swapped since the last team means the
  // last team (pressing makes what's out the team); otherwise the one before.
  function backTarget() {
    const out = petsOut().join(',');
    const s = obs.lineups.settled;
    if (s && s.length && out && s.join(',') !== out && !inFlight()) return s;
    return obs.lineups.last;
  }
  let shownBack;
  function showBack(force) {
    const label = lineupLabel(backTarget());
    obs.lastTeam = label ? { name: label } : null;
    if (!force && label === shownBack) return;
    shownBack = label;
    try { teamButton(); } catch (err) { /* never in the way */ }
  }
  let hutchClosing = null;
  const lineupCheck = perfTimed('teamCheck', lineupCheckJob);
  function lineupCheckJob() {
    const ids = petsOut();
    if (!ids.length) return;
    const key = ids.join(',');
    // A whole team out (yours from the game, or the app's swap).
    if (expect && key === expect.key) {
      expect = null;
      settle(ids);
    }
    if (inFlight()) return showBack();
    // The first lineup the app ever sees is where it starts.
    if (!obs.lineups.settled) settle(ids);
    // Done in the hutch: the window closed (a moment for the game to report
    // the last swap first). Only looked for while it can matter: pets out
    // that aren't your team yet, or a pet swap in the last 2 minutes
    // (v0.73.1: a look at the page every half second cost the game frames).
    const settledKey = obs.lineups.settled ? obs.lineups.settled.join(',') : '';
    const mid = obs.hutch.open || key !== settledKey || (petSwapAt && Date.now() - petSwapAt < 120000);
    const open = mid ? hutchOpen() : false;
    if (open && !obs.hutch.open) obs.hutch.opened += 1;
    if (!open && obs.hutch.open) {
      obs.hutch.closed += 1;
      clearTimeout(hutchClosing);
      hutchClosing = setTimeout(() => {
        try {
          if (!obs.hutch.open && !inFlight()) settle(petsOut());
          showBack();
        } catch (err) { /* never in the way */ }
      }, 700);
    }
    obs.hutch.open = open;
    // Moved on: something that isn't a pet swap since the last swap.
    if (!open && movedOnAt > petSwapAt) settle(ids);
    showBack();
  }
  setInterval(() => {
    try { lineupCheck(); } catch (err) { /* never in the way */ }
  }, 500);
  // A saved team the app puts out (Put out, Apply, weather and harvest
  // teams; v0.73.0): a whole team, so it counts as soon as it's out.
  obs.teamGoingOut = function teamGoingOut(team) {
    const ids = ((team && team.members) || []).map((m) => String(m.petId)).filter(Boolean).sort();
    if (!ids.length) return;
    settle(petsOut());
    expect = { key: ids.join(','), at: Date.now() };
  };
  // Back from the app after a restart: what was settled and last.
  obs.setLineups = function setLineups(x) {
    const v = x && typeof x === 'object' ? x : {};
    const clean = (a) => (Array.isArray(a) && a.length ? a.map(String).slice(0, 6).sort() : null);
    obs.lineups = { settled: clean(v.settled), last: clean(v.last), lastLabel: v.lastLabel ? String(v.lastLabel).slice(0, 60) : null };
    if (obs.lineups.last) obs.lineups.lastLabel = lineupLabel(obs.lineups.last) || obs.lineups.lastLabel;
    showBack();
  };
  obs.restoreLineup = function restoreLineup() {
    if (inFlight()) return { ok: false, busy: true, reason: 'Still swapping: one moment.' };
    // Pressing it means you're done swapping: what's out is your team now.
    settle(petsOut());
    const want = obs.lineups.last;
    if (!want || !want.length) {
      showBack();
      return { ok: false, reason: 'No earlier pets yet: swap some pets, and this brings the ones before back.' };
    }
    const r = lineupTo(want);
    showBack();
    return r;
  };
  // Put these pets out (v0.59.8, the team builder): a saved team that's
  // exactly them is applied; otherwise each one missing comes out of the
  // hutch in place of one that isn't wanted.
  obs.putOut = function putOut(ids) {
    const want = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).sort();
    if (!want.length) return { ok: false, reason: 'Pick some pets first.' };
    settle(petsOut());
    return lineupTo(want);
  };
  function lineupTo(want) {
    const label = lineupLabel(want);
    const out = petsOut();
    if (want.join(',') === out.join(',')) return { ok: true, already: true, team: label };
    const team = petTeams().find((t) => (t.members || []).map((m) => String(m.petId)).sort().join(',') === want.join(','));
    if (team) {
      const r = sendCommand({ type: 'ApplyPetTeam', teamId: team.id }, 'ApplyPetTeam:' + team.id);
      if (r.ok) expect = { key: want.join(','), at: Date.now() };
      return r.ok ? { ok: true, team: label, how: 'team' } : r;
    }
    const missing = want.filter((id) => !out.includes(id));
    const extra = out.filter((id) => !want.includes(id));
    const plan = [];
    for (const m of missing) {
      const st = petStorages().find((s) => (Array.isArray(s.items) ? s.items : []).some((it) => it && String(it.id) === m));
      if (!st) return { ok: false, reason: `${speciesOf(m)} isn't in the hutch (it's in your bag?): put it out by hand.` };
      const e = extra.shift();
      if (!e) return { ok: false, reason: 'You have fewer pets out than this team: put another pet out in the game first, then try again.' };
      plan.push({ petSlotId: e, storagePetId: m, storageId: String(st.decorId || st.storageId || st.id || 'PetHutch') });
    }
    expect = { key: want.join(','), at: Date.now() };
    for (const p of plan) {
      const r = sendCommand(Object.assign({ type: 'SwapPetFromStorage' }, p), 'SwapPetFromStorage:' + p.storagePetId);
      if (!r.ok) {
        expect = null;
        return r;
      }
    }
    return { ok: true, team: label, how: 'hutch', swaps: plan.length };
  }

  /* Swap to your last pet team, on the game (v0.56.4): a small button on
   * the left, just above the game's pet panel. It names the team it brings
   * back; a click asks the app to swap (the same safe swap as the panel's
   * 🔁 and Ctrl+Shift+T). Drag it to move it (saved like the maps),
   * double-click to put it back above the pet panel. Where the game draws
   * its pet panel isn't known for sure, so it's looked for (a tall block at
   * the left that's about pets) and a spot on the left is used otherwise. */
  obs.teamBtnOn = true; // on unless you turn it off (v0.63.11)
  obs.lastTeam = null;
  let teamBtn = null;
  let teamNote = null;
  function findPetPanel() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cands = [];
    for (const el of document.querySelectorAll('[class*="pet" i], [id*="pet" i], [aria-label*="pet" i], [data-testid*="pet" i]')) {
      if (el.closest && el.closest('#mg-team-btn, #mg-map, #mg-corner')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 30 && r.height > 60 && r.left < W * 0.3 && r.right < W * 0.5 && r.top > 0 && r.bottom <= H) cands.push(r);
    }
    cands.sort((a, b) => b.height - a.height || a.left - b.left);
    return cands[0] || null;
  }
  // Placed only when something it depends on changed (v0.73.1): reading
  // the page's layout makes the browser work it out there and then, and on
  // the live game that's costly. Looking for the pet panel again at most
  // every 15 s.
  let teamPlaceKey = '';
  function placeTeamButton(force) {
    if (!teamBtn || teamBtn.style.display === 'none') return;
    const saved = obs.mapPos && obs.mapPos['mg-team-btn'];
    const key = [window.innerWidth, window.innerHeight, saved ? `${saved.x},${saved.y}` : Math.floor(Date.now() / 15000), teamBtn.textContent].join('|');
    if (force !== true && key === teamPlaceKey) return;
    teamPlaceKey = key;
    const w = teamBtn.offsetWidth || 110;
    const h = teamBtn.offsetHeight || 30;
    let x;
    let y;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      x = saved.x * window.innerWidth;
      y = saved.y * window.innerHeight;
    } else {
      const r = findPetPanel();
      x = r ? r.left : 12;
      y = r ? r.top - h - 8 : window.innerHeight * 0.36;
      teamBtn.dataset.anchor = r ? 'pet panel' : 'default';
    }
    teamBtn.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, x))}px`;
    teamBtn.style.top = `${Math.max(4, Math.min(window.innerHeight - h - 4, y))}px`;
  }
  function teamButton() {
    if (!document.body) return;
    if (!obs.teamBtnOn) {
      if (teamBtn) teamBtn.style.display = 'none';
      return;
    }
    if (!teamBtn) {
      teamBtn = document.createElement('div');
      teamBtn.id = 'mg-team-btn';
      teamBtn.setAttribute('role', 'button');
      teamBtn.tabIndex = 0;
      teamBtn.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:auto;touch-action:none;user-select:none;cursor:pointer;'
        + 'font:700 12.5px system-ui,sans-serif;color:#fff;background:rgba(42,27,54,.92);border:1px solid rgba(255,255,255,.2);'
        + 'border-radius:10px;padding:5px 10px;box-shadow:0 2px 8px rgba(0,0,0,.35);white-space:nowrap;';
      // Dragging the way the maps do (window listeners while the button is
      // held), so a fast drag can't slip off it.
      let down = null;
      const move = (e) => {
        if (!down) return;
        e.preventDefault();
        if (!down.moved && Math.hypot(e.clientX - down.x0, e.clientY - down.y0) < 5) return;
        down.moved = true;
        teamBtn.style.left = `${Math.max(4, Math.min(window.innerWidth - teamBtn.offsetWidth - 4, e.clientX - down.dx))}px`;
        teamBtn.style.top = `${Math.max(4, Math.min(window.innerHeight - teamBtn.offsetHeight - 4, e.clientY - down.dy))}px`;
      };
      const end = (e) => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        const d = down;
        down = null;
        if (!d) return;
        if (e) e.stopPropagation();
        if (d.moved) {
          const r = teamBtn.getBoundingClientRect();
          obs.mapPos = Object.assign({}, obs.mapPos, { 'mg-team-btn': { x: r.left / window.innerWidth, y: r.top / window.innerHeight } });
          send('mapPos', { id: 'mg-team-btn', x: r.left / window.innerWidth, y: r.top / window.innerHeight });
          return;
        }
        if (e && e.type === 'pointercancel') return;
        // A double-click puts the button back: wait a moment so its two
        // clicks don't swap teams twice.
        clearTimeout(teamBtn.__click);
        teamBtn.__click = setTimeout(() => send('lastTeam', {}), 300);
      };
      teamBtn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const r = teamBtn.getBoundingClientRect();
        down = { x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
      });
      teamBtn.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        clearTimeout(teamBtn.__click);
        if (obs.mapPos) delete obs.mapPos['mg-team-btn'];
        send('mapPos', { id: 'mg-team-btn', x: null, y: null });
        placeTeamButton(true);
      });
      teamBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          send('lastTeam', {});
        }
      });
      document.body.appendChild(teamBtn);
    }
    const t = obs.lastTeam;
    teamBtn.textContent = t ? `🔁 ${t.name}` : '🔁 Last team';
    teamBtn.title = t ? `Swap back to ${t.name} (Ctrl+Shift+T) · drag to move, double-click to put it back` : 'Once you swap pets, this brings the ones before back · drag to move';
    teamBtn.style.opacity = t ? '1' : '.55';
    teamBtn.style.display = '';
    placeTeamButton();
  }
  obs.setTeamButton = function setTeamButton(x) {
    const v = x && typeof x === 'object' ? x : {};
    obs.teamBtnOn = v.on !== false;
    // The game page knows what a press brings back (v0.72.2); the app's
    // saved name only until it has seen your pets.
    if (obs.lineups.settled || obs.lineups.last) return showBack(true);
    obs.lastTeam = v.last && v.last.name ? { name: String(v.last.name).slice(0, 30) } : null;
    try { teamButton(); } catch (err) { /* never in the way */ }
  };
  // What the swap did, beside the button.
  obs.teamSaid = function teamSaid(r) {
    if (!teamBtn || !r) return;
    if (!teamNote) {
      teamNote = document.createElement('div');
      teamNote.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;font:600 12px system-ui,sans-serif;color:#fff;background:rgba(42,27,54,.92);border-radius:8px;padding:4px 9px;transition:opacity .3s;';
      document.body.appendChild(teamNote);
    }
    const b = teamBtn.getBoundingClientRect();
    teamNote.textContent = r.ok ? (r.already ? `🐾 ${r.team} is already out` : `🐾 Back to ${r.team}`) : `🐾 ${r.reason}`;
    teamNote.style.left = `${Math.min(window.innerWidth - 220, b.right + 8)}px`;
    teamNote.style.top = `${b.top}px`;
    teamNote.style.opacity = '1';
    clearTimeout(teamNote.__t);
    teamNote.__t = setTimeout(() => { teamNote.style.opacity = '0'; }, 2200);
  };
  window.addEventListener('resize', () => {
    try { placeTeamButton(true); } catch (err) { /* never in the way */ }
  });

  /* Quick plant (v0.56.15): a button on the game that plants one seed of
   * the kind you picked into the next open spot, per click, so you can spam
   * it (filling spots with pet food before weather, say). ▾ lists the seeds
   * in your bag with their counts; the pick is remembered. It uses the game's
   * own PlantSeed { slot, species }. Spots it has just planted are skipped
   * for a few seconds, so fast clicks fill different spots before the game
   * has reported the first. Each plant is checked: the note says whether it
   * took. Drag to move (saved), double-click to put it back. */
  obs.plantBtnOn = true;
  obs.plantPick = null;
  let plantBtn = null;
  let plantMain = null;
  let plantList = null;
  let plantNote = null;
  const plantPending = new Map();
  function bagSeeds() {
    const slot = mySlot();
    const items = (slot && slot.data && slot.data.inventory && Array.isArray(slot.data.inventory.items)) ? slot.data.inventory.items : [];
    const by = {};
    for (const it of items) {
      if (!it || typeof it !== 'object' || it.itemType !== 'Seed' || !it.species) continue;
      by[it.species] = (by[it.species] || 0) + (Number(it.quantity) || 0);
    }
    return Object.entries(by).filter(([, q]) => q > 0).map(([species, quantity]) => ({ species, quantity })).sort((a, b) => a.species.localeCompare(b.species));
  }
  const seedName = (sp) => String(sp || '').replace(/([a-z])([A-Z])/g, '$1 $2');
  function nextOpenSpot() {
    const tiles = tilesOf(mySlot());
    const now = Date.now();
    for (const [k, t] of plantPending) if (now - t > 4000) plantPending.delete(k);
    for (let i = 0; i < 200; i += 1) if (!tileAt(tiles, i) && !plantPending.has(i)) return i;
    return null;
  }
  function plantSay(text) {
    const anchor = plantBtn && plantBtn.style.display !== 'none' ? plantBtn : barEl;
    if (!anchor) return;
    if (!plantNote) {
      plantNote = document.createElement('div');
      plantNote.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;font:600 12px system-ui,sans-serif;color:#fff;background:rgba(42,27,54,.95);border-radius:8px;padding:4px 9px;transition:opacity .3s;white-space:nowrap;';
      document.body.appendChild(plantNote);
    }
    const b = anchor.getBoundingClientRect();
    plantNote.textContent = text;
    plantNote.style.left = `${Math.max(4, Math.min(window.innerWidth - 260, anchor === barEl ? b.left : b.right + 8))}px`;
    plantNote.style.top = `${anchor === barEl ? Math.max(4, b.top - 30) : b.top}px`;
    plantNote.style.opacity = '1';
    clearTimeout(plantNote.__t);
    plantNote.__t = setTimeout(() => { plantNote.style.opacity = '0'; }, 2000);
  }
  function plantOne(species) {
    const seeds = bagSeeds();
    const pick = species || obs.plantPick;
    if (!pick) {
      plantSay('🌱 Pick a seed first (▾)');
      return { ok: false, reason: 'no pick' };
    }
    const s = seeds.find((x) => x.species === pick);
    // Only plants the game hasn't reported yet (their spot still empty):
    // once it has, the bag's count already has them taken off (v0.56.15:
    // counting both refused the 4th fast click of 5 seeds).
    const tilesNow = tilesOf(mySlot());
    const onTheirWay = [...plantPending.keys()].filter((k) => !tileAt(tilesNow, k)).length;
    if (!s || s.quantity - onTheirWay <= 0) {
      plantSay(`🌱 No ${seedName(pick)} seeds left in your bag`);
      return { ok: false, reason: 'no seeds' };
    }
    const spot = nextOpenSpot();
    if (spot == null) {
      plantSay('🌱 No open spots');
      return { ok: false, reason: 'no spot' };
    }
    const r = sendCommand({ type: 'PlantSeed', slot: spot, species: s.species }, 'PlantSeed:' + spot);
    if (!r.ok) {
      plantSay(`🌱 ${r.reason || 'Couldn\'t plant it'}`);
      return r;
    }
    plantPending.set(spot, Date.now());
    setTimeout(() => {
      try {
        const took = Boolean(tileAt(tilesOf(mySlot()), spot));
        plantPending.delete(spot);
        const left = (bagSeeds().find((x) => x.species === s.species) || { quantity: 0 }).quantity;
        plantSay(took ? `🌱 Planted ${seedName(s.species)} · ${left} left` : '🌱 The game didn\'t plant it (it may want you nearer the spot)');
        plantButton();
      } catch (err) { /* never in the way */ }
    }, 1500);
    return { ok: true, spot };
  }
  obs.plantOne = plantOne;
  function closePlantList() {
    if (plantList) plantList.style.display = 'none';
  }
  function openPlantList() {
    if (!plantList) {
      plantList = document.createElement('div');
      plantList.id = 'mg-plant-list';
      plantList.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:auto;font:600 12px system-ui,sans-serif;color:#eee;background:rgba(22,16,29,.97);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:4px;max-height:260px;overflow:auto;min-width:150px;box-shadow:0 6px 20px rgba(0,0,0,.45);';
      plantList.addEventListener('pointerdown', (e) => e.stopPropagation());
      plantList.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = e.target.closest('[data-sp]');
        if (!row) return;
        obs.plantPick = row.dataset.sp;
        send('plantPick', { species: obs.plantPick });
        closePlantList();
        plantButton();
      });
      document.body.appendChild(plantList);
    }
    const seeds = bagSeeds();
    plantList.innerHTML = seeds.length
      ? seeds.map((x) => `<div data-sp="${x.species}" style="padding:5px 9px;border-radius:7px;cursor:pointer;display:flex;justify-content:space-between;gap:12px;${x.species === obs.plantPick ? 'background:rgba(255,255,255,.12);' : ''}"><span>${seedName(x.species)}</span><span style="opacity:.7">×${x.quantity}</span></div>`).join('')
      : '<div style="padding:6px 9px;opacity:.7">No seeds in your bag</div>';
    const b = plantBtn.getBoundingClientRect();
    plantList.style.display = '';
    plantList.style.left = `${Math.max(4, b.left)}px`;
    const below = b.bottom + 4;
    plantList.style.top = `${below + 200 < window.innerHeight ? below : Math.max(4, b.top - Math.min(260, plantList.offsetHeight || 200) - 4)}px`;
  }
  let plantPlaceKey = '';
  function placePlantButton(force) {
    if (!plantBtn || plantBtn.style.display === 'none') return;
    const saved = obs.mapPos && obs.mapPos['mg-plant-btn'];
    const key = [window.innerWidth, window.innerHeight, saved ? `${saved.x},${saved.y}` : '', plantBtn.textContent, teamBtn ? `${teamBtn.style.left},${teamBtn.style.top},${teamBtn.style.display}` : ''].join('|');
    if (force !== true && key === plantPlaceKey) return;
    plantPlaceKey = key;
    const w = plantBtn.offsetWidth || 130;
    const h = plantBtn.offsetHeight || 28;
    let x;
    let y;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      x = saved.x * window.innerWidth;
      y = saved.y * window.innerHeight;
    } else if (teamBtn && teamBtn.style.display !== 'none') {
      const r = teamBtn.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 6;
    } else {
      x = 12;
      y = window.innerHeight * 0.36 + 36;
    }
    plantBtn.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, x))}px`;
    plantBtn.style.top = `${Math.max(4, Math.min(window.innerHeight - h - 4, y))}px`;
  }
  function plantButton() {
    if (!document.body) return;
    if (!obs.plantBtnOn) {
      if (plantBtn) plantBtn.style.display = 'none';
      closePlantList();
      return;
    }
    if (!plantBtn) {
      plantBtn = document.createElement('div');
      plantBtn.id = 'mg-plant-btn';
      plantBtn.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:auto;touch-action:none;user-select:none;display:flex;align-items:stretch;'
        + 'font:700 12.5px system-ui,sans-serif;color:#fff;background:rgba(42,27,54,.92);border:1px solid rgba(255,255,255,.2);'
        + 'border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;';
      plantMain = document.createElement('span');
      plantMain.setAttribute('role', 'button');
      plantMain.style.cssText = 'padding:5px 9px 5px 10px;cursor:pointer;';
      const pickBtn = document.createElement('span');
      pickBtn.className = 'mg-pick';
      pickBtn.setAttribute('role', 'button');
      pickBtn.title = 'Pick which seed to plant';
      pickBtn.textContent = '▾';
      pickBtn.style.cssText = 'padding:5px 8px;cursor:pointer;border-left:1px solid rgba(255,255,255,.18);';
      plantBtn.appendChild(plantMain);
      plantBtn.appendChild(pickBtn);
      // Dragging the way the maps do; a press on ▾ opens the list instead.
      let down = null;
      const move = (e) => {
        if (!down) return;
        e.preventDefault();
        if (!down.moved && Math.hypot(e.clientX - down.x0, e.clientY - down.y0) < 5) return;
        down.moved = true;
        closePlantList();
        plantBtn.style.left = `${Math.max(4, Math.min(window.innerWidth - plantBtn.offsetWidth - 4, e.clientX - down.dx))}px`;
        plantBtn.style.top = `${Math.max(4, Math.min(window.innerHeight - plantBtn.offsetHeight - 4, e.clientY - down.dy))}px`;
      };
      const end = (e) => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        const d = down;
        down = null;
        if (!d) return;
        if (e) e.stopPropagation();
        if (d.moved) {
          const r = plantBtn.getBoundingClientRect();
          obs.mapPos = Object.assign({}, obs.mapPos, { 'mg-plant-btn': { x: r.left / window.innerWidth, y: r.top / window.innerHeight } });
          send('mapPos', { id: 'mg-plant-btn', x: r.left / window.innerWidth, y: r.top / window.innerHeight });
          return;
        }
        if (e && e.type === 'pointercancel') return;
        if (d.pick) {
          if (plantList && plantList.style.display !== 'none') closePlantList();
          else openPlantList();
          return;
        }
        plantOne();
      };
      plantBtn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const r = plantBtn.getBoundingClientRect();
        down = { x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, pick: Boolean(e.target.closest && e.target.closest('.mg-pick')) };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
      });
      // No double-click to put it back: spamming it makes double-clicks.
      // "Put it back" is next to its switch in the panel.
      plantBtn.addEventListener('dblclick', (e) => e.stopPropagation());
      window.addEventListener('pointerdown', () => closePlantList());
      document.body.appendChild(plantBtn);
    }
    const pick = obs.plantPick;
    const s = pick ? bagSeeds().find((x) => x.species === pick) : null;
    plantMain.textContent = pick ? `🌱 ${seedName(pick)} ×${s ? s.quantity : 0}` : '🌱 Pick a seed';
    plantMain.title = pick ? `Plant one ${seedName(pick)} seed in the next open spot (click as often as you like) · drag to move` : 'Pick a seed with ▾, then click to plant one per click';
    plantBtn.style.opacity = pick && !s ? '.55' : '1';
    plantBtn.style.display = 'flex';
    placePlantButton();
  }
  obs.setPlantButton = function setPlantButton(x) {
    const v = x && typeof x === 'object' ? x : {};
    if (v.resetPlace) {
      if (obs.mapPos) delete obs.mapPos['mg-plant-btn'];
      send('mapPos', { id: 'mg-plant-btn', x: null, y: null });
    }
    obs.plantBtnOn = v.on !== false;
    if (typeof v.pick === 'string' || v.pick === null) obs.plantPick = v.pick;
    try { plantButton(); } catch (err) { /* never in the way */ }
  };

  /* The action bar (v0.57.0): WoW-style, on the game. Nine slots on keys
   * 1-9 by default (rebind any of them in the panel), each holding an
   * action: plant a potted plant (one per press; holding the key keeps
   * going until those pots run out), plant a seed, swap to your last team,
   * put out a saved team, harvest mode or the harvest lock on / off. A slot
   * shows its icon, its key, what's left (or on / off), and flashes when
   * used. Empty slots don't take their key, so the game keeps it; keys never
   * fire while you're typing. Drag the bar by its grip.
   * Potted plants: the game's command for planting one hasn't been seen in
   * any sample, so it's learned: the first time you plant a potted plant by
   * hand, the command that carried that pot's id and a garden spot is kept,
   * and the bar repeats it with the next pot and the next open spot. */
  obs.actionBar = { on: true, slots: [], shape: 'square' };
  // The game's own bag slots on keys of your choosing (v0.57.1; the bar
  // takes 1-9): a bag key is passed to the game as its plain number.
  obs.bagKeys = [];
  let passThrough = false;
  function pressForGame(n) {
    const code = `Digit${n}`;
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body || document;
    passThrough = true;
    try {
      for (const type of ['keydown', 'keyup']) {
        const ev = new KeyboardEvent(type, { key: String(n), code, bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(ev, 'keyCode', { get: () => 48 + n });
        Object.defineProperty(ev, 'which', { get: () => 48 + n });
        target.dispatchEvent(ev);
      }
    } finally {
      passThrough = false;
    }
  }
  // The game's own command for planting a potted plant, seen in the owner's
  // sample (v0.57.2): PlantGardenPlant { slot, itemId }. Built in, so the key
  // works from the first press; one planted by hand still updates it if the
  // game ever changes it.
  const KNOWN_POT_COMMAND = { type: 'PlantGardenPlant', idKey: 'itemId', slotKey: 'slot', extra: {} };
  obs.potCommand = KNOWN_POT_COMMAND;
  let barEl = null;
  let barCells = [];
  const potPending = new Map();
  function bagItems() {
    const slot = mySlot();
    return (slot && slot.data && slot.data.inventory && Array.isArray(slot.data.inventory.items)) ? slot.data.inventory.items : [];
  }
  obs.bagSummary = function bagSummary() {
    const potted = {};
    const seeds = {};
    for (const it of bagItems()) {
      if (!it || typeof it !== 'object' || !it.species) continue;
      if (it.itemType === 'Plant') potted[it.species] = (potted[it.species] || 0) + 1;
      else if (it.itemType === 'Seed') seeds[it.species] = (seeds[it.species] || 0) + (Number(it.quantity) || 0);
    }
    return { potted, seeds };
  };
  function learnPotCommand(cmd) {
    if (!cmd || typeof cmd !== 'object' || !cmd.type) return;
    const pots = new Set(bagItems().filter((it) => it && it.itemType === 'Plant' && it.id).map((it) => String(it.id)));
    if (!pots.size) return;
    let idKey = null;
    const places = [];
    for (const [k, v] of Object.entries(cmd)) {
      if (k === 'type') continue;
      if (typeof v === 'string' && pots.has(v)) idKey = k;
      else if (Number.isInteger(v) && v >= 0 && v < 200 && !/rot|quant|count|angle|amount|dir/i.test(k)) places.push(k);
    }
    // The garden spot: a field named like one (slot, tile, spot, index,
    // position); otherwise the only number left. Two candidates and no
    // name to go on: don't guess, wait for the next pot planted by hand.
    const named = places.filter((k) => /slot|tile|spot|index|pos|cell/i.test(k));
    const slotKey = named.length === 1 ? named[0] : places.length === 1 ? places[0] : null;
    if (!idKey || !slotKey) return;
    const extra = {};
    for (const [k, v] of Object.entries(cmd)) if (k !== 'type' && k !== idKey && k !== slotKey) extra[k] = v;
    const learned = { type: String(cmd.type), idKey, slotKey, extra };
    if (JSON.stringify(learned) === JSON.stringify(obs.potCommand)) return;
    obs.potCommand = learned;
    send('potCommand', learned);
    renderBar();
  }
  function plantPotted(species) {
    const T = obs.potCommand;
    if (!T) {
      plantSay('🪴 Plant one potted plant by hand once: the app learns how, then this key works');
      return;
    }
    const now = Date.now();
    for (const [k, t] of potPending) if (now - t > 4000) potPending.delete(k);
    const all = bagItems().filter((it) => it && it.itemType === 'Plant' && it.id && (!species || it.species === species));
    const pots = all.filter((it) => !potPending.has(String(it.id)));
    if (!pots.length) {
      plantSay(all.length ? '🪴 Still planting the last ones…' : `🪴 No potted ${species ? seedName(species) : 'plants'} left in your bag`);
      return;
    }
    const spot = nextOpenSpot();
    if (spot == null) {
      plantSay('🪴 No open spots');
      return;
    }
    const pot = pots[0];
    const command = Object.assign({ type: T.type }, T.extra, { [T.idKey]: pot.id, [T.slotKey]: spot });
    const r = sendCommand(command, `${T.type}:${spot}`);
    if (!r.ok) {
      plantSay(`🪴 ${r.reason || 'Couldn\'t plant it'}`);
      return;
    }
    plantPending.set(spot, now);
    potPending.set(String(pot.id), now);
    setTimeout(() => {
      try {
        const took = Boolean(tileAt(tilesOf(mySlot()), spot));
        plantPending.delete(spot);
        // Refused: the pot is still in the bag, free to try again.
        if (!took) potPending.delete(String(pot.id));
        const left = obs.bagSummary().potted[pot.species] || 0;
        plantSay(took ? `🪴 Planted ${seedName(pot.species)} · ${left} potted left` : '🪴 The game didn\'t plant it (it may want you nearer the spot)');
        renderBar();
      } catch (err) { /* never in the way */ }
    }, 1500);
  }
  function barTeam(arg) {
    const teams = petTeams();
    if (arg && arg.id) return teams.find((t) => t.id === arg.id) || null;
    if (arg && Number.isInteger(arg.index)) return teams[arg.index] || null;
    return null;
  }
  const ACTIONS = {
    pot: {
      icon: '🪴', repeat: true,
      name: (a) => `Plant potted ${a ? seedName(a) : 'plants'}`,
      count: (a) => {
        const p = obs.bagSummary().potted;
        return a ? p[a] || 0 : Object.values(p).reduce((x, y) => x + y, 0);
      },
      run: (a) => plantPotted(a),
    },
    seed: {
      icon: '🌱', repeat: true,
      name: (a) => (a ? `Plant ${seedName(a)} seeds` : 'Plant seeds (pick which)'),
      count: (a) => (a ? obs.bagSummary().seeds[a] || 0 : null),
      run: (a) => (a ? plantOne(a) : plantSay('🌱 Pick which seed in the keybinds menu')),
    },
    lastTeam: { icon: '🔁', name: () => (obs.lastTeam ? `Swap back to ${obs.lastTeam.name}` : 'Swap to last team'), run: () => send('lastTeam', {}) },
    team: {
      icon: '🐾',
      name: (a) => { const t = barTeam(a); return t ? `Put out ${t.name}` : 'Put out a saved team'; },
      on: (a) => { const t = barTeam(a); return Boolean(t && teamIsOutHere(t)); },
      label: (a) => { const t = barTeam(a); return t ? String(t.name).slice(0, 6) : ''; },
      run: (a) => { const t = barTeam(a); if (t) send('barTeam', { teamId: t.id }); else plantSay('🐾 Pick which team in the keybinds menu'); },
    },
    harvestMode: { icon: '🧺', name: () => 'Harvesting unlocked on / off', on: () => Boolean(obs.harvestLock && obs.harvestLock.mode && obs.harvestLock.mode.on), run: () => send('barToggle', { what: 'mode' }) },
    harvestLock: { icon: '🔒', name: () => 'Harvest lock on / off', on: () => Boolean(obs.harvestLock && obs.harvestLock.on), run: () => send('barToggle', { what: 'lock' }) },
  };
  function teamIsOutHere(t) {
    const out = new Set(petsOut());
    return (t.members || []).length > 0 && t.members.every((m) => out.has(String(m.petId)));
  }
  const keyName = (k) => {
    if (!k || !k.code) return '';
    const base = /^Digit(\d)$/.test(k.code) ? k.code.slice(5) : /^Key([A-Z])$/.test(k.code) ? k.code.slice(3) : /^Numpad(\d)$/.test(k.code) ? `N${k.code.slice(6)}` : k.code.replace(/^Arrow/, '');
    return `${k.ctrl ? 'C' : ''}${k.alt ? 'A' : ''}${k.shift ? 'S' : ''}${k.ctrl || k.alt || k.shift ? '-' : ''}${base}`;
  };
  const sameKey = (a, e) => a && a.code === e.code && Boolean(a.shift) === e.shiftKey && Boolean(a.ctrl) === (e.ctrlKey || e.metaKey) && Boolean(a.alt) === e.altKey;
  function runSlot(i, repeat) {
    const s = obs.actionBar.slots[i];
    const A = s && ACTIONS[s.action];
    if (!A) return false;
    if (repeat && !A.repeat) return true;
    const cell = barCells[i];
    if (cell) {
      cell.style.transform = 'scale(.92)';
      cell.style.borderColor = 'rgba(255,233,160,.9)';
      setTimeout(() => { cell.style.transform = ''; cell.style.borderColor = ''; }, 140);
    }
    try { A.run(s.arg); } catch (err) { /* never in the way */ }
    setTimeout(renderBar, 400);
    return true;
  }
  // Keys: before the game sees them (capture, registered at page start).
  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  window.addEventListener('keydown', (e) => {
    if (passThrough || typing(e.target)) return;
    const b = obs.bagKeys.findIndex((k) => k && sameKey(k, e));
    if (b >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pressForGame(b + 1);
      return;
    }
    if (!obs.actionBar.on) return;
    const i = obs.actionBar.slots.findIndex((s) => s && s.action && sameKey(s.key, e));
    if (i < 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // One press, one action (v0.60.0): holding the key doesn't repeat it.
    if (e.repeat) return;
    runSlot(i, false);
  }, true);
  for (const type of ['keyup', 'keypress']) {
    window.addEventListener(type, (e) => {
      if (passThrough || typing(e.target)) return;
      if (obs.bagKeys.some((k) => k && sameKey(k, e)) || (obs.actionBar.on && obs.actionBar.slots.some((s) => s && s.action && sameKey(s.key, e)))) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  }
  let barPlaceKey = '';
  function placeBar(force) {
    if (!barEl) return;
    const saved = obs.mapPos && obs.mapPos['mg-action-bar'];
    const key = [window.innerWidth, window.innerHeight, saved ? `${saved.x},${saved.y}` : '', barEl.childElementCount, barEl.style.display].join('|');
    if (force !== true && key === barPlaceKey) return;
    barPlaceKey = key;
    const w = barEl.offsetWidth || 440;
    const h = barEl.offsetHeight || 52;
    const x = saved && Number.isFinite(saved.x) ? saved.x * window.innerWidth : (window.innerWidth - w) / 2;
    const y = saved && Number.isFinite(saved.y) ? saved.y * window.innerHeight : window.innerHeight - h - 96;
    barEl.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 4, x))}px`;
    barEl.style.top = `${Math.max(4, Math.min(window.innerHeight - h - 4, y))}px`;
  }
  function renderBar() {
    if (!document.body) return;
    if (!obs.actionBar.on) {
      if (barEl) barEl.style.display = 'none';
      return;
    }
    if (!barEl) {
      barEl = document.createElement('div');
      barEl.id = 'mg-action-bar';
      barEl.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:auto;user-select:none;display:flex;align-items:center;gap:4px;padding:4px 6px 4px 4px;'
        + 'background:rgba(22,16,29,.9);border:1px solid rgba(255,255,255,.16);border-radius:12px;box-shadow:0 4px 14px rgba(0,0,0,.45);font:600 11px system-ui,sans-serif;color:#fff;box-sizing:border-box;';
      const grip = document.createElement('div');
      grip.className = 'mg-grip';
      grip.title = 'Drag to move the action bar';
      grip.textContent = '⋮⋮';
      grip.style.cssText = 'width:12px;cursor:grab;color:rgba(255,255,255,.4);font-size:12px;line-height:1;text-align:center;touch-action:none;';
      barEl.appendChild(grip);
      let down = null;
      const move = (e) => {
        if (!down) return;
        e.preventDefault();
        barEl.style.left = `${Math.max(4, Math.min(window.innerWidth - barEl.offsetWidth - 4, e.clientX - down.dx))}px`;
        barEl.style.top = `${Math.max(4, Math.min(window.innerHeight - barEl.offsetHeight - 4, e.clientY - down.dy))}px`;
      };
      const end = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', end, true);
        if (!down) return;
        down = null;
        const r = barEl.getBoundingClientRect();
        obs.mapPos = Object.assign({}, obs.mapPos, { 'mg-action-bar': { x: r.left / window.innerWidth, y: r.top / window.innerHeight } });
        send('mapPos', { id: 'mg-action-bar', x: r.left / window.innerWidth, y: r.top / window.innerHeight });
      };
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const r = barEl.getBoundingClientRect();
        down = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', end, true);
      });
      barCells = [];
      for (let i = 0; i < 9; i += 1) {
        const c = document.createElement('div');
        c.className = 'mg-slot';
        c.style.cssText = 'position:relative;width:42px;height:42px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);'
          + 'display:flex;align-items:center;justify-content:center;font-size:21px;cursor:pointer;transition:transform .12s,border-color .12s,opacity .2s;box-sizing:border-box;';
        c.innerHTML = '<span class="ic"></span><span class="k" style="position:absolute;left:3px;top:1px;font-size:9.5px;color:rgba(255,255,255,.75)"></span><span class="n" style="position:absolute;right:3px;bottom:1px;font-size:10px;font-weight:700"></span><span class="t" style="position:absolute;left:0;right:0;bottom:1px;text-align:center;font-size:8.5px;color:rgba(255,255,255,.7);overflow:hidden;white-space:nowrap"></span>';
        c.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
        c.addEventListener('click', (e) => { e.stopPropagation(); runSlot(i, false); });
        barEl.appendChild(c);
        barCells.push(c);
      }
      document.body.appendChild(barEl);
    }
    // A 3x3 square (v0.58.0, keys 1-9 as on a number pad's rows) with the
    // grip on top, or one line with the grip at the left.
    const square = obs.actionBar.shape !== 'line';
    barEl.style.display = square ? 'grid' : 'flex';
    barEl.style.gridTemplateColumns = square ? 'repeat(3, 42px)' : '';
    barEl.style.padding = square ? '4px' : '4px 6px 4px 4px';
    const grip = barEl.querySelector('.mg-grip');
    if (grip) {
      grip.style.gridColumn = square ? '1 / -1' : '';
      grip.style.width = square ? 'auto' : '12px';
      grip.style.height = square ? '10px' : '';
      grip.textContent = square ? '⋯' : '⋮⋮';
    }
    obs.actionBar.slots.forEach((s, i) => {
      const c = barCells[i];
      if (!c) return;
      const A = s && ACTIONS[s.action];
      const ic = c.querySelector('.ic');
      const k = c.querySelector('.k');
      const n = c.querySelector('.n');
      const t = c.querySelector('.t');
      k.textContent = keyName(s && s.key);
      ic.textContent = A ? A.icon : '';
      const cnt = A && A.count ? A.count(s.arg) : null;
      n.textContent = cnt != null ? String(cnt) : '';
      t.textContent = A && A.label ? A.label(s.arg) : '';
      const on = A && A.on ? A.on(s.arg) : null;
      const empty = A && cnt === 0;
      const waiting = s && s.action === 'pot' && !obs.potCommand;
      const noTeam = s && s.action === 'team' && !barTeam(s.arg);
      c.style.opacity = !A ? '.45' : empty || waiting || noTeam ? '.5' : '1';
      // Harvest mode engaged glows red; anything else that's on, green.
      const red = s && s.action === 'harvestMode';
      c.style.boxShadow = on ? (red ? '0 0 0 2px rgba(239,68,68,.95) inset, 0 0 10px rgba(239,68,68,.55)' : '0 0 0 2px rgba(111,214,138,.85) inset, 0 0 8px rgba(111,214,138,.45)') : '';
      c.title = A ? `${A.name(s.arg)} (${keyName(s.key) || 'no key'})${waiting ? ' · plant one potted plant by hand first, so the app learns how' : ''}` : `Empty (${keyName(s && s.key) || 'no key'}): set it in the panel, Extras → Action bar & keys`;
    });
    placeBar();
  }
  obs.setActionBar = function setActionBar(x) {
    const v = x && typeof x === 'object' ? x : {};
    if (typeof v.on === 'boolean') obs.actionBar.on = v.on;
    if (Array.isArray(v.slots)) obs.actionBar.slots = v.slots.slice(0, 9).map((s) => (s && typeof s === 'object' ? s : {}));
    if (v.shape === 'line' || v.shape === 'square') obs.actionBar.shape = v.shape;
    if (Array.isArray(v.bagKeys)) obs.bagKeys = v.bagKeys.slice(0, 9).map((k) => (k && typeof k === 'object' && k.code ? k : null));
    if (v.potCommand && typeof v.potCommand === 'object' && v.potCommand.type) obs.potCommand = v.potCommand;
    if (v.forgetPot) obs.potCommand = KNOWN_POT_COMMAND;
    try { renderBar(); } catch (err) { /* never in the way */ }
  };
  window.addEventListener('resize', () => {
    try { placeBar(true); } catch (err) { /* never in the way */ }
  });

  // The Garden tab's map card (v0.57.4): the same maps as over the game,
  // built on request whatever you're holding, whichever pets are out and
  // whether or not a Dawn or Amber Moon is on.
  obs.mapCard = function mapCard(view) {
    let m = null;
    try {
      if (view === 'spots') m = spotModel(true);
      else if (view === 'thunder') m = thunderModel(true);
      else if (view === 'dawn' || view === 'amber') m = binderModel(view);
    } catch (err) {
      m = null;
    }
    if (!m) return null;
    return {
      title: String(m.title || ''),
      right: view === 'dawn' || view === 'amber' ? '' : String(m.right || ''),
      rightColor: m.rightColor || '',
      sum: String(m.sum || '').replace(/ for this pot/, ''),
      key: (m.key || []).filter(Boolean).map((k) => [k[0], k[1] || '', String(k[2] || ''), Boolean(k[3])]),
      looks: (m.looks || []).map((l) => (l ? { bg: l.bg, glow: l.glow || '', edge: l.edge || '', ground: l.bg === MAP_BASE.empty && !l.glow && !l.edge } : null)),
      me: obs.meTile,
      meGap: obs.meGap == null ? null : obs.meGap,
      calib: obs.calibInfo(),
    };
  };

  /* Where you are (v0.57.6). The game's movement messages
   * (QuinoaMovementSnapshot, then QuinoaMovementBatch about once a second)
   * carry each player's position in world tiles; yours is found by your
   * player id. Which world tile is which garden tile is learned: when you
   * harvest, plant or pot by hand, the command names the tile and you're
   * standing next to it, so each bed's offset is the median of (where you
   * were - that tile's place in the bed). The app's own commands go by the
   * native send and never count. Until a bed has a few of these, there's no
   * marker; with them, a pulsing ring marks your tile on the maps. */
  obs.selfPos = null;
  obs.meTile = null;
  obs.mapCalib = [];
  obs.mapCalibBySlot = {};
  let calibSlot = null;
  let lastPosChangeAt = 0;
  // Learning for the garden slot you're in now.
  function useSlotCalib() {
    const idx = mySlotIndex();
    if (idx == null || idx === calibSlot) return;
    if (calibSlot != null) obs.mapCalibBySlot[calibSlot] = obs.mapCalib;
    calibSlot = idx;
    obs.mapCalib = Array.isArray(obs.mapCalibBySlot[idx]) ? obs.mapCalibBySlot[idx] : [];
    obs.mapCalibBySlot[idx] = obs.mapCalib;
    calibRejects.L = [];
    calibRejects.R = [];
  }
  obs.movementSample = { snapshot: null, segments: [], types: {} };
  let meCell = null;
  let meSent = undefined;
  let fitCache = { key: '', fit: null };
  // A position in a message: x/y on the object, or a 'tile' / 'position' /
  // 'pos' that is an x/y (or a plain number, kept as it is for the sample).
  function pointOf(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    for (const k of ['tile', 'position', 'pos', 'to', 'at']) {
      const v = o[k];
      if (v && typeof v === 'object' && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))) return { x: Number(v.x), y: Number(v.y) };
      if (k === 'tile' && Number.isFinite(Number(v)) && v !== null && v !== '') return { t: Number(v) };
    }
    if (typeof o.x !== 'boolean' && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y)) && o.x !== null && o.y !== null) return { x: Number(o.x), y: Number(o.y) };
    return null;
  }
  function lastPoint(msg) {
    let best = null;
    const visit = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 8) return;
      if (Array.isArray(o)) {
        for (const x of o) visit(x, depth + 1);
        return;
      }
      const p = pointOf(o);
      if (p) best = p;
      for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v, depth + 1);
    };
    visit(msg, 0);
    return best;
  }
  // Every position moves the marker at once (v0.57.8: a 150 ms throttle
  // could drop the last update, leaving it a tile behind after you stopped).
  function setSelf(p) {
    const old = obs.selfPos;
    if (!old || old.x !== p.x || old.y !== p.y || old.t !== p.t) lastPosChangeAt = Date.now();
    obs.selfPos = Object.assign({}, p, { at: Date.now() });
    showMe();
  }
  // What the game sends besides commands (v0.57.7): your own movement goes
  // out this way (the server doesn't send it back to you). Types and a
  // trimmed copy of each are kept for samples.
  obs.outgoingShape = {};
  function watchOtherOutgoing(ws, data) {
    if (ws !== obs.gameSocket) return;
    if (typeof data !== 'string') {
      const e = obs.outgoingShape['(binary)'] || (obs.outgoingShape['(binary)'] = { count: 0, bytes: 0 });
      e.count += 1;
      e.bytes = (data && (data.byteLength || data.size || data.length)) || 0;
      return;
    }
    if (data.indexOf('"QuinoaCommand"') >= 0) return;
    let msg = null;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      const e = obs.outgoingShape['(text)'] || (obs.outgoingShape['(text)'] = { count: 0, last: '' });
      e.count += 1;
      e.last = data.slice(0, 200);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const t = String(msg.type || '?').slice(0, 40);
    const e = obs.outgoingShape[t] || (obs.outgoingShape[t] = { count: 0, keys: [], last: null });
    e.count += 1;
    for (const k of Object.keys(msg)) if (e.keys.length < 20 && e.keys.indexOf(k) < 0) e.keys.push(k);
    if (!/^(Ping|Pong)$/i.test(t)) e.last = data.slice(0, 600);
    if (/^(Ping|Pong)$/i.test(t)) return;
    const p = lastPoint(msg);
    if (p) setSelf(p);
  }
  function selfPoint(msg) {
    const id = obs.selfPlayerId;
    if (!id) return null;
    let best = null;
    const visit = (o, depth, mine) => {
      if (!o || typeof o !== 'object' || depth > 8) return;
      if (Array.isArray(o)) {
        for (const x of o) visit(x, depth + 1, mine);
        return;
      }
      const isMine = mine || o.playerId === id || o.userId === id || o.id === id;
      if (isMine) {
        const p = pointOf(o);
        if (p) best = p;
      }
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') visit(v, depth + 1, isMine || k === id);
      }
    };
    visit(msg, 0, false);
    return best;
  }
  function noteMovement(msg) {
    const id = obs.selfPlayerId;
    const ms = obs.movementSample;
    ms.types[msg.type] = (ms.types[msg.type] || 0) + 1;
    // For samples: your own part of these messages, trimmed.
    if (msg.type === 'QuinoaMovementSnapshot' && msg.players && id && msg.players[id]) ms.snapshot = JSON.stringify(msg.players[id]).slice(0, 600);
    if (msg.type === 'QuinoaMovementBatch' && id) {
      const raw = JSON.stringify(msg.segments || null);
      if (raw && raw.indexOf(id) >= 0) {
        ms.segments.push(raw.slice(0, 700));
        if (ms.segments.length > 4) ms.segments.shift();
      }
    }
    if (msg.type === 'QuinoaMovementBatch' && Array.isArray(msg.segments) && msg.segments.length) ms.example = JSON.stringify(msg).slice(0, 900);
    const p = selfPoint(msg);
    if (p) setSelf(p);
  }
  // A tile's place in its bed: 10 rows of 20 (two beds of 10 columns).
  const bedOf = (i) => (i % 20 < 10 ? 'L' : 'R');
  function calibFit() {
    const key = `${obs.mapCalib.length}:${obs.mapCalib.length ? JSON.stringify(obs.mapCalib[obs.mapCalib.length - 1]) : ''}`;
    if (fitCache.key === key) return fitCache.fit;
    fitCache = { key, fit: calibFitNow() };
    return fitCache.fit;
  }
  function calibFitNow() {
    const med = (a) => {
      const s = a.slice().sort((x, y) => x - y);
      return s.length ? s[Math.floor(s.length / 2)] : null;
    };
    const fit = {};
    for (const bed of ['L', 'R']) {
      const pts = obs.mapCalib.filter((c) => bedOf(c.i) === bed);
      const dxs = pts.map((c) => c.x - (c.i % 20));
      const dys = pts.map((c) => c.y - Math.floor(c.i / 20));
      // Three readings, or (v0.63.7) two or more that agree exactly.
      const agree = pts.length >= 2 && dxs.every((v) => v === dxs[0]) && dys.every((v) => v === dys[0]);
      if (pts.length >= 3 || agree) fit[bed] = { dx: med(dxs), dy: med(dys), n: pts.length };
    }
    // One bed learned: the other guessed from it until it's learned too. The
    // beds have a one-tile walkway between them, so the left bed sits one
    // tile further left than the right bed's offset says (v0.63.7: copying
    // it put the marker one tile off on the unlearned bed).
    if (fit.L && !fit.R) fit.R = Object.assign({ guess: true }, fit.L, { dx: fit.L.dx + 1 });
    if (fit.R && !fit.L) fit.L = Object.assign({ guess: true }, fit.R, { dx: fit.R.dx - 1 });
    return fit.L ? fit : null;
  }
  // One bed's offset from its own pairs (3 or more), or null.
  function bedFit(bed, list) {
    const pts = (list || obs.mapCalib).filter((c) => bedOf(c.i) === bed);
    if (pts.length < 3) return null;
    const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    return { dx: med(pts.map((c) => c.x - (c.i % 20))), dy: med(pts.map((c) => c.y - Math.floor(c.i / 20))) };
  }
  // Pairs a learned bed disagrees with (v0.57.10): set aside; six that agree
  // with each other mean the bed itself was learned wrong, and replace it.
  const calibRejects = { L: [], R: [] };
  function calibrateFrom(cmd) {
    if (!cmd || typeof cmd !== 'object' || !/^(HarvestCrop|PlantSeed|PlantGardenPlant|PotPlant|PlantEgg|WaterPlant)$/.test(String(cmd.type))) return;
    const i = Number(cmd.slot);
    const p = obs.selfPos;
    if (!Number.isInteger(i) || i < 0 || i >= 200 || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Date.now() - p.at > 4000) return;
    useSlotCalib();
    const pair = { i, x: p.x, y: p.y };
    const bed = bedOf(i);
    const f = bedFit(bed);
    // Standing still: no new position for 1.5 s, so it's an accurate one.
    const still = Date.now() - lastPosChangeAt >= 1500;
    // A harvest is always within reach, so once the bed is learned a pair
    // more than two tiles from where it puts that crop means your position
    // was stale (clicking while walking, in harvest mode say): it isn't
    // learned from, so a sweep can't slide the garden and lose the marker.
    if (f && (Math.abs(p.x - (f.dx + (i % 20))) > 2 || Math.abs(p.y - (f.dy + Math.floor(i / 20))) > 2)) {
      // Only harvests made standing still can say the bed was learned wrong;
      // ones made while walking (a steady walk lags steadily) are just dropped.
      if (!still) return;
      const rej = calibRejects[bed];
      rej.push(pair);
      if (rej.length > 8) rej.shift();
      const rf = rej.length >= 6 ? bedFit(bed, rej) : null;
      const agree = rf && rej.every((c) => Math.abs(c.x - (rf.dx + (c.i % 20))) <= 1 && Math.abs(c.y - (rf.dy + Math.floor(c.i / 20))) <= 1);
      if (!agree) return;
      obs.mapCalib = obs.mapCalib.filter((c) => bedOf(c.i) !== bed).concat(rej);
      calibRejects[bed] = [];
    } else {
      calibRejects[bed] = [];
      obs.mapCalib.push(pair);
    }
    while (obs.mapCalib.length > 40) obs.mapCalib.shift();
    if (calibSlot != null) obs.mapCalibBySlot[calibSlot] = obs.mapCalib;
    send('mapCalib', { calib: obs.mapCalib, bySlot: obs.mapCalibBySlot });
    showMe();
  }
  function tileFromPos(p) {
    const fit = calibFit();
    if (!fit || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    for (const bed of ['L', 'R']) {
      const f = fit[bed];
      const row = Math.round(p.y - f.dy);
      const col = Math.round(p.x - f.dx);
      const okCol = bed === 'L' ? col >= 0 && col < 10 : col >= 10 && col < 20;
      if (okCol && row >= 0 && row < 10) return row * 20 + col;
    }
    return null;
  }
  // Between the beds (v0.57.9): the walkway is the world columns between the
  // left bed's last and the right bed's first, known once both beds are
  // learned (not while one stands in for the other). Standing there on a
  // garden row puts the marker on that row's gap.
  function walkwayFromPos(p) {
    const fit = calibFit();
    if (!fit || fit.L.guess || fit.R.guess || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const x = Math.round(p.x);
    const from = fit.L.dx + 10;
    const to = fit.R.dx + 9;
    if (to < from || x < from || x > to) return null;
    const row = Math.round(p.y - (fit.L.dy + fit.R.dy) / 2);
    return row >= 0 && row < 10 ? row : null;
  }
  function showMe() {
    try { useSlotCalib(); } catch (err) { /* never in the way */ }
    // Your last known position stands until you move: the game only sends
    // movement while someone is moving, so standing still mustn't hide you.
    const t = obs.selfPos ? tileFromPos(obs.selfPos) : null;
    const g = t == null && obs.selfPos ? walkwayFromPos(obs.selfPos) : null;
    obs.meTile = t;
    obs.meGap = g;
    // The panel's map card hears about a new tile straight away (v0.57.8).
    const sent = `${t}|${g}`;
    if (sent !== meSent) {
      meSent = sent;
      send('meTile', { t, gap: g });
    }
    if (!MAP || !MAP.cells) return;
    const cell = t != null ? MAP.cells[t] : g != null && MAP.gaps ? MAP.gaps[g] : null;
    // Always make sure: the map's own restyling resets a cell's classes, so
    // "it's already there" can't be trusted.
    if (meCell && meCell !== cell) meCell.classList.remove('mg-me');
    if (cell && !cell.classList.contains('mg-me')) cell.classList.add('mg-me');
    meCell = cell;
  }
  obs.setMapCalib = function setMapCalib(v) {
    const clean = (list) => (Array.isArray(list) ? list.filter((c) => c && Number.isInteger(c.i) && Number.isFinite(c.x) && Number.isFinite(c.y)).slice(-40) : []);
    if (Array.isArray(v)) {
      // Saved before v0.57.10 (one list): it belongs to the slot you're in now.
      obs.mapCalib = clean(v);
      calibSlot = null;
      const idx = mySlotIndex();
      if (idx != null) {
        obs.mapCalibBySlot[idx] = obs.mapCalib;
        calibSlot = idx;
      }
    } else if (v && typeof v === 'object') {
      obs.mapCalibBySlot = {};
      for (const [k, list] of Object.entries(v)) obs.mapCalibBySlot[k] = clean(list);
      calibSlot = null;
      useSlotCalib();
    }
    showMe();
  };
  obs.refreshMe = () => {
    if (meCell && !meCell.isConnected) meCell = null;
    showMe();
    return { me: obs.meTile, hasMap: Boolean(MAP), cells: MAP && MAP.cells ? MAP.cells.length : 0, ringed: MAP && MAP.cells ? MAP.cells.findIndex((c) => c.classList.contains('mg-me')) : null };
  };
  obs.calibInfo = () => {
    const f = calibFit();
    return { pairs: obs.mapCalib.length, left: f ? !f.L.guess : false, right: f ? !f.R.guess : false, ready: Boolean(f) };
  };

  /* A team suggestion on the game (v0.60.0, fair play): the app never
   * swaps your pets; when the weather (or a trigger) suggests a team, this
   * card asks, and Put out is your press. */
  let suggestEl = null;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* Garden glass (v0.61.3; clean and calm since v0.67.0): one look for
   * everything the app puts over the game, so it feels part of it rather
   * than layered on top. Frosted graphite glass with the game softly blurred
   * behind; a hairline edge and a soft shadow; Inter (from the app, as data)
   * or the system font; the panel's tint for the main button and a quiet grey
   * second one. An event theme changes the glass and the tint (setTheme).
   * Looks only: where each thing sits stays its own. Warning colours (the
   * red badge, an urgent trough chip) keep their colour. */
  function ensureGlass() {
    if (!document.head || document.getElementById('mg-glass-style')) return;
    const F = "'MG Inter','Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif";
    const GLASS = 'background:var(--mg-glass,rgba(30,30,33,.74))!important;-webkit-backdrop-filter:blur(20px) saturate(170%);backdrop-filter:blur(20px) saturate(170%);border:.5px solid rgba(255,255,255,.14)!important;box-shadow:0 16px 44px rgba(0,0,0,.36),inset 0 .5px 0 rgba(255,255,255,.08)!important;color:#f5f5f7!important;';
    const all = '#mg-team-suggest,#mg-pot-card,#__mgStepOut,#__mgHarvestNote,#__mgHarvestLock,#mg-trough-chip,#mg-team-btn,#mg-plant-btn,#mg-plant-list,#mg-map,#mg-action-bar,#mg-money-box,#mg-hatch-box,#mg-egg-lock';
    const st = document.createElement('style');
    st.id = 'mg-glass-style';
    st.textContent = `${all}{font-family:${F}!important;letter-spacing:-.006em;-webkit-font-smoothing:antialiased}`
      + `${all.split(',').map((s) => `${s} *`).join(',')}{font-family:${F}!important}`
      + `#mg-team-suggest,#__mgStepOut,#mg-pot-card,#mg-team-btn,#mg-plant-btn,#mg-plant-list,#mg-action-bar,#mg-money-box,#mg-hatch-box,#mg-egg-lock{${GLASS}}`
      + '#mg-hatch-box{border-radius:14px!important}#mg-egg-lock{border-radius:20px!important}'
      + '#mg-pot-card{border-radius:20px!important;padding:16px 18px!important;font:600 15px var(--mgf,system-ui)}'
      + '#mg-money-box{border-radius:14px!important}'
      + `#mg-map{${GLASS}background:var(--mg-glass-deep,rgba(26,26,29,.88))!important;border-radius:16px!important}`
      + '#mg-team-suggest,#__mgStepOut{border-radius:20px!important;padding:18px 20px!important}'
      + '#__mgStepOut{left:50%!important;top:40%!important;transform:translate(-50%,-50%)!important;text-align:center;width:min(400px,calc(100vw - 32px));box-sizing:border-box;animation:mgGlassIn .45s cubic-bezier(.2,.8,.2,1) both}'
      + '@keyframes mgGlassIn{from{opacity:0;transform:translate(-50%,calc(-50% + 12px)) scale(.97)}to{opacity:1;transform:translate(-50%,-50%)}}'
      + `#mg-team-suggest button[data-act=apply],#__mgStepOut button[data-act=confirm],#mg-pot-card button[data-act=go]{background:var(--mg-tint,#30d158)!important;color:var(--mg-tint-ink,#04230f)!important;border:0!important;border-radius:12px!important;font:650 14px ${F}!important;padding:10px 18px!important;box-shadow:0 6px 18px var(--mg-tint-glow,rgba(48,209,88,.28))!important;cursor:pointer;transition:filter .15s ease,transform .1s ease}`
      + `#mg-team-suggest button[data-act=dismiss],#__mgStepOut button[data-act=ignore],#mg-pot-card button[data-act=done]{background:rgba(118,118,128,.26)!important;color:#f5f5f7!important;border:0!important;border-radius:12px!important;font:600 13px ${F}!important;padding:9px 14px!important;cursor:pointer;transition:background .15s ease}`
      + '#mg-team-suggest button:active,#__mgStepOut button:active,#mg-pot-card button:active{transform:scale(.98)}'
      + '#mg-team-suggest button:hover,#__mgStepOut button:hover{filter:brightness(1.06)}'
      + '#mg-team-suggest button[data-act=dismiss]:hover,#__mgStepOut button[data-act=ignore]:hover{background:rgba(118,118,128,.36)!important}'
      + '#mg-team-suggest button:focus-visible,#__mgStepOut button:focus-visible{outline:3px solid var(--mg-tint,#30d158);outline-offset:2px}'
      + '#__mgHarvestNote,#__mgHarvestLock,#mg-trough-chip{border-radius:999px!important;border:.5px solid rgba(255,255,255,.16)!important;box-shadow:0 8px 24px rgba(0,0,0,.3)!important;-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);font-weight:650!important;padding:7px 14px!important}'
      + '#__mgHarvestNote{background:var(--mg-glass-deep,rgba(26,26,29,.86))!important}'
      + '#mg-team-btn,#mg-plant-btn{border-radius:12px!important;font-weight:650!important}'
      + '#mg-action-bar{border-radius:16px!important}'
      + '@media (prefers-reduced-motion:reduce){#__mgStepOut{animation:none!important}#mg-team-suggest button,#__mgStepOut button{transition:none}}';
    document.head.appendChild(st);
  }
  // Loaded as soon as the observer starts (the map, the bar, the buttons,
  // badges and notes use it too), and kept if the game ever rebuilds <head>.
  ensureGlass();
  setInterval(ensureGlass, 5000);

  /* Pet-food pots for weather (v0.63.0): a card to plant pet-food pots out
   * when a weather you'll stay in for starts (Plant one, one pot a press),
   * and to pot them back up when it ends (Pot one, one plant a press: the
   * game's own PotPlant with a fresh id, then a check the pot reached the
   * bag; if not, it says so and stops). Only the kinds main sends. */
  let potCard = null;
  let potInfo = null;
  let potFailed = false;
  const potPicking = new Map();
  const normSp = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const potWanted = () => new Set(((potInfo && potInfo.species) || []).map(normSp));
  const potsInBag = () => { const w = potWanted(); return bagItems().filter((it) => it && it.itemType === 'Plant' && it.id && w.has(normSp(it.species))); };
  function potsInGarden() {
    const w = potWanted();
    const tiles = tilesOf(mySlot());
    const out = [];
    for (let i = 0; i < 200; i += 1) {
      const t = tileAt(tiles, i);
      if (t && String(t.objectType || '').toLowerCase() === 'plant' && w.has(normSp(t.species))) out.push({ slot: i, species: t.species });
    }
    return out;
  }
  function potOne() {
    const now = Date.now();
    for (const [k, t] of potPicking) if (now - t > 5000) potPicking.delete(k);
    const t = potsInGarden().find((x) => !potPicking.has(x.slot));
    if (!t) return renderPotCard();
    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    const r = sendCommand({ type: 'PotPlant', slot: t.slot, plantItemId: id }, `PotPlant:${t.slot}`);
    if (!r.ok) return renderPotCard(`Couldn't pot it: ${r.reason}`);
    potPicking.set(t.slot, now);
    setTimeout(() => {
      if (bagItems().some((it) => it && it.id === id)) {
        potPicking.delete(t.slot);
        renderPotCard();
      } else {
        potFailed = true;
        renderPotCard('The game didn\'t take that one. Pot it by hand.');
      }
    }, 2500);
    return renderPotCard();
  }
  function renderPotCard(note) {
    if (!document.body) return;
    ensureGlass();
    if (!potInfo) {
      if (potCard) potCard.style.display = 'none';
      return;
    }
    const plant = potInfo.mode === 'plant';
    const list = plant ? potsInBag() : potsInGarden().filter((x) => !potPicking.has(x.slot));
    if (!list.length && !note) {
      // Still checking a pot reached the bag: stay up and say so.
      if (!plant && potPicking.size) note = 'Potting…';
      else {
        potInfo = null;
        if (potCard) potCard.style.display = 'none';
        return;
      }
    }
    if (!potCard) {
      potCard = document.createElement('div');
      potCard.id = 'mg-pot-card';
      potCard.setAttribute('role', 'dialog');
      potCard.style.cssText = 'position:fixed;left:50%;top:64%;transform:translate(-50%,-50%);z-index:2147483646;display:flex;align-items:center;gap:14px;width:min(500px,calc(100vw - 32px));box-sizing:border-box;';
      document.body.appendChild(potCard);
      potCard.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        if (b.dataset.act === 'done') {
          potInfo = null;
          potCard.style.display = 'none';
        } else if (potInfo && potInfo.mode === 'plant') {
          const first = potsInBag()[0];
          if (first) plantPotted(first.species);
          setTimeout(() => renderPotCard(), 700);
        } else if (!potFailed) potOne();
      });
    }
    const names = [...new Set((list.length ? list.map((x) => x.species) : potInfo.species).map((s) => seedName(s)))].join(', ');
    const n = list.length;
    const title = plant ? `${potInfo.emoji} ${potInfo.label} is on: plant out your ${names} pots?` : `☀️ ${potInfo.label}'s over: pot your ${names} back up?`;
    const sub = note || (plant ? `${n} in your bag. They'll pick up a mutation while you're in.` : `${n} in your garden.`);
    const go = plant ? `Plant one · ${n} left` : `Pot one · ${n} left`;
    potCard.innerHTML = `<span style="font-size:34px;line-height:1">🪴</span><span style="flex:1;min-width:0">${esc(title)}<small style="display:block;font-weight:500;font-size:12.5px;color:#cdbedf;margin-top:2px">${esc(sub)}</small></span>`
      + `${n && !(potFailed && !plant) ? `<button data-act="go" style="cursor:pointer">${esc(go)}</button>` : ''}<button data-act="done" style="cursor:pointer">Done</button>`;
    potCard.style.display = 'flex';
  }
  obs.potWeather = function potWeather(info) {
    potInfo = info && Array.isArray(info.species) ? info : null;
    potFailed = false;
    potPicking.clear();
    renderPotCard();
  };

  obs.showTeamSuggest = function showTeamSuggest(s) {
    if (!document.body) return;
    ensureGlass();
    if (!s) {
      if (suggestEl) suggestEl.style.display = 'none';
      return;
    }
    // v0.61.2: in the middle of the game (a little above centre, off your
    // garden), larger, with a gentle fade-and-rise when it arrives; it stays
    // until you answer.
    if (!document.getElementById('mg-suggest-style')) {
      const st = document.createElement('style');
      st.id = 'mg-suggest-style';
      st.textContent = '@keyframes mgSuggestIn{from{opacity:0;transform:translate(-50%,calc(-50% + 12px)) scale(.97)}to{opacity:1;transform:translate(-50%,-50%)}}'
        + '#mg-team-suggest{animation:mgSuggestIn .45s cubic-bezier(.2,.8,.2,1) both}'
        + '#mg-team-suggest button:focus-visible{outline:3px solid #f5c96a;outline-offset:2px}'
        + '@media (prefers-reduced-motion:reduce){#mg-team-suggest{animation:none}}';
      document.head.appendChild(st);
    }
    if (!suggestEl) {
      suggestEl = document.createElement('div');
      suggestEl.id = 'mg-team-suggest';
      suggestEl.setAttribute('role', 'dialog');
      suggestEl.setAttribute('aria-label', 'Team suggestion');
      suggestEl.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:2147483646;display:flex;align-items:center;gap:14px;font:600 15px system-ui,sans-serif;color:#fff;background:rgba(38,26,48,.96);border:1px solid rgba(245,201,106,.65);border-radius:18px;padding:16px 18px;box-shadow:0 14px 44px rgba(0,0,0,.5),0 0 0 6px rgba(245,201,106,.08);width:min(480px,calc(100vw - 32px));box-sizing:border-box;';
      document.body.appendChild(suggestEl);
      suggestEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        send('teamSuggest', { act: b.dataset.act });
        suggestEl.style.display = 'none';
      });
    }
    suggestEl.dataset.name = s.name || '';
    suggestEl.innerHTML = `<span style="font-size:38px;line-height:1">${esc(s.emoji)}</span>`
      + `<span style="flex:1;min-width:0">Put out your <b>${esc(s.name)}</b>${/team$/i.test(String(s.name).trim()) ? '' : ' team'}?<small style="display:block;font-weight:500;font-size:12.5px;color:#cdbedf;margin-top:2px">${esc(s.why)}</small></span>`
      + '<button data-act="apply" style="cursor:pointer">Put out</button>'
      + '<button data-act="dismiss" style="cursor:pointer">Not now</button>';
    // Re-run the arrival only when it was hidden (a refresh doesn't replay it).
    if (suggestEl.style.display === 'none' || !suggestEl.dataset.shown) {
      suggestEl.style.animation = 'none';
      void suggestEl.offsetWidth;
      suggestEl.style.animation = '';
    }
    suggestEl.dataset.shown = '1';
    suggestEl.style.display = 'flex';
  };

  /* The trough countdown on the game (v0.58.0): a small chip by the 🔁
   * button, when turned on in the Pets tab. */
  let troughChip = null;
  obs.setTroughChip = function setTroughChip(x) {
    const v = x && typeof x === 'object' ? x : {};
    if (!document.body) return;
    if (!v.on || !v.text) {
      if (troughChip) troughChip.style.display = 'none';
      return;
    }
    if (!troughChip) {
      troughChip = document.createElement('div');
      troughChip.id = 'mg-trough-chip';
      troughChip.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:auto;cursor:grab;user-select:none;touch-action:none;font:700 12px system-ui,sans-serif;color:#fff;background:rgba(42,27,54,.92);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:5px 10px;box-shadow:0 2px 8px rgba(0,0,0,.35);white-space:nowrap;';
      troughChip.title = 'The trough runs out in… · drag to move · double-click to put it back';
      document.body.appendChild(troughChip);
      makeChipMovable(troughChip);
    }
    // A countdown to a moment (v0.59.0), ticking every second.
    troughChip.__v = v;
    const paint = () => {
      const w = troughChip.__v || {};
      let text = w.text;
      if (w.emptyAt) {
        const s = Math.max(0, Math.round((w.emptyAt - Date.now()) / 1000));
        const m = Math.floor(s / 60);
        // (v0.59.3: no \"?\" while it's still learning: the panel says so.)
        text = `🍽️ ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`}`;
      }
      troughChip.textContent = text;
      // Urgent keeps its red; otherwise the shared garden glass (v0.63.3).
      troughChip.style.background = w.urgent || (w.emptyAt && w.emptyAt - Date.now() < 30 * 60000) ? 'rgba(200,40,48,.88)' : 'rgba(32,23,42,.74)';
    };
    paint();
    clearInterval(troughChip.__t);
    if (v.emptyAt) troughChip.__t = setInterval(paint, 1000);
    troughChip.style.display = '';
    placeTroughChip();
  };

  /* The trough timer can be moved (v0.63.8): drag it anywhere (the game
   * doesn't see the drag), it's remembered (with the map positions, as
   * mg-trough-chip), double-click puts it back. It stays on screen. */
  function placeTroughChip() {
    if (!troughChip || troughChip.style.display === 'none') return;
    const p = obs.mapPos && obs.mapPos['mg-trough-chip'];
    const w = troughChip.offsetWidth || 90;
    const h = troughChip.offsetHeight || 26;
    let left;
    let top;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      left = p.x * window.innerWidth;
      top = p.y * window.innerHeight;
    } else {
      const anchorEl = teamBtn && teamBtn.style.display !== 'none' ? teamBtn : null;
      const r = anchorEl ? anchorEl.getBoundingClientRect() : { right: 12, top: window.innerHeight * 0.36 - 34 };
      left = anchorEl ? r.right + 8 : 12;
      top = r.top;
    }
    troughChip.style.left = `${Math.round(Math.max(4, Math.min(window.innerWidth - w - 4, left)))}px`;
    troughChip.style.top = `${Math.round(Math.max(4, Math.min(window.innerHeight - h - 4, top)))}px`;
  }
  function makeChipMovable(el) {
    let drag = null;
    const move = (e) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
      drag.moved = true;
      el.style.cursor = 'grabbing';
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = `${Math.round(Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - drag.dx)))}px`;
      el.style.top = `${Math.round(Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - drag.dy)))}px`;
    };
    const end = (e) => {
      if (!drag) return;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const moved = drag.moved;
      drag = null;
      el.style.cursor = 'grab';
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      if (!moved) return;
      const r = el.getBoundingClientRect();
      const pos = { x: r.left / window.innerWidth, y: r.top / window.innerHeight };
      obs.mapPos = Object.assign({}, obs.mapPos, { 'mg-trough-chip': pos });
      send('mapPos', { id: 'mg-trough-chip', x: pos.x, y: pos.y });
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* the window listeners carry it */ }
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    });
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = Object.assign({}, obs.mapPos);
      delete pos['mg-trough-chip'];
      obs.mapPos = pos;
      send('mapPos', { id: 'mg-trough-chip' });
      placeTroughChip();
    });
  }
  window.addEventListener('resize', () => {
    try { placeTroughChip(); } catch (err) { /* never in the way */ }
  });

  obs.showMapView = function showMapView(ctx) {
    obs.mapPick = MAP_ORDER.includes(ctx) ? ctx : null;
    obs.mapPickSet = null;
    try {
      mapUpdate();
    } catch (err) {
      /* never in the way */
    }
  };
  obs.setMountMap = function setMountMap(on) {
    obs.mountOn = on !== false;
    try { mapUpdate(); } catch (err) { /* never in the way */ }
  };
  obs.setThunderMap = function setThunderMap(on) {
    obs.thunderOn = on !== false;
    try { mapUpdate(); } catch (err) { /* never in the way */ }
  };

  function miniMapBox(id) {
    const box = document.createElement('div');
    box.id = id;
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'pointer-events:none;background:rgba(22,16,29,.97);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px 7px;'
      + 'font:11.5px/1.3 system-ui,sans-serif;color:#eee;box-shadow:0 6px 20px rgba(0,0,0,.45);box-sizing:border-box;width:312px;';
    if (!document.getElementById('mg-binder-style')) binderMapStyle();
    const head = document.createElement('div');
    head.className = 'mg-map-head';
    // A fixed frame (v0.56.7): every view has the same title row, tabs row,
    // two-line summary and three-line key, so switching views (a Phoenix out,
    // then a pot picked up) never moves the grid.
    head.style.cssText = 'font-weight:700;font-size:12.5px;margin-bottom:3px;';
    const sum = document.createElement('div');
    sum.style.cssText = 'color:#ddd;margin-bottom:6px;height:30px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(10,12px) 9px repeat(10,12px);grid-auto-rows:12px;gap:2px;';
    const cells = [];
    const gaps = [];
    for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 21; c += 1) {
        const cell = document.createElement('i');
        cell.style.cssText = c === 10 ? 'display:block;' : 'display:block;border-radius:2px;background:#18121f;';
        grid.appendChild(cell);
        if (c !== 10) cells.push(cell);
        else gaps.push(cell);
      }
    }
    const key = document.createElement('div');
    key.style.cssText = 'display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px 10px;margin-top:6px;color:#ccc;font-size:10.5px;height:50px;overflow:hidden;';
    box.appendChild(head);
    box.appendChild(sum);
    box.appendChild(grid);
    box.appendChild(key);
    dockMap(box);
    makeMovable(box, head);
    makeResizable(box);
    if (obs.mapFold[id]) box.classList.add('mg-folded');
    placeMap(box);
    return { box, head, sum, cells, gaps, key };
  }

  /* Resizing the map (v0.63.5): a grip in its bottom-right corner; drag to
   * make it bigger or smaller (60% to 220% of its normal size), double-click
   * for normal size. It scales the whole map (tiles, words, the box) on top
   * of the screen-size scaling, docked or moved, and it's remembered (kept
   * with the positions as mg-map-size: 0 smallest .. 1 biggest). */
  const MAP_MIN = 0.6;
  const MAP_MAX = 2.2;
  function mapUserScale() {
    const p = obs.mapPos && obs.mapPos['mg-map-size'];
    return p && Number.isFinite(p.x) ? MAP_MIN + p.x * (MAP_MAX - MAP_MIN) : 1;
  }
  function saveMapScale(s) {
    const x = (s - MAP_MIN) / (MAP_MAX - MAP_MIN);
    obs.mapPos = Object.assign({}, obs.mapPos, { 'mg-map-size': { x, y: 0 } });
    send('mapPos', { id: 'mg-map-size', x, y: 0 });
  }
  function makeResizable(box) {
    box.style.zoom = String(mapUserScale());
    if (!box.style.position || box.style.position === 'static') box.style.position = 'relative';
    const grip = document.createElement('div');
    grip.className = 'mg-map-grip';
    grip.title = 'Drag to resize · double-click for normal size';
    grip.style.cssText = 'position:absolute;right:3px;bottom:3px;width:14px;height:14px;cursor:nwse-resize;pointer-events:auto;opacity:.5;border-radius:0 0 9px 0;'
      + 'background:linear-gradient(135deg,transparent 45%,rgba(255,255,255,.7) 45%,rgba(255,255,255,.7) 53%,transparent 53%,transparent 66%,rgba(255,255,255,.7) 66%,rgba(255,255,255,.7) 74%,transparent 74%);transition:opacity .15s ease;';
    grip.addEventListener('pointerenter', () => { grip.style.opacity = '.95'; });
    grip.addEventListener('pointerleave', () => { grip.style.opacity = '.5'; });
    // While dragging, the whole page is listened to (not only the grip's
    // pointer capture), so the drag follows the mouse until it's let go.
    let start = null;
    const onMove = (e) => {
      if (!start) return;
      const d = ((e.clientX - start.x) + (e.clientY - start.y)) / 2;
      const s = Math.max(MAP_MIN, Math.min(MAP_MAX, start.s * (start.w + d) / start.w));
      box.style.zoom = s.toFixed(3);
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      if (!start) return;
      start = null;
      saveMapScale(Number(box.style.zoom) || 1);
      if (typeof fitOverlays === 'function') fitOverlays();
    };
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      start = { x: e.clientX, y: e.clientY, s: Number(box.style.zoom) || 1, w: box.getBoundingClientRect().width || 1 };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* the window listeners carry it */ }
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    });
    grip.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.style.zoom = '1';
      saveMapScale(1);
      if (typeof fitOverlays === 'function') fitOverlays();
    });
    box.appendChild(grip);
  }

  /* Sizing the maps to the screen (v0.53.16): everything over the game
   * scales with the game's view (a 13" laptop's ~900 x 680 draws them at
   * ~0.78, a 1440p monitor's at up to 1.4), and the corner stack shrinks
   * further if the maps in it would be taller than the view. Moved maps
   * scale the same way and stay inside it. */
  obs.mapFold = {};
  function overlayScale() {
    const s = Math.min(window.innerWidth / 1150, window.innerHeight / 820);
    return Math.max(0.7, Math.min(1.4, s));
  }
  function fitOverlays() {
    const c = corner && corner.isConnected ? corner : null;
    const s = overlayScale();
    if (c) {
      c.style.transformOrigin = 'bottom right';
      const room = window.innerHeight - 28;
      const tall = c.offsetHeight;
      const fit = tall > 0 && tall * s > room ? Math.max(0.5, room / tall) : s;
      c.style.transform = `scale(${fit.toFixed(3)})`;
    }
    for (const id of ['mg-map']) {
      const b = document.getElementById(id);
      if (b && b.style.position === 'fixed') {
        b.style.transformOrigin = 'top left';
        b.style.transform = `scale(${s.toFixed(3)})`;
      }
    }
  }

  /* Moving the corner maps (v0.53.9): drag one by its header to put it
   * anywhere; double-click the header to send it back to the corner. Only
   * the header takes the mouse (the map itself stays click-through, so it
   * never blocks the game). Where each one sits is kept as a share of the
   * window (so a resize doesn't lose it) and saved by the app. */
  obs.mapPos = {};
  let dragging = null;
  function dockMap(box) {
    box.style.position = '';
    box.style.left = '';
    box.style.top = '';
    box.style.zIndex = '';
    box.style.transform = '';
    const corner = cornerStack();
    const spot = document.getElementById('mg-spot-map');
    // Moved only if it isn't already there (v0.73.1: re-adding it on every
    // update made the page lay itself out again).
    if (spot && spot.parentNode === corner) {
      if (box.parentNode !== corner || box.nextSibling !== spot) corner.insertBefore(box, spot);
    } else if (box.parentNode !== corner || corner.lastElementChild !== box) {
      corner.appendChild(box);
    }
  }
  function floatMap(box, x, y) {
    if (box.parentNode !== document.body) document.body.appendChild(box);
    const s = overlayScale();
    box.style.transformOrigin = 'top left';
    box.style.transform = `scale(${s.toFixed(3)})`;
    const w = (box.offsetWidth || 300) * s;
    const h = (box.offsetHeight || 240) * s;
    box.style.position = 'fixed';
    box.style.left = `${Math.round(Math.max(0, Math.min(window.innerWidth - w, x)))}px`;
    box.style.top = `${Math.round(Math.max(0, Math.min(window.innerHeight - h, y)))}px`;
    box.style.zIndex = '2147483000';
  }
  // Where it was left, if it was moved (kept in view if the window shrank).
  // Placed again only when something that moves or sizes it changed
  // (v0.73.1): every update used to re-measure it and re-add it to the
  // corner, which made the browser lay the page out again each time.
  const mapPlaced = {};
  const mapPlaceTimed = perfTimed('map:place', (b) => placeMap(b));
  function placeMap(box, force) {
    // Your size for the map (v0.63.5), once the saved one has arrived.
    if (box && box.id === 'mg-map') box.style.zoom = String(mapUserScale());
    if (dragging && dragging.box === box) return;
    const c = corner && corner.isConnected ? corner : null;
    const key = [window.innerWidth, window.innerHeight, box.style.zoom, overlayScale(), JSON.stringify(obs.mapPos[box.id] || null), box.classList.contains('mg-folded'), box.style.display, c ? c.childElementCount : -1].join('|');
    if (force !== true && mapPlaced[box.id] === key) return;
    mapPlaced[box.id] = key;
    try { fitOverlays(); } catch (err) { /* never in the way */ }
    // The one map takes over a place you gave any of the old four.
    const p = obs.mapPos[box.id] || (box.id === 'mg-map' ? ['mg-binder-map', 'mg-thunder-map', 'mg-mount-map', 'mg-spot-map'].map((k) => obs.mapPos[k]).find(Boolean) : null);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) floatMap(box, p.x * window.innerWidth, p.y * window.innerHeight);
    else if (box.style.position === 'fixed') dockMap(box);
  }
  function makeMovable(box, handle) {
    handle.style.pointerEvents = 'auto';
    handle.style.cursor = 'grab';
    handle.style.userSelect = 'none';
    handle.title = 'Tap to fold · drag to move · double-click to put it back in the corner';
    // While dragging, the whole window follows the pointer (and the game
    // doesn't see those moves); the header alone would lose it the moment
    // the pointer left it.
    const move = (e) => {
      if (!dragging || dragging.box !== box) return;
      e.preventDefault();
      e.stopPropagation();
      if (!dragging.moved && Math.hypot(e.clientX - dragging.x0, e.clientY - dragging.y0) < 5) return;
      if (!dragging.moved) {
        dragging.moved = true;
        floatMap(box, dragging.r.left, dragging.r.top);
      }
      floatMap(box, e.clientX - dragging.dx, e.clientY - dragging.dy);
    };
    const end = (e) => {
      if (!dragging || dragging.box !== box) return;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const moved = dragging.moved;
      const tabCtx = dragging.tab;
      dragging = null;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      handle.style.cursor = 'grab';
      if (!moved && tabCtx) {
        // A tap on a tab: show that view (it holds until something new).
        obs.mapPick = tabCtx;
        obs.mapPickSet = null;
        try { mapUpdate(); } catch (err) { /* never in the way */ }
        return;
      }
      if (!moved) {
        // A tap: fold or unfold it (remembered).
        const folded = !box.classList.contains('mg-folded');
        box.classList.toggle('mg-folded', folded);
        obs.mapFold[box.id] = folded;
        send('mapFold', { id: box.id, folded });
        fitOverlays();
        return;
      }
      const r = box.getBoundingClientRect();
      obs.mapPos[box.id] = { x: r.left / window.innerWidth, y: r.top / window.innerHeight };
      send('mapPos', { id: box.id, x: obs.mapPos[box.id].x, y: obs.mapPos[box.id].y });
    };
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const r = box.getBoundingClientRect();
      // It only lifts out of the corner once it's really dragged (a tap
      // folds it instead).
      const tab = e.target && e.target.closest ? e.target.closest('.mg-tab') : null;
      dragging = { box, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false, r, tab: tab ? tab.dataset.ctx : null };
      handle.style.cursor = 'grabbing';
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    });
    handle.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      delete obs.mapPos[box.id];
      dockMap(box);
      send('mapPos', { id: box.id, x: null, y: null });
    });
  }
  obs.setMapPositions = function setMapPositions(p, folds) {
    obs.mapPos = p && typeof p === 'object' ? Object.assign({}, p) : {};
    if (folds && typeof folds === 'object') {
      obs.mapFold = Object.assign({}, folds);
      for (const [id, f] of Object.entries(obs.mapFold)) {
        const b = document.getElementById(id);
        if (b) b.classList.toggle('mg-folded', Boolean(f));
      }
    }
    for (const id of ['mg-map']) {
      const b = document.getElementById(id);
      if (b) placeMap(b, true);
    }
    // The trough timer's place too (v0.63.8).
    try { placeTroughChip(); } catch (err) { /* never in the way */ }
  };
  window.addEventListener('resize', () => {
    fitOverlays();
    for (const id of ['mg-map']) {
      const b = document.getElementById(id);
      if (b && b.style.position === 'fixed') placeMap(b, true);
    }
  });
  obs.setBinderMap = function setBinderMap(p) {
    const x = p && typeof p === 'object' ? p : {};
    obs.binderOn = x.on !== false;
    const e = x.event;
    obs.binderEvent = e && (e.kind === 'amber' || e.kind === 'dawn') ? { kind: e.kind, endsAt: Number(e.endsAt) || null } : null;
    try {
      mapUpdate();
    } catch (err) {
      /* never in the way */
    }
  };
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

  /* The hatch countdown and egg locks (v0.69.0). The app sends the
   * guarantees within 5 hatches and the eggs you've locked; a small box in
   * the corner counts them down while any is close. A hatch of a locked egg
   * is stopped (watchOutgoing) and a card says so, with a button to the
   * locks on the Luck tab. */
  obs.eggLock = [];
  const eggNorm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function eggAtSlot(slot) {
    const sl = mySlot();
    const tiles = (sl && sl.data && sl.data.garden && sl.data.garden.tileObjects) || {};
    const t = tiles[slot] || tiles[String(slot)];
    return t && t.eggId ? String(t.eggId) : null;
  }
  function eggLocked(egg) {
    return (obs.eggLock || []).some((x) => eggNorm(x) === eggNorm(egg));
  }
  const prettyEgg = (x) => String(x || 'egg').replace(/([a-z])([A-Z])/g, '$1 $2');
  let eggCardTimer = null;
  function showEggLocked(egg) {
    if (!document.body) return;
    ensureGlass();
    const old = document.getElementById('mg-egg-lock');
    if (old) old.remove();
    clearTimeout(eggCardTimer);
    const box = document.createElement('div');
    box.id = 'mg-egg-lock';
    box.setAttribute('role', 'alertdialog');
    box.style.cssText = 'position:fixed;left:50%;top:max(200px,32%);transform:translateX(-50%);z-index:2147483647;background:rgba(30,30,33,.94);color:#f5f5f7;font:14px system-ui,sans-serif;padding:16px 20px;border-radius:20px;text-align:center;width:min(360px,calc(100vw - 32px));box-sizing:border-box;';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:16px;margin-bottom:4px;';
    title.textContent = egg ? `🔒 ${prettyEgg(egg)} is locked` : '🔒 Hatch stopped';
    const line = document.createElement('div');
    line.style.cssText = 'opacity:.8;margin-bottom:12px;line-height:1.35;';
    line.textContent = egg ? 'You locked it so it isn\'t hatched by mistake. Unlock it on the Luck tab when you\'re ready.' : 'An egg is locked and the app couldn\'t tell which one this is yet. Try again in a moment.';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;';
    const button = (label, main, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:8px 16px;border-radius:11px;border:0;cursor:pointer;font:600 13.5px system-ui,sans-serif;' + (main ? 'background:#30d158;color:#06210f;' : 'background:rgba(118,118,128,.24);color:#f5f5f7;');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
        box.remove();
      });
      return b;
    };
    if (egg) row.appendChild(button('Go to egg locks', true, () => send('eggLockGo', { egg })));
    row.appendChild(button('OK', !egg, () => {}));
    box.appendChild(title);
    box.appendChild(line);
    box.appendChild(row);
    document.body.appendChild(box);
    eggCardTimer = setTimeout(() => box.remove(), 9000);
  }
  /* The hatch counter (v0.69.1): a warning at the top middle that pops up
   * when you hatch and a rare, Gold or Rainbow pet is 5 or fewer hatches
   * away. Up for 10 s after each hatch; otherwise off the screen. */
  let hatchBox = null;
  let hatchTimer = null;
  obs.hatchWatch = { rows: [], locks: [], shown: true };
  function noteHatching() {
    clearTimeout(hatchTimer);
    obs.hatchUntil = Date.now() + 10000;
    renderHatchPop();
    hatchTimer = setTimeout(renderHatchPop, 10100);
  }
  function renderHatchPop() {
    const W = obs.hatchWatch || {};
    const rows = W.rows || [];
    const show = W.shown !== false && rows.length > 0 && Date.now() < (obs.hatchUntil || 0);
    if (!show) {
      if (hatchBox) hatchBox.style.display = 'none';
      return;
    }
    ensureGlass();
    if (!hatchBox || !hatchBox.isConnected) {
      hatchBox = document.createElement('div');
      hatchBox.id = 'mg-hatch-box';
      hatchBox.setAttribute('role', 'status');
      hatchBox.style.cssText = 'position:fixed;left:50%;top:56px;transform:translateX(-50%);z-index:2147483646;pointer-events:none;width:min(320px,calc(100vw - 32px));box-sizing:border-box;background:rgba(30,30,33,.9);border-radius:16px;padding:10px 14px 11px;font:13.5px/1.45 system-ui,sans-serif;color:#f5f5f7;box-shadow:0 10px 30px rgba(0,0,0,.35);';
      (document.body || document.documentElement).appendChild(hatchBox);
    }
    while (hatchBox.firstChild) hatchBox.removeChild(hatchBox.firstChild);
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;opacity:.7;margin-bottom:3px;';
    head.textContent = '🥚 Rare hatch soon';
    hatchBox.appendChild(head);
    for (const r of rows.slice(0, 4)) {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;justify-content:space-between;gap:12px;white-space:nowrap;';
      const a = document.createElement('span');
      const icon = r.target === 'rainbow' ? '🌈' : r.target === 'gold' ? '🟡' : '🐾';
      a.textContent = `${icon} ${r.name} · ${r.eggName || 'any egg'}${r.locked ? ' 🔒' : ''}`;
      const b = document.createElement('b');
      b.style.cssText = `flex:none;font-variant-numeric:tabular-nums;color:${r.primed ? '#30d158' : '#ffd60a'};`;
      b.textContent = r.primed ? 'next one!' : `${r.left} to go`;
      line.appendChild(a);
      line.appendChild(b);
      hatchBox.appendChild(line);
    }
    hatchBox.style.display = '';
  }
  obs.setHatchWatch = function setHatchWatch(data) {
    const d = data && typeof data === 'object' ? data : {};
    obs.eggLock = Array.isArray(d.locks) ? d.locks.map(String) : [];
    obs.hatchWatch = { rows: Array.isArray(d.rows) ? d.rows : [], locks: obs.eggLock, shown: d.shown !== false };
    try { renderHatchPop(); } catch (err) { /* never in the way */ }
  };

  /* The money box: what the app worked out about your plan, as plain lines
   * (the app writes them; this only shows them). */
  let hudBox = null;
  obs.setBudgetHud = function setBudgetHud(data) {
    const shown = Boolean(data && data.shown && Array.isArray(data.lines) && data.lines.length);
    setTimeout(() => {
      try { fitOverlays(); } catch (err) { /* never in the way */ }
    }, 0);
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
    // A line can count down: "{t}" in its text is the time left until `at`,
    // ticking every second here (no need to hear from the app for that).
    const counters = [];
    for (const l of data.lines.slice(0, 6)) {
      const row = document.createElement('div');
      const text = String((l && l.text) || l || '').slice(0, 90);
      if (l && l.strong) row.style.fontWeight = '600';
      if (l && l.big) row.style.fontSize = '14px';
      if (l && l.faint) row.style.opacity = '.75';
      if (l && Number(l.at) > 0 && text.includes('{t}')) counters.push({ row, text, at: Number(l.at) });
      else row.textContent = text;
      hudBox.appendChild(row);
    }
    const fmt = (ms) => {
      const s = Math.max(0, Math.round(ms / 1000));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = String(s % 60).padStart(2, '0');
      return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    };
    const tick = () => {
      for (const c of counters) c.row.textContent = c.text.replace('{t}', fmt(c.at - Date.now()));
    };
    clearInterval(obs.hudTicker);
    obs.hudTicker = counters.length ? setInterval(tick, 1000) : null;
    tick();
    hudBox.style.display = '';
  };

  // What "ready" means: your harvest rule (v0.54.7), whether or not harvest
  // mode is on. Until the app sends it, ripe is ready.
  function readyRuleNow() {
    const m = obs.harvestLock && obs.harvestLock.mode;
    return {
      color: m && ['goldOrRainbow', 'rainbow'].includes(m.color) ? m.color : 'any',
      hydro: m && Array.isArray(m.hydro) ? m.hydro : [],
      lunar: m && Array.isArray(m.lunar) ? m.lunar : [],
      size: Boolean(m && m.size),
    };
  }
  // Kept so an older app doesn't fail calling it; the rule is the harvest rule.
  obs.setReadyRule = function setReadyRule() {
    try {
      report();
    } catch (err) {
      /* ignore */
    }
  };

  obs.setSpotMap = function setSpotMap(on) {
    obs.spotMapOn = on !== false;
    try {
      mapUpdate();
    } catch (err) {
      /* ignore */
    }
  };

  // Event themes (v0.67.0): the panel's theme on the glass too. Only our
  // own style element changes (custom properties the glass reads).
  obs.setTheme = function setTheme(theme) {
    try {
      const id = theme && theme.id ? String(theme.id) : '';
      let el = document.getElementById('mg-theme-style');
      if (!el) {
        if (!document.head) return;
        el = document.createElement('style');
        el.id = 'mg-theme-style';
        document.head.appendChild(el);
      }
      const T = {
        spooky: ':root{--mg-glass:rgba(30,20,44,.76);--mg-glass-deep:rgba(24,16,36,.88);--mg-tint:#ff9f0a;--mg-tint-ink:#2a1400;--mg-tint-glow:rgba(255,159,10,.32)}',
      };
      el.textContent = T[id] || '';
      obs.theme = id || null;
    } catch (err) {
      /* looks only */
    }
  };
  obs.setHarvestLock = function setHarvestLock(lock) {
    obs.harvestLock = {
      on: Boolean(lock && lock.on),
      species: Array.isArray(lock && lock.species) ? lock.species.map(String).slice(0, 100) : [],
      // "Never sell pet food": crops of the plants you carry in pots.
      petFood: Boolean(lock && lock.petFood),
      mode: lock && lock.mode && typeof lock.mode === 'object' ? {
        on: lock.mode.on === true,
        color: ['any', 'goldOrRainbow', 'rainbow'].includes(lock.mode.color) ? lock.mode.color : 'any',
        hydro: Array.isArray(lock.mode.hydro) ? lock.mode.hydro.map(String).slice(0, 5) : [],
        lunar: Array.isArray(lock.mode.lunar) ? lock.mode.lunar.map(String).slice(0, 4) : [],
        size: lock.mode.size === true,
      } : null,
    };
    if (lock && typeof lock.lockField === 'string' && LOCK_FIELDS.includes(lock.lockField)) obs.lockField = lock.lockField;
    lockBadge();
    try { mapUpdate(); } catch (err) { /* never in the way */ }
    // The rule is also what "ready" means: count again.
    setTimeout(() => {
      try { report(); } catch (err) { /* ignore */ }
    }, 0);
    return obs.harvestLock;
  };

  /* ---------------------------------------------------------------- *
   * "Rain is coming: step away?": a card with Step away (your press steps
   * out) and Ignore (stay in for this one). No answer: nothing happens
   * (v0.60.0); the card goes when the weather starts or ends. Screen only.
   * ---------------------------------------------------------------- */

  let stepTimer = null;
  obs.showStepOut = function showStepOut(info) {
    obs.hideStepOut();
    if (!document.body || !info) return;
    ensureGlass();
    const box = document.createElement('div');
    box.id = '__mgStepOut';
    box.style.cssText = 'position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:2147483647;background:rgba(42,27,54,.97);color:#f6f1f8;font:14px system-ui,sans-serif;padding:14px 18px;border-radius:14px;border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 40px rgba(0,0,0,.45);text-align:center;min-width:300px;';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:4px;';
    // v0.60.0: a question, not a countdown: only your press steps out.
    title.textContent = `${info.emoji || '🌦️'} ${info.label || 'Weather'} is coming: step away?`;
    const line = document.createElement('div');
    line.style.cssText = 'opacity:.85;margin-bottom:10px;';
    const row = document.createElement('div');
    const button = (label, act, main) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'margin:0 4px;padding:7px 16px;border-radius:9px;border:1px solid rgba(255,255,255,.2);cursor:pointer;font:600 13px system-ui,sans-serif;' +
        (main ? 'background:#47624c;color:#eafbec;' : 'background:transparent;color:#f6f1f8;');
      b.dataset.act = act;
      b.addEventListener('click', () => {
        send('stepOut', { act });
        obs.hideStepOut();
      });
      return b;
    };
    row.appendChild(button('Step away', 'confirm', true));
    row.appendChild(button('Stay in', 'ignore', false));
    box.appendChild(title);
    box.appendChild(line);
    box.appendChild(row);
    document.body.appendChild(box);
    const tick = () => {
      const left = Math.max(0, Math.round((info.until - Date.now()) / 1000));
      line.textContent = left > 0 ? `It starts in ${left >= 60 ? `${Math.round(left / 60)} min` : `${left}s`}. You set this weather to step away from.` : 'It\'s on now. You set this weather to step away from.';
    };
    tick();
    stepTimer = setInterval(tick, 500);
  };
  obs.hideStepOut = function hideStepOut() {
    clearInterval(stepTimer);
    stepTimer = null;
    const old = document.getElementById('__mgStepOut');
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
    if (r.ok && obs.teamGoingOut) {
      try { obs.teamGoingOut(team); } catch (err) { /* never in the way */ }
    }
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
      try {
        watchOtherOutgoing(this, data);
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

  /* Daily quests over the web (v0.64.2): if the game asks its server for
   * quests by address (not over the game connection), keep a read-only copy
   * of the last few answers for the sample. Nothing is changed or sent; any
   * trouble here and the game's request goes on as normal. */
  obs.questFetches = [];
  try {
    const realFetch = window.fetch;
    if (typeof realFetch === 'function' && !realFetch.__mgQuestWatch) {
      const watched = function fetch() {
        const p = Reflect.apply(realFetch, window, arguments);
        try {
          const req = arguments[0];
          const url = String((req && req.url) || req || '');
          if (/quest|journal/i.test(url)) {
            p.then((res) => res.clone().text()).then((text) => {
              obs.questFetches.push({ at: Date.now(), url: url.slice(0, 200), body: String(text).slice(0, 8000) });
              if (obs.questFetches.length > 6) obs.questFetches.shift();
            }).catch(() => {});
          }
        } catch (err) {
          /* never get in the game's way */
        }
        return p;
      };
      watched.__mgQuestWatch = true;
      window.fetch = watched;
    }
  } catch (err) {
    /* the game's own fetch stays */
  }

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

  // v0.66.0: the game's tables moved into a chunk past the first 25 files
  // (the Haunt update), so the reader looked and found nothing. Now it reads
  // every script file the page has (from the browser's cache, six at a time)
  // until it finds them, and tries again a minute and five minutes later if
  // the chunk loads late. While it's in there it keeps a few short excerpts
  // about the newest things (Ghost Plant, the Spooky Egg, night) for the
  // sample, so the app can learn their numbers.
  const CATALOG_KEYS = ['GhostPlant:{', 'Pumpkin:{', 'JackOLantern', 'SpookyBundle', 'GothicTopHat', 'CroakwardenLamp:{', 'HauntPolaroid:{', 'dayNightPhaseOverride', 'ghostCatches', 'spookyQuest'];
  let catalogTries = 0;
  async function readCatalog() {
    if (obs.catalog || !window.__MG_PARSE_GAME_CODE || catalogTries >= 3) return;
    catalogTries += 1;
    obs.catalogTried = true;
    const dbg = obs.catalogDebug;
    dbg.tried = true;
    dbg.tries = catalogTries;
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
      // Our own site's files first, then the likely names (the tables were in
      // keyboardTarget-*.js before the Haunt update).
      const rank = (u) => (u.startsWith(location.origin) ? 4 : 0) + (/keyboardTarget|catalog|data|dex|main|index|quinoa|app|game/i.test(u) ? 2 : 0);
      urls.sort((a, b) => rank(b) - rank(a));
      dbg.urlCount = urls.length;
      dbg.urls = urls.slice(0, 40).map((u) => u.replace(/\?.*$/, '').slice(-120));
      dbg.read = [];
      dbg.readCount = 0;
      const best = { pets: {}, abilities: {}, eggs: {} };
      const snippets = dbg.snippets || (dbg.snippets = {});
      const enough = () => Object.keys(best.pets).length >= 5 && Object.keys(best.abilities).length >= 10;
      const readOne = async (url) => {
        const entry = { url: url.replace(/\?.*$/, '').slice(-120) };
        try {
          const sameSite = url.startsWith(location.origin);
          const res = await fetch(url, sameSite ? { credentials: 'same-origin' } : { mode: 'cors', credentials: 'omit' });
          dbg.readCount += 1;
          entry.status = res.status;
          if (!res.ok) {
            dbg.read.push(entry);
            return;
          }
          const text = await res.text();
          entry.size = text.length;
          // The game loads some of its files only when they're needed: follow
          // the chunk names a file mentions ("./assets/name-Hash12.js").
          const re = /["'`]((?:\.{0,2}\/)?(?:[\w-]+\/)*[\w.-]+-[\w-]{6,}\.m?js)["'`]/g;
          let m;
          let added = 0;
          while ((m = re.exec(text)) && added < 60 && urls.length < 400) {
            const before = urls.length;
            addUrl(new URL(m[1], url).href);
            if (urls.length > before) added += 1;
          }
          entry.anchors = {
            hoursToMature: text.indexOf('hoursToMature') >= 0,
            baseProbability: text.indexOf('baseProbability') >= 0,
            faunaSpawnWeights: text.indexOf('faunaSpawnWeights') >= 0,
          };
          // Excerpts about the newest things, wherever they are.
          for (const k of CATALOG_KEYS) {
            if ((snippets[k] || []).length >= 2) continue;
            let at = text.indexOf(k);
            while (at >= 0 && (snippets[k] || []).length < 2) {
              (snippets[k] = snippets[k] || []).push({ file: entry.url.slice(-60), text: text.slice(Math.max(0, at - 160), at + 340) });
              at = text.indexOf(k, at + 400);
            }
          }
          if (!entry.anchors.hoursToMature && !entry.anchors.baseProbability) return;
          dbg.read.push(entry);
          const found = window.__MG_PARSE_GAME_CODE(text);
          entry.parsed = { pets: Object.keys(found.pets).length, abilities: Object.keys(found.abilities).length, eggs: Object.keys(found.eggs).length };
          Object.assign(best.pets, found.pets);
          Object.assign(best.abilities, found.abilities);
          Object.assign(best.eggs, found.eggs);
        } catch (err) {
          entry.error = String((err && err.message) || err).slice(0, 120);
          dbg.read.push(entry);
        }
      };
      // Six at a time, the list growing as files name others, up to 200.
      for (let i = 0; i < Math.min(urls.length, 200) && !enough(); ) {
        const batch = urls.slice(i, Math.min(i + 6, 200));
        i += batch.length;
        await Promise.all(batch.map(readOne));
      }
      dbg.urlCount = urls.length;
      dbg.found = { pets: Object.keys(best.pets).length, abilities: Object.keys(best.abilities).length, eggs: Object.keys(best.eggs).length };
      if (dbg.found.pets || dbg.found.abilities) {
        obs.catalog = best;
        send('catalog', best);
      } else if (catalogTries < 3) {
        setTimeout(readCatalog, catalogTries === 1 ? 60000 : 300000);
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
      perf: obs.perfView ? obs.perfView() : null,
      // The Pet Hutch window (v0.72.2): times seen open and closed, and the
      // game's dialogs on screen right now (class and first words), so a
      // sample with the hutch open shows what to look for.
      hutch: (() => {
        try {
          const dialogs = [...document.querySelectorAll(HUTCH_SEL)].filter((el) => !(el.closest && el.closest('[id^="mg-"], [id^="__mg"]')) && el.getBoundingClientRect().width > 60)
            .slice(0, 8).map((el) => ({ role: el.getAttribute('role'), cls: String(el.className || '').slice(0, 80), text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) }));
          return Object.assign({}, obs.hutch, { lineups: obs.lineups, dialogs });
        } catch (err) {
          return null;
        }
      })(),
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
      heldLog: obs.heldLog.slice(),
      mapView: obs.mapCtx,

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
      // (v0.61.1) Whether the game's pet entries say which abilities each
      // kind can roll, and one example (to make egg estimates exact).
      catalogAbilities: (() => { try { const pets = Object.entries((obs.catalog && obs.catalog.pets) || {}); const w = pets.filter(([, v]) => v && (v.abilityWeights || v.abilityList)); return { pets: pets.length, withAbilities: w.length, example: w.length ? { species: w[0][0], weights: w[0][1].abilityWeights, list: w[0][1].abilityList } : null }; } catch (err) { return null; } })(),
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
      // Daily quests (v0.64.2, added to the game 8 Oct 2026): anything that
      // looks like quests, the Garden Journal, rewards or streaks, wherever
      // the game keeps it, with enough detail to build the Quests tab from.
      quests: (() => {
        try {
          const found = {};
          let n = 0;
          const look = (obj, where, depth, max) => {
            if (!obj || typeof obj !== 'object' || depth > max || n > 40) return;
            for (const [k, v] of Object.entries(obj)) {
              if (/quest|journal|reward|streak|marlow/i.test(k)) {
                n += 1;
                let text = '';
                try { text = JSON.stringify(v); } catch (e) { text = String(v); }
                found[where + k] = { shape: shape(v, 6), json: text.length > 6000 ? text.slice(0, 6000) + '…' : text };
              } else if (v && typeof v === 'object' && !Array.isArray(v)) look(v, where + k + '.', depth + 1, max);
            }
          };
          look(slot, 'slot.', 0, 6);
          look(quinoaData(), 'game.', 0, 4);
          look(obs.state && obs.state.data, 'room.', 0, 3);
          return { found, messages: obs.questMessages || [], welcome: obs.questWelcome || null, fetches: obs.questFetches || [] };
        } catch (err) {
          return { error: String(err && err.message) };
        }
      })(),
      // The Haunt Event (v0.66.0): night, haunts and the forecast as the game
      // keeps them, so night times and haunts can be read from the game.
      haunt: (() => {
        try {
          const q = quinoaData() || {};
          const out = {};
          for (const [k, v] of Object.entries(q)) {
            if (/ghost|haunt|night|spooky|forecast|weather|dayNight|sun/i.test(k)) {
              let text = '';
              try { text = JSON.stringify(v); } catch (e) { text = String(v); }
              out[k] = { shape: shape(v, 5), json: text.length > 4000 ? text.slice(0, 4000) + '…' : text };
            }
          }
          return out;
        } catch (err) {
          return { error: String(err && err.message) };
        }
      })(),
      // Only the kind and number of each command, never its contents.
      recentOutgoing: obs.recentOutgoing.slice(-20),
      // The server's answers to recent commands (type, ok, code only).
      recentResults: (obs.recentResults || []).slice(-30),
      incomingShape: obs.incomingShape || null,
      // Where you are (v0.57.6): your part of the movement messages, the
      // position read from them, and the tile pairs learned.
      outgoingShape: obs.outgoingShape || null,
      movement: { sample: obs.movementSample, selfPos: obs.selfPos, meTile: obs.meTile, calib: obs.mapCalib.slice(-12), fit: (() => { try { return calibFit(); } catch (err) { return null; } })() },
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
          // What the app thinks is in your hand (v0.53.11: with the hotbar
          // index, the item itself, the favourites the hotbar may order by,
          // and whether the open-spot map is switched on).
          const it = heldItem();
          const sl = mySlot();
          const extra = { index: sl ? sl.notAuthoritative_selectedItemIndex : null, favorites: sl && sl.data && sl.data.inventory ? sl.data.inventory.favoritedItemIds : null, spotMapOn: obs.spotMapOn };
          return it && typeof it === 'object'
            ? Object.assign({ keys: Object.keys(it).slice(0, 20), itemType: it.itemType, species: it.species, potted: Array.isArray(it.slots), isPot: isPot(it), item: shape(it, 4) }, extra)
            : Object.assign({ item: it }, extra);
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
      tileShapes: (() => {
        try {
          const tiles = (slot && slot.data && slot.data.garden && slot.data.garden.tileObjects) || {};
          const out = {};
          for (const o of Object.values(tiles)) {
            if (!o || typeof o !== 'object') continue;
            const kind = String(o.objectType || 'unknown').slice(0, 20);
            if (out[kind]) continue;
            out[kind] = Object.assign(shape(o, 3), { __seenAs: tileKind(o) });
          }
          return out;
        } catch (err) {
          return 'error';
        }
      })(),
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
