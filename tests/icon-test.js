'use strict';
// The app's icon (v0.64.1): the files electron-builder and the app use are
// there and well formed, and the build is wired to put the icon on the
// Windows .exe (tools/after-pack.js). Plain Node, no packages.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let n = 0;
const ok = (cond, what) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  n += 1;
};

// icon.ico: every size Windows asks for; 256 as PNG, the rest 32-bit BMP.
function readIco(file) {
  const b = fs.readFileSync(file);
  ok(b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1, `${path.basename(file)} is an icon file`);
  const count = b.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const e = 6 + i * 16;
    const size = b[e] || 256;
    const len = b.readUInt32LE(e + 8);
    const off = b.readUInt32LE(e + 12);
    const data = b.subarray(off, off + len);
    const png = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const bpp = png ? 32 : data.readUInt16LE(14);
    const w = png ? data.readUInt32BE(16) : data.readInt32LE(4);
    out.push({ size, png, bpp, w, end: off + len <= b.length });
  }
  return out;
}
const want = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
for (const file of ['build/icon.ico', 'art/app-icon.ico']) {
  const icons = readIco(path.join(root, file));
  ok(want.every((s) => icons.some((x) => x.size === s)), `${file} has ${want.join(', ')}`);
  ok(icons.every((x) => x.end && x.w === x.size && x.bpp === 32), `${file}: every image whole, its own size, 32-bit`);
  ok(icons.every((x) => x.png === (x.size === 256)), `${file}: 256 is PNG, the rest BMP (what NSIS and old Windows read)`);
}
ok(fs.readFileSync(path.join(root, 'build/icon.ico')).equals(fs.readFileSync(path.join(root, 'art/app-icon.ico'))), 'the app and the installer use the same icon');

// icon.icns: Apple's sizes, all PNG.
{
  const b = fs.readFileSync(path.join(root, 'build/icon.icns'));
  ok(b.toString('ascii', 0, 4) === 'icns' && b.readUInt32BE(4) === b.length, 'icon.icns is whole');
  const kinds = [];
  for (let o = 8; o < b.length; o += b.readUInt32BE(o + 4)) kinds.push(b.toString('ascii', o, o + 4));
  ok(['icp4', 'icp5', 'ic07', 'ic08', 'ic09', 'ic10'].every((k) => kinds.includes(k)), `icon.icns has 16 to 1024 (${kinds.join(' ')})`);
}

// PNGs: the 1024 for electron-builder, the 256 for the app's windows.
const pngSize = (file) => fs.readFileSync(path.join(root, file)).readUInt32BE(16);
ok(pngSize('build/icon.png') === 1024, 'build/icon.png is 1024');
ok(pngSize('art/app-icon.png') === 256, 'art/app-icon.png is 256');

// The build: icons named, art packed and unpacked, the hook there, resedit
// a build tool (not shipped inside the app).
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const b = pkg.build;
ok(b.win.icon === 'build/icon.ico' && b.mac.icon === 'build/icon.icns' && b.nsis.installerIcon === 'build/icon.ico', 'the icons are named in the build');
ok(b.files.includes('art/app-icon.ico') && b.files.includes('art/app-icon.png') && (b.asarUnpack || []).includes('art/app-icon.*'), 'the app carries its icon, unpacked');
ok(fs.existsSync(path.join(root, b.afterPack)), 'the after-pack hook exists');
ok(pkg.devDependencies.resedit && !(pkg.dependencies || {}).resedit, 'resedit is a build tool only');
ok(!fs.existsSync(path.join(root, 'icons')), 'no "icons" folder (electron-builder takes it for the app icon)');
const hook = require(path.join(root, b.afterPack));
ok(typeof hook.default === 'function' && typeof hook.brandExe === 'function', 'the hook exports what electron-builder calls');

console.log(`icon: ${n} checks passed`);
