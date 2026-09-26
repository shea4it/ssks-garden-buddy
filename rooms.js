'use strict';

// Game rooms and their live player counts.
//
// Rooms hold 6 players. Each other player in your room adds 10% to what you
// get for selling crops, up to 50% (magicgarden.wiki/Multipliers).
//
// Player counts come from the game's own room endpoint,
// magicgarden.gg/api/rooms/<id>/info, which answers { numPlayers, ... }
// (the same call Arie's Mod and MGTools make). The app asks from inside the
// game page, so the request looks exactly like theirs.
//
// Which rooms? There is no live, public list of the official Discord's
// rooms. A Discord room's code is i-<activity instance>-gc-<server>-<channel>,
// and the instance part changes every time the room restarts, which only
// Discord knows. The community lists that other mods ship were last updated
// in October 2025, so every code in them is dead. So the app keeps your own
// list instead: rooms you've been in (added by the Save button) or typed in,
// with live counts for each.
//
// There is one live source of current rooms: rooms that players running
// Arie's Mod have chosen to make public. His server lists them at
// ariesmod-api.ariedam.fr/rooms (read with no account, the same way the
// "Favorite Rooms" userscript does). It isn't every room on the Discord, only
// the shared ones, and its counts can lag, so the app re-checks each one it
// shows with the game's own endpoint and drops any that are gone.
//
// Joining a room opens magicgarden.gg/r/<id> in the game view, the same as
// following a room link.

const CAPACITY = 6;
const COMMUNITY_URL = 'https://ariesmod-api.ariedam.fr/rooms?limit=200';
// Rooms nobody has reported on for this long are probably gone.
const COMMUNITY_MAX_AGE_MS = 20 * 60 * 1000;

// [{ id, is_private, players_count, last_updated_at, user_slots:[{name}] }]
// -> public rooms with someone in them, updated recently.
function parseCommunity(rows, now) {
  const t = now || Date.now();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.id && !r.is_private)
    .map((r) => ({
      id: String(r.id).slice(0, 120),
      reported: Math.max(0, Math.min(CAPACITY, Math.floor(Number(r.players_count) || 0))),
      updatedAt: Date.parse(r.last_updated_at) || null,
      names: (Array.isArray(r.user_slots) ? r.user_slots : []).map((u) => String((u && u.name) || '').slice(0, 30)).filter(Boolean).slice(0, 6),
    }))
    .filter((r) => r.reported > 0 && (!r.updatedAt || t - r.updatedAt < COMMUNITY_MAX_AGE_MS));
}

// The paths tried, in order. The first (the one verified in v0.11) stopped
// existing in Sep 2026 (the router answers 404 "Not found (router)" for
// every room); the others are where the game's newer "platform" API keeps
// things (the shop feed lives under /platform/v1/). The first path that
// answers for a room is kept for the rest of the session.
const INFO_PATHS = [
  (id) => `/api/rooms/${encodeURIComponent(id)}/info`,
  (id) => `/platform/v1/rooms/${encodeURIComponent(id)}/info`,
  (id) => `/platform/v1/rooms/${encodeURIComponent(id)}`,
];
// Only the original path ever meant "404 = this room is closed". The others
// are guesses: a 404 there means the path doesn't exist (proven: the second
// one answered 404 for a room the game said had 5 players), so it counts as
// gone, not as an empty room.
const GUESSED_FROM = 1;
let pathIndex = 0;
// Once every path has proven dead, nothing more is fetched this session.
let allDead = false;

function infoPath(id, which = pathIndex) {
  return INFO_PATHS[which](id);
}

// A 404 from the router itself (the endpoint is gone) is not "this room is
// closed": nothing is known then.
function endpointGone(status, body) {
  return status === 404 && /router/i.test(String(body || ''));
}

function joinUrl(id) {
  return `https://magicgarden.gg/r/${encodeURIComponent(id)}`;
}

// What joining would give you: the bonus is 10% per other player.
function bonusIfJoined(players) {
  if (players == null || players >= CAPACITY) return null;
  return Math.min(50, players * 10);
}

function bonusIn(players) {
  if (players == null) return null;
  return Math.min(50, Math.max(0, players - 1) * 10);
}

