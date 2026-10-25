'use strict';

/* Game events and their themes (v0.67.0).
 *
 * Night: from the game's own code (17 Oct 2026 sample). The game counts a
 * 10-hour day from 1 Jan 1970 UTC: day 570 minutes, sunset 10, midnight 10,
 * sunrise 10. Night is sunset to the end of sunrise (30 minutes) and starts
 * 9 h 40 min into each 10 hours, so it can be worked out from the clock.
 * Darkness ramps up through sunset, is full at midnight and fades through
 * sunrise; nocturnal pets get +20 STR x darkness (the devs' "stronger the
 * darker it gets, up to +20 STR").
 *
 * Events: each has the dates the devs gave and the signs the game shows
 * while it runs (the Haunt Event: the Spooky Shop opening at night, a Haunt
 * Quest for today). The panel takes on an event's theme while it runs:
 * between its dates, or whenever the game has shown its signs in the last
 * day, so next year's Haunt Event gets its theme even before the app knows
 * its dates. Dawn and Amber Moon can be added the same way.
 */

const NIGHT_EVERY_MS = 10 * 3600000;
const NIGHT_LONG_MS = 30 * 60000;
const SUNSET_AT_MS = 580 * 60000;
const NIGHT_STR = 20;

function nightClock(now) {
  const into = ((now % NIGHT_EVERY_MS) + NIGHT_EVERY_MS) % NIGHT_EVERY_MS;
  let start = now - into + SUNSET_AT_MS;
  if (into < 10 * 60000) start -= NIGHT_EVERY_MS;
  const on = now >= start && now < start + NIGHT_LONG_MS;
  const next = on || now >= start ? start + NIGHT_EVERY_MS : start;
  let darkness = 0;
  let phase = 'day';
  if (on) {
    const m = (now - start) / 60000;
    phase = m < 10 ? 'sunset' : m < 20 ? 'midnight' : 'sunrise';
    darkness = m < 10 ? m / 10 : m < 20 ? 1 : Math.max(0, (30 - m) / 10);
  }
  return { on, start, next, phase, darkness };
}

// { on, since, endsAt, next, known, phase, darkness, bonus }. shopSince:
// when the Spooky Shop was seen opening, if it's open now (a fallback in
// case the game ever moves night).
function nightInfo(now = Date.now(), shopSince = null) {
  const c = nightClock(now);
  const bonus = Math.round(NIGHT_STR * c.darkness);
  if (c.on) return { on: true, since: c.start, endsAt: c.start + NIGHT_LONG_MS, next: c.next, known: true, phase: c.phase, darkness: c.darkness, bonus };
  if (shopSince && now - shopSince < NIGHT_LONG_MS + 5 * 60000) {
    return { on: true, since: shopSince, endsAt: shopSince + NIGHT_LONG_MS, next: c.next, known: true, phase: 'midnight', darkness: 1, bonus: NIGHT_STR, fromShop: true };
  }
  return { on: false, known: true, next: c.next, endsAt: c.next + NIGHT_LONG_MS, phase: 'day', darkness: 0, bonus: 0 };
}

const EVENTS = [
  {
    id: 'haunt',
    name: 'Haunt Event',
    theme: 'spooky',
    emoji: '🎃',
    // The devs' notes: began mid-October, "ends on Monday, November 9, 2026
    // 7:00 PM" (Eastern).
    starts: Date.parse('2026-10-14T00:00:00Z'),
    ends: Date.parse('2026-11-10T00:00:00Z'),
    // Seen in the game this recently still counts as running.
    signalHours: 26,
  },
];

const THEMES = ['spooky'];

// The event running now, or null. signals: { [eventId]: last time the game
// showed it }.
function current(now = Date.now(), signals = {}) {
  for (const e of EVENTS) {
    const inDates = now >= e.starts && now < e.ends;
    const seenAt = Number(signals && signals[e.id]) || 0;
    const seen = seenAt > 0 && now - seenAt < e.signalHours * 3600000 && seenAt <= now + 60000;
    if (inDates || seen) {
      return { id: e.id, name: e.name, theme: e.theme, emoji: e.emoji, ends: inDates ? e.ends : null, source: inDates ? 'dates' : 'game' };
    }
  }
  return null;
}

// What the panel wears: { id, event, night } or null. on: the owner's
// "Event themes" switch (on unless turned off).
function theme(now = Date.now(), signals = {}, on = true, night = null) {
  if (on === false) return null;
  const e = current(now, signals);
  if (!e || !THEMES.includes(e.theme)) return null;
  const n = night || nightInfo(now);
  return { id: e.theme, event: e.name, emoji: e.emoji, ends: e.ends, night: Boolean(n && n.on), darkness: n ? n.darkness || 0 : 0 };
}

module.exports = { NIGHT_EVERY_MS, NIGHT_LONG_MS, SUNSET_AT_MS, NIGHT_STR, EVENTS, THEMES, nightClock, nightInfo, current, theme };
