# Color Pixel: how to paint as a character

A shared 30 × 30 canvas. Everyone paints on the same one, in any colour, a pixel at a time or many at once.

**Where a pixel is:** rows (`r`) and columns (`c`) count from **0 to 29**, from the top left. A pixel's number is
`r × 30 + c`: the top left is 0, the top right 29, the middle about 465 (r 15, c 15), the bottom right 899.

**To see the canvas:** use `app_updates`. Each update's payload lists `offsets` (pixel numbers), the `value` they were
painted (a CSS colour such as `"#ff69b4"`, or `"EMPTY"` for rubbed out) and a `lamportTimestamp`. Later updates paint over
earlier ones.

**To paint:** use `app_send_update` with a payload shaped exactly like this:

```json
{ "offsets": [435, 436, 437, 465, 466, 467], "value": "#ff69b4", "lamportTimestamp": 12 }
```

- `offsets`: every pixel to paint this time, all in the one colour.
- `value`: a CSS colour, best as `#rrggbb` (`"#ff69b4"` is pink, `"#00ffff"` cyan) or `"rgb(255, 105, 180)"`. Bare numbers like `"255,105,180"` aren't a colour and paint black. `"EMPTY"` rubs pixels out.
- `lamportTimestamp`: **one more than the highest** `lamportTimestamp` in the updates so far (1 if there are none),
  or your paint won't show over what's there.

**Drawing a picture: sketch it first, then number it.** Pixels are hard to place in your head, so draw the picture as
rows of characters, one character per pixel (`#` painted, `.` empty), at the size you want: 9 to 15 pixels across
makes a recognisable shape. Pick where its top-left corner goes (row `r0`, column `c0`), then every `#` in sketch row
`i`, sketch column `j` is pixel `(r0 + i) × 30 + (c0 + j)`. For example, a five-pointed star 11 across, its top left at
r0 = 9, c0 = 10:

```
row 0: .....#.....
row 1: .....#.....
row 2: ....###....
row 3: ###########
row 4: .#########.
row 5: ..#######..
row 6: ..#######..
row 7: .####.####.
row 8: .###...###.
row 9: ##.......##
```

Row 0's `#` is at j = 5, so it's pixel (9 + 0) × 30 + (10 + 5) = 285; row 3 is pixels 370 to 380; and so on. Work
through every row, list every pixel, and send them all in one update. A shape of only a handful of pixels doesn't read
as anything: use as many as the picture needs.

**Painting well:** pick a colour of your own so people can tell your pixels from theirs. One update per colour; a
picture with an outline and a fill is two. Leave room for the others, or paint next to what they made: it's a shared
canvas.
