// VELDARA — a vintage art-deco travel poster for a floating island that isn't there.
// main.ts (Node 22, stdlib only). Draws the poster procedurally into a pixel
// buffer and writes /output/entry.png (1024x1024, deterministic, no network,
// no external images, no font files — the letters are drawn from a hand-written
// 5x7 vector grid). Outside the grader's container, MAKEFUN_OUTPUT_DIR stands
// in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The scene: a golden sun rises behind a floating island above a sea of
// clouds. On the island a white village and a golden lighthouse; a waterfall
// spills off the island's edge into the clouds, where sailboats drift. The
// only text in the picture is the place name VELDARA, set in large gold
// art-deco capitals at the top.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------- deterministic PRNG (mulberry32, fixed seed) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);

// ---------- colour helpers ----------
type RGB = [number, number, number];
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// ---------- canvas ----------
class Canvas {
  buf = new Uint8ClampedArray(W * H * 4);

  set(x: number, y: number, c: RGB, a = 1): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
    const i = (yi * W + xi) * 4;
    const b = this.buf;
    const ia = 1 - a;
    b[i] = c[0] * a + b[i] * ia;
    b[i + 1] = c[1] * a + b[i + 1] * ia;
    b[i + 2] = c[2] * a + b[i + 2] * ia;
    b[i + 3] = 255;
  }

  // Direct horizontal span write (used by all scanline fills).
  hline(x0: number, x1: number, y: number, c: RGB, a = 1): void {
    const yi = Math.round(y);
    if (yi < 0 || yi >= H) return;
    let xa = Math.max(0, Math.floor(Math.min(x0, x1)));
    let xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1)));
    if (xb < xa) return;
    const b = this.buf;
    const ia = 1 - a;
    const r = c[0] * a;
    const g = c[1] * a;
    const bl = c[2] * a;
    for (let x = xa; x <= xb; x++) {
      const i = (yi * W + x) * 4;
      b[i] = r + b[i] * ia;
      b[i + 1] = g + b[i + 1] * ia;
      b[i + 2] = bl + b[i + 2] * ia;
      b[i + 3] = 255;
    }
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(H - 1, Math.ceil(y + h) - 1);
    for (let yy = y0; yy <= y1; yy++) this.hline(x, x + w - 1, yy, c, a);
  }

  // Vertical gradient rectangle through colour stops [[t, color], ...].
  vgrad(x: number, y: number, w: number, h: number, stops: [number, RGB][]): void {
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(H - 1, Math.ceil(y + h) - 1);
    for (let yy = y0; yy <= y1; yy++) {
      const t = (yy - y) / h;
      let c: RGB = stops[stops.length - 1][1];
      for (let s = 0; s < stops.length - 1; s++) {
        const [t0, c0] = stops[s];
        const [t1, c1] = stops[s + 1];
        if (t >= t0 && t <= t1) {
          c = mix(c0, c1, (t - t0) / (t1 - t0));
          break;
        }
      }
      this.hline(x, x + w - 1, yy, c, 1);
    }
  }

  circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    this.ellipse(cx, cy, r, r, c, a);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(H - 1, Math.ceil(cy + ry));
    for (let yy = y0; yy <= y1; yy++) {
      const dy = (yy - cy) / ry;
      if (dy * dy > 1) continue;
      const dx = rx * Math.sqrt(1 - dy * dy);
      this.hline(cx - dx, cx + dx, yy, c, a);
    }
  }

  // Scanline polygon fill. colourAt(y) lets a caller shade per row.
  poly(pts: [number, number][], c: RGB, a = 1, colourAt?: (y: number) => RGB): void {
    const n = pts.length;
    let yMin = H;
    let yMax = -1;
    for (const [, y] of pts) {
      yMin = Math.min(yMin, Math.floor(y));
      yMax = Math.max(yMax, Math.ceil(y));
    }
    yMin = Math.max(0, yMin);
    yMax = Math.min(H - 1, yMax);
    for (let yy = yMin; yy <= yMax; yy++) {
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % n];
        if ((y1 <= yy && y2 > yy) || (y2 <= yy && y1 > yy)) {
          xs.push(x1 + ((yy - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((p, q) => p - q);
      const col = colourAt ? colourAt(yy) : c;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.hline(xs[k], xs[k + 1], yy, col, a);
      }
    }
  }

  // Thick line: stamps circles along a Bresenham walk.
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB, a = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps === 0) {
      this.circle(x0, y0, width / 2, c, a);
      return;
    }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x0 + dx * t, y0 + dy * t, width / 2, c, a);
    }
  }
}

