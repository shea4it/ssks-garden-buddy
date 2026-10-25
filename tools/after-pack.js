'use strict';

/* The Windows app's own icon and name (v0.64.1).
 *
 * BUILD.bat builds with signAndEditExecutable off, because electron-builder's
 * winCodeSign download won't unpack on the owner's PC (see HANDOFF, build
 * quirks). That also leaves Electron's atom icon and the name "Electron" on
 * the .exe, so the desktop shortcut, Start menu, taskbar and Task Manager
 * showed Electron. This runs after the app is packed and before the
 * installer is made, and puts our icon (build/icon.ico) and name on the
 * .exe with resedit, a plain-JavaScript resource editor: nothing to download,
 * nothing to run.
 *
 * Never a failed build over an icon: anything that goes wrong is logged and
 * the original .exe is kept as it was.
 */
const fs = require('fs');
const path = require('path');

const log = (msg) => console.log(`  • ${msg}`);

async function loadResEdit() {
  // resedit is an ES module; its CommonJS entry loads it.
  return require('resedit/cjs').load();
}

function versionParts(v) {
  const p = String(v || '0').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  while (p.length < 4) p.push(0);
  return p.slice(0, 4);
}

async function brandExe(exePath, icoPath, info) {
  const ResEdit = await loadResEdit();
  const original = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(original, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  // The icon: every icon group Electron's .exe has (one, usually) gets ours.
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const icons = iconFile.icons.map((item) => item.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (groups.length) {
    for (const g of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons);
  } else {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
  }

  // The name: Task Manager, the file's Properties and Windows' own lists
  // read these (they said "Electron").
  const [a, b, c, d] = versionParts(info.version);
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const langs = vi.getAllLanguagesForStringValues();
  if (!langs.length) langs.push({ lang: 1033, codepage: 1200 });
  for (const l of langs) {
    vi.setFileVersion(a, b, c, d, l.lang);
    vi.setProductVersion(a, b, c, d, l.lang);
    vi.setStringValues(l, {
      FileDescription: info.productName,
      ProductName: info.productName,
      InternalName: info.productName,
      OriginalFilename: path.basename(exePath),
      CompanyName: info.companyName || '',
      LegalCopyright: info.copyright || '',
    });
  }
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  const out = Buffer.from(exe.generate());

  // Check the new file reads back with our icon before it replaces the old.
  const check = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(out));
  const back = ResEdit.Resource.IconGroupEntry.fromEntries(check.entries);
  if (!back.length || back[0].icons.length !== icons.length) throw new Error('the edited app did not read back right');
  const tmp = `${exePath}.icon-tmp`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, exePath);
  return { sizes: iconFile.icons.map((i) => i.width || 256), groups: back.length };
}

exports.brandExe = brandExe;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const appInfo = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico');
  try {
    if (!fs.existsSync(exePath)) throw new Error(`no ${path.basename(exePath)} in the packed app`);
    if (!fs.existsSync(icoPath)) throw new Error('no build/icon.ico');
    await brandExe(exePath, icoPath, {
      productName: appInfo.productName,
      companyName: appInfo.companyName,
      copyright: appInfo.copyright,
      version: appInfo.version,
    });
    log(`gave ${path.basename(exePath)} the Garden Buddy icon and name`);
  } catch (err) {
    log(`couldn't put the icon on the app (${err && err.message ? err.message : err}); it still works, with Electron's icon`);
    try {
      fs.rmSync(`${exePath}.icon-tmp`, { force: true });
    } catch (e) {}
  }
};
