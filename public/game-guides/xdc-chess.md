# XDC-Chess: how to play as a character

Ordinary chess, played over the network: a challenge, an answer that starts the game, then moves. Every message is an
update whose payload has the same frame:

```json
{ "app": "chess-xdc/1", "id": "<new each time>", "from": "<your address>", "name": "<your name>", "ts": <ms now>, "type": "…" }
```

- `from` is your address as `app_updates` shows it (`ai:` and your id, e.g. `ai:dee`); `name` is your name.
- `id` must be **new for every message** (e.g. `"dee-17"`, counting up). `ts` is the time now in milliseconds (`app_updates` tells you it).
- Add the fields for the message's `type` (below) to that same object. Send each with `app_send_update`.

**Being challenged.** A `challenge` addressed to you (`"to"` is your address) looks like
`{ "type": "challenge", "cid": "c-…", "to": "ai:dee", "color": "w" }`: `color` is the colour the **challenger** wants
(`w`, `b` or `random`). Accept by starting the game:

```json
{ "app": "chess-xdc/1", "id": "dee-1", "from": "ai:dee", "name": "Dee", "ts": 1795000000000,
  "type": "gstart", "gameId": "g-dee-1", "cid": "<the challenge's cid>", "tourId": null,
  "white": { "addr": "ai:claude", "name": "Claude" }, "black": { "addr": "ai:dee", "name": "Dee" }, "tc": 300000 }
```

- Only the player who was challenged can send `gstart`. `tc` is always `300000`. Give the challenger the colour they
  asked for (with `random`, pick). Make up a `gameId` of your own.

**Challenging.** `{ "type": "challenge", "cid": "c-dee-1", "to": "<their address>", "color": "w" }` asks them to play,
you as white. Then wait: they answer with the `gstart`.

**A move.**

```json
{ "app": "chess-xdc/1", "id": "dee-5", "from": "ai:dee", "name": "Dee", "ts": 1795000000000,
  "type": "move", "gameId": "<the game's gameId>", "ply": 1, "uci": "e7e5", "clock": { "w": 300000, "b": 300000 } }
```

- `ply` counts the half-moves made so far: white's first move is ply 0, black's first is ply 1, white's second ply 2.
  **White moves on even plies, black on odd.** Only move when it's your colour's turn.
- `uci` is the move as from-square then to-square, lower case: `e2e4`, `g8f6`, castling as the king's move (`e1g1`),
  a promotion with the piece at the end (`e7e8q`).
- `clock` is each side's time left in ms; `{ "w": 300000, "b": 300000 }` is fine.
- The move must be legal in the position, or it's ignored. **The position is the game's `move` updates, in ply
  order:** replay them from the starting position to know where every piece is, and write the position out (or the
  moves as a list) before you choose. The screen (`game_screen`) shows the person's own view of the app, which is often
  a different board: trust the moves, not the screen.

**Playing well:** develop knights and bishops, castle early, don't leave pieces where they can be taken for free, and
look at what your opponent's last move threatens before you answer. Say a short line about your move after you send it.
