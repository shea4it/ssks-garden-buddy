'use strict';

// Natural voices, powered by Piper (open source, MIT licence, runs entirely
// on this computer). The engine comes from Piper's official GitHub release
// and is checked against a known SHA-256 before it's ever run. Voices come
// from the official Piper voice collection on Hugging Face. Everything is
// stored in the app's AppData folder, so it survives updates.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { russianize } = require('./russian');

const ENGINE_BASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';
const ENGINES = {
  'win32-x64': { file: 'piper_windows_amd64.zip', sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea', exe: 'piper/piper.exe' },
  'linux-x64': { file: 'piper_linux_x86_64.tar.gz', sha256: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992', exe: 'piper/piper' },
  'darwin-x64': { file: 'piper_macos_x64.tar.gz', sha256: 'ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b', exe: 'piper/piper' },
  'darwin-arm64': { file: 'piper_macos_aarch64.tar.gz', sha256: '6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc', exe: 'piper/piper' },
};

const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

// The voices, chosen for quality first and personality second (v0.18).
// Quality notes from a listening test of every English Piper voice
// (quick-tts.com, "Every Piper Voice, Ranked", May 2026): Lessac-high is the
// best-sounding English voice, Amy the warmest for short alerts, Cori a
// strong corpus, VCTK a clean multi-speaker set recorded in Edinburgh.

// SEMAINE: four actors recorded for emotion research, each playing one
// character: cheerful Poppy, grumpy Spike, gloomy Obadiah, sensible Prudence.
// One download covers all four (speaker ids from Piper's voices.json:
// prudence 0, spike 1, obadiah 2, poppy 3).
const SEMAINE = { model: 'en_GB-semaine-medium', dir: 'en/en_GB/semaine/medium' };

// The effect voices are Lessac (high quality) with sound effects on top, so
// one download covers all of them. The effects are applied as the clip plays.
const LESSAC = { model: 'en_US-lessac-high', dir: 'en/en_US/lessac/high' };

// VCTK's Scottish men (the corpus's speaker notes list these as Scottish:
// Edinburgh, Fife, Perth, Midlothian and more). "Try another" steps through.
const SCOTTISH_MEN = ['p252', 'p272', 'p281', 'p285', 'p275', 'p237', 'p241', 'p246', 'p247', 'p255', 'p260', 'p263', 'p271', 'p284'];

const CATALOG = [
  Object.assign({ group: 'Characters', id: 'char-poppy', name: 'Poppy', accent: 'British', gender: 'Female', speakers: ['poppy'], persona: 'poppy',
    note: 'Bubbly and absolutely delighted about everything. Every restock is the best day of her life.',
    preview: "Ooh! Hi, I'm Poppy! Oh my gosh, a Moonbinder is in the shop! Quick quick quick!" }, SEMAINE),
  Object.assign({ group: 'Characters', id: 'char-spike', name: 'Spike', accent: 'British', gender: 'Male', speakers: ['spike'], persona: 'spike',
    note: "Grumpy and sarcastic. He'll tell you, but he won't be happy about it.",
    preview: "Ugh. I'm Spike. Fine. A Moonbinder is in the shop. Go on then, off you go." }, SEMAINE),
  Object.assign({ group: 'Characters', id: 'char-obadiah', name: 'Obadiah', accent: 'British', gender: 'Male', speakers: ['obadiah'], persona: 'obadiah',
    note: 'Gloomy and deadpan. Every alert is a small tragedy.',
    preview: 'Oh. Hello. I am Obadiah. A Moonbinder is in the shop. Not that it matters, really.' }, SEMAINE),
  Object.assign({ group: 'Characters', id: 'char-prudence', name: 'Prudence', accent: 'British', gender: 'Female', speakers: ['prudence'], persona: 'prudence',
    note: 'Calm and sensible. Never flustered, always helpful.',
    preview: "Hello, I'm Prudence. Just so you know, a Moonbinder is in the shop." }, SEMAINE),

  { group: 'Storytellers', id: 'en_GB-cori-high', dir: 'en/en_GB/cori/high', name: 'Storybook', accent: 'British', gender: 'Female', persona: 'storybook',
    note: 'A warm audiobook narrator. Every alert becomes a bedtime story.',
    preview: 'Once upon a time, in a garden not far from here, a Moonbinder appeared in the shop.' },
  { group: 'Storytellers', id: 'en_US-amy-medium', dir: 'en/en_US/amy/medium', name: 'Amy', accent: 'American', gender: 'Female',
    note: 'Warm, friendly and clear. Just the news, nicely.',
    preview: "Hi, I'm Amy. Heads up, a Moonbinder is in the shop!" },

  { group: 'Scottish', id: 'en_GB-alba-medium', dir: 'en/en_GB/alba/medium', name: 'Alba', accent: 'Scottish', gender: 'Female',
    note: 'A soft Scottish lilt.',
    preview: "Hiya, I'm Alba. There's a Moonbinder in the shop!" },
  { group: 'Scottish', id: 'scottish-male', model: 'en_GB-vctk-medium', dir: 'en/en_GB/vctk/medium', name: 'Callum', accent: 'Scottish', gender: 'Male',
    note: 'A real Scottish voice, recorded in Edinburgh. Use "Try another" to hear the other Scottish speakers.',
    speakers: SCOTTISH_MEN,
    preview: "Hiya, I'm Callum. There's a Moonbinder in the shop!" },

  Object.assign({ group: 'Showtime', id: 'fun-stadium', name: 'Stadium announcer', accent: 'Showtime', effect: 'stadium', persona: 'stadium',
    note: 'A big, echoing arena voice.',
    preview: 'Ladies and gentlemen! Moonbinder! Is in! The shop!' }, LESSAC),
  Object.assign({ group: 'Showtime', id: 'fun-radio', name: 'Old radio', accent: 'Showtime', effect: 'radio', persona: 'radio',
    note: 'A crackly vintage broadcast.',
    preview: 'This is your garden bulletin. Moonbinder is in the shop. Over.' }, LESSAC),
  Object.assign({ group: 'Showtime', id: 'fun-trailer', name: 'Movie trailer', accent: 'Showtime', effect: 'trailer', persona: 'trailer',
    note: 'Deep, dramatic, and echoing through a cinema.',
    preview: 'In a world... where the shop restocks without warning... one seed... changes everything. Moonbinder.' }, LESSAC),
];

// Several catalog entries can share one downloaded model file.
function modelOf(v) {
  return v.model || v.id;
}

let root = null;
let fetchImpl = (url, opts) => fetch(url, opts);
let proc = null;
let procVoice = null;
let stdoutBuf = '';
let counter = 0;
let downloading = null;
const jobs = new Map();

/* ---------------------------------------------------------------- *
 * Paths
 * ---------------------------------------------------------------- */

function init(userDataDir) {
  root = path.join(userDataDir, 'voices');
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.rmSync(tmpDir(), { recursive: true, force: true });
  fs.mkdirSync(tmpDir(), { recursive: true });
}

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function engineSpec() {
  return ENGINES[platformKey()] || null;
}

function engineDir() {
  return path.join(root, 'engine');
}

function enginePath() {
  const spec = engineSpec();
  return spec ? path.join(engineDir(), spec.exe) : null;
}

function tmpDir() {
  return path.join(root, 'tmp');
}

function modelPath(id) {
  return path.join(root, 'models', id + '.onnx');
}

function voiceById(id) {
  return CATALOG.find((v) => v.id === id) || null;
}

function engineInstalled() {
  const exe = enginePath();
  return Boolean(exe && fs.existsSync(exe));
}

function modelInstalled(model) {
  return fs.existsSync(modelPath(model)) && fs.existsSync(modelPath(model) + '.json');
}

function voiceInstalled(id) {
  const v = voiceById(id);
  return Boolean(v) && modelInstalled(modelOf(v));
}

// Speaker names (like "p288") map to numbers inside a multi-speaker model.
const speakerMaps = {};
function speakerMap(model) {
  if (!speakerMaps[model]) {
    try {
      speakerMaps[model] = JSON.parse(fs.readFileSync(modelPath(model) + '.json', 'utf8')).speaker_id_map || {};
    } catch (err) {
      return {};
    }
  }
  return speakerMaps[model];
}

// The candidate speakers this voice can actually use, in order.
function availableSpeakers(v) {
  if (!v.speakers) return [];
  const map = speakerMap(modelOf(v));
  return v.speakers.filter((name) => Object.prototype.hasOwnProperty.call(map, name));
}

// The number Piper needs for this voice's speaker, or null for single-speaker voices.
function speakerIdFor(v, speaker) {
  const map = speakerMap(modelOf(v));
  const speakers = availableSpeakers(v);
  if (speakers.length) return map[speakers.includes(speaker) ? speaker : speakers[0]];
  if (v.speakerIndex != null && Object.keys(map).length > v.speakerIndex) return v.speakerIndex;
  return null;
}

/* ---------------------------------------------------------------- *
 * Downloading
 * ---------------------------------------------------------------- */

// Waits for a write stream to catch up, or fails if the stream does (so a
// full disk can't leave a download hanging).
function drained(stream) {
  return new Promise((resolve, reject) => {
    const done = (err) => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
      if (err) reject(err);
      else resolve();
    };
    const onDrain = () => done();
    const onError = (err) => done(err || new Error('write failed'));
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function downloadFile(url, dest, onProgress) {
  const controller = new AbortController();
  let stall = setTimeout(() => controller.abort(), 30000);
  const res = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
  if (!res.ok) {
    clearTimeout(stall);
    throw new Error(`the server answered ${res.status}`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let received = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(stall);
      stall = setTimeout(() => controller.abort(), 30000);
      received += value.length;
      if (!out.write(Buffer.from(value))) await drained(out);
      if (onProgress) onProgress(received, total);
    }
    clearTimeout(stall);
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    clearTimeout(stall);
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw controller.signal.aborted ? new Error('the download stalled') : err;
  }
  fs.renameSync(tmp, dest);
  return received;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, Object.assign({ windowsHide: true }, opts));
    let err = '';
    if (p.stderr) p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().slice(0, 300) || `${cmd} exited with ${code}`))));
  });
}

