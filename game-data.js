'use strict';

// Reads the game's own data tables (pets, abilities, eggs) out of the
// game's JavaScript, so ability numbers, pet growth times and egg odds stay
// current when the game updates, without waiting for the wiki or for Claude.
//
// It is read-only: the garden observer fetches the game's script file (the
// same file the browser already loaded) and passes the text to
// parseGameCode(). Nothing is changed or sent anywhere. If the game ever
// reorganises its code so this finds nothing, the app quietly falls back to
// its built-in tables (pet-data.js, ability-data.js).
//
// The game's code is minified, so tables look like
//   Worm:{name:"Worm",...,maxScale:2,...,hoursToMature:12,...}
//   ProduceScaleBoost:{name:"Crop Size Boost I",trigger:"continuous",
//     baseProbability:.3,baseParameters:{sizeIncrease:4}}
//   CommonEgg:{name:"Common Egg",secondsToHatch:600,
//     faunaSpawnWeights:{Worm:60,Snail:35,Bee:5}}
// The parser finds a telltale key (hoursToMature, baseProbability,
// faunaSpawnWeights), walks out to the object around it, and reads the name
// in front of that object.
//
// Written in plain old JavaScript because it is also sent into the game page
// as source text (see browserSource).

function parseGameCode(text) {
  var LIMIT = 20000;

  function enclosingStart(idx) {
    var depth = 0;
    for (var i = idx - 1; i >= 0 && idx - i < LIMIT; i -= 1) {
      var c = text.charAt(i);
      if (c === '}') depth += 1;
      else if (c === '{') {
        if (depth === 0) return i;
        depth -= 1;
      }
    }
    return -1;
  }

  function balanced(start) {
    var depth = 0;
    var quote = '';
    var escaped = false;
    for (var i = start; i < text.length && i - start < LIMIT; i += 1) {
      var ch = text.charAt(i);
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function keyBefore(start) {
    var s = text.slice(Math.max(0, start - 100), start);
    var m = /(?:"([^"\\]{1,60})"|'([^'\\]{1,60})'|([A-Za-z_$][\w$]{0,60}))\s*:\s*$/.exec(s);
    return m ? m[1] || m[2] || m[3] : null;
  }

  function subBlock(block, key) {
    var i = block.indexOf(key + ':{');
    if (i < 0) return null;
    var save = text;
    text = block;
    var out = balanced(i + key.length + 1);
    text = save;
    return out;
  }

  // Top-level fields only: nested objects are cut out before matching.
  // keepArrays leaves [..] lists in (for pairs()).
  function flatten(block, keepArrays) {
    var inner = block.slice(1, -1);
    var out = '';
    var depth = 0;
    var quote = '';
    for (var i = 0; i < inner.length; i += 1) {
      var ch = inner.charAt(i);
      if (quote) {
        if (ch === quote && inner.charAt(i - 1) !== '\\') quote = '';
        if (depth === 0) out += ch;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        if (depth === 0) out += ch;
        continue;
      }
      var opens = ch === '{' || (!keepArrays && ch === '[');
      var closes = ch === '}' || (!keepArrays && ch === ']');
      if (opens) depth += 1;
      if (depth === 0) out += ch;
      if (closes) depth -= 1;
    }
    return ',' + out + ',';
  }

  function num(flat, key) {
    var m = new RegExp('[,{]\\s*"?' + key + '"?\\s*:\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)\\s*[,}]').exec(flat);
    return m ? Number(m[1]) : null;
  }

  function str(flat, key) {
    var m = new RegExp('[,{]\\s*"?' + key + '"?\\s*:\\s*"([^"\\\\]*)"').exec(flat);
    return m ? m[1] : null;
  }

  // Every key:value pair of a small flat object ({Worm:60,Snail:35}).
  function pairs(block) {
    var out = {};
    if (!block) return out;
    var re = /(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*(?:(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)|"([^"]*)"|\[([^\]]*)\])/g;
    var m;
    var flat = flatten(block, true);
    while ((m = re.exec(flat))) {
      var k = m[1] || m[2];
      if (m[3] != null) out[k] = Number(m[3]);
      else if (m[4] != null) out[k] = m[4];
      else if (m[5] != null) out[k] = m[5].split(',').map(function (x) { return x.replace(/["'\s]/g, ''); }).filter(Boolean);
    }
    return out;
  }

  function each(anchor, fn) {
    var seen = {};
    var idx = text.indexOf(anchor);
    var guard = 0;
    while (idx >= 0 && guard < 2000) {
      guard += 1;
      var start = enclosingStart(idx);
      if (start >= 0 && !seen[start]) {
        seen[start] = true;
        var block = balanced(start);
        var key = keyBefore(start);
        if (block && key) {
          try {
            fn(key, block);
          } catch (err) {
            /* skip anything odd */
          }
        }
      }
      idx = text.indexOf(anchor, idx + anchor.length);
    }
  }

  var out = { pets: {}, abilities: {}, eggs: {} };

  each('hoursToMature:', function (key, block) {
    var flat = flatten(block);
    var hours = num(flat, 'hoursToMature');
    if (hours == null) return;
    out.pets[key] = {
      name: str(flat, 'name') || key,
      hoursToMature: hours,
      maxScale: num(flat, 'maxScale'),
      sellPrice: num(flat, 'maturitySellPrice'),
      maxHunger: num(flat, 'coinsToFullyReplenishHunger'),
    };
  });

  // The real game writes some ability fields as references rather than
  // text (its names come from a translation file, its triggers from a list
  // of named values), so only the id and the numbers are required.
  function ability(key, block) {
    if (out.abilities[key] || !/^[A-Z][A-Za-z0-9_]{2,60}$/.test(key)) return;
    var flat = flatten(block);
    var chance = num(flat, 'baseProbability');
    var params = pairs(subBlock(block, 'baseParameters'));
    var hasParams = /[,{]\s*baseParameters\s*:/.test(flat + block.slice(0, 2000));
    if (chance == null && !hasParams) return;
    var trigger = str(flat, 'trigger');
    if (!trigger) {
      var m = /[,{]\s*trigger\s*:\s*[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)/.exec(flat);
      if (m) trigger = m[1];
    }
    out.abilities[key] = {
      name: str(flat, 'name') || null,
      trigger: trigger ? String(trigger).charAt(0).toLowerCase() + String(trigger).slice(1) : null,
      chance: chance,
      params: params,
    };
  }
  each('baseProbability:', ability);
  // Always-on abilities have no chance, only parameters.
  each('baseParameters:', ability);

  each('faunaSpawnWeights:', function (key, block) {
    var flat = flatten(block);
    out.eggs[key] = {
      name: str(flat, 'name') || key,
      secondsToHatch: num(flat, 'secondsToHatch'),
      weights: pairs(subBlock(block, 'faunaSpawnWeights')),
      // Bad Luck Protection thresholds per rare species (added Sept 2026).
      pity: pairs(subBlock(block, 'speciesPityThresholdPulls')),
    };
  });

  return out;
}

// True when a parse found enough to be worth using.
function looksComplete(parsed) {
  return Boolean(parsed) &&
    Object.keys(parsed.pets || {}).length >= 5 &&
    Object.keys(parsed.abilities || {}).length >= 10;
}

function browserSource() {
  return `window.__MG_PARSE_GAME_CODE = ${parseGameCode.toString()};\n`;
}

module.exports = { parseGameCode, looksComplete, browserSource };
