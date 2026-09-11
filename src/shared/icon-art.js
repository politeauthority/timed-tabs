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
 * clockwise.
 */

/** The design grid every coordinate below is expressed in. */
export const GRID = 32;

/** How faint the spent part of the ring sits behind the remaining part. */
const TRACK_ALPHA = 0.2;

/**
 * The resting mark: a full ring, all the time still to run. It is what the
 * packaged icons draw and what the toolbar button falls back to for a tab
 * with no timer running, so both come from here. It used to sit a quarter
 * spent so the mark read as a timer rather than a clock; the full ring is the
 * clearer identity, and a fresh tab and an untimed one now share it.
 */
export const IDENTITY_PROGRESS = 0;

/**
 * Stroke weights and hand lengths by render size, hinted rather than scaled.
 *
 * Two things go wrong when a 128px dial is simply shrunk. The ring turns to
 * mush below about 3 device pixels, so small renders get a heavier one; and
 * the hands weld themselves to the inside of the ring, so they also get
 * shorter, holding open a gap of at least a pixel between the hand tips and
 * the ring. Read as `ring` and `hand` being stroke widths, `minute` and
 * `hour` the lengths of the two hands from the centre.
 *
 * The ring's outer edge sits on the edge of the grid. Toolbar icons are drawn
 * edge to edge in their 16px box, and a ring that stopped short of it read as
 * the small one in the row.
 */
export function metrics(size) {
  if (size <= 20) return { radius: 13.2, ring: 5.6, hand: 3.6, minute: 5.8, hour: 4.2 };
  if (size <= 40) return { radius: 13.3, ring: 5.4, hand: 3.4, minute: 6.6, hour: 4.9 };
  return { radius: 13.4, ring: 5.2, hand: 3.2, minute: 7, hour: 5.2 };
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
 * exclamation knocked out of it). `hands: false` leaves the running ring
 * bare, for a mark that is no longer telling the time; `mutedHands: true`
 * keeps them but paints them like the spent part of the ring, so an empty
 * ring can still carry a faint clock.
 *
 * Every shape takes the one colour it is painted in, except that `trackColor`
 * gives the spent part of the ring a colour of its own instead of the faint
 * version of the same one, for callers that want the two halves to contrast.
 *
 * By default the arc still to run starts at twelve, so the part already spent
 * opens to the *left* of twelve and eats anticlockwise -- against the hands.
 * That is wrong, and `faceShapes` does it the other way round; `clockwise:
 * true` draws the ring the right way (spent part opening at twelve and
 * sweeping right), but the live button keeps the legacy direction until
 * `primary-icon-interactive` is folded in, rather than changing the mark every
 * user already has. The swatch set in design/icons/clock/ shows the clockwise ring.
 *
 * Every shape is the one colour or a hole punched out of it. Nothing is white
 * and nothing is dark, because the same image has to sit on a light and a
 * dark toolbar.
 */
export function dialShapes({
  progress = 0,
  size = GRID,
  state = "running",
  hands = true,
  mutedHands = false,
  clockwise = false,
  trackColor,
} = {}) {
  const c = GRID / 2;
  const m = metrics(size);

  if (state === "flash" || state === "expired") {
    const disc = [{ kind: "disc", cx: c, cy: c, r: m.radius + m.ring / 2 }];
    return state === "flash" ? disc : [...disc, { kind: "erase", shapes: bangShapes() }];
  }

  const spent = Math.min(1, Math.max(0, progress));
  const track = { kind: "arc", cx: c, cy: c, r: m.radius, width: m.ring, from: 0, to: 1 };
  // A colour of its own is drawn solid; the same colour is drawn faint.
  if (trackColor) track.color = trackColor;
  else track.alpha = TRACK_ALPHA;
  const shapes = [track];
  // A sliver of ring left is still worth drawing; none at all is not.
  if (spent < 1) {
    const remaining = clockwise ? { from: spent, to: 1 } : { from: 0, to: 1 - spent };
    shapes.push({ kind: "arc", cx: c, cy: c, r: m.radius, width: m.ring, ...remaining });
  }
  if (!hands) return shapes;

  const [mx, my] = handEnd(0, m.minute);
  const [hx, hy] = handEnd(1 / 3, m.hour);
  // Muted hands borrow the track's look: its own colour if it has one, the
  // same faintness otherwise.
  const tone = mutedHands ? (trackColor ? { color: trackColor } : { alpha: TRACK_ALPHA }) : {};
  shapes.push(
    { kind: "capsule", x1: c, y1: c, x2: mx, y2: my, width: m.hand, ...tone },
    { kind: "capsule", x1: c, y1: c, x2: hx, y2: hy, width: m.hand, ...tone },
  );
  return shapes;
}

