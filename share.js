'use strict';

// Sharing your room on the community list (Arie's mod API), opt-in.
//
// The list Garden Buddy already reads is fed by POST /collect-state. There
// is no room-only call: every report also sets the player's name and coins
// on that site (coins left out are stored as 0 and shown on a leaderboard),
// so the report carries the real name and coins, and the switch says so.
//
// What is sent: playerId (the game's own id), playerName, coins,
// modVersion, and room {id, isPrivate, playersCount}. Never the other
// players in the room (userSlots would create rows for people who didn't
// opt in), never the garden, inventory or stats (leaving `state` out keeps
// whatever is stored untouched).
//
// Cadence, as Arie's own mod does it: once when sharing starts, then a
// check every minute; send when something changed, and every fifth quiet
// check anyway (a room drops off the live list 6 minutes after the last
// report). Guest ids (p_…) are never sent: the server ignores them.

const API_URL = process.env.MG_SHARE_API || 'https://ariesmod-api.ariedam.fr/collect-state';
const CHECK_MS = 60 * 1000;
const HEARTBEAT_EVERY = 5;

function body({ playerId, playerName, coins, roomId, playersCount, isPrivate, version }) {
  if (!playerId || /^p_/i.test(String(playerId))) return null;
  const out = {
    playerId: String(playerId).slice(0, 80),
    modVersion: `garden-buddy ${String(version || '0')}`.slice(0, 64),
  };
  if (playerName) out.playerName = String(playerName).slice(0, 60);
  if (Number.isFinite(Number(coins))) out.coins = Math.max(0, Math.floor(Number(coins)));
  if (roomId) {
    out.room = { id: String(roomId).slice(0, 120), isPrivate: Boolean(isPrivate) };
    const n = Math.floor(Number(playersCount));
    if (Number.isFinite(n) && n >= 0 && n <= 6) out.room.playersCount = n;
  }
  return out;
}

// What matters for "did anything change": the room and who's in it.
function fingerprint(b) {
  if (!b) return '';
  return `${b.playerId}|${b.room ? `${b.room.id}|${b.room.playersCount}|${b.room.isPrivate}` : '-'}`;
}

function createSharer({ getSnapshot, fetchImpl, onEvent, version }) {
  const state = {
    on: false,
    timer: null,
    quiet: 0,
    lastSent: null,
    lastAt: null,
    lastBody: null,
    lastStatus: null,
    lastError: null,
    sent: 0,
    stoppedBy: null,
    backoffUntil: 0,
  };
  const emit = (e) => {
    if (onEvent) onEvent(Object.assign({ at: Date.now() }, e));
  };

  async function post(b) {
    const doFetch = fetchImpl || fetch;
    const res = await doFetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, ok: res.ok, text: res.ok ? '' : String(await res.text().catch(() => '')).slice(0, 200) };
  }

  // One check: build the report, decide, send.
  async function tick(reason) {
    if (!state.on) return { skipped: 'off' };
    if (Date.now() < state.backoffUntil) return { skipped: 'backoff' };
    const snap = getSnapshot() || {};
    const b = body(Object.assign({ version }, snap));
    if (!b) {
      // Not signed in (or a guest): nothing to report, and nothing stored to close.
      return { skipped: 'no player' };
    }
    const changed = fingerprint(b) !== fingerprint(state.lastSent);
    state.quiet = changed ? 0 : state.quiet + 1;
    const heartbeat = !changed && state.quiet >= HEARTBEAT_EVERY;
    if (!changed && !heartbeat && reason !== 'start') return { skipped: 'unchanged' };
    try {
      const r = await post(b);
      state.lastStatus = r.status;
      state.lastAt = Date.now();
      if (r.ok) {
        state.lastSent = b;
        state.lastBody = b;
        state.lastError = null;
        state.quiet = 0;
        state.sent += 1;
        emit({ kind: 'sent', room: b.room ? b.room.id : null, players: b.room ? b.room.playersCount : null });
        return { sent: true };
      }
      state.lastError = `HTTP ${r.status}${r.text ? ': ' + r.text : ''}`;
      if (r.status === 429) {
        state.backoffUntil = Date.now() + 60000;
        emit({ kind: 'slow', error: state.lastError });
        return { skipped: 'rate limited' };
      }
      if (r.status === 403 || r.status === 401) {
        // The list refuses this player (an account with its own key owns the row).
        stop('refused');
        emit({ kind: 'stopped', error: state.lastError });
        return { stopped: true };
      }
      emit({ kind: 'error', error: state.lastError });
      return { error: state.lastError };
    } catch (err) {
      state.lastError = String((err && err.message) || err).slice(0, 120);
      state.lastAt = Date.now();
      emit({ kind: 'error', error: state.lastError });
      return { error: state.lastError };
    }
  }

  function loop() {
    clearTimeout(state.timer);
    if (!state.on) return;
    state.timer = setTimeout(async () => {
      await tick('check');
      loop();
    }, CHECK_MS);
    if (state.timer.unref) state.timer.unref();
  }

  async function start() {
    if (state.on) return;
    state.on = true;
    state.stoppedBy = null;
    state.quiet = 0;
    state.lastSent = null;
    await tick('start');
    loop();
  }

  // Stops sharing. If a room was reported, one last report without a room
  // closes it on the list (otherwise it lingers for 6 minutes).
  async function stop(why) {
    const wasOn = state.on;
    state.on = false;
    clearTimeout(state.timer);
    state.timer = null;
    state.stoppedBy = why || 'off';
    if (wasOn && why !== 'refused' && state.lastSent && state.lastSent.room) {
      try {
        const bye = Object.assign({}, state.lastSent);
        delete bye.room;
        await post(bye);
      } catch (err) {
        /* best effort */
      }
    }
    state.lastSent = null;
  }

  // A room change shouldn't wait for the minute: the caller nudges.
  async function nudge() {
    if (!state.on) return;
    const snap = getSnapshot() || {};
    const b = body(Object.assign({ version }, snap));
    if (b && fingerprint(b) !== fingerprint(state.lastSent)) await tick('change');
  }

  function status() {
    return {
      on: state.on,
      lastAt: state.lastAt,
      lastStatus: state.lastStatus,
      lastError: state.lastError,
      sent: state.sent,
      stoppedBy: state.stoppedBy,
      room: state.lastSent && state.lastSent.room ? state.lastSent.room.id : null,
    };
  }

  return { start, stop, nudge, tick, status, _state: state };
}

module.exports = { API_URL, body, fingerprint, createSharer, CHECK_MS, HEARTBEAT_EVERY };