// ---------- palette ----------
const NAVY: RGB = [20, 38, 62];
const GOLD: RGB = [242, 193, 78];
const GOLD_DEEP: RGB = [217, 164, 65];
const CREAM: RGB = [253, 248, 239];
const WHITE: RGB = [251, 246, 234];
const TERRA: RGB = [198, 91, 57];
const ROCK_TOP: RGB = [138, 106, 79];
const ROCK_BOT: RGB = [74, 53, 39];
const LEAF: RGB = [94, 143, 90];
const LEAF_LT: RGB = [127, 174, 107];
const WATER: RGB = [214, 236, 245];
const WATER_DEEP: RGB = [159, 212, 239];

// ---------- 5x7 hand-written letterforms (1 = filled cell) ----------
const GLYPHS: Record<string, string[]> = {
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  A: ['00100', '01010', '10001', '10001', '11111', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
};

function drawWord(cv: Canvas, word: string, x0: number, y0: number, cell: number, gap: number, fill: RGB, outline: RGB): void {
  let x = x0;
  for (const ch of word) {
    const g = GLYPHS[ch];
    if (!g) continue;
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] !== '1') continue;
        const cx = x + col * cell;
        const cy = y0 + r * cell;
        // Dark outline first (slightly expanded), then the gold cell.
        cv.rect(cx - 2, cy - 2, cell + 4, cell + 4, outline, 1);
        cv.rect(cx, cy, cell, cell, fill, 1);
      }
    }
    x += 5 * cell + gap;
  }
}

// ---------- scene pieces ----------
function drawSky(cv: Canvas): void {
  cv.vgrad(0, 0, W, 700, [
    [0.0, [22, 48, 84]],
    [0.28, [52, 96, 132]],
    [0.48, [232, 168, 110]],
    [0.62, [247, 214, 150]],
    [1.0, [247, 214, 150]],
  ]);
}

function drawSun(cv: Canvas): void {
  const cx = 512;
  const cy = 470;
  // Art-deco rays: alternating wedges fanning out from behind the island.
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2;
    const a1 = ((i + 0.5) / 24) * Math.PI * 2;
    const r0 = 175;
    const r1 = 440;
    cv.poly(
      [
        [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0],
        [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1],
        [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1],
        [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0],
      ],
      [250, 220, 140],
      i % 2 === 0 ? 0.1 : 0.05,
    );
  }
  // Sun disc with a soft halo.
  cv.circle(cx, cy, 185, [250, 222, 148], 0.18);
  cv.circle(cx, cy, 165, [250, 224, 154], 1);
  cv.circle(cx, cy, 150, [252, 230, 170], 1);
}

function drawSkyWisps(cv: Canvas): void {
  const wisps: [number, number, number][] = [
    [150, 240, 46],
    [880, 210, 54],
    [820, 305, 36],
    [120, 330, 30],
  ];
  for (const [x, y, r] of wisps) {
    cv.ellipse(x, y, r, r * 0.32, CREAM, 0.55);
    cv.ellipse(x + r * 0.5, y + 6, r * 0.7, r * 0.26, CREAM, 0.5);
  }
}

function drawBirds(cv: Canvas): void {
  const birds: [number, number, number][] = [
    [330, 250, 9],
    [660, 225, 11],
    [730, 285, 8],
    [250, 305, 7],
  ];
  for (const [x, y, s] of birds) {
    cv.line(x - s, y, x, y - s * 0.55, 2.5, NAVY, 0.85);
    cv.line(x, y - s * 0.55, x + s, y, 2.5, NAVY, 0.85);
  }
}

function drawIsland(cv: Canvas): void {
  const pts: [number, number][] = [
    [190, 478],
    [834, 478],
    [760, 600],
    [640, 672],
    [512, 716],
    [384, 672],
    [264, 600],
  ];
  // Rock with a vertical shade from sunlit top to deep underside.
  cv.poly(pts, ROCK_TOP, 1, (y) => mix(ROCK_TOP, ROCK_BOT, Math.min(1, Math.max(0, (y - 478) / 238))));
  // Strata bands.
  cv.poly([[236, 540], [788, 540], [770, 556], [254, 556]], [60, 42, 30], 0.35);
  cv.poly([[300, 600], [724, 600], [700, 614], [324, 614]], [60, 42, 30], 0.3);
  // Sunlit rim along the plateau edge.
  cv.rect(190, 474, 644, 6, [168, 128, 94], 1);
  // Green terraces on the plateau.
  cv.rect(196, 468, 632, 10, LEAF, 1);
  cv.ellipse(300, 470, 46, 8, LEAF_LT, 1);
  cv.ellipse(560, 470, 58, 9, LEAF_LT, 1);
  cv.ellipse(690, 470, 34, 7, LEAF_LT, 1);
  // A few green patches on the rock face.
  cv.ellipse(420, 545, 40, 12, LEAF, 0.9);
  cv.ellipse(620, 560, 34, 10, LEAF, 0.9);
}

