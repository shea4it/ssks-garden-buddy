# Tests (not part of the app)

Plain Node, no Electron:

    node tests/store-test.js      # damaged settings.json -> newest backup; refused rename; coalesced async saves
    node tests/updater-test.js    # a download that fails to write rejects instead of hanging
    node tests/budget-test.js     # shop-feed counting, money flows, purchases, patterns, verdicts
    node tests/rooms-test.js      # room-count lookup answers: live, 404, odd body, server error; endpoint fallback
    node tests/alerts-test.js     # item alerts: game-id matching, one announcement per weather-shop opening, diagnostics, your own levels
    node tests/share-test.js      # room sharing: body shape, change/heartbeat cadence, stop, refusals
    node tests/garden-plan-test.js # the Garden map's to-do: binders' 8 tiles, cleanse / pot / wait / done, the 0.1 % bar, pots only where there's room
    node tests/voices-test.js     # the four voices, their tone and noise, retired voices -> closest new one, old downloads pruned

Refresh the community appearance rates from a newer #pingspam export
(DiscordChatExporter, JSON; hundreds of MB is fine, it streams):

    node tests/pingspam-rates.js "path/to/export.json"

and paste the printed BASELINE block into budget.js. Windows and clustering
rules are at the top of the script; if the game moves an item to another
shop, add a window for it.

End to end, in real Electron against a stand-in game (Linux, needs Xvfb):

    npm install electron@32.3.3 ws --no-save
    openssl req -x509 -newkey rsa:2048 -nodes -keyout tests/key.pem -out tests/cert.pem -days 2 \
      -subj "/CN=magicgarden.gg" -addext "subjectAltName=DNS:magicgarden.gg"
    setsid nohup node tests/stand-in-server.js > tests/server.out 2>&1 < /dev/null &
    XDG_CONFIG_HOME=$(mktemp -d) NODE_TLS_REJECT_UNAUTHORIZED=0 \
      MG_UPDATE_API=https://127.0.0.1:8443/releases/latest \
      MG_SHOPS_API=https://127.0.0.1:8443/platform/v1/shops \
      xvfb-run -a npx electron --no-sandbox tests/electron-harness.js
    cat tests/result.json

The harness runs the real main.js (the game's host is mapped to the stand-in
on 127.0.0.1:8443), waits for the Welcome and hatch backlog, pushes a stale
settings copy through settings:set, then the stand-in raises the game's own
numEggsHatched by 2 with no log entries. Expected in result.json:
`afterBacklog.lastEggsHatched` 40, `afterPatch` `{lastEggsHatched: 42,
totalHatches: 2}`, `whitelist.pityTotal` 0, `whitelist.rooms.saved` empty,
`errors` empty. The spending part (the stand-in serves a shop feed, its
player has 2B coins and 3B lifetime sales, and the harness seeds two hours of
money history, then sends a `PurchaseShopItem` for MoonCelestial from the game
page): `budget.day` earned 3B / spent 2.5B / kept 500M, level ok, tips room +
month; `recent` one Moonbinder Pod at 50B attributed to the moonbinder rule;
`moonbinderPattern` bought 1 of 1; `commandTypes` shows PurchaseShopItem;
`spotMap.timeline` with three entries: hidden (Carrot seed held), shown with
"198 open spots" (potted Tulip held), hidden again; `categories` with seeds
600B/day (one 50B buy inside a 2-hour window) and decor 0;
`plan` after starring Moonbinder: 1.5B of 50B, funded in ~8 days, next Amber
Moon in 2 h (the stand-in's forecast) short by ~48B, free 0, 1B = ~4 h; the
money box (`plan.hud`) shown in the game page with 5 lines, hidden after
`budgetHudSetting(false)`; the panel plan text and "★ in plan" star;
`tally`: the stand-in's state carries `shopPurchases` (egg: CommonEgg 1
at connect; a patch at 8 s adds LegendaryEgg 1); expected `recent` =
Legendary Egg 1 / 100M / rule legendaryegg and Common Egg 1 / 50K,
`legendaryPattern` bought 1 of 6 seen, `restockSeen` saved, `unlocked`
true with 26 h (the harness seeds 26 h of money history), tab shown,
progress line hidden, `budget.unlocked` saved; `locked` drives the panel's
locked state directly (sent back to Garden) and `relocked` shows the
unlock toast (the live refresh races the probe, so `tabHidden` may already
be false again).
`share`: turning "share my room" on sends one collect-state with
`room {id: TEST, playersCount, isPrivate}`, playerName and coins, no
userSlots and no state; turning it off sends one closing report without a
room (`afterOff.reports` 1, `last` has no room). Needs `MG_SHARE_API` set
to the stand-in.
`goldRate`: the stand-in's `__TestStat` hook raises the lifetime counters
(GoldGranter 500 → 503, RainbowGranter 140 → 141): expected
`settings.garden.hourly` [this hour: 3 gold, 1 rainbow, watched]. `__TestLog`
appends a live-format log entry (targetMutation 'Gold', growSlotsAffected,
petId/petSpecies, no pet object): `totalsAfter.gold` = before + 1.
`teams`: the Pets tab dropdown lists "Farm team ✓ out now — Worm", "Dawn
team — Bunny" and the card follows the choice; `stageInGarden` true.
`gold-rate.png` shows the chart with three days of made-up procs.