async function extract(archive, dir) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    // Windows 10 and later ship tar.exe, which also opens .zip files.
    await run('tar', ['-xf', archive, '-C', dir]);
  } catch (err) {
    if (process.platform !== 'win32') throw err;
    const q = (s) => "'" + s.replace(/'/g, "''") + "'";
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(archive)} -DestinationPath ${q(dir)} -Force`]);
  }
}

async function installEngine(onProgress) {
  const spec = engineSpec();
  if (!spec) throw new Error("natural voices aren't available on this kind of computer");
  if (engineInstalled()) return;
  const archive = path.join(root, spec.file);
  await downloadFile(ENGINE_BASE + spec.file, archive, (r, t) => onProgress('engine', r, t || 22500000));
  if (sha256(archive) !== spec.sha256) {
    fs.rmSync(archive, { force: true });
    throw new Error("the voice engine download didn't match the official release, so it was thrown away");
  }
  fs.rmSync(engineDir(), { recursive: true, force: true });
  await extract(archive, engineDir());
  fs.rmSync(archive, { force: true });
  if (process.platform !== 'win32') fs.chmodSync(enginePath(), 0o755);
  if (!engineInstalled()) throw new Error("the voice engine didn't unpack properly");
}

async function installVoice(id, onProgress) {
  const v = voiceById(id);
  if (!v) throw new Error('unknown voice');
  if (voiceInstalled(id)) return;
  const model = modelOf(v);
  const base = VOICE_BASE + v.dir + '/' + model;
  const cfg = modelPath(model) + '.json';
  await downloadFile(base + '.onnx.json', cfg + '.dl');
  try {
    JSON.parse(fs.readFileSync(cfg + '.dl', 'utf8'));
  } catch (err) {
    fs.rmSync(cfg + '.dl', { force: true });
    throw new Error("the voice's settings file was damaged");
  }
  const bytes = await downloadFile(base + '.onnx', modelPath(model) + '.dl', (r, t) => onProgress('voice', r, t || 63000000));
  if (bytes < 5000000) {
    fs.rmSync(modelPath(model) + '.dl', { force: true });
    fs.rmSync(cfg + '.dl', { force: true });
    throw new Error('the voice download was incomplete');
  }
  fs.renameSync(modelPath(model) + '.dl', modelPath(model));
  fs.renameSync(cfg + '.dl', cfg);
  delete speakerMaps[model];
}

// Engine first (once), then the voice. Only one download at a time.
async function download(id, onProgress) {
  if (downloading) throw new Error('another voice is already downloading');
  downloading = id;
  try {
    await installEngine(onProgress);
    await installVoice(id, onProgress);
  } finally {
    downloading = null;
  }
}

// Voices from older versions of the app that aren't offered any more: their
// downloads are removed so they don't sit on the disk (some are 100 MB).
function pruneUnused() {
  const keep = new Set(CATALOG.map(modelOf));
  const removed = [];
  let files = [];
  try {
    files = fs.readdirSync(path.join(root, 'models'));
  } catch (err) {
    return removed;
  }
  for (const f of files) {
    const m = /^(.+)\.onnx(\.json)?$/.exec(f);
    if (!m || keep.has(m[1])) continue;
    try {
      fs.rmSync(path.join(root, 'models', f), { force: true });
      if (!m[2]) removed.push(m[1]);
    } catch (err) {
      /* try again next time */
    }
  }
  return removed;
}

function remove(id) {
  const v = voiceById(id);
  if (!v) return;
  const model = modelOf(v);
  if (procVoice === model) stopProcess();
  fs.rmSync(modelPath(model), { force: true });
  fs.rmSync(modelPath(model) + '.json', { force: true });
  delete speakerMaps[model];
}

/* ---------------------------------------------------------------- *
 * Speaking: one Piper process stays running with the current voice,
 * so each line takes a fraction of a second.
 * ---------------------------------------------------------------- */

function failJobs(message) {
  for (const job of jobs.values()) {
    clearTimeout(job.timer);
    job.reject(new Error(message));
  }
  jobs.clear();
}

function stopProcess() {
  if (proc) {
    try {
      proc.stdin.end();
      proc.kill();
    } catch (err) {
      /* already gone */
    }
  }
  proc = null;
  procVoice = null;
  failJobs('The voice was switched');
}

function startProcess(id) {
  stopProcess();
  const exe = enginePath();
  proc = spawn(exe, ['--model', modelPath(id), '--json-input', '--quiet', '--output_dir', tmpDir()], {
    cwd: path.dirname(exe),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  procVoice = id;
  stdoutBuf = '';
  const mine = proc;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk;
    let i;
    while ((i = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, i).trim();
      stdoutBuf = stdoutBuf.slice(i + 1);
      const job = jobs.get(path.resolve(line));
      if (job) {
        jobs.delete(path.resolve(line));
        clearTimeout(job.timer);
        job.resolve();
      }
    }
  });
  proc.stderr.on('data', () => {});
  proc.stdin.on('error', () => {});
  proc.on('error', () => {});
  proc.on('exit', () => {
    if (proc === mine) {
      proc = null;
      procVoice = null;
      failJobs('The voice engine stopped');
    }
  });
}

async function synthesize(id, text, speaker) {
  const v = voiceById(id);
  if (!v || !engineInstalled() || !voiceInstalled(id)) throw new Error("That voice isn't downloaded");
  const model = modelOf(v);
  if (!proc || procVoice !== model) startProcess(model);
  counter += 1;
  const file = path.resolve(path.join(tmpDir(), `line-${Date.now()}-${counter}.wav`));
  let clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (v.transform === 'russian') clean = russianize(clean);
  const line = { text: clean, output_file: file };
  const sid = speakerIdFor(v, speaker);
  if (sid != null) line.speaker_id = sid;
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      jobs.delete(file);
      reject(new Error('The voice took too long'));
    }, 20000);
    jobs.set(file, { resolve, reject, timer });
  });
  proc.stdin.write(JSON.stringify(line) + '\n');
  await finished;
  const bytes = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return bytes;
}

function warm(id) {
  const v = voiceById(id);
  if (v && engineInstalled() && voiceInstalled(id) && procVoice !== modelOf(v)) startProcess(modelOf(v));
}

function list() {
  return {
    available: Boolean(engineSpec()),
    engineInstalled: engineInstalled(),
    downloading,
    voices: CATALOG.map((v) => Object.assign({}, v, {
      installed: voiceInstalled(v.id),
      speakers: voiceInstalled(v.id) ? availableSpeakers(v) : v.speakers || [],
      sharesDownloadWith: CATALOG.filter((o) => o.id !== v.id && modelOf(o) === modelOf(v)).map((o) => o.name),
    })),
  };
}

module.exports = {
  init,
  pruneUnused,
  CATALOG,
  list,
  download,
  remove,
  synthesize,
  warm,
  stop: stopProcess,
  // For the test harness only.
  _setFetch(fn) {
    fetchImpl = fn;
  },
};
