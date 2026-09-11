/**
 * The Timed Tabs dial, described as geometry rather than drawn.
 *
 * The same mark has to appear in three places that have nothing in common:
 * the toolbar button, repainted per tab as a tab ages (canvas at runtime);
 * the packaged `icons/icon-*.png` set (rasterised by scripts/icons.mjs); and
 * `icons/icon.svg`. Describing the shapes once and rendering them three ways
 * is what stops the shipped icon drifting away from the live one, which is
 * how the old hand-maintained PNGs ended up unrelated to the SVG.
 *
 * Everything here is pure: no canvas, no DOM, no extension API. The units are
 * a 32x32 grid, and `size` is only ever a hint about how much detail survives.
 *
 * Angles are turns, not radians: 0 is twelve o'clock and they increase
 * clockwise, which is the direction the ring drains.
 */

/** The design grid every coordinate below is expressed in. */
export const GRID = 32;

/** How faint the spent part of the ring sits behind the remaining part. */
const TRACK_ALPHA = 0.2;

/**
 * The resting mark: enough ring spent to read as a timer rather than a plain
 * clock. It is what the packaged icons draw and what the toolbar button falls
 * back to for a tab with no timer running, so both come from here.
 */
export const IDENTITY_PROGRESS = 0.25;

/**
 * Stroke weights and hand lengths by render size, hinted rather than scaled.
 *
 * Two things go wrong when a 128px dial is simply shrunk. The ring turns to
 * mush below about 3 device pixels, so small renders get a heavier one; and
 * the hands weld themselves to the inside of the ring, so they also get
 * shorter, holding open a gap of at least a pixel between the hand tips and
 * the ring. Read as `ring` and `hand` being stroke widths, `minute` and
 * `hour` the lengths of the two hands from the centre.
 */
export function metrics(size) {
  if (size <= 20) return { radius: 11, ring: 5.2, hand: 3.4, minute: 4.7, hour: 3.4 };
  if (size <= 40) return { radius: 11, ring: 5.2, hand: 3.2, minute: 5.6, hour: 4.2 };
  return { radius: 11, ring: 5, hand: 3, minute: 5.8, hour: 4.4 };
}

/** Where a hand of length `len` ends, `turn` turns clockwise from twelve. */
function handEnd(turn, len) {
  const angle = turn * Math.PI * 2;
  return [GRID / 2 + Math.sin(angle) * len, GRID / 2 - Math.cos(angle) * len];
}

/**
 * The dial as a flat list of shapes, in paint order.
 *
 * `state` is "running" (ring drains as `progress` goes 0 -> 1), "flash" (a
 * solid disc, the loud half of a blink) or "expired" (solid disc with an
 * exclamation knocked out of it).
 *
 * Every shape is the one colour or a hole punched out of it. Nothing is white
 * and nothing is dark, because the same image has to sit on a light and a
 * dark toolbar.
 */
export function dialShapes({ progress = 0, size = GRID, state = "running" } = {}) {
  const c = GRID / 2;
  const m = metrics(size);

  if (state === "flash" || state === "expired") {
    const disc = [{ kind: "disc", cx: c, cy: c, r: m.radius + m.ring / 2 }];
    return state === "flash" ? disc : [...disc, { kind: "erase", shapes: bangShapes() }];
  }

  const remaining = 1 - Math.min(1, Math.max(0, progress));
  const shapes = [
    { kind: "arc", cx: c, cy: c, r: m.radius, width: m.ring, from: 0, to: 1, alpha: TRACK_ALPHA },
  ];
  // A sliver of ring left is still worth drawing; none at all is not.
  if (remaining > 0) {
    shapes.push({ kind: "arc", cx: c, cy: c, r: m.radius, width: m.ring, from: 0, to: remaining });
  }

  const [mx, my] = handEnd(0, m.minute);
  const [hx, hy] = handEnd(1 / 3, m.hour);
  shapes.push(
    { kind: "capsule", x1: c, y1: c, x2: mx, y2: my, width: m.hand },
    { kind: "capsule", x1: c, y1: c, x2: hx, y2: hy, width: m.hand },
  );
  return shapes;
}

/** The exclamation that marks an expired tab, punched out of a solid disc. */
function bangShapes() {
  return [
    { kind: "capsule", x1: 16, y1: 9.8, x2: 16, y2: 16.6, width: 3.4 },
    { kind: "disc", cx: 16, cy: 21.6, r: 1.9 },
  ];
}

/**
 * Paint `shapes` onto a Canvas2D context sized `size` x `size`, in `color`
 * (a CSS colour string). The context is left as it was found.
 *
 * Kept next to the geometry because the runtime indicator and the build
 * script must agree pixel for pixel; scripts/icons.mjs reimplements this
 * against a plain pixel buffer and the two are checked against each other
 * in the unit tests.
 */
export function paintShapes(ctx, shapes, size, color) {
  const scale = size / GRID;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  for (const shape of shapes) paintShape(ctx, shape, color);
  ctx.restore();
}

function paintShape(ctx, shape, color) {
  if (shape.kind === "erase") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    for (const inner of shape.shapes) paintShape(ctx, inner, color);
    ctx.restore();
    return;
  }

  ctx.save();
  if (shape.alpha !== undefined) ctx.globalAlpha = shape.alpha;
  ctx.beginPath();
  if (shape.kind === "disc") {
    ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape.kind === "arc") {
    // Butt caps: the drained end of the ring is a clean radial edge, which is
    // what makes a nearly-full ring read as nearly-full.
    ctx.lineWidth = shape.width;
    ctx.lineCap = "butt";
    const start = -Math.PI / 2 + shape.from * Math.PI * 2;
    const end = -Math.PI / 2 + shape.to * Math.PI * 2;
    ctx.arc(shape.cx, shape.cy, shape.r, start, end);
    ctx.stroke();
  } else if (shape.kind === "capsule") {
    ctx.lineWidth = shape.width;
    ctx.lineCap = "round";
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Convenience: the whole mark onto a context, in one call. */
export function drawDial(ctx, { progress = 0, size = GRID, state = "running", color = "#2ecc71" } = {}) {
  paintShapes(ctx, dialShapes({ progress, size, state }), size, color);
}
