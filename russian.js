'use strict';

// Turns English alert lines into Russian-letter spellings, so a Russian voice
// reads them with Russian sounds: rolled r, "v" for "w", "z" for "th", and
// no "the" or "a". That's what makes the accent thick. Words in the alert
// lines have hand-picked spellings; anything else (like a custom item name)
// goes through simple pronunciation rules.

const WORDS = {
  // alert vocabulary
  alert: 'алэрт', alerts: 'алэртс', shop: 'шоп', stock: 'сток', is: 'из', in: 'ин', it: 'ит',
  "it's": 'итс', its: 'итс', "i'm": 'айм', i: 'ай', hi: 'хай', and: 'энд', of: 'оф', on: 'он',
  to: 'ту', for: 'фор', you: 'ю', your: 'ёр', yourself: 'ёрсэлф', go: 'гоу', get: 'гет', got: 'гот',
  now: 'нау', oh: 'о', ooh: 'у', my: 'май', goodness: 'гуднэсс', stop: 'стоп', everything: 'эврисинг',
  everyone: 'эвриван', news: 'ньюс', big: 'биг', very: 'вэри', good: 'гуд', lovely: 'лавли',
  brilliant: 'брильянт', well: 'вэлл', never: 'нэвэр', honestly: 'онэстли', once: 'ванс', more: 'мор',
  luck: 'лак', not: 'нот', drill: 'дрилл', love: 'лав', off: 'офф', pop: 'поп', attention: 'аттэншн',
gardeners: 'гардэнэрс', appeared: 'эппирд', has: 'хэз', have: 'хэв',
  arrived: 'эррайвд', rise: 'райз', shine: 'шайн', grind: 'грайнд', then: 'зэн', heads: 'хэдс',
  up: 'ап', spotted: 'споттэд', toasty: 'тоусти', treat: 'трит', smashing: 'смэшинг', while: 'вайл',
  lasts: 'ластс', last: 'ласт', strike: 'страйк', hot: 'хот', all: 'олл', hands: 'хэндс', deck: 'дэк',
  chop: 'чоп', red: 'рэд', morning: 'морнинг', sun: 'сан', open: 'оупэн', things: 'сингс',
  are: 'ар', heating: 'хитинг', this: 'зис', that: 'зэт', where: 'вэр', will: 'вилл', play: 'плэй',
  testing: 'тэстинг', say: 'сэй', again: 'эгэйн', move: 'мув', repeat: 'рипит', drop: 'дроп',
  chosen: 'чоузэн', us: 'ас', moon: 'мун', excellent: 'экселлэнт', cellent: 'сэллэнт',
be: 'би', there: 'зэр', here: 'хир', new: 'нью', one: 'ван', two: 'ту', three: 'сри',
  // game words
  egg: 'эгг', eggs: 'эггс', gold: 'голд', rainbow: 'рэйнбоу', pet: 'пэт', crop: 'кроп', crops: 'кропс',
  seed: 'сид', seeds: 'сидс', decor: 'дэкор', dawn: 'доун', amber: 'эмбэр', legendary: 'лэджэндари',
  mythical: 'мификал', moonbinder: 'мунбайндэр', dawnbinder: 'доунбайндэр', dawnbreaker: 'доунбрэйкэр',
  emberbloom: 'эмбэрблум', thunderspire: 'зандэрспайр', starweaver: 'старвивэр', windturner: 'виндтёрнэр',
  firepit: 'файэрпит', fire: 'файэр', pit: 'пит', ube: 'убэ', milkcap: 'милккэп', marigold: 'мэриголд',
  thunder: 'зандэр', rain: 'рэйн', snow: 'сноу', weather: 'вэзэр', garden: 'гардэн', bunny: 'банни',
  // flavour
  comrade: 'товарищ', privet: 'привет', da: 'да', dmitri: 'дмитрий',
};

// Longest patterns first; applied left to right.
const RULES = [
  ['tion', 'шн'], ['sion', 'жн'], ['ough', 'оф'], ['igh', 'ай'], ['tch', 'ч'],
  ['th', 'з'], ['sh', 'ш'], ['ch', 'ч'], ['ph', 'ф'], ['ck', 'к'], ['qu', 'кв'], ['wh', 'в'],
  ['ee', 'и'], ['ea', 'и'], ['oo', 'у'], ['ou', 'ау'], ['ow', 'оу'], ['oa', 'оу'], ['ai', 'эй'],
  ['ay', 'эй'], ['ey', 'эй'], ['oi', 'ой'], ['oy', 'ой'], ['au', 'о'], ['aw', 'о'], ['ew', 'ью'],
  ['er', 'эр'], ['ng', 'нг'], ['kn', 'н'], ['wr', 'р'], ['x', 'кс'],
];

const LETTERS = {
  a: 'а', b: 'б', d: 'д', e: 'э', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л',
  m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'а', v: 'в', w: 'в', z: 'з',
};

const VOWELS = 'aeiouy';

function spell(word) {
  let w = word.toLowerCase().replace(/'/g, '');
  // A silent final "e" after a consonant ("shine", "stone").
  if (w.length > 3 && w.endsWith('e') && !VOWELS.includes(w[w.length - 2])) w = w.slice(0, -1);
  let out = '';
  let i = 0;
  while (i < w.length) {
    const rule = RULES.find(([from]) => w.startsWith(from, i));
    if (rule) {
      out += rule[1];
      i += rule[0].length;
      continue;
    }
    const ch = w[i];
    if (ch === 'c') out += 'eiy'.includes(w[i + 1] || '') ? 'с' : 'к';
    else if (ch === 'y') out += i === 0 ? 'й' : 'и';
    else out += LETTERS[ch] || ch;
    i += 1;
  }
  return out;
}

function russianize(text) {
  // Drop articles, the way a lot of Russian speakers do.
  const noArticles = String(text || '').replace(/\b(the|a|an)\s+/gi, '');
  return noArticles.replace(/[A-Za-z']+/g, (word) => {
    const key = word.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(WORDS, key)) return WORDS[key];
    return spell(key);
  });
}

module.exports = { russianize, spell };
