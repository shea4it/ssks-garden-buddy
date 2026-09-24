'use strict';

// The egg (pity) tracker. Plain Node, no Electron, so it can be tested on its
// own. The main process owns this state; the panel asks for changes through
// act() and gets the new state back.
//
// A counter counts hatches since its last "hit":
//   gold / rainbow   hit when the pet hatches Gold / Rainbow
//   species          hit when that species hatches (e.g. Capybara)
//   manual           only you say when it hit (the old way)
// A counter can be tied to one egg (only hatches of that egg count toward
// it), or count every egg.
//
// Hatches arrive automatically from the game's activity log. When the app
// starts, it also catches up on hatches it missed while it was closed: the
// ones still in the game's log are counted in full, and any the log no longer
// holds (the game's own hatch counter says how many) are counted as ordinary
// hatches.

const petData = require('./pet-data');

const DEFAULT_COUNTERS = [
  { id: 'gold', name: 'Gold', kind: 'gold', egg: '', species: '', value: 0 },
  { id: 'rainbow', name: 'Rainbow', kind: 'rainbow', egg: '', species: '', value: 0 },
];

const KINDS = new Set(['gold', 'rainbow', 'species', 'manual']);

// Brings older saved data (plain counters, no kinds) up to date.
function migrate(p) {
  const pity = p && typeof p === 'object' ? p : {};
  if (!Array.isArray(pity.counters) || !pity.counters.length) pity.counters = JSON.parse(JSON.stringify(DEFAULT_COUNTERS));
  for (const c of pity.counters) {
    if (!KINDS.has(c.kind)) c.kind = c.id === 'gold' ? 'gold' : c.id === 'rainbow' ? 'rainbow' : 'manual';
    c.egg = c.egg || '';
    c.species = c.species || '';
    c.value = Math.max(0, Math.floor(Number(c.value) || 0));
    c.name = String(c.name || 'Counter').slice(0, 40);
  }
  pity.totalHatches = Math.max(0, Math.floor(Number(pity.totalHatches) || 0));
  pity.history = Array.isArray(pity.history) ? pity.history.slice(-200) : [];
  pity.recent = Array.isArray(pity.recent) ? pity.recent.slice(-60) : [];
  pity.byEgg = pity.byEgg && typeof pity.byEgg === 'object' ? pity.byEgg : {};
  pity.seenIds = Array.isArray(pity.seenIds) ? pity.seenIds.slice(-400) : [];
  if (pity.version !== 2) {
    // From v0.11 the tracker counts by itself unless you switch that off.
    pity.autoCount = true;
    pity.version = 2;
  }
  if (pity.lastHatchAt === undefined) pity.lastHatchAt = null;
  if (pity.lastEggsHatched === undefined) pity.lastEggsHatched = null;
  return pity;
}

function isHit(c, h) {
  if (!h || h.unknown) return false;
  const muts = (h.mutations || []).map((m) => String(m).toLowerCase());
  if (c.kind === 'gold') return muts.includes('gold');
  if (c.kind === 'rainbow') return muts.includes('rainbow');
  if (c.kind === 'species') return Boolean(c.species) && petData.norm(c.species) === petData.norm(h.species);
  return false;
}

function applies(c, h) {
  if (!c.egg) return true;
  return !h.unknown && c.egg === h.eggId;
}

