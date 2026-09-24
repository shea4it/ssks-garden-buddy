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

Updating: download and install again. Your settings, counts and history are kept.

## What it does

- **🔔 Alerts** with sound and a voice when rare seeds, eggs, tools or decor
  are in the shop, when the weather changes, and when your pets are hungry.
  Quiet hours, with a 🌙 for the alerts worth waking up for.
- **🎭 Voices with personality:** cheerful Poppy, grumpy Spike, gloomy
  Obadiah, a storybook narrator, a stadium announcer, and more.
- **🌦️ Weather helpers:** today's weather at a glance, a pet team for each kind
  of weather, and team swaps when your garden reaches a goal (like "95% of my
  crops are Thunderstruck").
- **🌻 Garden:** what your garden is worth (with your room and pet bonuses), a
  chart of it over time, how close you are to all-Gold/Rainbow and full size,
  your weather mutations, and open spots for when you're moving plants around.
- **🐾 Pets:** each pet's real strength, what its abilities do in plain words,
  the best pets you own for any goal, and team ideas.
- **🍀 Luck:** Bad Luck Protection counters for every egg, plant and capsule,
  with a heads-up when a guarantee is one pull away.
- **🎮 Rooms:** your room's sell bonus, rooms other players share, and your
  saved rooms with how full they are.
- **🧰 Extras:** a harvest lock for moving pots without harvesting by
  accident, a seed deleter, backups, and some just-for-fun effects.

The **[guide](GUIDE.md)** explains every part of it.

## Fair play and what it sends

Magic Circle's modding policy asks mods to be fair, transparent and safe.
This one doesn't automate buying, harvesting or selling. It mostly watches
and tells you things. Here is everything it does that touches the game:

- **It reads** your game's own data in the app's window, and the game's public
  shop feed.
- **It can send the game exactly two kinds of command**, both only because of
  something you set up or pressed:
  - **Swap to one of your saved pet teams** (the same as tapping the team in the
    game): when you press Apply, or from weather teams and team triggers if
    you've switched those on.
  - **Throw a seed into the wishing well**: the seed deleter, one seed at a
    time, only when you press it.
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
  player counts), Arie's Mod's public room list (read only; can be switched
  off), and GitHub / Hugging Face to download the natural voices when you
  choose one. No accounts, no tracking; nothing about you is sent anywhere.

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
- **Arie's Mod** and **MG AFK** for showing how the game's commands and rooms
  work, and Arie for the public room list; the pet strength formula comes from
  the community's Gemini mod.
- The natural voices are **[Piper](https://github.com/rhasspy/piper)** voices
  (SEMAINE, Cori, Amy, Alba, VCTK and Lessac recordings).

## Building it yourself

See **[BUILDING.md](BUILDING.md)**.

## License

MIT (see [LICENSE](LICENSE)). Made by Spread Sheet King.
