'use strict';

/* Your stage in the game (v0.56.0, beta): Early, Mid or Late, worked out
 * from milestones in your own game, and always explained. You can pick one
 * yourself; Auto stays worked out underneath, so the app can say when the
 * game has moved on.
 *
 * Milestones say more than money alone (money thresholds drift as the
 * game's economy changes), and a stage needs several of them, so one unusual
 * number doesn't misplace you:
 *   Mid:  any 2 of  net worth 1B · a celestial planted · 10% of crops Gold
 *                   or Rainbow · a Gold or Rainbow Granter pet
 *   Late: Mid, and any 3 of  net worth 100B · 3 celestials planted · a
 *                   Moonbinder or Dawnbinder planted · half your crops Gold
 *                   or Rainbow · sell pets worth +15%
 * The thresholds are a first draft, to tune against real gardens.
 */

const STAGES = [
  { id: 'early', label: 'Early', emoji: '🌱', title: 'Climbing', advice: 'Coins per hour is your number: sell often and buy the dearest seeds you can.' },
  { id: 'mid', label: 'Mid', emoji: '🌿', title: 'Building', advice: 'Save for celestials and get Gold and Rainbow going with granter pets.' },
  { id: 'late', label: 'Late', emoji: '🌳', title: 'Maxing', advice: 'Stack mutations, bind with your binders, and sell with your best sell pets out.' },
];

const CELESTIAL = /celestial|starweaver/i;
const BINDER = /^(dawn|moon)celestial$|binder/i;

// What the stage is worked out from, out of the garden report.
function signalsFrom(st) {
  const s = st && typeof st === 'object' ? st : {};
  const bucket = (Array.isArray(s.crops) ? s.crops : []).find((b) => b && /garden/i.test(b.name)) || {};
  const coins = Number(s.wallet && s.wallet.coins) || 0;
  const tiles = s.gardenTiles && typeof s.gardenTiles === 'object' ? Object.values(s.gardenTiles) : [];
  const species = tiles.map((t) => (Array.isArray(t) ? String(t[1] || '') : ''));
  const total = Number(bucket.total) || 0;
  const special = Number(bucket.special) || (Number(bucket.gold) || 0) + (Number(bucket.rainbow) || 0);
  const pets = Array.isArray(s.allPets) ? s.allPets : [];
  return {
    netWorth: coins + (Number(bucket.value) || 0),
    coins,
    crops: total,
    colorShare: total > 0 ? special / total : 0,
    celestials: species.filter((x) => CELESTIAL.test(x)).length,
    binders: species.filter((x) => CELESTIAL.test(x) && BINDER.test(x)).length,
    granters: pets.filter((p) => (Array.isArray(p.abilities) ? p.abilities : []).some((a) => /^(Gold|Rainbow)Granter$/.test(String(a)))).length,
    sellPart: Number(s.idealSell && s.idealSell.petPart) || 1,
    known: Boolean(s.foundSelf),
  };
}

const MILESTONES = {
  mid: {
    need: 2,
    list: [
      { id: 'worth', label: 'Net worth 1B', test: (s) => s.netWorth >= 1e9, have: (s) => ({ value: s.netWorth, unit: 'coins' }) },
      { id: 'celestial', label: 'A celestial planted', test: (s) => s.celestials >= 1, have: (s) => ({ value: s.celestials, unit: 'planted' }) },
      { id: 'color', label: '10% of crops Gold or Rainbow', test: (s) => s.crops >= 20 && s.colorShare >= 0.1, have: (s) => ({ value: s.colorShare, unit: 'share', note: s.crops < 20 ? `of ${s.crops} crops; counts from 20` : null }) },
      { id: 'granter', label: 'A Gold or Rainbow Granter pet', test: (s) => s.granters >= 1, have: (s) => ({ value: s.granters, unit: 'pets' }) },
    ],
  },
  late: {
    need: 3,
    list: [
      { id: 'worth', label: 'Net worth 100B', test: (s) => s.netWorth >= 1e11, have: (s) => ({ value: s.netWorth, unit: 'coins' }) },
      { id: 'celestials', label: '3 celestials planted', test: (s) => s.celestials >= 3, have: (s) => ({ value: s.celestials, unit: 'planted' }) },
      { id: 'binder', label: 'A Moonbinder or Dawnbinder planted', test: (s) => s.binders >= 1, have: (s) => ({ value: s.binders, unit: 'planted' }) },
      { id: 'color', label: 'Half your crops Gold or Rainbow', test: (s) => s.crops >= 20 && s.colorShare >= 0.5, have: (s) => ({ value: s.colorShare, unit: 'share', note: s.crops < 20 ? `of ${s.crops} crops; counts from 20` : null }) },
      { id: 'sell', label: 'Sell pets worth +15%', test: (s) => s.sellPart >= 1.15, have: (s) => ({ value: s.sellPart - 1, unit: 'share' }) },
    ],
  },
};

