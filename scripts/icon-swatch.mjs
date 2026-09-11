#!/usr/bin/env node
/**
 * Render the toolbar ring at every position and colour it passes through.
 *
 *   npm run icons:swatch                       # write design/icons/clock/
 *   npm run icons:swatch -- --muted=#8a8f98    # with a colour of your own
 *
 * The button only ever paints 16 and 32 pixel rings, which is too small to
 * judge the mark by. This writes the same geometry at 128 pixels, draining
 * clockwise (the direction the live ring will take when the interactive
 * clock flag is folded in; until then the button keeps the legacy one), one PNG and
 * SVG per five percent of time remaining, and a contact sheet SVG laying them
 * all out on a light and a dark toolbar. It lives outside `src/`, so nothing
 * here ships: it is for the README, the store listing and for looking at the
 * ramp with a human eye. A UI page that wants the ring draws it live from the
 * same geometry instead.
 *
 * Two sets come out:
 *
 *   ring-NNN      the live ring, hands on, coloured along the green -> red
 *                 ramp for that point; `ring-000` is the expired disc.
 *   expired-NNN   the same ring for a tab that has stopped counting: hands on
 *                 at every position but zero, where the ring has gone and the
 *                 hands go with it. `expired-000-hands` keeps them, for
 *                 comparison, and `expired-000-muted` keeps them as faintly
 *                 as the spent ring. Ramp-coloured like the live ring unless
 *                 `--muted` gives it a colour of its own.
 *
 * Colours can be overridden, each as a `#rrggbb` flag:
 *
 *   --color=      the remaining part of the live ring (fixes it, no ramp)
 *   --track=      the spent part of the live ring (default: faint `--color`)
 *   --muted=      the expired ring (fixes it, no ramp; e.g. the paused slate)
 *   --muted-track= the spent part of the expired ring (default: faint ring colour)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { GRID, dialShapes } from "../src/shared/icon-art.js";
import { fromHex, rampColor, toHex } from "../src/shared/color.js";
import { encodePng, rasterise, toSvg } from "./icons.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "design", "icons", "clock");

const SIZE = 128;
/** Time remaining, in percent, one file each. */
const STEPS = Array.from({ length: 21 }, (_, i) => 100 - i * 5);

/* ---------------------------------------------------------------- flags --- */

const flags = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
function colorFlag(name) {
  if (!(name in flags)) return null;
  const rgb = fromHex(flags[name]);
  if (!rgb) {
    console.error(`--${name} wants a #rrggbb colour, got "${flags[name]}"`);
    process.exit(2);
  }
  return rgb;
}
const fixedColor = colorFlag("color");
const trackColor = colorFlag("track");
const mutedColor = colorFlag("muted");
const mutedTrack = colorFlag("muted-track");

/* --------------------------------------------------------------- frames --- */

const name = (prefix, remaining) => `${prefix}-${String(remaining).padStart(3, "0")}`;

/** The live ring with `remaining` percent left, ramp-coloured unless fixed. */
function live(remaining) {
  const progress = 1 - remaining / 100;
  const rgb = fixedColor ?? rampColor(progress, "vivid");
  const state = remaining === 0 ? "expired" : "running";
  const shapes = dialShapes({ progress, size: SIZE, state, clockwise: true, trackColor: trackColor && toHex(trackColor) });
  return { name: name("ring", remaining), shapes, rgb };
}

/** The stopped ring with `remaining` percent left: hands on, except at zero. */
function muted(remaining, hands = remaining > 0, mutedHands = false) {
  const progress = 1 - remaining / 100;
  const shapes = dialShapes({
    progress,
    size: SIZE,
    hands,
    mutedHands,
    clockwise: true,
    trackColor: mutedTrack && toHex(mutedTrack),
  });
  const suffix = remaining === 0 && hands ? (mutedHands ? "-muted" : "-hands") : "";
  return { name: name("expired", remaining) + suffix, shapes, rgb: mutedColor ?? rampColor(progress, "vivid") };
}

const rings = STEPS.map(live);
const expired = [...STEPS.map((r) => muted(r)), muted(0, true), muted(0, true, true)];
const frames = [...rings, ...expired];

/* ---------------------------------------------------------------- sheet --- */

/**
 * All the frames on one sheet: the live ring, then the stopped set, each once
 * on a light toolbar and once on a dark one.
 */
function sheet(sets, cols = 7) {
  const cell = 44;
  const pad = 8;
  const width = cols * cell + pad * 2;
  const strips = [];
  let y = 0;
  for (const set of sets) {
    const stripH = Math.ceil(set.length / cols) * cell + pad * 2;
    for (const fill of ["#f9f9fb", "#2b2a33"]) {
      strips.push({ y, fill, set, stripH });
      y += stripH + pad;
    }
  }
  const body = [];
  for (const strip of strips) {
    body.push(`<rect x="0" y="${strip.y}" width="${width}" height="${strip.stripH}" rx="8" fill="${strip.fill}"/>`);
    strip.set.forEach((f, i) => {
      const x = pad + (i % cols) * cell + (cell - GRID) / 2;
      const gy = strip.y + pad + Math.floor(i / cols) * cell + (cell - GRID) / 2;
      const inner = toSvg(f.shapes, toHex(f.rgb))
        .split("\n")
        .filter((line) => line.startsWith("  <") && !line.startsWith("  <!--"))
        .join("\n");
      body.push(`<g transform="translate(${x} ${gy})">\n${inner}\n</g>`);
    });
  }
  const height = y - pad;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * 2}" height="${height * 2}">`,
    "  <!-- Generated by scripts/icon-swatch.mjs from src/shared/icon-art.js. Do not edit by hand. -->",
    ...body,
    "</svg>",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ run --- */

mkdirSync(outDir, { recursive: true });
for (const f of frames) {
  writeFileSync(join(outDir, `${f.name}.png`), encodePng(rasterise(f.shapes, SIZE, f.rgb), SIZE));
  writeFileSync(join(outDir, `${f.name}.svg`), toSvg(f.shapes, toHex(f.rgb)));
}
writeFileSync(join(outDir, "sheet.svg"), sheet([rings, expired]));
console.log(`wrote ${frames.length} rings and sheet.svg to design/icons/clock/`);
