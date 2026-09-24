#!/bin/bash
# SSK's Garden Buddy builder for macOS. Double-click this file in Finder
# (the first time: right-click it, choose Open, then Open again).
# It builds the app for this Mac, puts it in your Applications folder, and
# opens it. Your settings live in ~/Library/Application Support and carry over.

cd "$(dirname "$0")" || exit 1
EV="32.3.3"
APPNAME="SSK's Garden Buddy"

fail() {
  echo
  echo "  Something went wrong. Scroll up to find the error, and paste it to Claude."
  echo
  read -r -p "  Press Return to close this window. " _
  exit 1
}

echo
echo "  SSK's Garden Buddy builder (Mac)"
echo "  ================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js isn't installed on this Mac."
  echo "  Install the LTS version from https://nodejs.org and then run this again."
  echo
  read -r -p "  Press Return to close this window. " _
  exit 1
fi

ARCH="$(uname -m)"
[ "$ARCH" = "x86_64" ] && ARCH="x64"
AV="$(node -p "require('./package.json').version")"

echo "  Step 1 of 4: installing packages..."
npm install --no-audit --no-fund --loglevel=error || fail

if [ ! -d "node_modules/electron/dist/Electron.app" ]; then
  echo "  Step 2 of 4: downloading Electron $EV for $ARCH, about 100 MB..."
  mkdir -p node_modules/electron/dist
  curl -L --fail -o electron.zip "https://github.com/electron/electron/releases/download/v$EV/electron-v$EV-darwin-$ARCH.zip" || fail
  ditto -x -k electron.zip node_modules/electron/dist || fail
  rm -f electron.zip
  printf "Electron.app/Contents/MacOS/Electron" > node_modules/electron/path.txt
else
  echo "  Step 2 of 4: Electron is already in place."
fi

echo "  Step 3 of 4: building version $AV..."
rm -rf release
npx electron-builder --mac dir "--$ARCH" --publish never -c.mac.identity=null || fail

BUILT="$(find release -maxdepth 2 -name "$APPNAME.app" -type d | head -1)"
[ -n "$BUILT" ] || fail

# The app isn't signed by a paid Apple developer account. A local "ad-hoc"
# signature is what Apple Silicon Macs need to run it at all.
codesign --force --deep --sign - "$BUILT" >/dev/null 2>&1

echo "  Step 4 of 4: installing into Applications..."
osascript -e "tell application \"$APPNAME\" to quit" >/dev/null 2>&1
sleep 1
rm -rf "/Applications/$APPNAME.app"
# The app's old name, from before v0.22 (its settings move over by themselves).
osascript -e 'tell application "Magic Garden Loader" to quit' >/dev/null 2>&1
rm -rf "/Applications/Magic Garden Loader.app"
ditto "$BUILT" "/Applications/$APPNAME.app" || fail

# A zip for another Mac (your girlfriend's laptop, say).
ditto -c -k --keepParent "$BUILT" "release/$APPNAME $AV (Mac $ARCH).zip"

open "/Applications/$APPNAME.app"
echo
echo "  Done. The app is in your Applications folder and is opening now."
echo "  For another Mac, use the zip in the release folder (see README)."
echo
read -r -p "  Press Return to close this window. " _
exit 0
