'use strict';

// Tests for stage.js: Early / Mid / Late from milestones, explained, and an
// override that keeps Auto underneath.
const stage = require('../stage');

let n = 0;
function ok(cond, what) {
  n += 1;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
}

// A brand new garden: Early, with what Mid needs.
{
  const r = stage.detect({ netWorth: 2e6, crops: 12, colorShare: 0, celestials: 0, granters: 0 });
  ok(r.id === 'early' && r.auto === 'early' && !r.picked, 'a new garden is Early');
  ok(r.next && r.next.id === 'mid' && r.next.need === 2 && r.next.met === 0, 'and it says Mid needs 2 milestones, none met yet');
}

// One milestone isn't enough: a rich player with nothing else is still Early.
{
  const r = stage.detect({ netWorth: 5e9, crops: 30, colorShare: 0.02 });
  ok(r.auto === 'early' && r.next.met === 1, 'net worth alone (1 of 4) is still Early');
}

// Mid: 1B and a celestial.
{
  const r = stage.detect({ netWorth: 3e9, crops: 60, colorShare: 0.12, celestials: 1 });
  ok(r.auto === 'mid', 'a celestial, 1B and 12% Gold/Rainbow is Mid');
  ok(r.next.id === 'late' && r.next.need === 3, 'and it says Late needs 3 of its milestones');
}

// The owner's garden (their sample): Late, and why.
{
  const st = {
    foundSelf: true,
    wallet: { coins: 11.4e9 },
    crops: [{ name: 'garden', total: 270, value: 639.3e9, special: 235 }],
    gardenTiles: Object.fromEntries([
      ...Array.from({ length: 4 }, (_, i) => [`t${i}`, ['p', 'ThunderCelestial']]),
      ...Array.from({ length: 4 }, (_, i) => [`s${i}`, ['p', 'Starweaver']]),
      ...Array.from({ length: 3 }, (_, i) => [`d${i}`, ['p', 'DawnCelestial']]),
      ...Array.from({ length: 2 }, (_, i) => [`m${i}`, ['p', 'MoonCelestial']]),
      ['u1', ['p', 'Ube']],
    ]),
    allPets: [{ abilities: ['SellBoostII', 'RainbowGranter'] }, { abilities: ['GoldGranter'] }],
    idealSell: { petPart: 1.313 },
  };
  const sig = stage.signalsFrom(st);
  ok(sig.celestials === 13 && sig.binders === 5, `13 celestials, 5 binders (${sig.celestials}, ${sig.binders})`);
  ok(sig.granters === 2 && Math.abs(sig.colorShare - 235 / 270) < 1e-9, 'two granter pets, 87% Gold/Rainbow');
  const r = stage.detect(sig);
  ok(r.auto === 'late' && r.next === null, 'the owner is Late, with nothing further');
  ok(r.milestones.late.met === 5, `every Late milestone met (${r.milestones.late.met})`);
}

// Picking a stage keeps Auto underneath.
{
  const r = stage.detect({ netWorth: 3e9, crops: 60, colorShare: 0.12, celestials: 1 }, 'late');
  ok(r.id === 'late' && r.picked === 'late' && r.auto === 'mid', 'picked Late shows Late, with Auto still Mid');
  const bad = stage.detect({}, 'expert');
  ok(bad.id === 'early' && bad.picked === null, 'an unknown pick is ignored');
}

// How far into the stage (v0.56.1): the owner's girlfriend's account (her
// samples): net worth 211B, 10 celestials, 2 binders, 45% Gold and no
// Rainbow, no sell pets: Late, but early in it, with the two gaps.
{
  const gf = stage.detect({ netWorth: 211e9, crops: 150, colorShare: 0.45, celestials: 10, binders: 2, granters: 8, sellPart: 1 });
  ok(gf.auto === 'late' && gf.within.step === 'early', `her account is early in Late (${gf.within.label})`);
  ok(gf.within.gaps.map((g) => g.id).join() === 'color,sell', `her gaps: Gold/Rainbow and sell pets (${gf.within.gaps.map((g) => g.id).join()})`);
  ok(gf.within.of === '3 of 5 Late milestones', gf.within.of);
  const four = stage.detect({ netWorth: 211e9, crops: 150, colorShare: 0.6, celestials: 10, binders: 2, granters: 8, sellPart: 1 });
  ok(four.within.step === 'well' && four.within.gaps.length === 1, 'one more milestone: well into Late, one gap');
  const owner = stage.detect({ netWorth: 1.27e12, crops: 270, colorShare: 0.87, celestials: 13, binders: 5, granters: 2, sellPart: 1.313 });
  ok(owner.within.step === 'deep' && owner.within.gaps.length === 0 && owner.within.label === 'deep in Late', 'the owner is deep in Late, no gaps');
  const mid = stage.detect({ netWorth: 3e9, crops: 60, colorShare: 0.12, celestials: 1 });
  ok(mid.within.step === 'early' && mid.within.gaps.length === 5 && /Late needs/.test(mid.within.of), `Mid with nothing of Late yet: early in Mid (${mid.within.of})`);
}

console.log(`stage: ${n} checks passed`);
