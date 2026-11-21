# VELDARA — The Poster for a Place That Isn't There

![make.fun badge](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)
![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/yansz54/poster-place/rank.svg)
![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/yansz54/poster-place/reward.svg)

A vintage art-deco travel poster for **VELDARA**, a floating island that
doesn't exist — drawn entirely in code.

## The poster

A golden sun rises behind a floating island above a sea of clouds. On the
island: a white village with terracotta roofs and a golden lighthouse. A
waterfall spills off the island's edge into the clouds below, where
sailboats drift. The only text in the picture is the place name **VELDARA**,
set in large gold art-deco capitals at the top.

## How it is made

`main.ts` (Node 22, standard library only) draws the poster procedurally
into a pixel buffer — sky gradient, sunburst rays, the island's rock with
strata and green terraces, the village, the lighthouse with its light
beams, the waterfall, layered cloud puffs, sailboats, birds — then encodes
the buffer as a PNG with a hand-written encoder (`node:zlib` deflate +
CRC32). No external images, no font files, no network: the letters are
drawn from a hand-written 5×7 vector grid, and every "random" placement
comes from a seeded PRNG, so two runs produce byte-identical output.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png — 1024×1024, deterministic
```

See [METHOD.md](METHOD.md) for the full breakdown of the scene and the
drawing techniques.