// A short readable name for a room id: web rooms have short codes (Q9BD),
// Discord rooms have long ones.
function describeId(id) {
  const s = String(id || '');
  const m = /^i-(\d+)-gc-(\d+)-(\d+)$/.exec(s);
  if (m) return { discord: true, label: `Discord room …${m[3].slice(-4)}` };
  return { discord: false, label: s };
}

// Turns whatever the endpoint answered into { players } or { error }.
function readInfo(status, body) {
  if (endpointGone(status, body)) return { players: null, error: 'the game no longer answers this lookup', gone: true };
  if (status === 404) return { players: 0, closed: true };
  if (status < 200 || status >= 300) return { players: null, error: `HTTP ${status}` };
  let data = body;
  if (typeof body === 'string') {
    try {
      data = JSON.parse(body);
    } catch (err) {
      return { players: null, error: 'not JSON' };
    }
  }
  const n = Number(data && (data.numPlayers ?? data.playerCount ?? (Array.isArray(data.players) ? data.players.length : NaN)));
  if (!Number.isFinite(n)) return { players: null, error: 'no player count in the answer' };
  return { players: Math.max(0, Math.min(CAPACITY, Math.floor(n))) };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// fetchInfo(path) -> { status, body }
function createRooms({ fetchInfo }) {
  const counts = {};
  let busy = null;

  async function count(id) {
    if (allDead) return { players: null, error: 'the game no longer answers this lookup', gone: true };
    try {
      let out = null;
      for (let tries = 0; tries < INFO_PATHS.length; tries += 1) {
        const which = (pathIndex + tries) % INFO_PATHS.length;
        const r = await fetchInfo(infoPath(id, which));
        out = readInfo(r.status, r.body);
        if (which >= GUESSED_FROM && r.status === 404) out = { players: null, error: 'the game no longer answers this lookup', gone: true };
        out.status = r.status;
        out.path = infoPath(id, which);
        // Keep what the endpoint said when it's odd (an error, or "closed"),
        // so a sample shows it.
        if (out.error || out.closed) out.sample = String(r.body || '').slice(0, 200);
        if (out.gone) continue; // this path is dead: try the next
        pathIndex = which;
        return out;
      }
      if (out && out.gone) allDead = true;
      return out;
    } catch (err) {
      return { players: null, error: String((err && err.message) || err).slice(0, 80) };
    }
  }

  // ids: the saved rooms plus the room you're in (for the lookup check).
  async function refresh(ids) {
    if (busy) return busy;
    busy = (async () => {
      const list = [...new Set((ids || []).filter(Boolean).map(String))];
      const found = await mapLimit(list, 4, count);
      list.forEach((id, i) => {
        counts[id] = Object.assign({ at: Date.now() }, found[i]);
      });
      return snapshot(list);
    })();
    try {
      return await busy;
    } finally {
      busy = null;
    }
  }

  function snapshot(ids) {
    return (ids || []).map((id) => {
      const c = counts[id] || {};
      return {
        id,
        players: c.players == null ? null : c.players,
        full: c.players != null && c.players >= CAPACITY,
        closed: Boolean(c.closed),
        error: c.error || null,
        sample: c.sample || null,
        status: c.status || null,
        path: c.path || null,
        at: c.at || null,
        bonusIfJoined: bonusIfJoined(c.players),
      };
    });
  }

  return { refresh, snapshot, lookupDead: () => allDead };
}

// How the shared list broke down, to show why it can look empty.
function communityStats(rows, now) {
  const t = now || Date.now();
  const list = Array.isArray(rows) ? rows : [];
  const pub = list.filter((r) => r && r.id && !r.is_private);
  const withPlayers = pub.filter((r) => Number(r.players_count) > 0);
  const recent = withPlayers.filter((r) => { const u = Date.parse(r.last_updated_at); return !u || t - u < COMMUNITY_MAX_AGE_MS; });
  return { total: list.length, isPrivate: list.length - pub.length, public: pub.length, withPlayers: withPlayers.length, recent: recent.length };
}

module.exports = { createRooms, parseCommunity, communityStats, COMMUNITY_URL, readInfo, bonusIfJoined, bonusIn, joinUrl, infoPath, describeId, CAPACITY };
