# Tap Play Toybox

A static, dependency-free web app for a very small child on an iPad. Opening
it shows a chooser with five big picture cards; there is almost no text
anywhere. Built and tuned for an iPad Pro 12.9-inch (3rd generation).

## Flying things

Tap the sky and an airplane, helicopter, balloon, rocket, boat or car appears
under your finger, already being dragged. Shapes are in the bottom bar, colours
on the right-hand rail (the last swatch is a rainbow — a surprise colour every
tap). The green button sets everything drifting, and each kind moves in
character:

- **Airplanes and helicopters** fly in long, continuously changing arcs — each
  one carries its own turn rate that drifts to a new value every few seconds,
  so nobody ever flies in a straight line or retraces a path. They bounce off
  the edges, and a bounce also picks a fresh curve.
- **Balloons** sway upward and wrap around from the top.
- **Rockets** always want to go up. However one is thrown, its heading arcs
  back toward vertical, it weaves gently as it climbs, and it does **not**
  bounce — it flies off the edge and is gone from the canvas for good. Tap to
  launch another.
- **Boats and cars** stay level and settle into lanes near the ground.

Flicking something while it is moving throws it. The throw is brief: it shoots
off fast and then eases back down to its own cruising speed over a couple of
seconds.

## Drawing

A canvas with five implements — **crayon** (waxy and grainy), **marker** (fat
and solid), **pencil** (thin and scratchy), **glitter** (the colour walks
around the wheel as you go) and **magic**, whose glowing ink slowly evaporates
about three and a half seconds after you draw it. The last button in the bar
opens a tray of stickers: the same six things from the other game, tappable
onto the page and draggable afterwards.

## Picture cards

A naming game. On opening, pick a group — **animals** (dog, cat, fish, bird,
cow, pig, duck, frog, bee), **food** (tomato, bread, pasta, cheese, banana,
carrot, grapes, strawberry, broccoli), **vehicles**, **shapes** or **colours** —
and get a 3x3 board of nine pictures. Nine per
group, always the same nine, dealt in a new order each time, because a
consistent set is what a small child actually learns from.

Say "where's the puppy?" and let them find it. Tapping a card turns it over to
a flash-card back carrying the thing's name; tapping again turns it back to the
picture. **Press and hold the purple button** to turn the whole board over at
once — it looks at what is showing and does the visible thing, so if you can
mostly see pictures it hides them and otherwise it reveals them. That stays
predictable even after cards have been turned by hand.

The group buttons stay in the bar so you can switch at any time, and
**press-and-hold on the red button** re-deals a freshly shuffled board.

## Pop the balloons

Balloons drift up from the bottom; tap one and it bursts with a pop and a spray
of confetti. Several fingers at once is fine. There are no rules and no way to
lose — the spawner keeps about nine in the air, so there is always something to
reach for. Press and hold the red button to pop the whole lot at once.

## Scratch to find the picture

A picture hides under a coloured cover. Drag a finger and the cover wipes away,
revealing the picture and the backdrop around it. The picture is picked at
random from all 45 card subjects, and **press and hold the red button to
shuffle** — a new picture and a fresh cover. Undo brings the old picture and
your scratches back.

## All five games

- The **right-hand rail** picks the colour — of the next thing, the next
  stroke, or the next sticker.
- The **small grey button** is for grown-ups: **press and hold it** to open
  settings, where you can change the background, mute the sound, or go back to
  the chooser. There are seven backgrounds — sky, blank white, dotted paper,
  starry night, under the sea, sunset and tropical island.
- **Each game keeps its own background**, remembered separately:
  - *flying things* starts on the grassy field and sky, and can be changed
  - *drawing* starts on the dotted paper, and can be changed
  - *pop the balloons* starts on the sky, and can be changed
  - *scratch* starts on the dotted paper, and can be changed
  - *picture cards* is **always** the dotted paper and offers no picker at all,
    so the pictures always sit on the same quiet ground
- In the card game the **turn-everything-over button** sits in the top-right
  corner of the canvas rather than in the bar. The card grid reserves room for
  it on whichever axis has slack — the side margin on a wide screen, the band
  above on a tall one — so it never covers a card.
- The **big red button** clears everything, and also needs a **press and
  hold** so a stray tap can't wipe the page. For five seconds afterwards it
  turns into an undo button that puts everything back — drawing included. In
  the card game it re-deals instead, and undo brings the old board back.
- Up to 25 things or stickers at a time; past that the oldest fades out.
- The colour rail is hidden in the card game, where there is nothing to colour,
  and the board takes the full width instead.

## Getting it onto the iPad

The [**Sitecase**](https://apps.apple.com/app/sitecase/id6762896369) app has
been tested and works: it opens this folder's `index.html` directly on the
iPad, fully offline, no wifi or network needed at all — handy on a plane.
There are probably other ways to get a static folder like this onto an iPad
too.

## Files

- `index.html` — all five screens, plus every sprite as a `<symbol>` template
- `styles.css` — layout, the seven background presets, buttons, chooser
- `core.js` — sprites, sound + mute, backgrounds, colour rail, settings,
  press-and-hold, undo, and the screen router
- `play.js` — the flying-things game
- `draw.js` — the drawing game
- `cards.js` — the picture-card game
- `pop.js` — the balloon game
- `scratch.js` — the scratch-off game

One thing the card game does not do: say the names out loud. A grown-up reads
the card. `speechSynthesis` could speak each name on flip if that would help —
it is a few lines in `cards.js` and would respect the existing mute switch.

## Two things worth knowing if you touch draw.js

**Why the strokes look smooth.** Every implement follows three rules, and
breaking any one of them brings back a visible row of dots along the line:

1. All the samples from one pointer event become **one** path, curved through
   their midpoints. Stroking each sample as its own little line leaves a round
   cap at every join.
2. The body is painted at **alpha 1**. Two translucent passes that overlap
   double their alpha, and a chain of those overlaps *is* the row of dots.
   Softness comes from a lighter colour instead — see `lighten()`.
3. Anything that belongs under the stroke (the marker's bleed halo) is drawn
   with `destination-over`, so it can never repaint what is already down.

The crayon is the deliberate exception: its grain really is made of dabs, so it
walks the path at a fixed spacing, carrying the leftover distance between
events so there is never a gap or a clump at an event boundary.

**Anything periodic must be paced by time, not frames.** The target device (an
iPad Pro 12.9-inch, 3rd generation) runs at 120Hz. The disappearing ink used
to remove a fixed amount of alpha every fourth frame, which made it evaporate
about three times too fast on a ProMotion screen. It now accumulates elapsed
time and bites at a fixed 15 per second, so the ink lasts the same ~3.5
seconds at 14fps, 60fps or 120Hz.
