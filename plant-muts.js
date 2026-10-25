'use strict';

/* Mutations plant by plant (v0.64.0), so plants can be left out of the
 * Garden tab's "Mutations over time". Pure functions, shared by main.js
 * (recording) and the tests; the panel has its own copy of plantStateAt.
 *
 * A row is one plant kind's counts, in the same order and meaning as a
 * reading's fields: [n, h, l, c, w, ch, f, th, d, a, g, r] = crops; with any
 * weather, any moon, Gold or Rainbow; wet, chilled, frozen, thunder (struck
 * + charged), dawn (lit + bound), amber (lit + bound), gold, rainbow.
 * Trailing zeros are dropped. A reading's `s` holds only the rows that
 * changed since the reading before it (0 = that kind is gone); `sf: 1` marks
 * a full set. A reading without `s` wasn't tracked plant by plant. */

const PLANT_HYDRO = ['wet', 'chilled', 'frozen', 'thunderstruck', 'thundercharged'];
const PLANT_LUNAR = ['dawnlit', 'amberlit', 'dawnbound', 'amberbound'];
function plantMutRows(plants) {
  if (!Array.isArray(plants)) return null;
  const rows = {};
  for (const p of plants) {
    const sp = String((p && p.sp) || '');
    if (!sp || !Array.isArray(p.s) || !p.s.length) continue;
    const r = rows[sp] || (rows[sp] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const c of p.s) {
      const seen = new Set(String((c && c[0]) || '').split(',').filter(Boolean));
      r[0] += 1;
      if (PLANT_HYDRO.some((k) => seen.has(k))) r[1] += 1;
      if (PLANT_LUNAR.some((k) => seen.has(k))) r[2] += 1;
      if (seen.has('gold') || seen.has('rainbow')) r[3] += 1;
      if (seen.has('wet')) r[4] += 1;
      if (seen.has('chilled')) r[5] += 1;
      if (seen.has('frozen')) r[6] += 1;
      r[7] += (seen.has('thunderstruck') ? 1 : 0) + (seen.has('thundercharged') ? 1 : 0);
      r[8] += (seen.has('dawnlit') ? 1 : 0) + (seen.has('dawnbound') ? 1 : 0);
      r[9] += (seen.has('amberlit') ? 1 : 0) + (seen.has('amberbound') ? 1 : 0);
      if (seen.has('gold')) r[10] += 1;
      if (seen.has('rainbow')) r[11] += 1;
    }
  }
  for (const k of Object.keys(rows)) rows[k] = trimRow(rows[k]);
  return rows;
}
function trimRow(r) {
  const out = r.slice();
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}
const rowEq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
// The full set of rows after readings [0, end), or null if not tracked then.
function plantStateAt(h, end) {
  let state = null;
  for (let i = 0; i < end; i += 1) {
    const p = h[i];
    if (!p || !p.s || typeof p.s !== 'object') {
      state = null;
      continue;
    }
    state = p.sf || !state ? {} : Object.assign({}, state);
    for (const [k, v] of Object.entries(p.s)) {
      if (Array.isArray(v)) state[k] = v;
      else delete state[k];
    }
  }
  return state;
}
function plantDelta(prev, cur) {
  if (!prev) return { s: Object.assign({}, cur), sf: 1 };
  const s = {};
  for (const [k, v] of Object.entries(cur)) if (!rowEq(prev[k], v)) s[k] = v;
  for (const k of Object.keys(prev)) if (!(k in cur)) s[k] = 0;
  return { s };
}

// Adds reading p (with this moment's rows, or null when not known) to
// history h: the latest reading in each `every` ms wins; at most `keep`
// readings; the first one kept always carries a full set. Returns true when
// a new reading was added (false when the current one was updated).
function pushReading(h, p, rows, every, keep) {
  const last = h[h.length - 1];
  const same = Boolean(last && Math.floor(last.t / every) === Math.floor(p.t / every));
  if (rows) {
    const d = plantDelta(plantStateAt(h, same ? h.length - 1 : h.length), rows);
    p.s = d.s;
    if (d.sf) p.sf = 1;
  }
  if (same) {
    delete last.s;
    delete last.sf;
    Object.assign(last, p);
    return false;
  }
  h.push(p);
  if (h.length > keep) {
    const cut = h.length - keep;
    const first = plantStateAt(h, cut + 1);
    h.splice(0, cut);
    if (first && h[0] && h[0].s) {
      h[0].s = first;
      h[0].sf = 1;
    }
  }
  return true;
}

module.exports = { plantMutRows, trimRow, rowEq, plantStateAt, plantDelta, pushReading, PLANT_HYDRO, PLANT_LUNAR };
