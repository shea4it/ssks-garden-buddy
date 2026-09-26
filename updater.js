'use strict';

// Updates, from the app's GitHub releases.
//
// Checking asks GitHub's public API for the newest release (the same one the
// download page's buttons give). Nothing is installed without the player
// pressing Update now. The download is checked against the size GitHub lists
// and, when GitHub provides one, the file's SHA-256 fingerprint, so a broken
// or tampered download is never run.
//
// Windows runs the new installer (it replaces the app and reopens it; settings
// live elsewhere and stay). Macs open the downloaded disk image for the player
// to drag into Applications: without a paid Apple certificate, macOS doesn't
// let an app replace itself.

const fs = require('fs');
const crypto = require('crypto');

const REPO = 'shea4it/ssks-garden-buddy';
const API_URL = process.env.MG_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE_URL = 'https://shea4it.github.io/ssks-garden-buddy/';

const ASSETS = {
  win32: 'SSKs-Garden-Buddy-Windows.exe',
  darwin: 'SSKs-Garden-Buddy-Mac.dmg',
};

// "v0.22.1-beta" -> [0, 22, 1]
function parseVersion(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// > 0 when a is newer than b.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Release notes as a few lines of plain text (they're written in Markdown).
function plainNotes(body) {
  return String(body || '')
    .replace(/\r/g, '')
    .replace(/[#*_`>]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join('\n')
    .slice(0, 900);
}

// What GitHub says about the newest release, for this computer.
async function check({ currentVersion, platform, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  const res = await doFetch(API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `SSKs-Garden-Buddy/${currentVersion}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return { available: false, latest: null, reason: 'No release published yet.' };
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const rel = await res.json();
  const latest = String(rel.tag_name || rel.name || '').trim();
  const newer = compareVersions(latest, currentVersion) > 0;
  const wanted = process.env.MG_UPDATE_ASSET || ASSETS[platform];
  const asset = (rel.assets || []).find((a) => a && a.name === wanted) || null;
  let sha256 = null;
  if (asset && typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(asset.digest)) sha256 = asset.digest.slice(7).toLowerCase();
  const bare = latest.replace(/^v/, '');
  return {
    available: newer,
    latest: bare,
    // "0.23.0-beta" reads better as "0.23.0 (beta)".
    display: bare.replace(/-([a-z]+)[.\d]*$/i, ' ($1)'),
    title: String(rel.name || latest),
    notes: plainNotes(rel.body),
    pageUrl: rel.html_url || PAGE_URL,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: Number(asset.size) || null, sha256 } : null,
  };
}

// Waits for a write stream to catch up. If it fails instead (disk full, say),
// this rejects rather than waiting forever for a 'drain' that never comes.
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

// Downloads to dest, reporting progress, then checks size and fingerprint.
async function download({ asset, dest, onProgress, fetchImpl }) {
  const doFetch = fetchImpl || fetch;
  const res = await doFetch(asset.url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status})`);
  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let lastReport = 0;
  try {
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk);
      hash.update(buf);
      got += buf.length;
      if (!out.write(buf)) await drained(out);
      if (onProgress && Date.now() - lastReport > 250) {
        lastReport = Date.now();
        onProgress(got, total);
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  if (asset.size && got !== asset.size) {
    fs.rmSync(tmp, { force: true });
    throw new Error("The download didn't finish properly. Try again.");
  }
  const digest = hash.digest('hex');
  if (asset.sha256 && digest !== asset.sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error("The download didn't match what GitHub published, so it wasn't used. Try again later.");
  }
  fs.rmSync(dest, { force: true });
  fs.renameSync(tmp, dest);
  if (onProgress) onProgress(got, total || got);
  return { path: dest, bytes: got, sha256: digest, verified: Boolean(asset.sha256) };
}

module.exports = { check, download, compareVersions, parseVersion, plainNotes, ASSETS, API_URL, PAGE_URL, REPO };
