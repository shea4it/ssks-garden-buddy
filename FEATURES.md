# 🌱 SSK's Garden Buddy: everything it does (beta 0.45.6)

hey! this is my helper app for Magic Garden. it runs the game in its own window with a side panel that keeps an eye on things for you. it's a beta, so there'll be bugs. if you find one, tell me (Extras → 🛠 Troubleshooting → Save a sample helps a ton).

it doesn't buy, harvest or sell anything for you. it watches, tells you things, and only ever does something when you set it up or press it. full details are at the bottom.

## 💰 Money (the big one)

- **one chart of your money.** the left quarter is the last week as it happened (solid), the rest is the next couple of weeks as expected (dashed), with a dot for right now and what you'll have at the end. there's a key under it, and a "how to read this" if it's your first time
- **your wants on the chart.** your wants list (it starts with Moonbinder, Dawnbinder, Starweaver, Emberbloom, Dawnbreaker, Mythical Egg and Amber Egg) sits on the chart, each on the day it's likely to show up, ringed green if you'll have the money, amber if it's worth skipping for a bigger one, red if you'll be short
- **purchases to scale.** every upcoming want is a block as tall as its price, so a 50B Moonbinder looks exactly as big (or small) as it is next to your money, with "🌙 −50B · 6%" on the big ones
- **the final boss 🏁** is a purple line for "what if I bought *everything*": every alert item and every decoration worth 100M+, each time it shows up. stay above zero and you can afford it all. dip under and it tells you when you'd run out
- **the race.** a track with a 🏁 at what buying everything costs a day (around 51B a day in this beta, and it updates as the app learns the shops) and you 🌱 at what you make a day. cross it and you get confetti and a cheer, and it remembers the day you did it
- **safe to spend now**, with a green / yellow / red "open to spend / careful / save"
- **"Can I buy this?"**: type any price (or tap something that's in the shop right now) and it tells you what it would cost you, like "you'd have to skip the Dawnbreaker"
- **estimated value when full**: what your garden will be worth once everything's ready, and what it'd fetch with your bonuses or in a full room
- **your wants list**: reorder it, add or remove stuff. tap any want on the chart (or "✏️ edit what you want" under it) to jump straight there
- **money engine**: what you actually earn a day, week vs week
- **money box** over the game (Ctrl+Shift+B) for quick decisions at any shop
- the Money tab unlocks after you've played a bit. can't wait? **Extras → Money tab → Show it now**

## 🔔 Alerts

- sound + voice when the good stuff is in the shop: all the celestials (Moonbinder, Dawnbinder, Dawnbreaker, Emberbloom, Thunderspire, Starweaver), Mythical Egg, Amber Egg, Legendary Egg, **XP Potion** (a must for late game), Wind Turner, Firepit, Ube, Milkcap, Marigold, any decor over 500M, and yes, **Sunflower** (i know. it gets its own very excited, very calm announcement). you can add your own items too
- weather alerts (thunder, rain, dawn, amber moon, snow, anything else)
- pet alerts: a pet turned a crop Gold or Rainbow (cha-ching!), a pet is getting hungry, a pet is fully grown, you hatched a Gold / Rainbow / rare pet, and Bad Luck Protection is one pull away
- seed and egg restock timers, a recent alerts list, snooze for 30 min or an hour, pop-up notifications
- **quiet hours**, with a 🌙 on any alert you want to wake you anyway
- **voices with personality**: Poppy, Spike, Obadiah, Prudence, storytellers, Scottish voices, a stadium announcer, an old radio, a movie trailer guy… plus your computer's own built-in voice
- separate volume for chimes and the voice, pick your speaker, and keep Bluetooth speakers (like an Echo) from dozing off

## 🌻 Garden

- your garden at a glance: how many crops are growing, **ripe** and **ready to sell**, and what it's worth (and what it'd fetch with your room and pet bonuses, or in a full room)
- **your stage**: where you are in the game (seed ladder → building your pets → mutation farming) and where your crops are, from planted to ready
- **Gold & Rainbow by your pets**: a gold line and a rainbow line showing how fast your pets are turning crops, hour by hour (12h / 24h / 3 days / 7 days), straight from the game's own counters, with a ✨ on your best stretch and how long until every crop is Gold or Rainbow
- garden worth over time, weather mutations, crop size
- **open spots map**, which also pops up over the game while you're holding a pot
- **harvest lock** (Ctrl+Shift+L) so you can move pots around without harvesting by accident
- **never sell pet food**: locks your pets' food before you sell so it can't get sold
- always-protect list for crops you never want harvested by accident

