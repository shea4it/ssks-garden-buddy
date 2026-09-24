'use strict';

// One place that decides what kind of weather a name refers to, so the
// alerts, the pet-team swapper and the log-off feature all agree.
//
// The game and the shop feed don't always use the same words ("Thunderstorm",
// "Thunder", "Frost", "Snow", "AmberMoon", "Amber Moon"), so this matches on
// the stem of the word rather than the exact name.

const KINDS = [
  { id: 'rain', label: 'Rain', emoji: '🌧️', group: 'hydro', gives: 'Wet (or Frozen on Chilled crops)' },
  { id: 'snow', label: 'Snow', emoji: '❄️', group: 'hydro', gives: 'Chilled (or Frozen on Wet crops)' },
  { id: 'thunder', label: 'Thunderstorm', emoji: '⛈️', group: 'hydro', gives: 'Thunderstruck' },
  { id: 'dawn', label: 'Dawn', emoji: '🌅', group: 'lunar', gives: 'Dawnlit' },
  { id: 'amber', label: 'Amber Moon', emoji: '🌕', group: 'lunar', gives: 'Amberlit' },
];

const BY_ID = Object.fromEntries(KINDS.map((k) => [k.id, k]));

// Returns 'rain' | 'snow' | 'thunder' | 'dawn' | 'amber' | 'clear' | null.
// null means "some weather we don't recognise", which is different from
// clear skies.
function kindOf(name) {
  if (name == null) return 'clear';
  const s = String(name).toLowerCase();
  if (!s.trim() || /\b(sunny|clear|none|normal)\b/.test(s)) return 'clear';
  if (/thunder|storm|lightning/.test(s)) return 'thunder';
  if (/rain/.test(s)) return 'rain';
  if (/snow|frost|blizzard|chill/.test(s)) return 'snow';
  if (/dawn/.test(s)) return 'dawn';
  if (/amber|harvest ?moon/.test(s)) return 'amber';
  return null;
}

function label(kind) {
  if (kind === 'clear') return 'Clear skies';
  return (BY_ID[kind] && BY_ID[kind].label) || 'Unknown weather';
}

// Lunar events are announced ahead of time without saying which one it is.
// Returns the kinds an unannounced event could still turn out to be.
function possibleKinds(event) {
  if (!event) return [];
  const known = kindOf(event.name || event.weatherId);
  if (known && known !== 'clear' && (event.name || event.weatherId)) return [known];
  const group = String(event.groupId || '').toLowerCase();
  if (/lunar|moon/.test(group)) return ['dawn', 'amber'];
  if (/hydro|weather/.test(group)) return ['rain', 'snow', 'thunder'];
  return KINDS.map((k) => k.id);
}

module.exports = { KINDS, BY_ID, kindOf, label, possibleKinds };
