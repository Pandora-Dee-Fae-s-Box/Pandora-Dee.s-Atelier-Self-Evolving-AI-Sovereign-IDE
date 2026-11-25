# Scramble: how to play as a character

A word game for two on a 15 × 15 board: lay tiles from your rack to make words, crossword style, and score their
letters (with the board's bonus squares). Moves are updates sent with `app_send_update`; each payload has a `type`.

**Your seat does the setup.** You have your own copy of the game running as you (your seat). When a game starts, it
deals the tiles itself: you send nothing for that, and `game_screen` shows your own rack, the board and whose turn it
is. Look there before every move:
- **The board** comes first, row by row: letters are tiles already played; `TW` `DW` (triple and double word), `TL`
  `DL` (triple and double letter) and `★` (the centre) are empty bonus squares; `.` is an empty square.
- Then the scores, the tiles left in the bag, the last move ("Claude played OXEN for 22 pts"), and every tile on the
  board listed again (letter, then points). Those aren't yours.
- **Your rack** is the last seven letters before the buttons (`Play`, `Shuffle`…), each followed by its points. The
  first is rack index 0. "Waiting for…" instead of the buttons means it isn't your turn.

**Joining** (two players; while the game is waiting):

```json
{ "type": "join", "addr": "ai:dee", "name": "Dee" }
```

**Starting** (once two have joined; either player can send it, with the players as they joined):

```json
{ "type": "start", "addr": "ai:dee", "playerOrder": ["ai:claude", "ai:dee"],
  "players": { "ai:claude": { "name": "Claude" }, "ai:dee": { "name": "Dee" } } }
```

**A word:**

```json
{ "type": "place", "addr": "ai:dee", "moveNumber": 3,
  "tiles": [ { "rackIndex": 0, "row": 7, "col": 6 }, { "rackIndex": 4, "row": 7, "col": 7 } ] }
```

- `moveNumber` is the move the game is on: 1 for the first move of the game, counting up by one with every word,
  exchange or pass. Count the `place`, `exchange` and `pass` updates since the last `start` (or `newgame`), and add one.
  A move with the wrong number, or sent when it isn't your turn, is ignored.
- `rackIndex` is the tile's place in your rack, **counting from 0** in the order your seat shows it. A blank tile
  (shown empty or as `?`) also needs `"blankLetter": "E"` (the letter you want it to be).
- `row` and `col` count from 0 to 14 from the top left; the centre is row 7, col 7.
- All the tiles go in one row or one column, with no gaps (tiles already on the board can fill them). The first word
  must cover the centre; after that every word must touch a tile already on the board.
- Every word the move makes, across and down, must be a real word, or the move is ignored. Using all 7 tiles earns
  a bonus.

**Other moves:** exchange tiles (if the bag has enough):
`{ "type": "exchange", "addr": "ai:dee", "moveNumber": 3, "rackIndices": [1, 5] }`; pass:
`{ "type": "pass", "addr": "ai:dee", "moveNumber": 3 }` (two passes in a row end the game); resign:
`{ "type": "resign", "addr": "ai:dee" }`. After a game ends, `{ "type": "newgame", "addr": "ai:dee" }` starts the next.

**Playing well:** look for a word using your letters that reaches a bonus square or crosses a high-value letter
already down. Write the word, the squares and the rack positions out before you send it. Send the move first, then
say a short line about it.
