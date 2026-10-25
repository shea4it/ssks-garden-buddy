'use strict';

// The trough timer's arithmetic (v0.58.0), run through main.js's own
// function (pulled out of the file, since main.js needs Electron).
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const a = src.indexOf('function troughForecast(');
const b = src.indexOf('\nfunction fmtLeft(', a);
// eslint-disable-next-line no-new-func
const troughForecast = new Function(`${src.slice(a, b)}; return troughForecast;`)();

let n = 0;
function ok(cond, what) {
  n += 1;
  if (!cond) {
    console.error(`FAIL: ${what}`);
    process.exit(1);
  }
}
// A meal seen means both its size (lastMeal) and when it ate (eatAt).
const pet = (name, diet, perSecond, lastMeal, max) => ({ name, species: name, known: true, maxHunger: max || 40000, diet, perSecond, lastMeal, eatAt: lastMeal ? 0 : null, secondsLeft: perSecond ? 20000 / perSecond : null });

// Three pets, each eating one crop's worth every 2 hours; 9 crops they eat.
{
  const pets = [pet('Ostrich', ['Eggplant', 'Peach'], 2, 14400), pet('Pig', ['Lychee', 'Cacao'], 2, 14400), pet('Bat', ['Cacao'], 2, 14400)];
  const t = troughForecast(pets, { species: ['Lychee', 'Lychee', 'Lychee', 'Cacao', 'Cacao', 'Eggplant', 'Eggplant', 'Eggplant', 'Cacao'] });
  ok(t.edible === 9 && Math.abs(t.perHour - 1.5) < 0.01, `3 pets, a meal each every 2 h: 1.5 crops an hour (${t.perHour})`);
  // All three are hungry now (hunger 0), so each eats at 0, 2 h and 4 h:
  // nine crops, the last at 4 h (meals played out, v0.59.0).
  ok(Math.abs(t.emptyIn - 4 * 3600) < 5, `all hungry now, a meal each every 2 h: empty at 4 h (${(t.emptyIn / 3600).toFixed(2)} h)`);
  ok(!t.learning && t.starving.length === 0, 'meals seen, nobody without food');
}
// A pet with nothing it eats in the trough is listed, not counted.
{
  const pets = [pet('Ostrich', ['Peach'], 2, 14400), pet('Pig', ['Cacao'], 2, 14400)];
  const t = troughForecast(pets, { species: ['Cacao', 'Cacao'] });
  ok(t.starving.length === 1 && t.starving[0].name === 'Ostrich', 'the Ostrich has nothing it eats: listed with its own time left');
  ok(t.edible === 2 && Math.abs(t.emptyIn - 7200) < 5, 'the Pig alone: 2 crops, eaten now and in 2 h');
}
// No meal seen yet: a full refill is assumed and it says it's still learning.
{
  // No meal seen: a meal is a full refill, so it eats when empty: 20000 / 2.
  const t = troughForecast([Object.assign(pet('Pig', ['Cacao'], 2, null, 40000), { hunger: 20000 })], { species: ['Cacao'] });
  ok(t.learning && Math.abs(t.emptyIn - 10000) < 5, `no meal seen: assumes a full refill, eats when there's room (${t.emptyIn} s), marked as learning`);
}
// No rate measured yet: no time, still learning.
{
  const t = troughForecast([pet('Pig', ['Cacao'], null, null)], { species: ['Cacao'] });
  ok(t.emptyIn === null && t.learning, 'no hunger rate yet: no time given');
}
// (v0.59.0) A countdown that moves: the same pets a minute later (hunger
// down by a minute's worth) run out a minute sooner, and emptyAt stays put.
{
  const mk = (hunger) => [Object.assign(pet('Pig', ['Cacao'], 2, 14400), { hunger, eatAt: 20000 })];
  const a = troughForecast(mk(30000), { species: ['Cacao', 'Cacao', 'Cacao'] });
  const b = troughForecast(mk(30000 - 120), { species: ['Cacao', 'Cacao', 'Cacao'] });
  ok(a.emptyIn - b.emptyIn === 60, `a minute on, a minute less (${a.emptyIn} -> ${b.emptyIn})`);
  ok(Math.abs(a.emptyAt - b.emptyAt - 60000) < 1500, 'emptyAt is a moment: the countdown ticks toward it');
  // First meal when hunger falls to 20000: (30000 - 20000) / 2 = 5000 s; then
  // every 14400 / 2 = 7200 s: three crops gone at 5000 + 2 x 7200.
  ok(a.emptyIn === 5000 + 2 * 7200, `meals played out: ${a.emptyIn} s`);
}
console.log(`trough: ${n} checks passed`);
