# Changelog

What changed in each version, in plain words. The app checks for new
versions by itself; press **Update now** when it tells you.

## 0.54.5 (beta)
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
- **Binder map** during Amber Moons and Dawns (in that moon's colours), and
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
