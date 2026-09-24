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

function infoPath(id) {
  return `/api/rooms/${encodeURIComponent(id)}/info`;
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
    try {
      const r = await fetchInfo(infoPath(id));
      const out = readInfo(r.status, r.body);
      if (out.error) out.sample = String(r.body || '').slice(0, 200);
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
        at: c.at || null,
        bonusIfJoined: bonusIfJoined(c.players),
      };
    });
  }

  return { refresh, snapshot };
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