// Counts one hatch. h = { at, eggId, species, mutations, targetScale, petId }
// or { unknown: true } for one the log didn't keep. Returns the counters that
// hit, for the celebration.
function countHatch(pity, h, source) {
  const hits = [];
  pity.totalHatches += 1;
  if (!h.unknown) {
    const egg = pity.byEgg[h.eggId] || (pity.byEgg[h.eggId] = { hatched: 0, gold: 0, rainbow: 0, species: {} });
    egg.hatched += 1;
    const muts = (h.mutations || []).map((m) => String(m).toLowerCase());
    if (muts.includes('gold')) egg.gold += 1;
    if (muts.includes('rainbow')) egg.rainbow += 1;
    egg.species[h.species] = (egg.species[h.species] || 0) + 1;
    const st = petData.strength({ species: h.species, targetScale: h.targetScale, xp: 0 }, []);
    pity.recent.push({
      at: h.at || Date.now(),
      eggId: h.eggId,
      species: h.species,
      mutations: h.mutations || [],
      max: st ? st.max : null,
      source: source || 'auto',
    });
    if (pity.recent.length > 60) pity.recent.splice(0, pity.recent.length - 60);
    if (h.petId) {
      pity.seenIds.push(h.petId);
      if (pity.seenIds.length > 400) pity.seenIds.splice(0, pity.seenIds.length - 400);
    }
  }
  for (const c of pity.counters) {
    if (!applies(c, h)) continue;
    if (isHit(c, h)) {
      pity.history.push({
        name: c.name, counterId: c.id, hatches: c.value + 1, at: h.at || Date.now(),
        species: h.species || null, egg: h.eggId || null, auto: source !== 'manual',
      });
      c.value = 0;
      hits.push({ counter: c.name, kind: c.kind, species: h.species, egg: h.eggId });
    } else {
      c.value += 1;
    }
  }
  if (pity.history.length > 200) pity.history.splice(0, pity.history.length - 200);
  return hits;
}

// A hatch as it happens.
function onHatch(pity, h) {
  if (h.petId && pity.seenIds.includes(h.petId)) return { counted: false, hits: [] };
  // The game's own total is NOT taken from here: it can arrive a moment after
  // the hatch itself, and an out-of-date total made the next catch-up count a
  // phantom hatch. syncTotal() keeps it instead, from regular status updates;
  // this tallies live hatches the kept total doesn't include yet.
  pity.pendingLive = (pity.pendingLive || 0) + 1;
  pity.lastHatchAt = Math.max(pity.lastHatchAt || 0, h.at || Date.now());
  if (!pity.autoCount) {
    if (h.petId) pity.seenIds.push(h.petId);
    return { counted: false, hits: [] };
  }
  return { counted: true, hits: countHatch(pity, h, 'auto') };
}

