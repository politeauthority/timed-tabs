#!/usr/bin/env node
/**
 * Regenerate src/icons/ from the dial geometry in src/shared/icon-art.js.
 *
 *   npm run icons            # write the SVG and the PNG set
 *   npm run icons -- --check # fail if what is committed is not what this produces
 *
 * There is no image library here on purpose: the mark is a ring, two round
 * capsules and a disc, so the shapes can be sampled directly and the PNG
 * written with node:zlib. That keeps the icons reproducible from a plain
 * `npm ci` with no native dependency, and it keeps the raster set honest -
 * the old PNGs had drifted away from icon.svg because nothing regenerated
 * them.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { GRID, IDENTITY_PROGRESS, dialShapes } from "../src/shared/icon-art.js";
import { VIVID_RAMP, toHex } from "../src/shared/color.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "src", "icons");

const IDENTITY_COLOR = toHex(VIVID_RAMP[0][1]);
const SIZES = [16, 32, 48, 96, 128];

/* ----------------------------------------------------------- sampling --- */

/** Is `(x, y)`, in grid units, inside `shape`? */
function covers(shape, x, y) {
  if (shape.kind === "disc") {
    return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2;
  }
  if (shape.kind === "arc") {
    const dx = x - shape.cx;
    const dy = y - shape.cy;
    const d = Math.hypot(dx, dy);
    if (d < shape.r - shape.width / 2 || d > shape.r + shape.width / 2) return false;
    if (shape.to - shape.from >= 1) return true;
    // Turns clockwise from twelve, matching icon-art's angle convention.
    let turn = Math.atan2(dx, -dy) / (Math.PI * 2);
    if (turn < 0) turn += 1;
    return turn >= shape.from && turn <= shape.to;
  }
  if (shape.kind === "capsule") {
    const vx = shape.x2 - shape.x1;
    const vy = shape.y2 - shape.y1;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - shape.x1) * vx + (y - shape.y1) * vy) / len2));
    const dx = x - (shape.x1 + vx * t);
    const dy = y - (shape.y1 + vy * t);
    return dx * dx + dy * dy <= (shape.width / 2) ** 2;
  }
  return false;
}

/** Alpha at one sample point, compositing the shapes in paint order. */
function alphaAt(shapes, x, y) {
  let a = 0;
  for (const shape of shapes) {
    if (shape.kind === "erase") {
      for (const inner of shape.shapes) if (covers(inner, x, y)) a = 0;
      continue;
    }
    if (!covers(shape, x, y)) continue;
    const s = shape.alpha ?? 1;
    a = a + s * (1 - a);
  }
  return a;
}

/**
 * Rasterise `shapes` into an RGBA buffer, `ss` x `ss` samples per pixel.
 * One colour throughout, so only the alpha channel varies and there is no
 * blending to get wrong.
 */
export function rasterise(shapes, size, [r, g, b], ss = 8) {
  const data = Buffer.alloc(size * size * 4);
  const unit = GRID / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let total = 0;
      for (let sy = 0; sy < ss; sy++) {
        const y = (py + (sy + 0.5) / ss) * unit;
        for (let sx = 0; sx < ss; sx++) {
          total += alphaAt(shapes, (px + (sx + 0.5) / ss) * unit, y);
        }
      }
      const i = (py * size + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round((total / (ss * ss)) * 255);
    }
  }
  return data;
}

/* ------------------------------------------------------------ encoding --- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** Minimal RGBA PNG: one IDAT, filter 0 on every scanline. */
export function encodePng(rgba, width, height = width) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- SVG --- */

const round = (n) => Number(n.toFixed(3));

function arcPath({ cx, cy, r, from, to }) {
  const point = (turn) => {
    const angle = turn * Math.PI * 2;
    return [round(cx + Math.sin(angle) * r), round(cy - Math.cos(angle) * r)];
  };
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  const large = to - from > 0.5 ? 1 : 0;
  return `M${x1} ${y1}A${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function toSvg(shapes, color) {
  const body = [];
  const draw = (shape, extra = "") => {
    const alpha = shape.alpha !== undefined ? ` opacity="${shape.alpha}"` : "";
    if (shape.kind === "disc") {
      body.push(`<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${color}"${alpha}${extra}/>`);
    } else if (shape.kind === "arc" && shape.to - shape.from >= 1) {
      body.push(
        `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="none" stroke="${color}" stroke-width="${shape.width}"${alpha}${extra}/>`,
      );
    } else if (shape.kind === "arc") {
      body.push(
        `<path d="${arcPath(shape)}" fill="none" stroke="${color}" stroke-width="${shape.width}"${alpha}${extra}/>`,
      );
    } else if (shape.kind === "capsule") {
      body.push(
        `<line x1="${round(shape.x1)}" y1="${round(shape.y1)}" x2="${round(shape.x2)}" y2="${round(shape.y2)}" stroke="${color}" stroke-width="${shape.width}" stroke-linecap="round"${alpha}${extra}/>`,
      );
    }
  };
  for (const shape of shapes) {
    if (shape.kind === "erase") continue; // The identity mark has nothing knocked out.
    draw(shape);
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${GRID}" height="${GRID}">`,
    "  <!-- Generated by scripts/icons.mjs from src/shared/icon-art.js. Do not edit by hand. -->",
    ...body.map((line) => `  ${line}`),
    "</svg>",
    "",
  ].join("\n");
}

/* ----------------------------------------------------------------- run --- */

/** The icons as they should be on disk, ready to compare or write. */

function artefacts() {
  const rgb = VIVID_RAMP[0][1];
  const files = [];
  for (const size of SIZES) {
    const shapes = dialShapes({ progress: IDENTITY_PROGRESS, size });
    files.push({ name: `icon-${size}.png`, bytes: encodePng(rasterise(shapes, size, rgb), size) });
  }
  const svgShapes = dialShapes({ progress: IDENTITY_PROGRESS, size: 128 });
  files.push({ name: "icon.svg", bytes: Buffer.from(toSvg(svgShapes, IDENTITY_COLOR), "utf8") });
  return files;
}

// Importable for tests and previews; only writes when run as a script.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { name, bytes } of artefacts()) {
    const path = join(iconsDir, name);
    const current = existsSync(path) ? readFileSync(path) : null;
    if (current && current.equals(bytes)) continue;
    if (check) {
      console.error(`stale: src/icons/${name}`);
      stale += 1;
      continue;
    }
    writeFileSync(path, bytes);
    console.log(`wrote src/icons/${name} (${bytes.length} bytes)`);
  }
  if (check && stale) {
    console.error(`\n${stale} icon(s) out of date. Run \`npm run icons\`.`);
    process.exit(1);
  }
  if (check && !stale) console.log("icons up to date");
}