/**
 * Stroke weights for the interactive clock, which is a different animal from
 * the ring: a thin rim holding a filled face, so the weights that keep the
 * ring legible would swallow it. The hands are cut *out* of the face rather
 * than drawn, so they are sized to survive as a hole - a knocked-out hand
 * needs more width than a painted one to read at 16px.
 */
export function faceMetrics(size) {
  if (size <= 20) return { rim: 14.6, rimWidth: 2.8, face: 11.6, hand: 3.4, minute: 8.4, hour: 6 };
  if (size <= 40) return { rim: 14.8, rimWidth: 2.4, face: 12, hand: 3, minute: 8.8, hour: 6.3 };
  return { rim: 14.9, rimWidth: 2.2, face: 12.2, hand: 2.8, minute: 9.2, hour: 6.5 };
}

/** How faint the drained part of the face sits behind the part still to run. */
const FACE_ALPHA = 0.16;

/**
 * The interactive clock: the same mark as `dialShapes`, but the face itself
 * empties instead of a ring draining around it. The wedge still to run is
 * solid and the hands are punched out of it, so a tab with time left reads as
 * a full clock and one nearly out reads as a rim with a sliver in it.
 *
 * `state` adds one the ring has no way to say: "exempt" is a tab that will
 * never expire, no face at all, just the rim and the hands, so there is
 * visibly nothing draining.
 *
 * A stopped clock needs no artwork of its own. The face is drawn from
 * `progress`, and a paused tab's progress is what stops advancing, so the mark
 * freezes where it stood by itself; `STATE_COLORS.paused` takes it off the
 * green-to-red ramp, which is what says stopped rather than merely slow. It
 * used to swap the hands for a pause bar, and that could not survive the
 * drain: the bar is punched *out* of the face, so once the face had gone the
 * bar went with it, and a clock stopped past halfway read as a smear.
 */
export function faceShapes({ progress = 0, size = GRID, state = "running" } = {}) {
  const c = GRID / 2;
  const m = faceMetrics(size);
  const rim = { kind: "arc", cx: c, cy: c, r: m.rim, width: m.rimWidth, from: 0, to: 1 };

  if (state === "flash") return [{ kind: "disc", cx: c, cy: c, r: m.rim + m.rimWidth / 2 }];
  if (state === "expired") {
    return [
      { kind: "disc", cx: c, cy: c, r: m.rim + m.rimWidth / 2 },
      { kind: "erase", shapes: bangShapes() },
    ];
  }
  if (state === "exempt") return [rim, ...handShapes(m)];

  const spent = Math.min(1, Math.max(0, progress));
  const shapes = [
    rim,
    { kind: "wedge", cx: c, cy: c, r: m.face, from: 0, to: 1, alpha: FACE_ALPHA },
  ];
  // The wedge still to run ends at twelve, so the part already spent opens at
  // twelve and sweeps right -- the way the hands move.
  // A sliver of face left is still worth drawing; none at all is not.
  if (spent < 1) shapes.push({ kind: "wedge", cx: c, cy: c, r: m.face, from: spent, to: 1 });
  shapes.push({ kind: "erase", shapes: handShapes(m) });
  return shapes;
}

/** The two hands, at the resting angles the packaged mark uses. */
function handShapes(m) {
  const c = GRID / 2;
  const [mx, my] = handEnd(0, m.minute);
  const [hx, hy] = handEnd(1 / 3, m.hour);
  return [
    { kind: "capsule", x1: c, y1: c, x2: mx, y2: my, width: m.hand },
    { kind: "capsule", x1: c, y1: c, x2: hx, y2: hy, width: m.hand },
  ];
}

/** The exclamation that marks an expired tab, punched out of a solid disc. */
function bangShapes() {
  return [
    { kind: "capsule", x1: 16, y1: 8.6, x2: 16, y2: 17, width: 3.8 },
    { kind: "disc", cx: 16, cy: 22.6, r: 2.2 },
  ];
}

/**
 * Paint `shapes` onto a Canvas2D context sized `size` x `size`, in `color`
 * (a CSS colour string), or in a shape's own `color` where it carries one.
 * The context is left as it was found.
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
  if (shape.color) {
    ctx.fillStyle = shape.color;
    ctx.strokeStyle = shape.color;
  }
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
  } else if (shape.kind === "wedge") {
    // A slice of the face: centre, out to the rim, round, and back.
    const start = -Math.PI / 2 + shape.from * Math.PI * 2;
    const end = -Math.PI / 2 + shape.to * Math.PI * 2;
    ctx.moveTo(shape.cx, shape.cy);
    ctx.arc(shape.cx, shape.cy, shape.r, start, end);
    ctx.closePath();
    ctx.fill();
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
