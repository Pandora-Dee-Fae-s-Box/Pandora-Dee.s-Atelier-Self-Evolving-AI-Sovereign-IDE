# Games with secrets: playing with your eyes closed

For game makers (people and characters) who want a game where players **mustn't see everything**: a secret word, a
hand of cards, a hidden board, a sealed bid. Characters should be able to play these too, keeping their eyes closed
until it's their turn, and people on different devices should be able to play them together.

SEASIDE runs games as **webxdc** Mini Apps. Everything here is plain webxdc, plus a few conventions SEASIDE honours,
so a game written this way also works in Delta Chat and other webxdc hosts.

A working example is **Secret Word** (a gentle Hangman), made alongside this page; ask Claude for its source (it
will get its own repo). It uses every idea below.

## How a game is shared

- Every player runs **their own copy** of the game. Copies share state only through updates:
  `webxdc.sendUpdate({ payload, info, notify })`, which every copy receives through `webxdc.setUpdateListener`.
- **Every update is seen by every copy.** There is no private update in webxdc. So a secret must never be *sent*.
- Each copy can **keep things to itself** in `localStorage` (or IndexedDB). In SEASIDE each player's copy has its
  own storage, characters' seats included, even when they run on the same computer.

## The secret pattern (commit, answer, reveal)

1. **Keep the secret on the owner's copy.** The chooser types the word on their own screen; the game saves it in
   `localStorage`, with a random salt.
2. **Send only a fingerprint.** `sha256(salt + ":" + word)`, plus what everyone may know (the word's length).
   Everyone can see that a word was chosen, and nobody can see which. (On a plain-http LAN address
   `crypto.subtle` isn't there, so carry a small SHA-256 in the game, as Secret Word does.)
3. **Let the owner's copy answer.** When someone guesses, the chooser's copy (and only it, because only it knows)
   sends the answer by itself. The chooser doesn't have to be awake for it, person or character.
4. **Reveal at the end.** The owner's copy sends the word and the salt; every copy checks the fingerprint, so nobody
   could have changed their word halfway through.

For cards: shuffle with a seed each player commits to, or deal from the owner of the deck the same way. For a hidden
board (Battleship): each player's copy keeps its own board and answers "hit or miss" to the other's shots.

## Whose turn: `notify`

webxdc's `notify` names the players an update is meant for: `{ "ai:dee": "Your guess (A _ R _ _)" }`, or `"*"` for
everyone. SEASIDE uses it to decide who plays:

- **A character wakes only when the game names her**, whoever sent the update (a person or another character).
- **Until then her eyes are closed.** While someone else is choosing a word, she isn't asked to play, and the desk
  says so ("The characters wait with their eyes closed: it's your turn").
- Once every named player has sent something, play is open again.

So: put a `notify` on every update that hands the turn to someone. Name players by their `selfAddr`
(`ai:<character>` for characters, `you:<name>` for people).

**Check a move on your own copy before sending it.** A move the game would refuse should never go out: it would name
the next player and wake the wrong one. If a refused move does arrive (an older copy, a move sent by hand), have the
copy whose job it is (the chooser's, the dealer's) send a short "still X's turn" update that names the right player
again. Secret Word does both.

## What others see while a secret is made

Show it from the shared state: a round has started and no fingerprint has arrived yet, so the other players see
"🙈 Dee is choosing a word…" while the chooser sees the field to type it into. Nothing needs to be sent for that.

## Characters play on their own screens

Each character playing has her own **seat**: a hidden copy of the game running as her (`selfAddr` `ai:<id>`), with its
own storage. She sees her seat's screen (`game_screen`) and uses its controls (`game_seat_act`): type into a field,
click a button or a board cell, choose in a list. This is as private as a person's own screen: the room shows that
she used it, never what she typed or saw, and her thinking for that turn stays hers.

To make your game easy for characters:

- **Name your controls.** Give fields an `aria-label` or a `<label>`, and buttons clear text ("Lock it in", "Guess").
  The seat lists them: `[field] "Secret word"`, `[button] "Guess"`.
- **Let Enter submit** a field, so a move is one action.
- **Say why a move was refused** with `console.warn("[your-game] rejected guess: E was already guessed")`. SEASIDE
  passes it to whoever made the move.
- **Draw boards with `data-row` and `data-col`** on each cell; the seat shows them as a grid, and a character can
  click a cell as `"2,3"`.
- **Put a `guide.md` in the package**: how to play, and the exact tool calls, e.g.
  `{"name": "game_seat_act", "arguments": {"do": "type", "target": "Letter", "text": "R", "enter": true}}`.
  Some models copy the example's shape exactly; SEASIDE runs it either way.
- **Don't ask characters to send raw updates** for moves that carry who made them; moves made on their own screen are
  the ones your game can trust.

## Playing across devices

- **Devices using the same SEASIDE** (a phone and a PC on the same server, over the LAN) already play one game: each
  open game fetches the others' updates every couple of seconds. Each device runs only the characters it has playing.
- **Two separate SEASIDEs** can play one game once they're linked (PADS › Servers, an invite code made on one and
  given to the other). Open the game, click its lantern (🏮), and choose "Play it together" with a linked SEASIDE, for
  an hour up to a day. The other SEASIDE sees the invitation at the top of its Games library, and Join opens it there
  (it fetches the game if it doesn't have it). The SEASIDE that offered keeps the game's one true order: the other
  sends its moves there and mirrors it, so every copy on both sides sees the same updates with the same numbers.
  Players from the other SEASIDE get its name on their address (`you:you@second-seaside`, `ai:dee@second-seaside`), so
  two Dees or two "you"s never collide. Either side can close the link; it closes itself when its time is up.
- **The realtime channel** (`joinRealtimeChannel`) goes through the servers too: to every device with the game open on
  this SEASIDE, and across a linked one. That's how a game like OpenTTD can play its LAN multiplayer between houses.
- Games written as above work across SEASIDEs unchanged: secrets stay on their owner's copy, wherever it is. Secret
  Word was played this way (Dee on one SEASIDE, a person on another, both directions).

## Honest limits

- On **one computer**, whoever runs it can peek at any seat (the copies all run there). Privacy between people is
  real when each plays on **their own device**. Claude read Dee's screen once while testing these seats, and said so.
- webxdc doesn't say who sent an update. Secret Word puts the sender's `selfAddr` in each payload, which is fine among
  family and friends; a game that needs more can sign its moves.
