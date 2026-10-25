# The app's icon

A cheerful terracotta pot with a sprout, smiling, in front of a rainbow on an
evening sky: the garden, Gold (the sparkle) and Rainbow, and the panel's
evening colors. Drawn for this app; nothing is taken from the game.

- `master.svg`: the big drawing (1024, the tile is 896 with a 64 margin).
  Parts wrapped in `<!--d-->…<!--/d-->` are details left out at small sizes.
- `big.py`: makes the Windows tile (`win.svg`, nearly full size), the version
  with fewer details (`winmid.svg`, 40 to 96 px) and Apple's grid
  (`mac.svg`, `macmid.svg`: 824 of 1024 with a soft shadow) from the master.
- `small.py`: the 32, 24 and 16 px drawings, each drawn on its own pixel grid
  so they stay sharp (`s32.svg`, `s24.svg`, `s16.svg`; 16 is used at 20 too).
- `make_icons.py`: renders every size with Chromium (Python Playwright) and
  packs `icon.ico` (16, 20, 24, 32, 40, 48, 64, 96, 128 as 32-bit BMP, 256 as
  PNG), `icon.icns` and `icon.png` (1024).

To change the icon: edit the SVGs, run
`python3 small.py && python3 big.py && python3 make_icons.py out`, then copy
`out/icon.ico`, `out/icon.icns` and `out/icon.png` to `build/`, and
`out/icon.ico` and `out/app-icon.png` to `art/` as `app-icon.ico` and
`app-icon.png`.