`pingspam-rates.js` now also measures the pinged decor (Wind Spinner,
Cauldron, Mini Wizard Tower, Mini Fairy Castle) for the "buy everything"
line.

**Benchmarks:** `node tests/bench-budget.js` times the Money calculations
with a heavy, realistic history (a month of readings, 400 shop items, 800
purchases): expect about 8 ms for the whole view, 5 for the forecast, 3 for
"buy everything", 6 for a what-if. `tests/bench-panel.js` times the panel's
renders in the real app (run it like the tour, with MG_SAMPLE; writes
`bench-panel.json`): about 4–6 ms per redraw with a 270-crop garden.

**Screenshot tour** (`tests/tour.js`): run it exactly like the harness but
with `tests/tour.js` in place of `tests/electron-harness.js`. It opens every
tab as a user first sees it (default folds), plus the Alerts tab unfolded,
puts the owner's garden numbers into the Money tab, scrolls through each tab
capturing every screenful into `$MG_TEST_DIR/tour/`, then
`python3 tests/stitch.py $MG_TEST_DIR/tour` lays them out three to an image
(`view-<tab>-<n>.png`) for looking at. Do this after any layout change.
Set `MG_SAMPLE=<path to a garden-sample.json>` to load a real garden's status
into every render (the Garden and Pets tabs then show real crops, pets,
teams and mutations instead of the stand-in's three crops).

**Restart the stand-in between runs**: it keeps its state in memory (locked
crops, pets out, weather), so a second run against the same server sees the
first run's changes (e.g. the Eggplants already locked, and the pet-food
guard has nothing to do).