function drawHouse(cv: Canvas, x: number, w: number, h: number): void {
  const base = 478;
  // Walls.
  cv.rect(x, base - h, w, h, WHITE, 1);
  // Terracotta roof (triangle with a small overhang).
  cv.poly(
    [
      [x - 3, base - h],
      [x + w + 3, base - h],
      [x + w / 2, base - h - 16],
    ],
    TERRA,
    1,
  );
  // Windows and a door, placed deterministically by house width.
  const win = 7;
  const nWin = w >= 38 ? 2 : 1;
  for (let i = 0; i < nWin; i++) {
    const wx = x + 6 + i * ((w - 12 - win) / Math.max(1, nWin - 1 || 1));
    cv.rect(wx, base - h + 9, win, 9, NAVY, 1);
  }
  if (w >= 34) cv.rect(x + w / 2 - 4, base - 13, 8, 13, NAVY, 1);
}

function drawVillage(cv: Canvas): void {
  const houses: [number, number, number][] = [
    [235, 34, 34],
    [275, 40, 44],
    [321, 30, 30],
    [357, 44, 50],
    [407, 36, 38],
    [449, 42, 46],
    [497, 30, 32],
    [533, 38, 40],
    [577, 34, 36],
    [617, 40, 44],
    [663, 32, 30],
  ];
  for (const [x, w, h] of houses) drawHouse(cv, x, w, h);
}

function drawLighthouse(cv: Canvas): void {
  const base = 478;
  // Light beams first (behind the tower), sweeping low across the sky.
  cv.poly([[767, 300], [767, 318], [300, 240], [300, 262]], [255, 224, 120], 0.12);
  cv.poly([[767, 300], [767, 318], [1010, 260], [1010, 282]], [255, 224, 120], 0.12);
  // Tapered tower.
  cv.poly([[748, base], [786, base], [780, 340], [754, 340]], WHITE, 1);
  // Gold bands.
  cv.rect(750, 400, 34, 12, GOLD_DEEP, 1);
  cv.rect(752, 440, 30, 12, GOLD_DEEP, 1);
  // Gallery and lamp room.
  cv.rect(740, 322, 54, 18, NAVY, 1);
  cv.rect(748, 296, 38, 26, GOLD_DEEP, 1);
  cv.rect(752, 300, 30, 18, [255, 224, 102], 1);
  cv.circle(767, 309, 26, [255, 224, 102], 0.25);
  cv.circle(767, 309, 9, [255, 240, 150], 1);
  // Dome roof.
  cv.poly([[744, 296], [790, 296], [767, 280]], NAVY, 1);
  // A tiny door at the tower foot.
  cv.rect(762, base - 16, 10, 16, NAVY, 1);
}

function drawWaterfall(cv: Canvas): void {
  // Ribbon spilling off the island's left edge into the clouds.
  cv.poly(
    [
      [196, 478],
      [228, 478],
      [222, 560],
      [206, 640],
      [196, 700],
      [168, 700],
      [172, 630],
      [182, 545],
    ],
    WATER,
    1,
  );
  // Bright streaks down the fall.
  cv.line(205, 490, 196, 680, 3, [255, 255, 255], 0.85);
  cv.line(216, 490, 208, 660, 2.5, [255, 255, 255], 0.7);
  cv.line(190, 500, 182, 660, 2.5, WATER_DEEP, 0.8);
  // Foam where the fall meets the clouds.
  cv.ellipse(182, 700, 34, 12, [255, 255, 255], 0.95);
  cv.ellipse(200, 706, 22, 9, [255, 255, 255], 0.9);
  cv.ellipse(164, 706, 18, 8, [255, 255, 255], 0.9);
}

function drawCloudLayer(cv: Canvas, yBase: number, count: number, rxMin: number, rxMax: number, ry: number, c: RGB, a: number): void {
  for (let i = 0; i < count; i++) {
    const x = 20 + (i / (count - 1)) * (W - 40) + (rand() - 0.5) * 60;
    const y = yBase + (rand() - 0.5) * 26;
    const rx = rxMin + rand() * (rxMax - rxMin);
    cv.ellipse(x, y, rx, ry * (0.8 + rand() * 0.4), c, a);
    cv.ellipse(x - rx * 0.45, y + 8, rx * 0.6, ry * 0.7, c, a);
    cv.ellipse(x + rx * 0.45, y + 8, rx * 0.6, ry * 0.7, c, a);
  }
}

