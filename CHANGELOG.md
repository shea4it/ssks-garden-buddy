# Changelog

What changed in each version, in plain words. The app checks for new
versions by itself; press **Update now** when it tells you.

## 0.74.1 (beta)
- **A weather team suggestion goes away when its weather does.** Away for a
  whole spell of weather, you came back to "Put out your rain team?" under
  clear skies. Now the card on the game, the banner in the panel and the
  desktop notification all clear once that weather is over (or turns into
  another one). A "go back to your team" suggestion after the weather goes
  the same way if new weather starts.
- A team trigger's suggestion is no longer replaced by the weather team's on
  the very next update.

## 0.74.0 (beta)
- **Gold and Rainbow pets are counted per egg.** The game's own Bad Luck
  Protection help says every egg tracks its own counter for each outcome,
  and that nothing is account-wide. The app had Gold and Rainbow pets as
  one count across every egg, so it could say a Gold was due on any egg
  when it was only due on the egg you'd been hatching.
  - Each egg's line on the Luck tab now has its own **Gold pet** (by 200
    of that egg) and **Rainbow pet** (by 2,000 of that egg). The hatch
    warning, egg locks, Home and the heads-ups name the egg ("Your next
    Common Egg is a guaranteed Gold pet").
  - The old every-egg counts can't be split by egg, so each egg's Gold and
    Rainbow start at "waiting for the first one" and count from that egg's
    next Gold or Rainbow. The old numbers are kept aside, unused. If you
    know an egg's count, type it in its box.
- **When two guarantees land at once, the rarer one wins and the other
  waits**, as the game's help says. A Rainbow while Gold was due, a Phoenix
  while the Fire Horse was due, or a Dawnbreaker Spore while the Ube Seed
  was due no longer makes the app think it lost count: the other one stays
  due and keeps counting. A rare pet and Gold or Rainbow are separate rolls,
  so one hatch can still force both.

## 0.73.1 (beta)
- **Lighter on the game while you move plants around.** Every pot and
  replant changes the garden, and the app's corner map, swap button,
  quick-plant button and action bar used to re-measure the game's page
  several times a second to place themselves (on top of a twice-a-second
  look for the Pet Hutch window). Each re-measure makes the browser lay
  the whole game page out again. Now they're placed only when something
  that moves them changes (the window size, where you dragged them), and
  the Pet Hutch look only happens while you're swapping pets. In a test
  garden the size of yours, the app's work on the game page while potting
  went from about 4 seconds a minute to under 1.
- **A saved sample now says how long the app's own work takes**: its time
  on each game report, any pauses in the app, and the game page's long
  pauses with how much of each was the app. If the game ever freezes
  again, a sample taken right after shows whether it was the app or the
  game.

## 0.73.0 (beta)
- **A pet team for harvesting.** Garden tab → Harvest, under Harvesting
  unlocked: pick one of your saved teams, and it goes out when you turn
  Harvesting unlocked on (the switch, the 🧺 up top, Ctrl+Shift+M or the
  action bar).
  - **Put my pets back when I turn it off** (on by default): when you lock
    harvesting again, the pets you had out before come back. If you've
    changed pets while harvesting, they're left as you set them.
  - Each turn is one swap from your own press, and Recent alerts notes it.
- The 🔁 swap button counts a team put out by the app (Put out, Apply, a
  weather or harvest team) as soon as it's out, so pressing 🔁 afterwards
  goes back to what you had before.

## 0.72.2 (beta)
- **The 🔁 swap button works the way you'd expect.**
  - **No waiting.** A new set of pets counts as your team the moment
    you're done: when you close the Pet Hutch window, when a whole team
    goes out (one of your saved teams, or the button's own swap), when you
    do something else (harvest, plant, buy, sell…), or when you press the
    button. It no longer waits 20 seconds first.
  - **Swapping one by one never counts the in-between pets.** While the
    Pet Hutch is open nothing counts, so the button still names the team
    you had before you started.
  - **No lockout.** The "too many swaps in a short time" limit is gone,
    for the button, Ctrl+Shift+T, the action bar and Put out. Two presses
    at the same instant still wait for the first swap to land ("Still
    swapping: one moment") so pets don't get half-moved.

## 0.72.1 (beta)
- **Counts you typed are back.** 0.72.0 reset every luck counter that
  hadn't had its result yet, including counts you'd typed in yourself
  (kept by hand from before you used the app). That was a mistake: a count
  you tracked is a real count, not a guess.
  - The first time 0.72.1 starts, it finds your newest daily backup from
    before 0.72.0, takes the counts you typed from it, and adds every pull
    the app has counted since. A note in Recent alerts lists what came
    back. A count that would now be past its guarantee stays waiting, since
    it can't be right.
  - Coming straight from 0.71 or earlier, nothing is lost: typed counts
    are kept as they are.
- **You can type your own count again.** Open an egg, plant or capsule on
  the Luck tab and type your misses since your last one in its box,
  including on a line that's waiting for the first one. It's marked "your
  count" and counts on from there until the app sees the result itself.
  Clear the box to go back to waiting.

## 0.72.0 (beta)
- **Luck counters only count what the app has seen.** A counter now starts
  the first time the app sees that result happen: your first Gold pet,
  your first Thunder Wolf, your first Dawnbreaker Spore. Only then does it
  know the game's own count is back at zero, so from there its number
  matches the game's. Until then the line says **waiting for the first
  one**, with no number and no countdown, and it never sets off the hatch
  warning or a "next one is guaranteed" heads-up.
  - Before, a counter the app hadn't seen reset was a guess (started at
    zero, or halfway for accounts from before the September update), and a
    guess can be off in either direction: a Gold pet "due" that wasn't, or
    one that came early.
  - Counters that have already reset since the app started counting keep
    their number. Ones that never have go to waiting.
  - If a counter ever goes past its guarantee without the result (some
    pulls went unseen), it goes back to waiting instead of counting on.
  - Typing your own "misses so far", the "My account played before the
    update" switch and the matching setup question are gone: the app no
    longer needs either.
- **Home says "max net worth".** It's your coins plus your garden sold at
  the most you could get for it (a full room and your best sell pets out),
  so it's higher than the net worth on the game overlay, which counts the
  garden at its plain price. Hover it for the explanation.

## 0.71.0 (beta)
- **New user setup.** The first time the app opens, a short setup walks a
  new player through everything it needs to know, one screen at a time
  (about a minute):
  1. How far along your garden is (or let the app work it out), and
     whether the account played before the September update (for the luck
     counters).
  2. Which shop items to watch for.
  3. How alerts sound: volume, spoken or just sounds, sound effects, a
     sample to hear, and pop-ups on your computer.
  4. Weather you'd rather not have, and a ping or "ask me to step away".
  5. When a crop counts as ready to sell, and keeping pet food out of
     sales.
  6. How you sell (full room with sell pets or not), and whether to share
     your room.
  7. Where the panel goes, opening on Home or Alerts, and event themes.

  Each answer is set as you tap it, a summary shows at the end, and you can
  skip it at any step. It replaces the old three-card welcome. Extras →
  Panel → **Run setup again** brings it back with your current choices. The
  room-sharing question is part of the setup now, so it no longer pops up
  on its own for anyone who answered it there.

## 0.70.0 (beta)
- **Pet Power Rankings follow your stage.** In a late-game garden the
  weather slot is saved for Thunderstruck → Thundercharged and the moon
  slot for Amberlit → Amberbound, so with your stage at Late:
  - Amberlit Granter goes from 13% to 24%, Thunderstruck Granter from 14%
    to 22% and Thundercharger from 4% to 12%.
  - Frost, Rain and Snow Granters count for nothing (Frost was 18%).
  - Dawnlit Granter goes from 12% to 4%: it's only worth it for Dawn
    captures.
  Early and mid gardens keep the old weights, where Frost Granter is
  worth a lot. ⚖️ What counts says which weights you're on, and any weight
  can still be changed there.
- **Why the rankings moved in 0.67.3.** The fix that let Rainbow Granter
  count toward Rainbow also fixed the yardstick the rankings measure
  against. Before it, 20 abilities (Coin Finder, Sell Boost, Seed Finder
  and more) all counted as much as a Rainbow Granter, which inflated
  everyone's PP. The numbers since then are the right ones. That should
  have been in the 0.67.3 notes.

## 0.69.1 (beta)
- **The hatch counter is a warning now.** It pops up at the top middle of
  the game when you hatch an egg and a rare, Gold or Rainbow pet is 5
  hatches away or less ("🥚 Rare hatch soon · Thunder Wolf · next one!"),
  and goes away 10 seconds after your last hatch. It's no longer a box in
  the corner. The switch is on the Luck tab, under Egg locks.

## 0.69.0 (beta)
- **Home, tidied.** Nothing shows twice anymore:
  - The best sell pets reminder is off Home (it stays on the Money tab).
  - The event capsule is only up top, not in the Home card too.
  - The four tiles at the bottom are gone. Today's quests ride along on
    the "New daily quests" line ("2 left today").
  - Lines without anything to add ("Weather", "A fresh three") are gone.
- **Hatching on Home.** While a rare, Gold or Rainbow pet is 5 hatches
  away or less, Home shows each one with how many to go ("Next one!" when
  it's next), with a 🔒 on each egg. A small **hatch countdown** shows over
  the game at the same time (switch on the Luck tab).
- **🔒 Egg locks.** Lock an egg on the Luck tab (or from Home) and it can't
  be hatched until you unlock it. Try to hatch one and the game says
  "🔒 Thunder Egg is locked", with a **Go to egg locks** button that opens
  the lock with that egg lit up. The top of the list shows how far the
  any-egg Gold and Rainbow guarantees are, for lining up a Rainbow Thunder
  Wolf.
- **Pets out on Home**, each with how long until max strength.

## 0.68.0 (beta)
- **🏠 Home.** Tap the tab you're on again, or the app's name at the top,
  and the panel shows Home: one page with what matters most right now.
  - **Hello**: ready to sell, your wallet, and your net worth with how much
    it moved in 7 days, plus a Live dot while the game is connected.
  - **Needs you**: only what's worth doing now, like a pet with nothing it
    eats, quests to claim, a guaranteed next pull or a lock left on. When
    there's nothing, it says you're all caught up.
  - **Coming up**, as clock times, not countdowns: the weather, the next
    spooky night, new daily quests and when the trough runs out.
  - **At a glance**: quests, pets, safe to spend and your closest
    guarantee.
  Every line opens the tab it comes from. The app remembers if you left it
  on Home.
- **No more "?" on the Alerts tab.** A moon event the game hasn't named yet
  (Dawn or Amber) shows a 🌙 instead of a question mark, and weather that
  isn't named yet shows 🌦️. The Garden tab's forecast uses the same.

## 0.67.3 (beta)
- **Expected burn rate on the money forecast.** Once the app has two weeks
  of your money history, an orange dotted line shows where your money goes
  if you keep spending like you have those two weeks: everything that went
  out, wherever you spent it. The key shows how much a day. If it would run
  out inside the chart, a line under it says when. Until then, How to read
  this says how many of the 14 days are in.
- **The "% of the way to affording everything" bar is gone** from under
  the forecast (it swung too much with when you harvest). The purple "If
  you bought everything" line stays.
- **Best sell pets fold away.** Under net worth on the Growth card, one
  line now says "Including full-room prices and best sell pets"; tap it for
  each pet's share and whether they're out. A pet that isn't out is still
  flagged on the line.
- **Your team right now counts Rainbow and Gold.** The game's own ability
  list spells those mutations in a way the app didn't match, so a Rainbow
  Granter or Gold Granter was left out of the team summary and of Best pets
  for… Rainbow crops / Gold crops. Weather granters were caught by the same
  fix. Each line in the summary now has its name on top and what it adds up
  to underneath.
- **No more bouncing text on the Food card.** Long notes in a card that
  redraws every few seconds (like the food list) showed in full for a
  moment, then folded back to two lines. Now they fold before they show,
  everywhere in the panel. A note you tapped open stays open when its card
  redraws. The trough countdown sits on its own line under "The trough runs
  out in", with digits that don't shift as they tick, and "hungry in…" in a
  pet warning has its own line too.
- **The Pets tab, tidied like the Garden tab.** Five views along the top:
  🐾 Now (your team and the pets out), 🍽️ Food, 👥 Teams, 🏆 Rankings (Pet
  Power Rankings, Best pets for…, Time to max strength) and ✨ Made. It
  remembers the one you were on, and a red dot on Food means a pet has
  nothing it eats in the trough. The food list only adds a line under a pet
  when something needs doing.
- The stage strip's "granter pets" number opens Pet Power Rankings (it
  pointed at a section that had been renamed).

## 0.67.2 (beta)
- **The Garden map's buttons fit again.** Spots, Thunder, Dawn, Amber and
  Value now share the width of the card instead of running off its edge. On
  a narrow panel the ones you haven't picked show just their emoji (hover
  for the name).
- **Keep the map on the game.** A new switch under the Garden map, 📌 Keep
  this map on the game, leaves the view you pick there (Spots, Thunder,
  Dawn, Amber or Value) over the game all the time, like the map in the
  panel. Everything else works as before: open spots, the binder map and
  the finders still pop up when they apply, and the kept map comes back as
  a tab (📌) or on its own when they're done. Off unless you turn it on.
- The map view you pick is remembered after a restart (Thunder, Dawn and
  Amber used to go back to Spots).

## 0.67.1 (beta)
- **No more jumping text.** Some lines had their words split onto a new line
  and kept bouncing between one line and two as their numbers changed:
  - **The pet food list:** each pet's name and "49% full · hungry in 44 min"
    now stay on one line, with what it eats underneath.
  - **The greeting line** under the title stays one line. Beside an event,
    it's short: "🌙 until 9:07pm · +14 STR · 16 crops ready".
  - **Your wallet** sits on its own line under "Connected to your garden".
    The session's coins and the hourly rate are on separate lines too.
  - **Lines with a value** keep it at the right, so a changing number can't
    rewrap the words: what selling now would bring, the sell-pets tip, what
    counts as ready, the mutation lines and the money legend.
  - **Short labels stay whole:** voice names, quest totals, Time to max
    strength, the luck list, tab names on a narrow panel, chart ranges, the
    room bonus and settings rows. Longer names that must wrap split evenly
    instead of leaving one word alone.
- The night alert is called "Night (Spooky Shop)".

## 0.67.0 (beta)
- **A cleaner, calmer look.** The whole panel has been redone in the style
  of Apple's apps:
  - Soft graphite cards set apart by shade instead of outlines.
  - A new typeface (Inter).
  - iPhone-style switches, buttons and segmented controls.
  - Section headings with a chevron on the right, and lists with fine
    separators.
  - Line icons in the tab bar and on the header buttons. The tab you're on
    lights up.
  - Status lines with a small green dot when all's well.
  - Extras as Settings-style tiles with coloured icons.
  Nothing has moved, so everything is where you left it. Some of the longer
  explanations are shorter now. A few small tidy-ups:
  - "Check the shops now" is a small refresh button next to the time.
  - Chart ranges (24 hours / 7 days, Week / Month) are segmented controls.
  - Quest difficulty is a coloured dot.
  - Your wants show their progress above a slim bar.
- **The overlays on the game match.** The team suggestion, the step-away
  card, the map and the rest use the same frosted graphite glass and the
  same font. The second account's tabs and the stepped-away screen do too.
- **🎃 Event themes.** While a game event runs, the panel dresses up for it,
  and goes back to normal when it ends. First up is the **Haunt Event**:
  - Deep plum colours with pumpkin-orange switches and highlights.
  - A dusky glow behind the header, and a bat flying past now and then.
  - Stars at night, and a little mist at the bottom of the panel.
  - "🎃 Haunt Event · 23 days left" by the greeting.
  - The overlays on the game turn orange too.
  The theme turns on by itself during the event's dates, or whenever the
  game shows the event (the Spooky Shop opening, today's Haunt Quest), so it
  will come back for next year's Haunt Event too. You can switch it off in
  Extras → Panel → Event themes. More events (like Dawn and Amber Moon) can
  get themes later.
- **Night, to the minute.** The app now knows the game's day-and-night clock
  (from the game itself), so it shows exactly when the next night is, even
  before it has seen one. At night it also shows how dark it is:
  - The greeting reads "🌙 Night until 9:07pm · nocturnal +14 STR", and the
    Weather tab says the same.
  - Nocturnal pets get stronger as it gets darker, up to +20 STR at
    midnight.
- **The Haunt Event's pets and egg, from the game's own tables.** The app
  reads the game's tables again:
  - The Spooky Egg's odds (Snake 65%, Moth 30%, Toad 5%) and its Bad Luck
    Protection count.
  - What Moth, Snake and Toad eat (the Moth likes Ghost Plants).
  - Which pets are nocturnal, straight from the game.

## 0.66.0 (beta)
Ready for the **Haunt Event** (until Monday, November 9, 7:00pm Eastern).
- **🌙 Night.** Night comes every 10 hours and lasts 30 minutes. The Weather
  tab shows when the next night is, or that it's night now and until when.
  It also shows as a 🌙 Night box with the weather and restocks. The app
  learns the time the first night it sees the Spooky Shop open, then works
  out the next ones from there.
- **A night alert** (Alerts → Weather): a soft night chime and "Night has
  fallen. The Spooky Shop is open", once a night. It also says when the
  Spooky Egg is in stock. You can turn it off like any other alert.
- **The Spooky Shop and the Spooky Egg.** The Spooky Shop shows with the
  other shops, and the Spooky Egg (800M) can go on your Money tab list
  while the event runs. The Spooky Egg's Moth, Snake and Toad are known
  pets now, with their growth times.
- **👻 The Haunt Quest** has its own card on the Quests tab. It shows how
  many haunts you've snapped with your Camera, what it pays (the Black Cat
  outfit, or a Haunt Lamp if you have it), and when haunts are next out,
  at night or in weather. The gold dot on the tab also lights up when it's
  ready to claim. "Your quests so far" counts Haunt Quests done.
- **Time to max strength, on the Pets tab.** Every pet still growing gets a
  row: its strength now and its max, and how long it takes out and fed.
  Pets out show the time with your team's XP Boost. The others show the
  time with your two best XP Boost pets out with them, and on their own.
  The top of the section says how much faster your XP Boost pets make
  everything grow.
- **🌙 Nocturnal pets** (Bat, Platypus, Red Fox, Moth, Snake and Toad) are
  marked on the Pets tab. They get up to +20 STR at night.
- **Reading the game's own tables again.** Since the Haunt update the game
  keeps its pet, ability and egg tables in a different file, so the app
  couldn't find them. It now looks through all of the game's files,
  including ones the game only loads when it needs them, and tries again a
  little later if they aren't there yet. Once it reads them, the Spooky Egg's
  odds and the new pets' numbers come straight from the game.
- Weather that hasn't been announced yet now shows as ❔ instead of 🌙, so it
  isn't mixed up with night.
- Saving a sample (Extras → Troubleshooting) now also records how the game
  keeps night, haunts and the forecast.

## 0.65.0 (beta)
- **A new 📜 Quests tab for the daily quests.** It shows today's three
  quests in the game's own words, how far along each one is, what it pays,
  and whether it's ready to claim. A gold dot on the tab means something's
  ready to claim at the Quest Booth. It also shows the bonus for finishing
  all three, and a countdown to the new quests (8:00pm your time, midnight
  UTC).
- **A line of help on each quest**, from what the app already knows:
  - Buying a seed or egg: whether it's in the shop now, or when it restocks.
  - Harvesting: how many ripe crops would count, and how many of those are
    ready by your harvest rule.
  - Hatching eggs: how many are growing and how many are ready.
  - Pet abilities: which of your pets out do it, and about how long it'll
    take.
  - Selling for coins: what your ready crops would bring.
  - New mutations: when the right weather is next.
  - Journal entries: how much of your journal is filled in.
- **Your quests so far:** quests done, coins and Magic Dust earned from
  them, re-rolls used, and your journal (from the game's own counters).
  The app also keeps the last two weeks: which quests got done, and the
  bonus each day.
- **An optional reminder** an hour before new quests, only if something's
  left to do or claim (on the Quests tab; once a day).
- On a narrow panel the tabs show just their emoji, so all nine fit.
- **Fixed:** for gardens worth over 1B, the Money tab could unlock after
  one day instead of two weeks if the app read your money before the game
  had connected. It now waits until it knows your wallet and garden.

## 0.64.2
- **Step away now waits out the weather too.** Pressing **Step away now** on
  the Weather tab while it's raining (or a few minutes before it starts)
  steps away for that weather. The away screen counts down to its end, and
  after 5 seconds it offers **Reconnect when it ends**. On a clear sky it's
  still a plain break.
- **No pile of notifications when you come back.** While you're away from
  the computer (the screen is locked, it's asleep, or nobody has touched it
  for 10 minutes), Windows notifications are held back. Alerts still make
  their sound and still go in Recent alerts. When you're back, one
  **Welcome back** line in the panel says how long you were away and what
  happened. Also, a notification about weather that has already ended never
  pops up, and no more than three pop up in half a minute.
- **Getting ready for daily quests.** Saving a sample (Extras →
  Troubleshooting) now also records how the game keeps your daily quests,
  so a Quests tab can be built from it.

## 0.64.1
- **Garden Buddy has its own icon.** It's a happy little terracotta pot with a
  sprout, in front of a rainbow on an evening sky. It shows on the desktop
  shortcut, the Start menu, the taskbar, the window, the installer and the
  notifications. Task Manager now says "SSK's Garden Buddy" instead of
  "Electron". The small sizes, like the title bar and the taskbar, are drawn
  by hand so they stay sharp.
- If Windows still shows the old icon after you update, restarting the
  computer clears Windows' saved icons.

## 0.64.0
- **Leave plants out of Mutations over time.** A new **🌱 All plants**
  button above the chart opens a list of your plants. Tap a plant to leave
  it out, like crops you never harvest such as Thunder Celestials, and the
  shares are worked out from the rest of your garden. Tap it again, or
  **Count every plant again**, to bring it back. Your choice is remembered.
  The app starts tracking each plant with this update, so a line with plants
  left out begins from now.
- **The Garden tab, in five views.** A row of buttons at the top stays in
  reach as you scroll:
  - **🌱 Now**: your garden, ripe, ready, worth and crop size.
  - **✨ Mutations**: mutations now, over time, and Gold & Rainbow by your
    pets.
  - **🗺️ Map**: your garden map.
  - **🧺 Harvest**: what counts as ready, and Harvesting unlocked. A dot
    shows while Harvesting unlocked is on.
  - **🏅 Progress**: worth over time, your stats and your stage.

  The tab opens on the view you used last. Links from elsewhere, such as
  the stage numbers and Money's "Change it", open the right view. On a
  narrow panel, the other views show as just their emoji.
- **One "Mutations now" card.** Weather, moon, and Gold & Rainbow shares are
  together in one card, along with how long until every crop is Gold or
  Rainbow. They used to be in three places.
- The chart's **Stacked** switch is now remembered.

## 0.63.12
- **Fixed: being asked to step away for a weather that had just ended.**
  When a weather ends, the game keeps reporting it for a little while after
  the weather feed has moved on, and the app took that as a brand-new spell.
  Weather that's over is never asked about now.
- **One question per spell of weather you don't want.** Not answering counts
  as staying in (it used to ask again once the weather started), and Stay in
  sticks for that whole spell, even when the weather feed isn't answering.

## 0.63.11
- **Fixed: team suggestions repeating.** A blip in the game's connection
  during a weather made the app suggest (and notify) the same team again,
  up to three times in half a minute. A suggestion now goes once per weather,
  and the same one never again within 15 minutes.
- **No double heads-up for weather you don't want:** with "Ask me to step
  away" on, its "about to start" notification is the one; the gentle ping
  stays quiet.
- **The 🔁 swap-back button on the game is back** (on unless you turn it off
  in the Pets tab).

## 0.63.10
- **A steadier money forecast.** The line jumped around because its two
  estimates (what a ready crop is worth, how fast crops mature) were
  re-picked on every update from whichever source looked best right then.
  They now move gradually toward new readings (half way in about 2 hours),
  so flip-flops smooth out while real changes still come through.
- **Crops in your bag count** toward the money you could have now, so
  harvesting no longer dips the forecast until you sell.
- Samples now include what the forecast was built from over the last few
  hours, so any bounce left can be traced to its cause.

## 0.63.9
- **Moon events aren't cut short:** when Dawn or Amber Moon runs right up to
  weather you don't want, the step-away question waits until 10 seconds
  before that weather starts (instead of about 50), so you don't leave the
  moon event early.

## 0.63.8
- **The trough timer on the game can be moved:** drag it anywhere; it's
  remembered; double-click it to put it back.

## 0.63.7
- **No more "Bring it back"** after Not now on a team suggestion: Not now
  just closes it.
- **The 🔁 swap-back button on the game is off** unless you turn it on
  (Pets tab); Ctrl+Shift+T still swaps back.
- **No more doubled notifications:** reconnecting after weather said it
  three ways, "safe to join" twice; now once each. The gentle weather ping
  steps aside when that weather's own alert is on (it already announces it).
- **Fixed: the map's "you are here" ring sat one tile off on one bed.**
  Until both beds were learned, the unlearned one was assumed in line with
  the other, missing the one-tile walkway between them. Now it allows for
  it, and a bed is learned from two readings that agree.

## 0.63.6
- **The Money tab's cover for new players:** until it has enough data, the
  tab sits softly blurred behind a card: "Garden Buddy is gathering data.
  Come back after about 14 more hours of play and this tab will unlock",
  with a progress ring, what you'll get, and Open it now anyway. (A day of
  play for most gardens; two weeks for big ones, as before.)

## 0.63.5
- **The map over the game is resizable:** drag the grip in its bottom-right
  corner to make it bigger or smaller (60% to 220%); double-click the grip
  for its normal size. Your size is remembered.

## 0.63.4
- **Fixed: the pet-food planting card planted the wrong pots.** It counted
  every potted plant that can't fill some pet's bar as pet food, so it could
  plant pots you keep for other reasons. Pet food is now what's in your
  trough, and a kind needs weather only if even its largest size can't fill
  the bar of a pet that eats it (for most players: Lychee). Only those kinds
  are ever planted or potted.
- **Off by default.** Turn it on in the Weather tab's new "Pet food that
  needs weather" card, where you can also see and change which kinds it
  uses.

## 0.63.3
A full quality pass.
- **Fixed: losing the connection to the game could look like the weather
  ending.** The pet-food pots card could offer to pot your plants back up
  mid-rain, and the gentle weather ping could ping twice. Both now wait for
  the game to be back.
- **Clearer words:** "Stepped away" everywhere (the banner, notes and the
  Step away now button, which said Log off); the banner says Reconnecting
  only if you pressed it; "Color" in American spelling; the guide's map
  section describes the five map views there are now (it still described
  the old To-do view).
- **The trough chip** sits on the same frosted glass as everything else over
  the game (red only when it's urgent).
- The weather planner can't show "Invalid Date" if an event has no end.

## 0.63.2
- **A cozy first run.** The first time the app opens, a welcome card at the
  top of the panel (never over anything) asks two friendly questions (any
  weather you'd rather not have? which shop items to watch for?) and gives
  three tips. Skip it any time; it doesn't come back by itself (Extras >
  Panel > Show the welcome again). Installs that already have choices made
  never see it.

## 0.63.1
- **Welcome back:** after 30 minutes or more away, a gentle bar under the
  hello says what changed while you were gone: how long, crops ready to pick
  (and how many more than when you left), garden worth, and the alerts that
  went off. ✕ closes it.

## 0.63.0
- **Pet-food pots for weather.** Pet food that can't fill a pet's bar
  without a mutation (Lychee, for most) is kept in pots. When a weather you'll
  stay in for starts, a card on the game offers to plant those pots out,
  one press per pot ("Plant one · 6 left"), so they pick up a mutation.
  When it ends, a card offers to pot them back up, one press per plant. If
  the game doesn't take a pot, the card says so and stops. It works out
  which kinds need weather from your pets and what you keep in pots.

## 0.62.2
- **Weather planner** (top of the Weather tab): each weather now and next,
  when it starts (and how long until), what it could do to your crops ("11
  crops could get Wet", "125 could get Amberlit", Wet crops that could
  freeze in snow), and your plan for it: the team it'll suggest, or that
  it's weather you'd rather not have (with the ping and step-away asks you
  set). Weather that isn't announced yet says so.

## 0.62.1
A gentle wording pass and the older corners.
- **Shorter, warmer explanations:** the Money forecast's How to read this,
  the suggested-team cards, the second account and the open rooms list say
  the same things in about half the words.
- **The Luck tab is calmer:** a small ≈ marks counters that started partway
  (explained once), instead of the word "estimate" on nearly every group.
- **The older corners match the gentle look:** softer row dividers
  everywhere, and warning / good-news banners and tags in soft apricot and
  leaf instead of brick red and dark green.

## 0.62.0
- **🔔 in the header pauses pings for an hour**, from any tab: alerts,
  chimes and voices stay quiet (notes still show). It turns into 🔕 and
  says until when; tap it again to turn pings back on. The hello at the top
  mentions it while it's on.

## 0.61.6
- **Reconnect when [weather] ends** now floats in about 5 seconds after the
  stepped-away screen appears (it used to wait for the weather to start).
- **Bring it back:** pressed Not now on a team suggestion by mistake? For a
  few seconds it becomes a small "Not now · Bring it back" (on the game and
  in the panel); one tap and the suggestion's back.
- **Time away on the charts:** Gold & Rainbow by your pets and Garden worth
  over time join the stretches you were away with a faint dashed line
  instead of a gap or a line that looks watched (your pets weren't working
  then, so it isn't counted).
- "Put out your dawn team?", not "your dawn team team", when a team's name
  already ends in "team".

## 0.61.5
A comb-through of every tab with real data, and the first fixes from it.
- **The newer pings respect quiet hours and snooze:** the weather ping and
  the Safe-to-join chime stay silent then (their notes still show), and
  desktop notifications show silently.
- **Kinder words:** the weather team pickers say "No suggestion" (the app
  only ever suggests now), and Rooms says the shared room list isn't
  answering right now, instead of an error code.

## 0.61.4
- **Mutations over time has no more gaps.** While you're out of the game
  your crops stay as you left them, so each line now holds flat across the
  time away and picks up where the app sees your garden again.

## 0.61.3
- **Everything over the game shares one gentle look**, so it feels part of
  the game rather than stuck on top: frosted, translucent plum with the game
  softly blurred behind, soft shadows, rounded corners, and the same
  friendly typeface as the panel. That's the team suggestion, the step-away
  question, the harvest badge and notes, the trough chip, the money box, the
  Last team and plant buttons, the action bar and the map.
- **The questions are calmer and clearer:** a warm gold main button and a
  quiet second one, in plain words (Put out / Not now; Step away / Stay in),
  and the step-away question now sits in the middle too.

## 0.61.2
- **Team suggestions appear in the middle of the game**, a little above
  center, larger, with a gentle fade-in, so they're hard to miss. They stay
  until you press Put out or ✕.

## 0.61.1
- **The stepped-away screen shows the game's weather right now.** On a break
  ("Ready when you are!") or once the weather you stepped away from is over,
  the screen matches what's happening in the game: rainy if it's raining
  (with gently falling rain), snowy if it's snowing, and so on, with "It's
  raining in the game right now, until 4:10am". It changes as the weather
  does. Clear skies keep the sun.
- **What's PP?** now sits under the Hall of Fame, in plain words: 100 PP is
  a perfect Rainbow Granter, so a 50 PP pet is worth about half of one.
- **Which eggs to hunt** (was Pet Power by egg): for choosing which eggs to
  hatch next. Where you're short (the abilities you count where your best
  team is weakest, and the eggs that could fill them), then every egg with
  about what a hatch is worth to you, the kinds you've never had, and how
  much the estimate is based on.

## 0.61.0
A gentler look, so the Buddy feels like a calm companion beside the game.
- **A hello at the top:** a time-of-day greeting and the one or two things
  worth knowing right now (a hungry pet, crops ready to pick, the weather).
- **Warmer, softer colors**, more room to breathe, rounder cards set apart
  by shade rather than lines, and quieter headings.
- **Nunito**, a rounded, friendly typeface, throughout (bundled, so it works
  offline; SIL Open Font License, in fonts/).
- Chosen options glow a soft leaf green instead of brick red.
- FEATURES.md opens with what the Buddy is for: the game is yours to play;
  it watches, gives gentle heads-ups, and catches mistakes.

## 0.60.5
- **Reconnect when [weather] ends:** on the stepped-away screen, a few
  seconds after the weather starts, a button floats gently in under the
  countdown. Press it and you're reconnected when that weather ends;
  Cancel takes it back. For that weather only, never on by default.

## 0.60.4
- **Pet Power by egg** (Pets → Pet Power Rankings): how much of your Pet
  Power each egg gave you, from the pets you've kept: its share, how many
  pets, their average and your best, and per species its odds from that
  egg, how many you have and their average.

## 0.60.3
- **A big countdown while you've stepped away**, then **Safe to join!** The
  game area shows a large ring and timer ("Rain ends in 4:31"), colored
  for the weather; when it's over the screen warms up to a sunny "Safe to
  join!" with a big Join the game button, a cheerful chime in the panel and
  a desktop notification. If the end time isn't known yet it says it's
  waiting, and turns over as soon as the app knows.

## 0.60.2
- **A gentle ping when weather you don't want starts:** a soft two-note
  chime, a note, and a desktop notification (if those are on). The Weather
  tab's card is now "Weather you don't want": pick the weather, then
  Gentle ping when it starts (on by default) and Ask me to step away, each
  its own switch.
- **"Harvest mode" is now "Harvesting unlocked"**, a reminder you're
  harvesting: the switch (with ON), the 🧺 button, the game's badge
  (HARVESTING UNLOCKED), the action bar, keys and menu.
- **What's PP?**: a small fold at the top of Pet Power Rankings explaining
  Pet Power.

## 0.60.1
- **Extras is a grid of tiles:** Updates, Beta features, Action bar & keys,
  Second account, Seed deleter, Just for fun, Scripts, Panel, Money tab and
  Backups, each with its icon and a one-line status. A tile opens just that
  section, with ← Extras (or Esc) to go back to the grid.

## 0.60.0
Fair play: the app never plays the game for you. Every game action is your
press, one press, one action.
- **Weather teams and team triggers suggest instead of swapping.** When the
  weather changes (or your garden reaches a goal), a card on the game, a
  banner in the panel and a desktop notification suggest the team, with
  **Put out**: you press it. A suggestion goes once that team is out.
- **Step away during weather is yours to press.** A card asks "Rain is
  coming: step away?" (Step away / Ignore); no answer, nothing happens. When
  the weather's over you're told, and you press Rejoin. The app never steps
  out or comes back by itself.
- **Desktop notifications** (Alerts tab): weather (step away, it's over) and
  team suggestions, each with its own switch, and a test button.
- **The action bar is one press, one action:** holding a key no longer
  repeats it.
- **Removed: coming back after playing on another device.**
- FEATURES.md and the guide describe all of this, including exactly what
  the app sends and when.

## 0.59.11
- **Dawn captures cost nothing** (how late-game gardens play: Dawn is
  farmed off to make room for Amberbound while Gold / Rainbow finishes, and
  Thunderpeels are kept just for it). Dawn Capture is back to 2%, now worked
  out: a capsule is worth ~84M (a 1-in-200 Dawnbreaker Spore, a 1-in-40 Ube
  Seed), and a garden feeds it ~7-19 Dawn mutations a day. Amber Capture
  stays 0% (Amber is the mutation you're pushing for).

## 0.59.10
- **Dawn and Amber Capture are valued properly** instead of a flat 2%: what
  a capsule is worth (Dawn: 0.5% a Dawnbreaker Spore at up to 28B grown,
  2.5% an Ube Seed; Amber: pet shards) minus what the capture costs (the
  crop loses its moon mutation and waits to get one back). In a late-game
  garden that's slightly negative, so both count 0% by default; the
  working is in docs/ability-weights.md, and What counts lets you set your
  own weight if you value spores for growing your Dawnbreakers.

## 0.59.9
- **Best team for each ability shows STR and tier, not a confusing %.** The
  % was an internal score (how close to the best possible ability), which
  read like strength and made no sense for lower tiers. Pointing at a pet
  says what its ability really does ("turns a crop Rainbow, about once
  every 2.6 h"). Same for the podium, team chips and ranking tips.
- A sweep for other inconsistencies, all fixed: pet names like "FireHorse"
  (now "Fire Horse") in three places; Level next gains say PP; a team chip
  with two different tiers says "Sell Boost II + IV" (not "II ×2");
  Best pets for says when an ability only works in its weather; the Food
  cards agree when the game's away; the strength hint sits with the pets it
  explains; the mutation chart says Weather and Moon like everywhere else
  (not Hydro and Lunar); the Money tab says "measuring" instead of earning
  0 and being 0% there, "today" instead of today's date, and the right
  decoration threshold (500M, not 100M).

## 0.59.8
- **Your saved teams, as cards:** each pet's picture, STR and Pet Power, the
  team's total PP, and chips for the abilities it covers (×2 when two pets
  share one). The team that's out comes first.
- **Team builder:** pick any three pets (each listed with its PP, and
  flagged if it's in your bag), or start from a saved team, see the same
  stats, and put the team out (it swaps pets in from the hutch).
- **Best pets for…** moved below Your saved teams.

## 0.59.7
- **Fixes a protected crop getting harvested** right after planting it from a
  pot: plant a potted Ube and pick it in the same moment, and the app hadn't
  heard from the server yet, didn't know what was there, and let it through.
  Now it knows what you just planted, and a harvest it can't identify is
  stopped ("try again in a moment") while the lock, a protected crop or
  harvest mode is on.

## 0.59.6
- **What counts no longer bounces:** the rankings card is only rebuilt when
  its numbers change, never while you're dragging a slider (it catches up
  when you let go), and its note no longer flicks between full and "[…]".
  The trough card and the mutations chart rebuild only when something they
  show changes too (so a hover on the chart isn't wiped every few seconds).
- House cleaning: removed leftovers (the old 🔁 button's code, the old saved
  teams list, an unused message, the old Level next sum the app still worked
  out on every update). A new automatic check makes sure every file the app
  loads is packaged, every message has a handler, and every panel element it
  looks for exists.

## 0.59.5
- The pet ranking has a name: **Pet Power Rankings**. The score is Pet Power
  (PP; a perfect Rainbow Granter is 100 PP), the podium is the Hall of
  Fame, and everyone else is The Pack.

## 0.59.4
- Pet rankings: Level next moved under the ranking, folded under its own
  "💡 Suggestions" arrow.

## 0.59.3
- **A podium for your best pets:** your top 3 as gold, silver and bronze
  cards (the best in the middle), big values that count up, a 🌈 / ⭐ badge
  for Rainbow and Gold pets, and each one's best ability.
- **One Level next row** (the two were nearly the same list); each card
  says which team it improves.
- **A pet's own mutation counts in its value:** a Rainbow pet +50, a Gold pet
  +20 by default (What counts lets you change or switch them off). The
  Rainbow Pig leads clearly.
- The trough countdown on the game no longer ends in a "?".

## 0.59.2
- **Fixes the build** ("icon directory ... icons doesn't contain icons"):
  electron-builder takes a folder called icons for the app's own icon, so
  the pet pictures moved to pet-icons. BUILD.bat / BUILD.command remove the
  icons folder 0.59.1 left behind (only its pet pictures; a folder with
  anything else in it is left alone).

## 0.59.1
- **Pet icons are Microsoft's Fluent Emoji 3D** (MIT licence; credit and
  licence in icons/pets and the README): every pet species has one, Phoenix
  included.

## 0.59.0
- **Ability weights by money:** Rainbow Granter is 100% and every other
  ability is weighted by the coins it can make compared with it, worked out
  for a late-game garden (Gold 49%, Crop Refund 22%, Sell Boost 9%, Plant
  Growth Boost 8%, coin finders ~1%...). All the working is in
  docs/ability-weights.md. Every weight is still yours to change.
- **The trough timer counts down** (it used to sit still between meals),
  on the panel and on the game, from each pet's hunger to its next meals.
- **Pets that are out:** a row per pet with its icon, strength and hunger
  bars and age; tap a row for the details.
- **Best pets for…:** ranked rows with icons and bars.
- **Best team for each ability:** the pet's name shows the instant you
  point at it. Pet ages (time out) on the rankings too.

## 0.58.1
- Pet icons stay emoji (the game's own pictures aren't ours to use), and
  every pet species the app knows now has one (Pony 🐴, Platypus 🦦 added).
  Samples no longer note where the game loads its pictures from.

## 0.58.0
- **Pet rankings** (Pets tab, replaces Level next): level next for value
  and for your best teams, every pet ranked by value, each ability's best
  team, and what counts (tick abilities, set their weights). Icons first,
  few words.
- **Trough timer:** when the trough runs out for the pets you have out, and
  which pets have nothing they eat in it; optionally a countdown on the game.
- **The action bar is a 3×3 square** (keys 1–9 in three rows), or a line
  (Extras → Action bar & keys → Shape).

## 0.57.11
- **Never sell pet food unlocks it again after the sale:** the crops the
  app locked for the sale are unlocked once it's done, ready for the trough.
  Crops you locked yourself stay locked; a sale that's called off unlocks
  what it locked too.

## 0.57.10
- **"You are here" no longer vanishes in harvest mode.** Sweeping and
  clicking crops while walking taught it positions a few tiles stale, which
  slid the learned garden until you were "off" it. Once a bed is learned,
  far-off harvests are ignored; only accurate ones (made standing still)
  can correct it. Learning is also kept per garden slot, so a different
  room's garden is learned on its own.

## 0.57.9
- **"You are here" stays on the walkway between the beds:** the marker
  sits in the gap on your row, so it doesn't vanish as you cross over (once
  both beds are learned).

## 0.57.8
- **"You are here" keeps up.** It no longer ends a step behind after you
  stop walking (an update could be dropped), and the Garden map card moves
  its marker the moment you change tile instead of every few seconds.

## 0.57.7
- **"You are here" reads your position from your own movement.** The game
  sends your movement out (the server never sends it back to you), so the
  app now reads what your game sends, and understands positions given as a
  tile. Samples include what the game sends besides commands, to pin it down
  if your game does it differently.

## 0.57.6
- **You are here:** a dot in a pulsing ring marks your tile on the maps
  (over the game and on the Garden map card). It learns where your garden is
  from crops you harvest, plant or pot by hand: a few on each bed and it
  appears.

## 0.57.5
- **ENGAGED only shows while harvest mode is on** (it was always showing).
- **A 🧺 harvest-mode button at the top of the panel**, next to the 🔒:
  click to turn harvest mode on or off; it's red while engaged.

## 0.57.4
- **The Garden map card shows the maps that pop up over the game**, any
  time: Spots (open spots), Thunder (the Thunderstruck finder), Dawn and
  Amber (each binder map, with your open spots on it), and Value. The same
  maps as over the game, whether or not you're holding a pot, a Wolf is out
  or a moon is up. The To-do view is gone (the Amber map shows what to
  move in).

## 0.57.3
- **Protecting Thunderpeel no longer protects Stormcap.** Both grow on the
  Thunderspire, and the lock went by the plant; now each crop goes by its
  own kind.
- **Harvest mode takes over:** while it's on, the lock and your protected
  crops step aside, and they're back exactly as they were when it's off.
  It looks engaged: red switch, ENGAGED tag, red badge on the game, red 🧺 on
  the action bar.
- The 🔁 swap-back button is gone from the panel's top right (the one on the
  game and Ctrl+Shift+T stay).

## 0.57.2
- **🪴 works from the first press:** the game's own command for planting a
  potted plant (seen in your sample) is built in; planting one by hand only
  matters if the game changes it.
- Recorded hatches keep each pet's id, and samples include your keybinds,
  for future checks.

## 0.57.1
- **Mutations over time is stacked** (a stacked area chart): within a
  family, each mutation you tick sits on the ones below it, so Wet and
  Chilled together show their total with a line where they split; with all
  of a family ticked the top is its total. A "Stacked" chip switches back
  to separate lines.
- **The game's bag slots on keys of their own** (Shift+1–9 by default),
  since the action bar has 1–9; rebind them with the rest in Extras →
  Action bar & keys.

## 0.57.0
- **Action bar & keybinds.** A WoW-style bar on the game with nine slots
  on 1–9: plant potted plants (one per press, hold to keep going until
  they run out), plant seeds, swap to your last team, put out a saved team,
  harvest mode, harvest lock. Slots show their key, what's left or what's on,
  and flash when used; drag the bar anywhere. Empty slots leave their key to
  the game; keys don't fire while you type. Extras → Action bar & keys
  rebinds every slot and every app shortcut.
- Potted planting learns the game's command from the first potted plant you
  plant by hand.
- The 🌱 quick-plant button is off by default now (the bar does it).

## 0.56.15
- **Quick plant:** a 🌱 button on the game. Pick a seed from your bag (▾
  lists them with counts), then each click plants one in the next open spot;
  spam it to fill spots fast (say, pet food before weather). It shows how
  many are left, remembers your pick, and says when you're out of seeds or
  spots, or if the game didn't plant one. Drag it anywhere; its switch and
  "put it back" are on the Garden tab under Harvesting & ready.

## 0.56.14
- **Mutations over time: the totals add up again.** Since 0.54.7 the
  weather and moon totals counted only what your harvest rule asks for (say
  Thundercharged or Frozen), so the weather total could read 52% while
  Thunder alone read 78%. They're any weather / any moon again, and the past
  readings are repaired (a crop never has two weather or two moon mutations,
  so a total is its parts added up). Same for the "without" lines under it.
- **The legend says All / Both** instead of 💧 🌙 🌈: All (weather), Both
  (Dawn and Amber), Both (Gold and Rainbow).
- A caption meant for Garden worth over time had ended up under this chart;
  it's gone.

## 0.56.13
- **Empty spots on the map have their slight glow back**, as a soft inner
  glow on a solid square (no hard outline, nothing showing through).

## 0.56.12
- **Empty spots on the map are solid again, without the outlines**: a plain
  dark "ground" square, between the map's background and the plants. And
  the map's background is opaque, so the game moving behind it doesn't show
  through.

## 0.56.11
- **Egg hatch trackers, tested in depth and two catch-up bugs fixed.** When
  the app opens it catches up on hatches made while it was closed; that used
  to compare the game's times with this computer's clock, so a PC clock
  running ahead could skip hatches (and two hatches in the same instant could
  lose one). It now goes by each pet's own id, which can't be fooled.
- **Check the counts** (Luck tab, top of Eggs): whether every hatch the app
  counted is on its egg, and the hatches counted per egg, to compare with a
  paper tally. A saved sample includes the counters too.

## 0.56.10
- **Empty spots on the map are outlines**, so they no longer blend into the
  background: filled means something is there.
- **The maps highlight only what you can act on.** Finished crops
  (Thundercharged, Amberbound and Dawnbound on the binder map) are a quiet
  tint marked "(done)", so the Thunderstruck crops, the crops to move in
  and the open spots stand out. Keys list only what's on the map, and the
  lines are shorter so they don't cut off.

## 0.56.9
- **The map over the game is calmer and switches views smoothly.** Every
  view now shares one base (empty ground, plants and other things look the
  same in all of them), so changing view only changes what's highlighted;
  highlights are a little softer with lighter glows; squares fade into
  their new colors, and the line and key fade in, instead of snapping.

## 0.56.8
- **The map over the game no longer spills over its edge.** The game's page
  counts padding inside widths, which squeezed the grid out of the box in
  0.56.7; the map now sizes itself whatever the page does.

## 0.56.7
- **The map over the game holds still when its view changes.** With a
  Phoenix out, picking up a pot switches the view but the grid stays exactly
  where it was: every view now has the same frame (title row, a row for the
  tabs, a two-line summary, a three-line key, a fixed width), docked or
  moved.

## 0.56.6
- **Your stage is off unless you turn it on** (Extras → Beta features):
  it's still being worked out. Off means no bar above the tabs, no
  rearranged sections and the Your stage card as it was; turning it off
  again puts every tab back in its own order.

## 0.56.5
- **Swap to your last team means the last pets you had out,** not just
  saved teams: a random lineup or pets you swapped out of the hutch. A
  lineup counts once it settles (you do something else, or 20 seconds pass
  with no pet swaps), so quick hutch swaps in a row don't count in between.
  It comes back as a saved team when one matches, otherwise pet by pet out
  of the hutch.
- **The Garden map doesn't suggest cleansing any more.** The To-do view is
  about potting Amberlit crops next to a Moonbinder.

## 0.56.4
- **The swap-back button is on the game now:** "🔁 <team>" on the left,
  just above the game's pet panel. Click to swap back to your last team;
  drag it anywhere (it remembers), double-click to put it back. A switch on
  the Pets tab turns it off. (The panel's 🔁 and Ctrl+Shift+T still work.)

## 0.56.3
- **The Garden map, without the wall of text.** The count line says what
  to do and what it's worth ("2 to cleanse · up to +8.3B"); what Cleanse
  and Pot mean is on the legend (hover it, or tap it to open the biggest
  one); a plant's card is three short lines (what's wrong, what to do, any
  warning); the switches for the map over the game are folded away under
  "Maps over the game".
- The stage bar stays on one line: "Auto", and the stage in use underlined
  with how far in you are.

## 0.56.2
- **Swap to your last pet team:** 🔁 at the top of the panel, or
  Ctrl+Shift+T, puts the team you had out before back (its tooltip names
  it); press again to swap back. It notices every swap: in the game, from
  the Pets tab, or by a weather team.

## 0.56.1
- **How far into your stage.** The stage in use says "early", "well in" or
  "deep" ("🌳 Late · early"): a garden with the celestials and binders but
  no Rainbow or sell team yet is early in Late; one with all five Late
  milestones is deep in it. While you're not deep yet, your biggest gap
  takes the strip's last slot and its section leads its tab, and Your stage
  lists what would take you deeper.

## 0.56.0
- **Your stage (beta feature).** Above the tabs: Auto · Early · Mid · Late.
  Auto works your stage out from milestones in your game (net worth,
  celestials and binders planted, Gold / Rainbow share, granter and sell
  pets) and says why; pick one to override it. The stage sets the four
  numbers in the strip under it (tap one to jump to it) and which sections
  each tab leads with (moved up, opened, marked ★). Your stage on the Garden
  tab shows what the next stage needs, with your numbers.
- The crop track's labels stay short ("Weather", "Moon") when your rule
  takes three or more kinds.

## 0.55.0
- **A second account.** Extras → Second account (or the Accounts menu) opens
  another game in a tab above the first, with its own login. Both stay
  connected: the one you're not on keeps running, hidden and muted, with
  your scripts. Ctrl+Tab switches; the panel follows account 1.
- **Clearer numbers on the Money tab.** "Garden full" and "value when full"
  are now "all ready" and "worth when it's all ready"; the bar's "Growing"
  is "Not ready yet"; the rate says it's still learning instead of "~0";
  the buy-everything bar says "you earn X a day" and "your wants cost Y a
  day"; safe to spend is three short sentences.
- **Shorter, correct notes** across the app (weather teams, the map over the
  game, playing on another device, panel size, the Money tab's unlock, the
  Money engine). The map note was out of date: during an Amber Moon or Dawn
  the binder map comes first.

## 0.54.7
- **"Ready" means one thing everywhere: your harvest rule.** What you pick
  under Harvesting & ready (Garden tab) is what the Garden tab's "ready"
  count, the Money tab and harvest mode all use. The Money tab's separate
  ready rule is gone; it shows your rule and links to it. If you never set a
  harvest rule, it starts as the old ready rule was, so nothing jumps.
- The Money tab's crop-stage track follows your rule too, in its words
  ("Thundercharged or Frozen" instead of "Weather", counting only crops
  that have what you asked for).
- Clearer words: "ripe" instead of "grown" or "mature" for crops, "can become
  ready" in the full-garden estimate, and "Garden worth over time" says it's
  base value (net worth counts crops at what you'd get).
- The section is now "Harvesting & ready"; folded, it says your rule.

## 0.54.6
- **The binder map stays up when you pick up a pot** during an Amber Moon or
  Dawn, and lights up every open spot on it, the ones beside the binder
  brightest (a plant put there binds). The plain open-spot map is a tab.
- The map's title keeps to one line; its tabs and countdown go underneath
  when there isn't room.
- A saved sample includes your last sale checks, so how close the money
  estimates are can be checked from it.

## 0.54.5
- **The open-spot map works again.** The game changed how it says what's in
  your hand (it names the item now instead of a slot number), so the app
  never saw a pot. It reads the new way (a Planter Pot, or a potted plant by
  its own id), and still understands the old one.
- **Level next** (Pets tab): which pet to level next. For each ability line
  your account's best is the strongest one you own (Sell Boost IV over III);
  it finds the pets whose levelled abilities would add the most to those,
  weighted by what matters most and counting the time it takes. Three picks
  that build on each other, and a quick win.
- **The Garden map says what "cleanse" and "pot" mean** under its count, and
  opens the plant with the most to gain, with how to do it.

## 0.54.4
- **Harvest mode** (Garden tab, or Ctrl+Shift+M): pick what a crop needs
  (Gold or Rainbow, a weather mutation, a moon mutation, full size) and only
  those can be harvested; everything else is kept, so you can sweep the whole
  garden without looking. It shows how many match right now and what they're
  worth, and the map over the game lights up the plants to harvest.
- **Your garden** is numbers first: crops, ripe and ready as tiles, what
  selling now and in a full room would bring side by side, and two short
  lines instead of five paragraphs (the explanations are in the tooltips).

## 0.54.3
- **One map over the game** instead of four: it shows what fits what you're
  doing (a pot in hand, an Amber Moon or Dawn, riding, the Thunder Wolf, a
  capture pet), with tabs on its title for the rest. On a small screen it
  takes a third of the space the stacked maps did.
- **Shop voices come sooner:** the spoken line is made while the chime
  plays, instead of after it, so a long Dawn shop announcement no longer
  leaves a silence. A stuck voice gives way to the computer's voice after 8
  seconds (was 20).
- The app now notes what you've held lately, so a saved sample can show why
  the open-spot map doesn't come up for a pot.

## 0.54.2
- **Your best sell pets, and a reminder to put them out.** The Money tab
  shows each one's share (the Capybara's Double Harvest and Crop Refund
  included) with ✅ when they're all out, or which to put out before you sell
  and about how much more that gets you. The Garden tab shows the reminder
  while one isn't out.
- The team follows your pets: as they grow stronger or you get new ones, the
  best three (and the Money tab's numbers) change with them.

## 0.54.1
- **Sturdier.** If the panel's page ever crashes it comes back by itself, and
  so does the game's; anything unexpected is written to a small log that goes
  into a saved sample (Extras → Troubleshooting), so bug reports show what
  happened.
- **Lighter.** Settings are written to disk only when something changes (they
  were being saved every few seconds), and the panel gets the bulky parts of
  your garden (teams, the Garden map's plan, every pet) only when they change.
- **Zoom keys follow what you're in:** Ctrl + / Ctrl − / Ctrl+0 size the panel
  when you're in the panel and zoom the game when you're in the game.
- **Easier to read and use:** the faint text is a touch brighter (it now
  meets the usual contrast standard), long notes open from the keyboard too,
  shop and weather tiles show their whole name, and the team picker shows the
  whole team.
- Tighter security settings for the panel.

## 0.54.0
- Ready for GitHub: tests run on every push, the README is up to date.
- The Money tab's Growth card says how crops are counted once, not three times.

## 0.53.16
- **Any screen size:** the window opens to fit your screen, the panel sizes
  itself (Extras → Panel → Panel size, or Ctrl + / Ctrl −), and the maps over
  the game scale and fit. Tap a map's title to fold it. Works with touch.

## 0.53.15
- **Money counts crops at what you'd actually get:** a full room with your
  best sell pets (switch to base value under "How crops are counted").
- **The app checks its values against your real sales** and says how close
  it was.

## 0.53.13 – 0.53.14
- A numbers check across tabs: "Estimated value when full" no longer counts
  crops that can't finish, "if you sold now" counts only ripe crops, and each
  total says what it counts. "In a full room" uses your best sell pets.

## 0.53.8 – 0.53.12
- **Maps over the game:** the Thunderstruck finder (while a Thunder Wolf is
  out), the capture map (Ostrich / Phoenix, out or ridden), and a rebuilt
  open-spot map. Every map can be dragged anywhere.
- A trail for alerts that go missing, in the saved sample.

## 0.53.2 – 0.53.7
- **Binder map** during Amber Moons and Dawns (in that moon's colors), and
  binders' own fruit counted in the Garden map's to-do.
- **Alerts that arrive together are one announcement** (no more five in a
  row from one shop).
- **Mutations over time** split into Wet, Chilled, Frozen, Thunder, Dawn,
  Amber, Gold and Rainbow.
- **Luck** leads with your nearest rare pulls, with icons and odds.

## 0.52.x
- **Garden map with a to-do:** which plants to cleanse, which to pot beside a
  Moonbinder, and what each is worth.
- Safe to spend explained in plain words; Luck sorted by what's close.

## 0.50 – 0.51
- New natural voices and a rebuilt Alerts tab; Mutations over time; the Money
  forecast.