function check(stageId, s) {
  const m = MILESTONES[stageId];
  const list = m.list.map((x) => Object.assign({ id: x.id, label: x.label, met: Boolean(x.test(s)) }, x.have(s)));
  return { need: m.need, met: list.filter((x) => x.met).length, list };
}

// The stage: what Auto makes of your game, what you picked (if anything), and
// the one in use, with every milestone and what's left for the next stage.
function detect(signals, pick) {
  const s = Object.assign({ netWorth: 0, crops: 0, colorShare: 0, celestials: 0, binders: 0, granters: 0, sellPart: 1 }, signals);
  const mid = check('mid', s);
  const late = check('late', s);
  const midOk = mid.met >= mid.need;
  const lateOk = midOk && late.met >= late.need;
  const auto = lateOk ? 'late' : midOk ? 'mid' : 'early';
  const picked = ['early', 'mid', 'late'].includes(pick) ? pick : null;
  const id = picked || auto;
  const nextId = auto === 'early' ? 'mid' : auto === 'mid' ? 'late' : null;
  const next = nextId ? Object.assign({ id: nextId }, nextId === 'mid' ? mid : late) : null;
  // How far into the stage (v0.56.1): two Late gardens can differ a lot (one
  // with the celestials but no Rainbow or sell team, one maxed). In Late, by
  // the Late milestones met past the 3 needed (3 early, 4 well into, 5
  // deep); in Early and Mid, by the next stage's milestones met so far. The
  // gaps are what's left: Late's unmet milestones, or the next stage's.
  const toward = id === 'late' ? late : id === 'mid' ? late : mid;
  const progress = id === 'late'
    ? Math.max(0, Math.min(1, (late.met - late.need) / Math.max(1, late.list.length - late.need)))
    : Math.max(0, Math.min(0.99, toward.met / Math.max(1, toward.need)));
  const step = progress >= 1 ? 'deep' : progress >= 0.34 ? 'well' : 'early';
  const label = STAGES.find((x) => x.id === id).label;
  const within = {
    step,
    progress,
    label: step === 'deep' ? `deep in ${label}` : step === 'well' ? `well into ${label}` : `early in ${label}`,
    short: step === 'deep' ? 'deep' : step === 'well' ? 'well in' : 'early',
    gaps: toward.list.filter((x) => !x.met).map((x) => ({ id: x.id, label: x.label, value: x.value, unit: x.unit, note: x.note || null })),
    of: id === 'late' ? `${late.met} of ${late.list.length} Late milestones` : `${toward.met} of the ${toward.need} ${id === 'mid' ? 'Late' : 'Mid'} needs`,
  };
  return {
    within,
    id,
    auto,
    picked,
    index: STAGES.findIndex((x) => x.id === id),
    stage: STAGES.find((x) => x.id === id),
    stages: STAGES.map((x) => ({ id: x.id, label: x.label, emoji: x.emoji, title: x.title })),
    milestones: { mid, late },
    next,
    signals: s,
  };
}

module.exports = { STAGES, MILESTONES, signalsFrom, detect };
