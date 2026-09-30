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

const ENGINE_BASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';
const ENGINES = {
  'win32-x64': { file: 'piper_windows_amd64.zip', sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea', exe: 'piper/piper.exe' },
  'linux-x64': { file: 'piper_linux_x86_64.tar.gz', sha256: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992', exe: 'piper/piper' },
  'darwin-x64': { file: 'piper_macos_x64.tar.gz', sha256: 'ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b', exe: 'piper/piper' },
  'darwin-arm64': { file: 'piper_macos_aarch64.tar.gz', sha256: '6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc', exe: 'piper/piper' },
};

const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

// v0.50: four voices, picked for one thing: being easy to understand from
// across a room on a house speaker. No sound effects, no characters, no pitch
// tricks: those made alerts hard to follow (measured: the old radio / stadium
// / trailer effects cost 13-27 % of speech intelligibility, extended STOI).
//
// v0.50.2: every built-in line was rendered through every voice and checked
// (Praat pitch and harmonics, Whisper small.en transcripts, the waveform;
// tests/voice-audit.py and tests/README.md "Voice audit"). Ryan was
// replaced by Alan: Ryan started speaking on the very first sample in 36 of
// 41 lines (a click and a clipped first sound) and had 40 pitch breaks on 17
// test lines; Alan had 7 (the steadiest of all nine voices tried) and Whisper
// misheard 2 of the 17 lines against Ryan's 7.
//
// Per voice:
//   tone.presence  dB lift around 3 kHz, where words are told apart
//   tone.air       dB high-shelf above 7 kHz. Cori, Alba and Alan carry
//                  about 15 dB more synthesis fizz on their vowels than Leah
//                  (-35 vs -50 dB), which small speakers turn into something
//                  that sounds distorted; -6 takes the edge off it and leaves
//                  the "s" sounds (mostly 4-7 kHz) alone.
//   noise          Piper's randomness [noise_scale, noise_w] (its default
//                  is 0.667, 0.8). Piper never says a line the same way
//                  twice, so a voice can crack on one alert and not the next.
//                  Leah is the most expressive voice (a 16.7-semitone pitch
//                  range, twice the others'), and 8 of 24 renders of the same
//                  4 lines squeaked (a jump of 10+ semitones held 50 ms+,
//                  Praat); at noise_scale 0 it was 1 of 24, with no loss in
//                  Whisper's transcripts. Cori and Alba never squeaked;
//                  0.4 / 0.5 gave them fewer pitch breaks and Cori fewer
//                  misheard lines. Alan: none at his defaults, so left alone.
const CATALOG = [
  { id: 'en_US-lessac-high', dir: 'en/en_US/lessac/high', name: 'Leah', accent: 'American', gender: 'Female', mb: 109, recommended: true,
    tone: { presence: 3, air: 0 }, noise: [0, 0.5],
    note: 'The clearest voice here. Crisp and even, easy to follow from across the room.' },
  { id: 'en_GB-cori-high', dir: 'en/en_GB/cori/high', name: 'Cori', accent: 'British', gender: 'Female', mb: 114,
    tone: { presence: 1.5, air: -6 }, noise: [0.4, 0.5],
    note: 'A warm British voice, recorded by an audiobook narrator.' },
  { id: 'en_GB-alan-medium', dir: 'en/en_GB/alan/medium', name: 'Alan', accent: 'British', gender: 'Male', mb: 63,
    tone: { presence: 2, air: -6 },
    note: 'A calm, steady British man\'s voice.' },
  { id: 'en_GB-alba-medium', dir: 'en/en_GB/alba/medium', name: 'Alba', accent: 'Scottish', gender: 'Female', mb: 63,
    tone: { presence: 1.5, air: -6 }, noise: [0.4, 0.5],
    note: 'A soft Scottish lilt. A smaller download and a touch less crisp than the others.' },
];

// Voices from before and the closest one now. The old effect voices
// (stadium, radio, trailer) were Lessac underneath, so their download is
// already there and they move over without downloading anything.
const RETIRED = {
  'fun-stadium': 'en_US-lessac-high',
  'fun-radio': 'en_US-lessac-high',
  'fun-trailer': 'en_US-lessac-high',
  'en_US-amy-medium': 'en_US-lessac-high',
  'char-poppy': 'en_GB-cori-high',
  'char-prudence': 'en_GB-cori-high',
  'char-spike': 'en_GB-alan-medium',
  'char-obadiah': 'en_GB-alan-medium',
  'scottish-male': 'en_GB-alan-medium',
  'en_US-ryan-high': 'en_GB-alan-medium',
};

// How fast the voice talks. Piper takes this when it starts (not per line),
// so a change restarts it. "clear" is a little slower, with longer pauses
// between sentences: easier in a room with echo or game music.
const PACES = {
  clear: { length: 1.1, gap: 0.35 },
  normal: { length: 1.0, gap: 0.25 },
};

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
  if (procVoice && procVoice.startsWith(model + '|')) stopProcess();
  fs.rmSync(modelPath(model), { force: true });
  fs.rmSync(modelPath(model) + '.json', { force: true });
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

function paceOf(pace) {
  return PACES[pace] ? pace : 'clear';
}

function startProcess(model, pace) {
  stopProcess();
  const exe = enginePath();
  const p = PACES[paceOf(pace)];
  const voice = CATALOG.find((v) => modelOf(v) === model);
  const steady = voice && voice.noise ? ['--noise_scale', String(voice.noise[0]), '--noise_w', String(voice.noise[1])] : [];
  proc = spawn(exe, ['--model', modelPath(model), '--json-input', '--quiet', '--output_dir', tmpDir(),
    '--length_scale', String(p.length), '--sentence_silence', String(p.gap), ...steady], {
    cwd: path.dirname(exe),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  procVoice = model + '|' + paceOf(pace);
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

// `pace` is 'clear' (the default) or 'normal'.
// One line at a time. Switching voice or pace restarts Piper, which would
// cut off a line still being made (an alert speaking while you pick another
// voice, change the pace or press a preview: the alert failed, or fell back
// to the computer's voice halfway through). So every line, and every warm
// start, waits its turn behind whatever is in progress.
let queue = Promise.resolve();
function inTurn(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

function synthesize(id, text, pace) {
  return inTurn(() => synthesizeNow(id, text, pace));
}

async function synthesizeNow(id, text, pace) {
  const v = voiceById(id);
  if (!v || !engineInstalled() || !voiceInstalled(id)) throw new Error("That voice isn't downloaded");
  const key = modelOf(v) + '|' + paceOf(pace);
  if (!proc || procVoice !== key) startProcess(modelOf(v), pace);
  counter += 1;
  const file = path.resolve(path.join(tmpDir(), `line-${Date.now()}-${counter}.wav`));
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const line = { text: clean, output_file: file };
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      jobs.delete(file);
      reject(new Error('The voice took too long'));
    }, 8000); // v0.54.3: was 20 s; past 8 s the computer's voice is the better choice
    jobs.set(file, { resolve, reject, timer });
  });
  proc.stdin.write(JSON.stringify(line) + '\n');
  await finished;
  const bytes = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return bytes;
}

function warm(id, pace) {
  return inTurn(() => {
    const v = voiceById(id);
    if (v && engineInstalled() && voiceInstalled(id) && procVoice !== modelOf(v) + '|' + paceOf(pace)) startProcess(modelOf(v), pace);
  });
}

function list() {
  return {
    available: Boolean(engineSpec()),
    engineInstalled: engineInstalled(),
    downloading,
    voices: CATALOG.map((v) => Object.assign({}, v, { installed: voiceInstalled(v.id) })),
  };
}

// A voice from an older version: what to use now. `to` is the closest new
// voice; `use` is the best one that's actually downloaded (the closest if
// it is, else any downloaded one), or null if none are.
function replacementFor(oldId) {
  const to = RETIRED[oldId] || CATALOG[0].id;
  const use = voiceInstalled(to) ? to : (CATALOG.find((v) => voiceInstalled(v.id)) || {}).id || null;
  return { to, use };
}

module.exports = {
  init,
  pruneUnused,
  CATALOG,
  RETIRED,
  PACES,
  replacementFor,
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
