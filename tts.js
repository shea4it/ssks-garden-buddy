'use strict';

// Windows' built-in speech (what the voice normally uses) always talks through
// the default speaker. To send the voice to a chosen speaker, the app asks
// Windows to render each line into a WAV clip instead, then plays that clip
// itself. This runs one small, hidden PowerShell process that stays open, so
// each line takes a fraction of a second instead of starting PowerShell every
// time. If anything here fails, the caller falls back to normal speech.

const { spawn } = require('child_process');

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $wanted = [string]$req.voice
    $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
      Where-Object { $wanted -and ($wanted -eq $_.DisplayName -or $wanted.StartsWith($_.DisplayName + ' ')) } |
      Select-Object -First 1
    if ($voice) { $synth.Voice = $voice }
    try {
      $synth.Options.SpeakingRate = [double]$req.rate
      $synth.Options.AudioPitch = [double]$req.pitch
    } catch { }
    $stream = Await ($synth.SynthesizeTextToStreamAsync([string]$req.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $size = [uint32]$stream.Size
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $null = Await ($reader.LoadAsync($size)) ([uint32])
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    $reader.Dispose()
    $stream.Dispose()
    [Console]::Out.WriteLine((@{ id = $id; ok = $true; wav = [Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ id = $id; ok = $false; error = [string]$_.Exception.Message } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
`;

let forced = null;
let proc = null;
let ready = false;
let buffer = '';
let nextId = 1;
let starts = 0;
let lastError = null;
const pending = new Map();

function supported() {
  if (forced !== null) return forced;
  return process.platform === 'win32';
}

function clamp(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function failAll(message) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(message));
  }
  pending.clear();
}

function handleLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    return;
  }
  if (msg.ready) {
    ready = true;
    return;
  }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.ok && msg.wav) p.resolve(Buffer.from(msg.wav, 'base64'));
  else p.reject(new Error(msg.error || 'Speech failed'));
}

function start() {
  if (proc || !supported()) return;
  // Give up after a few crashed starts rather than respawning forever.
  if (starts >= 4) return;
  starts += 1;
  ready = false;
  buffer = '';

  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
  try {
    proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    lastError = String(err.message || err);
    proc = null;
    return;
  }

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) handleLine(line);
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (d) => {
    lastError = String(d).slice(0, 400);
  });
  proc.stdin.on('error', () => {});
  proc.on('error', (err) => {
    lastError = String(err.message || err);
  });
  proc.on('exit', () => {
    proc = null;
    ready = false;
    failAll('The speech helper stopped');
  });
}

function synthesize(req) {
  if (!supported()) return Promise.reject(new Error('Not available on this computer'));
  start();
  if (!proc) return Promise.reject(new Error(lastError || 'The speech helper could not start'));

  const id = nextId++;
  const payload = {
    id,
    text: String((req && req.text) || '').slice(0, 400),
    voice: String((req && req.voice) || ''),
    pitch: clamp(req && req.pitch, 0, 2, 1),
    rate: clamp(req && req.rate, 0.5, 6, 1),
  };

  return new Promise((resolve, reject) => {
    // The very first line waits for PowerShell to start, so it gets longer.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The speech helper took too long'));
    }, ready ? 8000 : 20000);
    pending.set(id, { resolve, reject, timer });
    try {
      proc.stdin.write(JSON.stringify(payload) + '\n');
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err);
    }
  });
}

function warm() {
  if (supported()) start();
}

function stop() {
  if (!proc) return;
  try {
    proc.stdin.end();
    proc.kill();
  } catch (err) {
    /* already gone */
  }
  proc = null;
}

function status() {
  return { supported: supported(), running: Boolean(proc), ready, lastError };
}

module.exports = {
  synthesize,
  warm,
  stop,
  status,
  supported,
  // For the test harness only: pretend to be (or not be) Windows.
  _forceSupported(value) {
    forced = value;
  },
  _script: PS_SCRIPT,
};
