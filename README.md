# 🌱 SSK's Garden Buddy

**A friendly helper for [Magic Garden](https://magicgarden.gg).** It plays the
game in its own window with a side panel that keeps an eye on things for you:
it tells you when something good is in the shop, helps you pick pet teams,
counts your eggs toward Bad Luck Protection, and a lot more.

> **Beta.** Things may still change, and there will be bugs. If you find one,
> please say so (see *Help* below).
>
> This is an unofficial, fan-made mod. It isn't made or reviewed by Magic
> Circle. Use it at your own risk.

## Download

### 👉 **[Download page: shea4it.github.io/ssks-garden-buddy](https://shea4it.github.io/ssks-garden-buddy/)**

Or straight to the file:

- 🪟 **[Download for Windows](https://github.com/shea4it/ssks-garden-buddy/releases/latest/download/SSKs-Garden-Buddy-Windows.exe)**: open it and it installs by itself. If Windows says *"Windows protected your PC"*, click **More info**, then **Run anyway** (that shows for any app without a paid certificate).
- 🍎 **[Download for Mac](https://github.com/shea4it/ssks-garden-buddy/releases/latest/download/SSKs-Garden-Buddy-Mac.dmg)** (any Mac): open it, drag the app into Applications, then the first time **right-click the app and choose Open**. If macOS says it's "damaged", run `xattr -cr "/Applications/SSK's Garden Buddy.app"` in Terminal and try again.

**Updating:** the app checks for new versions by itself and tells you. Press
**Update now** (in the banner, or Extras → Updates) and it downloads and installs
the new one; on a Mac you drag it into Applications. Your settings, counts and
history are kept. You can also use **Help → Check for updates…**.

## What it does

- **🔔 Alerts** with sound and a voice when rare seeds, eggs (Mythical and
  Amber too), tools or decor are in the shop, when the weather changes, when
  a pet turns a crop Gold or Rainbow, and when your pets are hungry. Quiet
  hours, with a 🌙 for the alerts worth waking up for.
- **🎭 Voices with personality:** cheerful Poppy, grumpy Spike, gloomy
  Obadiah, a storybook narrator, a stadium announcer, and more.
- **💰 Money:** one chart of your money — the last week as it happened and
  the next couple of weeks as expected — with each thing you want (celestials,
  Mythical and Amber Eggs) sitting on the day it's likely to show up, sized
  against what you'll have. How much is safe to spend right now, "Can I buy
  this?" for anything you're eyeing, what your garden will be worth when it's
  all ready (and with your room and pet bonuses), and **the final boss**: the
  line for buying *everything* — every alert item and every decoration as it
  shows up. There's a race to cross it, and a party when you do.
- **🌻 Garden:** what your garden is worth, how many crops are ripe and ready
  to sell, how fast your pets are turning crops Gold and Rainbow (hour by
  hour), where you are in the game and in your crops' lives, weather
  mutations, crop size, and an open-spot map that appears over the game
  while you hold a pot.
- **🐾 Pets:** each pet's real strength, what its abilities do in plain words,
  the best pets you own for any goal, team ideas, your saved teams with what
  each one does, and pet food.
- **🌦️ Weather helpers:** a pet team for each kind of weather (swapped in
  and back again for you), team swaps when your garden reaches a goal, and
  stepping out during weather you want to keep off your crops.
- **🍀 Luck:** Bad Luck Protection counters for every egg, plant and capsule,
  with a heads-up when a guarantee is one pull away.
- **🎮 Rooms:** your room's sell bonus, rooms other players share, your
  saved rooms with how full they are, and an opt-in switch to share your own
  room on the community list.
- **🧰 Extras:** a harvest lock for moving pots without harvesting by
  accident, a "never sell pet food" guard, a seed deleter, backups, and some
  just-for-fun effects.

The **[guide](GUIDE.md)** explains every part of it, and
**[FEATURES.md](FEATURES.md)** is the full list.

## Fair play and what it sends

Magic Circle's modding policy asks mods to be fair, transparent and safe.
This one doesn't automate buying, harvesting or selling. It mostly watches
and tells you things. Here is everything it does that touches the game:

- **It reads** your game's own data in the app's window, and the game's public
  shop feed.
- **It can send the game exactly three kinds of command**, all only because
  of something you set up or pressed:
  - **Swap to one of your saved pet teams** (the same as tapping the team in the
    game): when you press Apply, or from weather teams and team triggers if
    you've switched those on.
  - **Throw a seed into the wishing well**: the seed deleter, one seed at a
    time, only when you press it.
  - **Lock a crop kind** (the game's own right-click lock): only with "Never
    sell pet food" on, when you sell, so the crops your pets eat are kept.
- **The harvest lock** doesn't send anything of its own: while it's on, it
  points the game's own harvest at a spot that doesn't exist, so the game
  refuses it and nothing is harvested.
- **One number is adjusted** in what the game receives: after the app sends a
  command, the game's "commands done so far" count is shifted to match, so the
  game stays in step. Nothing else the game receives is changed.
- **Off unless you switch them on:** stepping out of the game during chosen
  weather, and coming back automatically after you play on another device
  (with a countdown and a Stay away button, as Magic Circle asks).
- **Other places it connects to:** magicgarden.gg (the shop feed and room
  player counts), Arie's Mod's public room list (reading it can be switched
  off), GitHub to check for updates (can be switched off; nothing installs
  until you press Update now), and GitHub / Hugging Face to download the
  natural voices when you choose one. No accounts, no tracking.
- **The one thing that sends anything about you, and only if you switch it
  on:** *Share my room on the community list* (Rooms tab) sends your room
  code, how many are in it, your name and your coin balance to Arie's Mod's
  site (at most once a minute), so others can find and join your room. It's off
  until you turn it on, and nothing is sent while it's off.

All of the code is plain, readable JavaScript, right here.

## Help

Found a bug or have an idea? Open an issue on this page (**Issues**, then
**New issue**), or post in the app's thread on the Magic Garden Discord. If
something's wrong with what the app sees in your game, **Extras → 🛠
Troubleshooting → Save a sample** makes a file that helps a lot.

## Thanks

- **Magic Circle** for Magic Garden, and for welcoming mods.
- **[magicgarden.wiki](https://magicgarden.wiki)** for prices, odds and
  ability numbers.
- **Arie**, big time: Arie opened up Arie's Mod's public room list so the
  Buddy can both read it and post shared rooms to it, and his team wrote up
  a guide to their API. That's what makes "Open rooms right now" and "Share
  my room" work, for his users and ours.
- **Arie's Mod** and **MG AFK** for showing how the game's commands and rooms
  work; the pet strength formula comes from the community's Gemini mod.
- The natural voices are **[Piper](https://github.com/rhasspy/piper)** voices
  (SEMAINE, Cori, Amy, Alba, VCTK and Lessac recordings).

## Building it yourself

See **[BUILDING.md](BUILDING.md)**.

## License

MIT (see [LICENSE](LICENSE)). Made by Spread Sheet King.
