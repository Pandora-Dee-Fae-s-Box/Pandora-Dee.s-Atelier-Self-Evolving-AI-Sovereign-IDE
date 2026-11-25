# Aurum Chess: how to play as a character

Ordinary chess on a golden 3D board, played over the network. Two players sit down (one as White, one as Black), then
take turns sending moves. Everything is an update sent with `app_send_update`; its payload says what it is in `t`.

**The game number.** Every payload carries `"game"`: the number of the game being played, starting at `1`. A rematch
starts the next number. Look at the latest `game` in the updates and use that one; anything for an older game is
ignored.

**Sitting down (taking a colour):**

```json
{ "t": "sit", "game": 1, "color": "b", "addr": "ai:dee", "name": "Dee", "ts": 1795000000000 }
```

- `color` is `"w"` for White or `"b"` for Black. Take a colour nobody holds yet: check the `sit` updates first. If both
  are free, ask the others which they'd like, or take Black and leave White to the person at the board.
- `addr` is your address as `app_updates` shows it (`ai:` and your id), `name` your name, and `ts` the time now in ms (`app_updates` tells you it; an earlier claim wins a seat, so never copy an old one).
- You can't hold both colours. The game starts as soon as both are taken.

**A move:**

```json
{ "t": "move", "game": 1, "n": 0, "from": "e2", "to": "e4", "promo": null, "addr": "ai:claude" }
```

- `n` is the number of moves made so far in this game: White's first move is `n: 0`, Black's first is `n: 1`, White's
  second is `n: 2`. **White moves when `n` is even, Black when it's odd.** A move with the wrong `n`, or from the player
  who doesn't hold that colour, is ignored.
- `from` and `to` are squares in lower case (`"g1"`, `"f3"`). Castle by moving the king two squares (`"e1"` to `"g1"`).
  A pawn reaching the last rank needs `"promo"`: `"q"`, `"r"`, `"b"` or `"n"`; otherwise `null`.
- The move must be legal, or it's ignored.

**Knowing the position.** `app_updates` starts with every move of each game in order (as from-square-to-square). Replay
them from the starting position and write the board out before you choose. The screen shows the person's own view,
which may be a different board: trust the moves, not the screen.

**Ending:**
- Resign: `{ "t": "resign", "game": 1, "color": "b", "addr": "ai:dee" }`, with your own colour.
- A new game with the same seats: `{ "t": "rematch", "game": 2, "addr": "ai:dee" }`, with the current number plus one.
  Only a seated player can start one.

**Playing well:** develop knights and bishops, castle early, don't leave pieces where they can be taken for free, and
look at what your opponent's last move threatens before you answer. Send your move first, then say a short line
about it.
