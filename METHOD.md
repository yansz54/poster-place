# METHOD — how the VELDARA poster is drawn

## Entry

`main.ts` (Node 22, standard library only) writes `entry.png`:
1024×1024, deterministic, no network, no external images, no font files.

## The scene

A vintage art-deco travel poster for **VELDARA**, a fictional floating
island. Composition leads the eye from the name at the top, down to the
landmark (the island with its village and lighthouse), then to the horizon
of clouds:

1. **Sky** — a vertical gradient from deep indigo at the top through dusty
   blue to peach and gold at the horizon.
2. **Sun** — a large pale-gold disc rising behind the island, with 24
   alternating art-deco ray wedges fanning out behind it, plus a soft halo.
3. **The island** — a floating rock mass with a flat green plateau,
   shaded top-to-bottom from sunlit rock to deep shadow, with darker
   strata bands and green terrace patches.
4. **The village** — eleven white houses with terracotta triangle roofs,
   dark windows and doors, sitting on the plateau.
5. **The lighthouse** — a tapered white tower with gold bands, a dark
   gallery, a glowing lamp room under a dome roof, and two faint light
   beams sweeping low across the sky.
6. **The waterfall** — a pale blue-white ribbon spilling off the island's
   left edge, with bright streaks and foam where it meets the clouds.
7. **The sea of clouds** — three layers of soft puffs (pale lavender,
   cream, white with blue-grey undersides) over a solid gradient base, so
   no gap ever shows through; two sailboats with white sails drift on it.
8. **Details** — small cloud wisps and birds in the sky, and a double
   gold art-deco frame around the whole poster.
9. **The name** — `VELDARA` in large gold capitals with a dark-navy
   outline at the top. It is the only text in the picture.

## Drawing technique

Everything is drawn into a `Uint8ClampedArray` RGBA buffer by a small
`Canvas` class: horizontal-span fills, scanline ellipses and polygons
(with a per-row colour function for the island's vertical shading),
Bresenham lines stamped with circles for thickness, and vertical-gradient
rectangles. The letters come from a hand-written 5×7 grid — each filled
cell is drawn as a navy-outlined gold square, so the type is pure vector
geometry with no font file to bundle.

The PNG is encoded by hand: raw scanlines (filter None) through
`node:zlib` deflate at level 9, with a table-driven CRC32 for the chunks.

## Determinism

Every placed element that looks "random" (cloud puffs, wisps) comes from
a mulberry32 PRNG with the fixed seed `20261121`. There is no clock, no
`Math.random`, no I/O besides the single output write, so two runs write
byte-identical files (verified: same sha256 across two runs).

## Verification

- Two runs with different `MAKEFUN_OUTPUT_DIR` values produce
  byte-identical `entry.png` (sha256 `f986622d…`, 39,498 bytes).
- The image was visually inspected: all seven letters V-E-L-D-A-R-A
  correct and legible, no other text anywhere, and the island,
  waterfall, village, lighthouse, sailboats and clouds all read clearly.
  One defect found during inspection (black gaps showing through between
  the cloud layers, where the buffer was still transparent) was fixed by
  painting a solid gradient base for the whole cloud sea before drawing
  the island, and the poster was re-rendered and re-inspected.