function drawCloudBase(cv: Canvas): void {
  // Solid base for the whole sea of clouds, drawn before the island so no
  // transparent gap ever shows through between the cloud layers.
  cv.vgrad(0, 680, W, H - 680, [
    [0.0, [228, 234, 246]],
    [0.5, [242, 238, 224]],
    [1.0, [253, 248, 239]],
  ]);
}

function drawCloudSea(cv: Canvas): void {
  // Back layer: pale lavender puffs.
  drawCloudLayer(cv, 700, 9, 70, 110, 30, [226, 232, 244], 0.95);
  // Mid layer: cream puffs.
  drawCloudLayer(cv, 790, 9, 80, 120, 36, [246, 236, 212], 0.98);
  // Front layer: white puffs with soft blue-grey undersides.
  for (let i = 0; i < 9; i++) {
    const x = 20 + (i / 8) * (W - 40) + (rand() - 0.5) * 60;
    const y = 900 + (rand() - 0.5) * 30;
    const rx = 90 + rand() * 40;
    const ry = 34 + rand() * 14;
    cv.ellipse(x, y + 8, rx, ry, [195, 206, 222], 0.7);
    cv.ellipse(x, y, rx, ry, CREAM, 1);
    cv.ellipse(x - rx * 0.45, y + 8, rx * 0.6, ry * 0.7, CREAM, 1);
    cv.ellipse(x + rx * 0.45, y + 8, rx * 0.6, ry * 0.7, CREAM, 1);
  }
}

function drawBoat(cv: Canvas, x: number, y: number, s: number): void {
  // Wake on the clouds.
  cv.ellipse(x, y + 15 * s, 42 * s, 5 * s, [255, 255, 255], 0.7);
  // Hull.
  cv.poly(
    [
      [x - 34 * s, y],
      [x + 34 * s, y],
      [x + 24 * s, y + 12 * s],
      [x - 24 * s, y + 12 * s],
    ],
    [107, 66, 38],
    1,
  );
  // Mast.
  cv.line(x, y - 2 * s, x, y - 58 * s, 3, NAVY, 1);
  // Sails.
  cv.poly([[x + 2, y - 56 * s], [x + 2, y - 6 * s], [x + 30 * s, y - 8 * s]], WHITE, 1);
  cv.poly([[x - 2, y - 50 * s], [x - 2, y - 6 * s], [x - 26 * s, y - 8 * s]], [246, 236, 212], 1);
  // Gold stripe on the main sail.
  cv.line(x + 3, y - 40 * s, x + 22 * s, y - 9 * s, 2, GOLD_DEEP, 1);
}

function drawBorder(cv: Canvas): void {
  // Double art-deco frame.
  cv.rect(20, 20, W - 40, 5, GOLD_DEEP, 1);
  cv.rect(20, H - 25, W - 40, 5, GOLD_DEEP, 1);
  cv.rect(20, 20, 5, H - 40, GOLD_DEEP, 1);
  cv.rect(W - 25, 20, 5, H - 40, GOLD_DEEP, 1);
  cv.rect(34, 34, W - 68, 2, GOLD, 0.9);
  cv.rect(34, H - 36, W - 68, 2, GOLD, 0.9);
  cv.rect(34, 34, 2, H - 68, GOLD, 0.9);
  cv.rect(W - 36, 34, 2, H - 68, GOLD, 0.9);
}

// ---------- PNG encoding (zlib + CRC32, stdlib only) ----------
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(cv: Canvas): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0; // filter: None
    Buffer.from(cv.buf.buffer, cv.buf.byteOffset + y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- main ----------
function main(): void {
  const cv = new Canvas();
  drawSky(cv);
  drawSun(cv);
  drawSkyWisps(cv);
  drawBirds(cv);
  drawCloudBase(cv);
  drawIsland(cv);
  drawVillage(cv);
  drawLighthouse(cv);
  drawWaterfall(cv);
  drawCloudSea(cv);
  drawBoat(cv, 300, 862, 1.0);
  drawBoat(cv, 705, 912, 0.72);
  drawBorder(cv);
  // The place name, set in large gold capitals at the top. The only text.
  drawWord(cv, 'VELDARA', 237, 66, 13, 16, GOLD, NAVY);

  const png = encodePNG(cv);
  const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'entry.png'), png);
}

main();
