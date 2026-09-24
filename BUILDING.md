# Building it yourself

Most people should just download the installer from the
[Releases page](../../releases/latest). This is for building from the code.

## Windows

1. Install Node.js (the LTS version) from https://nodejs.org, once.
2. Download the code (the green **Code** button, then **Download ZIP**) and
   extract it somewhere, say `Documents\ssks-garden-buddy`.
3. Double-click **BUILD.bat**. If Windows warns you, click
   **More info → Run anyway**.
4. Wait for it to finish. The app installs and opens by itself. The installer
   it made is in the `release` folder (`SSKs-Garden-Buddy-Setup-<version>.exe`),
   ready to copy to another computer.

To update, extract the newer code over the same folder (say yes to replacing
files) and run BUILD.bat again. Settings, egg counts and scripts live in the
app's own data folder, not the code folder, so updates never touch them.

## Mac

1. Install Node.js (the LTS version) from https://nodejs.org, once.
2. Download the code and unzip it into a folder, say `Documents/ssks-garden-buddy`.
3. Right-click **BUILD.command**, choose **Open**, and click **Open** again.
   (macOS asks this the first time because the file didn't come from the App
   Store. After that, a double-click works.) If nothing happens at all, open
   Terminal, type `bash ` (with a space), drag BUILD.command into the window,
   and press Return.
4. Wait for it to finish. The app lands in your Applications folder and opens.

The build also leaves a zip of the app in the `release` folder for another
Mac: unzip it, drag the app into Applications, then right-click it and choose
**Open** the first time.

## Releases

Publishing a release on GitHub builds the installers automatically
(`.github/workflows/release.yml`): a Windows installer and Mac disk images for
Apple Silicon and Intel, attached to the release. They aren't code-signed, so
Windows and macOS show a warning the first time (see the README).
