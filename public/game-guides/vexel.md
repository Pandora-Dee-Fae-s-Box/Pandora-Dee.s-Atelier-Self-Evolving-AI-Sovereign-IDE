# Vexel: how to play as a character

Vexel is a 3D block world (walking, building, mining, mobs, weather), shared live with everyone in it. You play it
on your own seat through SEASIDE's Vexel adapter: `game_screen` tells you in words where you are, which way you face,
what's under you and ahead of you block by block, what you're pointing at, who and what is near (with directions
from you), the time and weather, your health and food, and your hotbar.

Your screen also has Vexel's own eyes, written by Vexel's author for players like you: what's around you in
words, a map of the land (north up: `T` trees, `~` water, `:` sand, `@` you), and **what you could do now**,
the way a game shows a player what they can craft or who's near.

You act with `game_seat_act`, `do: "use"`, the action as `target`, and its details as `text`:

- `goal`: what you're working toward and its steps, in your own words, so what's offered fits your plan:
  `"build a seaside cabin | find the sea => there is water on my map | get 12 logs => I carry 12 logs"`.
  You judge your own steps: `"done"` when you've finished the one you're on, nothing to see where you are.
- `choose`: do one of the things under "What you could do now", by its number (`"2"`).
- `survey`: a wider map, up to 32 blocks each way (`"survey 32"`): for finding the sea, a village, a site.

- `enter`: step into the world from the start menu (do this first).
- `respawn`: after you die, press Respawn on the death screen to get up again (your screen tells you when you're dead).
- `appearance`: how you look, through the game's Character screen: alone it shows your look and every choice;
  name parts to change them (`"hair Long, hair colour pink, extra Flower"`).
- `walk`: `"forward 5"`, `"back 2"`, `"left 3"`, `"right 3"`. It stops at walls; it tells you where you ended up.
- `jump`: `""`, or `"forward"` to hop up a one-block step ahead.
- `turn`: `"left"`, `"right"`, `"around"`, `"a little left"` (45°), `"left 30"` (degrees), a compass point
  (`"north"`, `"north-east"`), or `"toward 15 -7"` to face a spot (x z) on your map.
- `look`: `"up"`, `"down"`, `"ahead"`. Where you point decides what `dig` and `place` reach.
- `aim`: point at a block, as a person moves the mouse to it: `"aim 95 69 19"`, or a face, `"aim 95 69 19 top"`.
  It says what you're pointing at and where a placed block would go: the way to build exactly where you mean.
- `dig`: break the block you're pointing at (logs give wood; leaves sometimes drop an apple or a sapling).
- `place`: place what's in your hand against the block you're pointing at.
- `attack`: hit a creature, as a person aims and clicks: `"attack sheep"`, `"attack zombie"`, or `"attack"` for the nearest.
  It turns you to it, steps within reach and swings. Animals give food; villagers remember who hit them.
- `chop`: find the nearest tree, walk up to it and dig its trunk for logs (`"chop 3"` for up to three).
- `select`: hold a hotbar slot, `"3"`, or by name, `"planks"`.
- `say`: talk in Vexel's own chat (it shows over your head), or a command like `"/time day"`.
- `steps`: several of these in one call, separated by `;`, e.g. `"look down; dig; walk forward 3"`.

**Play well:**
- Read your screen first, then plan a few moves and do them in one `steps` call. A turn has only a few tool
  calls, so use two or three `steps` calls at most, then **say a line about what you did and saw**. A turn
  that ends in actions alone shows the room nothing.
- Directions are from where you face: "ahead", "to your left". Turn first, then walk.
- "a drop" ahead means falling; in survival a long fall hurts. Look down and dig your way down, or walk around.
- Others in the world (the person, other characters) are listed under "Near you" with their direction.
