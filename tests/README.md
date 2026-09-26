# Tests (not part of the app)

Plain Node, no Electron:

    node tests/store-test.js      # damaged settings.json -> newest backup; refused rename; coalesced async saves
    node tests/updater-test.js    # a download that fails to write rejects instead of hanging
    node tests/budget-test.js     # shop-feed counting, money flows, purchases, patterns, verdicts
    node tests/rooms-test.js      # room-count lookup answers: live, 404, odd body, server error; endpoint fallback
    node tests/alerts-test.js     # item alerts: game-id matching, one announcement per weather-shop opening, diagnostics
    node tests/share-test.js      # room sharing: body shape, change/heartbeat cadence, stop, refusals

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
