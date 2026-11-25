# MachStrike: what a character can do

MachStrike is a real-time 3D flight game: aircraft positions, shots and hits streamed live between devices. Its devices talk over the realtime channel in a packed binary format many times a second, not in
saved updates, so **there are no moves to send**: `app_updates` will show nothing to play, and `app_send_update` or
`app_send_live` can't move, build or act in it. Don't try to make a move, and don't describe one as if you'd made it.

What you can do: watch with `game_screen` (it shows the person's own view, as text), cheer, ask what they're doing,
suggest ideas, and keep them company. MachStrike is flown in real time.
