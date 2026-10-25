'use strict';

/* Egg hatches into the two trackers (v0.56.11; moved out of main.js so the
 * tests run the very code the app runs).
 *
 * pity.js keeps \"hatches tracked\" and the Gold / Rainbow / species counters;
 * luck.js keeps the Luck tab's counters (each egg's rare pets, and the shared
 * Gold / Rainbow pet counters). Both hear about a hatch exactly once:
 *   live()     a hatch as it happens (the game's activity log gained a
 *              hatchEgg entry); the same pet twice is counted once.
 *   backlog()  right after the game connects: the hatches still in its log
 *              (any the app missed while closed are caught up on, on their
 *              egg) and the game's own total (hatches that have dropped off
 *              the log are counted, but which egg they were is unknown).
 * The main process does the rest (notes, celebrations, saving). */

const pity = require('./pity');
const luck = require('./luck');

function live(p, l, h) {
  const seen = Boolean(h && h.petId && p.seenIds.includes(h.petId));
  pity.onHatch(p, h);
  const events = !seen && p.autoCount ? luck.onEgg(l, h) : [];
  return { seen, counted: !seen && Boolean(p.autoCount), events };
}

function backlog(p, l, payload) {
  const x = payload || {};
  const r = pity.onBacklog(p, x.hatches, x.eggsHatched, x.oldestLogAt);
  p.syncConnection = x.connection;
  const events = [];
  if (p.autoCount) {
    for (const h of r.fresh || []) events.push(...luck.onEgg(l, h));
    if (r.unknown) luck.onUnknownHatches(l, r.unknown);
  }
  return Object.assign({ events }, r);
}

module.exports = { live, backlog };