Screenshots: the harness also renders the Spend-or-save card with the
owner's 0.34.0 sample numbers (36B wallet, 121/270 crops ready worth
410.7B, plus half a day of readings at ~2 crops an hour for the
estimate), a tight case (30B, 2B a day) and a 50B what-if, and saves
`money-real.png`, `money-real-growth.png`, `money-tight.png`,
`money-tight-growth.png`, `money-whatif.png`, `money-stage.png` (both
stage tracks with his garden: the moon is the bottleneck) in MG_TEST_DIR
(refreshes are paused while it does, or the live refresh replaces the
injected numbers). Look at them after any change to that card.
`prediction`: the harness seeds a lead-in and three synthetic 24-hour cycles
(garden 1B → 100B, harvested, sold ~100B; last harvest 30 h ago, then a
20K garden): expected 3 cycles, typical 24 h, last sold 100B, elapsed 30 h,
timing from the cycles (1 h, since the requirements can't say), value
source "floor" (the stand-in's live garden is tiny), the spend-up-to strip
all 0 (Save), the learned line in the Growth card.
`lifecycle`: the stand-in plants three crops on tile 5 (a ripe full-size
Carrot with Gold, Wet and Dawnlit; a ripe full-size Gold Carrot; an unripe
size-70 Pumpkin); under the full rule 1 of 3 is ready, the harvest time is
unknown (no size or gold pets) so growing crops aren't counted; with the
weather and moon parts switched off 2 of 3 are ready. `weatherTeams`: the
stand-in has saved teams A (pet-1, out) and B (pet-2) and swaps pets on
ApplyPetTeam; the game page's `__TestWeather` sets the weather. With Dawn →
teamB and nothing for clear: Dawn sends teamB (teamA remembered), Sunny
sends teamA back; Dawn again, a swap to teamA by hand, then Sunny sends
nothing.
`petFood` (auto-lock): the stand-in answers `ToggleLockItem` only when it
carries `species` (so the app has to try `itemId` first and move on), and
echoes the new locked list; expected: the game's own `SellAllCrops` refused
with `blocked_by_pet_food_guard`, `lockCommandsSent` 2, `lockField`
"species" (also saved in settings.harvestLock.lockField), Eggplant in
`lockedNow`, `serverGotSell` 1 (the app's re-sent sale), the "Kept your pet
food" banner and note, a `HarvestCrop` sent next still in sequence. The bag:
the stand-in's bag has pots of Tulip, Eggplant and Apple, and
crops Carrot ×12 (no pot), Eggplant ×5 (two loose, one stack of 3), Apple
×4 (favourited), Cactus ×2; with the guard on a `SellAllCrops` from the
game page never reaches the server (`guarded.serverGotSell` 0), the game gets
`blocked_by_pet_food_guard`, the banner shows, `guarded.saw` (the guard's
own record) reads produce 6 / pots 3 / food 4 / blocked Eggplant ×5, the
note names "Eggplant ×5" only, a `HarvestCrop` sent next still reaches the
server with a good sequence; guard off → the sale arrives;
`afford` with Windturner (pingspam baseline, level cut), Firepit (unknown,
app only) and Moonbinder (blended: 9 + 1 sightings, level yes);
`cardText` with the three boxes, the verdict, the afford rows and the pattern; settings.json
has 3 money points and 1 purchase, and no `earnHistory`/`budget` leftovers.
To stop a running stand-in: `pkill -f "stand-in-serv[e]r.js"` in a command
of its own (the bracket keeps the pattern from matching the shell running
it; never put it in the same command line as the `node stand-in-server.js`
that starts the new one, or the pattern matches that shell and kills it).
Then `pgrep -fa "stand-in-serv[e]r.js"` should print nothing. Killing by
port with `ss -ltnp` doesn't work here (no PIDs shown without root). `fuser -k` has been
seen to leave the old server running, and then a new one silently fails to
bind and you test against the old code.
Start the server with setsid/nohup: a plain `&` dies with the shell and every
later run then fails with ERR_CONNECTION_REFUSED (which looks exactly like
"the observer didn't install"). If the server complains about `ws`, point
NODE_PATH at a node_modules that has it.

**Sound and alerts (v0.50), end to end:** `tests/sound-harness.js` starts from
a v0.49 settings file (on the retired Radio voice, a custom "alarm" alert, Ube
removed, a few items "seen" in the shops) and checks the migration, the
Alerts tab (voice cards, adding / removing / levels / add-back / 🌙), what
every alert says, the new settings, real Piper speech and its pace flags,
loudness (sounds vs voice, rendered offline), and the game going quiet during
an alert. Screenshots go to `tests/shots/`. It needs the stand-in running (as
above) and, for real speech, Piper's Linux engine plus any Piper voice (the
old `v0.0.2/voice-en-us-lessac-medium.tar.gz` from Piper's GitHub releases
works; Hugging Face is blocked in the sandbox):

    curl -LO https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
    curl -LO https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-lessac-medium.tar.gz
    mkdir -p /tmp/pdir /tmp/lessac && tar xzf piper_linux_x86_64.tar.gz -C /tmp/pdir && tar xzf voice-en-us-lessac-medium.tar.gz -C /tmp/lessac
    XDG_CONFIG_HOME=$(mktemp -d) NODE_TLS_REJECT_UNAUTHORIZED=0 \
      MG_SHOPS_API=https://127.0.0.1:8443/platform/v1/shops MG_UPDATE_API=https://127.0.0.1:8443/releases/latest \
      MG_PIPER_DIR=/tmp/pdir MG_PIPER_MODEL=/tmp/lessac/en-us-lessac-medium.onnx \
      xvfb-run -a npx electron --no-sandbox tests/sound-harness.js
    cat tests/sound-result.json

Expected: `errors` and `console` empty; `migration` naturalVoice
en_US-lessac-high, retiredVoice fun-radio, voiceVolume gone, Lychee epic,
semaine pruned; six voice cards with Leah on; `dropdown`: 39 items in nine
groups (with the stand-in's feed; 38 without), dawnEgg/ubeSeed "picked",
kiwiSeed/moonPod/pedestal "disabled" (the feed lists Marble Pedestal at 2B,
which Decor over 500M covers; live prices win over the built-in list),
custom has `Dawn Egg:named:DawnEgg`, ubeBack true; every `ui` check true (kiwiBig
"big", dawnbinderLevel "basic", mainRules shows the new levels); `duck`
during true, after false, whenOff false; `speech.piperArgs` has
`--length_scale 1.1 --sentence_silence 0.35`; `speech.levels`: every sound 4.7-7.6 dB under the voice's loudest 400 ms
(with real Leah at 80 %: voice about -17, ding -24.5, chime -22.6, fanfare
-23.7, big fanfare -22.5, siren -21.6, klaxon -22.7); with `MG_PIPER_VOICES`,
`speech.perVoice` peaks about -4.6 to -5.7 dBFS and firstLoud ~0.0001 (the
fade), and `args:` shows Leah `--noise_scale 0`, Cori `0.4`, Alan Piper
defaults. Its
console ignores "cannot resume an offline context": that's the harness
swapping in an OfflineAudioContext to measure, not the app.
`MG_SOUND_CASE=fresh` (a new install: computer voice on, no note) and
`MG_SOUND_CASE=spike` (retired Spike, nothing downloaded, voice slider at 0:
No voice, no note) are short runs writing `sound-result-<case>.json`.

Gotcha (again): the full harness reads the stand-in's log, so start the
stand-in with `MG_TEST_DIR=/tmp/erun` and run the harness with the same.
Stop an old stand-in by its pid (from /proc), never with `pkill -f` from a
command line that contains the name.

**Voice audit (v0.50.2).** To check how the voices actually sound, line by
line. Hugging Face is blocked here; sherpa-onnx mirrors Piper's voices on
GitHub (with the .onnx.json):

    for v in en_US-lessac-high en_GB-cori-high en_GB-alan-medium en_GB-alba-medium; do
      curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-$v.tar.bz2
      tar xjf vits-piper-$v.tar.bz2; mkdir -p /tmp/models; cp vits-piper-$v/$v.onnx* /tmp/models/
    done

Some of the mirror's medium models are ONNX IR 9, which Piper 2023.11.14-2
can't load ("Unsupported model IR version: 9"): `pip install onnx`, load,
set `m.ir_version = 8`, save (the ops are opset 17 either way; the real
downloads from Hugging Face load as they are).

- `MG_PIPER_DIR=/tmp/pdir MG_PIPER_VOICES=/tmp/models node tests/voices-race.js`:
  lines in four voices and two paces at once, all delivered (the queue).
- `MG_PIPER_VOICES=/tmp/models` on the sound harness installs all four real
  voices (instead of the one stand-in) and adds `speech.perVoice`;
  `MG_SOUND_CASE=peaks` just measures each voice's peak after processVoice,
  through a lone limiter, and through the whole app path at 100 % and 80 %
  (expected: -1.5 and -4.6 dBFS or below; the voice skips the limiter).
- `python3 tests/voice-audit.py <folder of wavs> <presence> <air>` runs
  Piper output through an exact Python copy of processVoice and reports
  early starts, peaks and the energy above 7 kHz.
- What v0.50.2 used on top (pip, not in the repo): praat-parselmouth for
  pitch and harmonics-to-noise (`to_pitch_ac(..., octave_jump_cost=0.6)`;
  count a "squeak" only when a line holds 10+ semitones above its median
  for 50 ms+, or tracker octave errors look like squeaks), and sherpa-onnx
  with Whisper small.en (`asr-models/sherpa-onnx-whisper-small.en.tar.bz2`
  from the same releases) to transcribe every clip. Render each line several
  times: Piper is random, so one render proves little. Whisper merges
  repeated phrases and doesn't know the game's words; read its transcripts
  rather than trusting the error rate.

**Charts (v0.51).** `tests/chart-shots.js` sets up the Money forecast and
Mutations over time in several data scenarios, screenshots each into
`tests/shots/chart-*.png`, measures every label and dot for overlaps
(including text that merely touches, and text off the chart), and hovers the
plot and the icons. With the stand-in running (restart it first):

    XDG_CONFIG_HOME=$(mktemp -d) NODE_TLS_REJECT_UNAUTHORIZED=0 MG_CHART=all \
      MG_SHOPS_API=https://127.0.0.1:8443/platform/v1/shops MG_UPDATE_API=https://127.0.0.1:8443/releases/latest \
      xvfb-run -a -s "-screen 0 1280x1000x24" npx electron --no-sandbox tests/chart-shots.js
    cat tests/chart-result.json

`MG_CHART` is `money`, `mut` or `all`. Expected: `errors` and `console`
empty; every scenario's `overlaps` and `outside` empty and `nativeTitles`
0; `scenarios.week.hover.iconSeen` has a chartTip naming the want and no
nativeTitle; `whatIf.hasWithout` true; `mut.recorded` a real reading;
`mut.untick` blueLines 0, blueBands 0, saved.hydro false; `mut.range.hours`
72; `mut.day.hover.gap` says "Not watched"; `mut.day.hover.aheadSeen`
names a Rain; `mut.realInput.pageEverMoved` false (real mouse clicks and
Space on every box: the panel page must never scroll), and
`mut.realInput.net.page` 0. Look at the screenshots too: the detector can't judge
whether a chart reads well.

`MG_CHART=map` (or `all`) adds the Garden map: `map.real` has the stand-in's
plant ("Carrot: wait"); `map.views` todo / value / spots each with no
`hits` or `outside` and `saved` equal to the view; `map.tiles` cleanse / pot
/ binder / wait / egg each name the right thing (the binder says "7 of the
8 have a plant"); `map.page` 0. Screenshots: chart-map-*.png.

`MG_CHART=moneycard` screenshots the whole Spend or save? section and the
sentence under the number in three states: `moneycard.why.free` ("covers
all your wants"), `setAside` ("74.1B of it is set aside for the
Moonbinder"), `short` ("29.1B short for the Moonbinder"); `howOpen` and
`howStaysOpen` true; `page` 0.

`MG_CHART=ux` checks three spots a new player sees: `ux.history` collapses
repeats ("Legendary Egg in stock ×5 …"), `ux.mapDefault` is "spots" with
no binder and `ux.todoNoBinder` explains the empty To-do, and `ux.engine`
is a sentence rather than "— a day".

`MG_CHART=luck`: `luck.late.hero` is "🦫 | 🎉 It's yours next | Capybara 1
in 20 | Guaranteed on your next Mythical Egg! | 39 Mythical Eggs without a
Capybara so far"; `luck.late.rows` start 🔥 Phoenix (4 more Amber Eggs),
🌅 Dawnbreaker Spore, 👑 Embercrown; `luck.fresh.hero` is the Capybara
(estimate); `gold` false and no `hits` in either; `luck.late.chips` starts
with the Mythical Egg and the Amber Egg.

Mutations over time (`MG_CHART=mut`): `mut.splitAll.paths` has the eight
separate colours (Rainbow as `url(#mutRainbow)`) and `endLabels` 0;
`mut.oldHistory.note` says the separate lines start from this update and
`subPaths` is 0; `mut.recorded` has w, ch, f, th, d, a, g, r.

`MG_CHART=alerts`: `alerts.amberShop.log` is sounds, then one "say: Amber
alert! The Amber shop is open. In stock: Moonbinder, Dawnbinder,
Starweaver, an Amber Egg and Emberbloom.", "say: Once more: Moonbinder,
Dawnbinder and Starweaver.", one Gold-proc sound and the Capybara hatch;
`oneItem` is "Dawnbreaker! Dawnbreaker is in the shop."; `splitArrival` is
one announcement. `MG_CHART=binder`: `binder.amber.text` starts "Amber Moon
· binder map" and counts "1 binding · 3 to move in · 2 Dawn to swap out ·
2 open spots", `pulses` 5; `dawnNoBinder`, `switchedOff`, `ended` null;
`observerOff` false and `observerOn` true; `dawnCalm.pulses` 0, and
`dawnSwap` 10 pulses with `purpleGlowPulses` 10 and `orangePulses` 0.
Screenshots: shots/binder-amber.png, binder-dawn-calm.png, binder-dawn-swap.png.

`MG_CHART=owner` runs the owner's garden (tests/fixtures/garden-layout.json):
`owner.todo` "2 to cleanse | Worth up to +8.3B.", `owner.tile107` says
"Cleanse its fruit" (+7.7B) with the Dawnbinder note, `binderOutlines` 5;
`owner.dawn` "4 binding" with 0 pulses; `owner.amber` "4 binding · 5 to move
in · 1 Dawn to swap out".

`MG_CHART=alerts` also: `alerts.dawnUbe.log` starts "sound 2.6s", "sound
1.4s", "say: Dawn shop! The Dawn shop is open. In stock: Ube."; `trail.panel`
has "played" reports (one with ["Dawn", "Ube"]), `trail.main` "sent"
entries from the stand-in's shop, `trail.settings` the alert settings.

`MG_CHART=thunder`: `thunder.wolfOut.text` "⚡ Thunderstruck finder 7 left 7
Thunderstruck crops on 5 plants · 223 Thundercharged…"; `noWolf`,
`duringAmber` (with `binderUp` true), `switchedOff`, `allCharged` null;
`afterAmber` shown again; `observerOff` false, `observerOn` true.
Screenshot: shots/thunder-finder.png.

`MG_CHART=mount`: `mount.ostrich.text` "🐦 Riding the Ostrich 88 capsules 46
Dawn crops…" with `pulses` 3; `mount.phoenix` "386 capsules · 200 Amber
crops" with 0; `notRiding`, `switchedOff`, `thunderWhileRiding` null and
`thunderBack` true; `dragged.rect` moved by (-300, -240) with `saved` {x, y};
`forgot` false then `restored` fixed at the same spot; `docked` not fixed and
`savedAfter` null. Screenshots: shots/mount-ostrich.png, mount-phoenix.png.