// Right after the game connects: the hatches still in the log, and the
// game's own running total.
function onBacklog(pity, hatches, eggsHatched, oldestLogAt) {
  const list = (hatches || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
  const newest = list.reduce((m, h) => Math.max(m, h.at || 0), 0);
  const result = { counted: 0, unknown: 0, hits: [] };

  // First time: this is where counting starts. Nothing before it counts.
  if (pity.lastHatchAt == null || pity.lastEggsHatched == null || !pity.autoCount) {
    pity.lastHatchAt = Math.max(pity.lastHatchAt || 0, newest, Date.now() - 1000);
    pity.pendingLive = 0;
    if (eggsHatched != null) {
      pity.lastEggsHatched = Number(eggsHatched);
      pity.gameBase = pity.lastEggsHatched;
      pity.trackedBase = pity.totalHatches;
    }
    for (const h of list) if (h.petId && !pity.seenIds.includes(h.petId)) pity.seenIds.push(h.petId);
    return result;
  }

  const fresh = list.filter((h) => (h.at || 0) > pity.lastHatchAt && !(h.petId && pity.seenIds.includes(h.petId)));
  result.fresh = fresh;
  for (const h of fresh) {
    result.hits.push(...countHatch(pity, h, 'catch-up'));
    result.counted += 1;
  }
  // If the game's log reaches back past the last hatch we counted, the log
  // holds every hatch since, so nothing can be missing. Only when the log
  // starts later than that (a long time away) can hatches have dropped off
  // it, and the game's own total fills that gap.
  const logCoversGap = oldestLogAt != null && Number(oldestLogAt) <= pity.lastHatchAt;
  if (!logCoversGap && eggsHatched != null && pity.lastEggsHatched != null) {
    // The total as it really was when we left: the last one kept, plus
    // live hatches it hadn't caught up with yet.
    const missing = eggsHatched - (pity.lastEggsHatched + (pity.pendingLive || 0)) - fresh.length;
    // A sanity cap, in case the game ever resets its counter.
    if (missing > 0 && missing < 2000) {
      for (let i = 0; i < missing; i += 1) countHatch(pity, { unknown: true }, 'catch-up');
      result.unknown = missing;
    }
  }
  pity.pendingLive = 0;
  if (eggsHatched != null) {
    pity.lastEggsHatched = Math.max(pity.lastEggsHatched || 0, Number(eggsHatched) || 0);
    syncTotal(pity, eggsHatched);
  }
  pity.lastHatchAt = Math.max(pity.lastHatchAt, newest);
  return result;
}

function newId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// While connected, every hatch is counted as it happens, so the game's own
// running total can simply be followed. Only after this connection's catch-up
// (onBacklog) has run, so it can't jump ahead of it.
function syncTotal(pity, eggsHatched) {
  const n = Number(eggsHatched);
  if (!Number.isFinite(n) || pity.lastEggsHatched == null) return;
  // The game's total only goes up; an update that lags behind is ignored.
  // Whatever it adds covers live hatches we'd already counted.
  if (n > pity.lastEggsHatched) {
    pity.pendingLive = Math.max(0, (pity.pendingLive || 0) - (n - pity.lastEggsHatched));
    pity.lastEggsHatched = n;
  }
  // "Hatches tracked" follows the game's own count exactly: the number when
  // tracking started (or when you last typed one in), plus every egg the game
  // has counted since. It can't drift the way adding up one by one can.
  if (pity.gameBase == null) {
    pity.gameBase = pity.lastEggsHatched;
    pity.trackedBase = pity.totalHatches;
  }
  pity.totalHatches = pity.trackedBase + (pity.lastEggsHatched - pity.gameBase);
}

// Changes made from the panel. Returns a short message for a toast, or null.
function act(pity, a) {
  const find = (id) => pity.counters.find((c) => c.id === id);
  switch (a && a.type) {
    case 'hatch':
      countHatch(pity, { unknown: true }, 'manual');
      if (pity.trackedBase != null) pity.trackedBase += 1;
      return 'Added one hatch.';
    case 'got': {
      const c = find(a.id);
      if (!c) return null;
      for (const other of pity.counters) if (other.id !== c.id && !other.egg) other.value += 1;
      pity.totalHatches += 1;
      pity.history.push({ name: c.name, counterId: c.id, hatches: c.value + 1, at: Date.now(), auto: false });
      c.value = 0;
      return `${c.name} logged. Counter reset.`;
    }
    case 'setValue': {
      const c = find(a.id);
      if (c) c.value = Math.max(0, Math.floor(Number(a.value) || 0));
      return null;
    }
    case 'setTotal':
      pity.totalHatches = Math.max(0, Math.floor(Number(a.value) || 0));
      // Counting on from the number you typed.
      if (pity.lastEggsHatched != null) {
        pity.gameBase = pity.lastEggsHatched;
        pity.trackedBase = pity.totalHatches;
      }
      return null;
    case 'edit': {
      const c = find(a.id);
      if (!c) return null;
      if (a.name != null) c.name = String(a.name).trim().slice(0, 40) || c.name;
      if (a.kind && KINDS.has(a.kind)) c.kind = a.kind;
      if (a.species != null) c.species = String(a.species);
      if (a.egg != null) c.egg = String(a.egg);
      return null;
    }
    case 'add': {
      const kind = KINDS.has(a.kind) ? a.kind : 'manual';
      const name = String(a.name || (kind === 'species' ? petData.prettySpecies(a.species) : 'New counter')).slice(0, 40);
      pity.counters.push({ id: newId(), name, kind, species: String(a.species || ''), egg: String(a.egg || ''), value: 0 });
      return `Added ${name}.`;
    }
    case 'remove':
      pity.counters = pity.counters.filter((c) => c.id !== a.id);
      return 'Counter removed.';
    case 'setAuto':
      pity.autoCount = Boolean(a.on);
      if (pity.autoCount) {
        // Start fresh from now, so turning it on doesn't count old hatches
        // (including catching up on ones from while it was off).
        pity.lastHatchAt = Date.now();
        pity.lastEggsHatched = null;
        pity.gameBase = null;
      }
      return pity.autoCount ? 'Counting hatches automatically.' : 'Automatic counting is off.';
    case 'headStart': {
      // The update started every existing account halfway to each guarantee.
      let n = 0;
      const st = stats(pity);
      for (const c of pity.counters) {
        const g = st[c.id] && st[c.id].guaranteeAt;
        if (!g) continue;
        c.value = Math.round(g / 2) + Math.max(0, Math.floor(Number(a.since) || 0));
        n += 1;
      }
      return n ? `Set ${n} counter${n === 1 ? '' : 's'} to halfway, like the update did.` : 'No counters with a guarantee to set.';
    }
    case 'clearHistory':
      pity.history = [];
      pity.recent = [];
      return 'History cleared.';
    default:
      return null;
  }
}

// The guarantee for a counter. Gold and Rainbow are the devs' own numbers
// (199 and 1999 misses); species come from 2x the expected hatches.
// Manual counters have none.
function guaranteeFor(c, chance) {
  if (c.kind === 'gold') return { at: 200, approx: false };
  if (c.kind === 'rainbow') return { at: 2000, approx: false };
  if (c.kind === 'species' && chance) return petData.guarantee(chance);
  return null;
}

// Averages and odds for the panel.
function stats(pity) {
  const out = {};
  for (const c of pity.counters) {
    const runs = pity.history.filter((h) => (h.counterId ? h.counterId === c.id : h.name === c.name)).map((h) => Number(h.hatches) || 0);
    let chance = null;
    if (c.kind === 'gold') chance = petData.GOLD_CHANCE;
    else if (c.kind === 'rainbow') chance = petData.RAINBOW_CHANCE;
    else if (c.kind === 'species') {
      // Its egg's odds; if the counter covers any egg, the egg(s) it comes
      // from (they all share the same 65/30/5 split).
      const eggs = c.egg ? [petData.eggInfo(c.egg)] : petData.allEggs();
      for (const info of eggs) {
        const key = Object.keys(info.odds || {}).find((sp) => petData.norm(sp) === petData.norm(c.species));
        if (key) {
          chance = info.odds[key];
          break;
        }
      }
    }
    // Chance of having had at least one hit by now, at the base odds.
    const bad = chance ? 1 - Math.pow(1 - chance / 100, c.value) : null;
    // Bad Luck Protection: the hit is guaranteed on hatch number g.at, so
    // after c.value misses it's at most (g.at - c.value) hatches away.
    const g = guaranteeFor(c, chance);
    out[c.id] = {
      guaranteeAt: g ? g.at : null,
      guaranteeApprox: g ? g.approx : false,
      untilGuaranteed: g ? Math.max(1, g.at - c.value) : null,
      runs: runs.length,
      average: runs.length ? Math.round(runs.reduce((a, b) => a + b, 0) / runs.length) : null,
      best: runs.length ? Math.min(...runs) : null,
      chance,
      expected: chance ? Math.round(100 / chance) : null,
      unluckyPct: bad != null ? Math.round(bad * 100) : null,
    };
  }
  return out;
}

// Counters now one hatch from their guarantee, for a heads-up.
function guaranteedNext(pity) {
  const st = stats(pity);
  return pity.counters.filter((c) => st[c.id] && st[c.id].untilGuaranteed === 1 && !st[c.id].guaranteeApprox);
}

module.exports = { migrate, onHatch, onBacklog, syncTotal, countHatch, act, stats, guaranteedNext, DEFAULT_COUNTERS };