## 🐾 Pets

- every pet's real strength (fix it by typing over it if it's off), how long until it's fully grown, and what its abilities actually do in plain words
- your team right now, all added up (coins an hour, sell bonus, hatch XP…)
- team ideas picked from every pet you own: money, Gold crops, Rainbow crops, each kind of weather, crop size, faster growing, hatching and leveling
- best pets for any goal, ranked
- **your saved teams** in one dropdown with the pets in each, what the team does, and Apply
- **team triggers**: swap teams by themselves once your garden hits a goal, like "once 95% of my crops are Thunderstruck, swap back to my usual team", or once every crop is full size, or Gold / Rainbow (you set them up in the Weather tab)
- pet food (who's hungry, what's in the trough) and what your pets have made

## 🌦️ Weather

- today's weather
- **a pet team for each weather**: switch it on, pick a team for rain, snow, thunder, dawn and amber moon, and it swaps in when that weather starts and swaps back after
- **step out during weather** you want to keep off your crops, and come back when it's over

## 🍀 Luck

- Bad Luck Protection counters for every egg, plant and capsule, counted automatically
- a heads-up when a guarantee is one pull away
- recent hatches, what each egg has given you vs the odds, and your rare finds

## 🎮 Rooms

- your room's sell bonus (+10% per other player, up to +50%), so it's worth being in a full room when you sell
- **open rooms right now**: rooms other players are sharing on Arie's Mod's public room list, with how full each one is (the app checks each one with the game first, so they're real and current). one tap to join (unless it's full)
- **share my room**: flip it on in Rooms → Room settings and the room you're in gets posted to Arie's Mod's room list, so people looking for a full room can find you and hop in. it shows up on Arie's Mod's public rooms page and in everyone's "open rooms right now" in the Buddy. it sends your room code, how many are in it, your name and your coins (at most once a minute), and it stops the second you turn it off
- your saved rooms with how full they are, and join / save by code
- copy a room code anywhere (like Discord) and the app offers to join or save it

**huge shoutout to Arie 💜** Arie runs Arie's Mod, and he opened his mod's room list up to other mods: the Buddy gets to read it *and* post rooms to it, and his team even wrote up a guide to their API so I could hook it all up. he absolutely didn't have to do any of that. it's why finding a full room for that +50% is so easy now, for his users and ours. go check out Arie's Mod and tell him thanks

## 🧰 Extras

- updates that check themselves (nothing installs until you press Update now)
- come back automatically after you play on another device (with a countdown and a Stay away button)
- seed deleter (throws seeds into the wishing well, one at a time, when you press it)
- just for fun, only on your screen: confetti, hearts, disco, spin, wobble, upside down, glitch, rainbow mode
- your own scripts, backups (it makes one every day too), and where the panel sits (attached or its own window, Ctrl+Shift+D to hide it)
- every section folds up, and folded sections show a one-line summary so tabs read at a glance

## 🤝 Fair play: what it sends

- it **reads** your game's own data in its window, plus the game's public shop feed
- it can send **three kinds of command**, all only because you pressed something or set it up: swapping to one of your saved pet teams, throwing a seed into the wishing well (seed deleter), and locking a crop kind (only with "never sell pet food" on, when you sell)
- the harvest lock doesn't send anything. it just makes the game's own harvest miss
- the **only** thing that sends anything about you is **Share my room**, and only if you switch it on: your room code, player count, name and coins go to Arie's Mod's room list (at most once a minute)
- no accounts, no tracking. all the code is plain JavaScript you can read

made by Spread Sheet King 💜
