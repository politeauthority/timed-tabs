import { describe, expect, it } from "vitest";
import { GRID, IDENTITY_PROGRESS, dialShapes, faceMetrics, faceShapes, metrics, paintShapes } from "../src/shared/icon-art.js";
import { decodePng, encodePng, rasterise } from "../scripts/icons.mjs";

const arcs = (shapes) => shapes.filter((s) => s.kind === "arc");
const hands = (shapes) => shapes.filter((s) => s.kind === "capsule");

describe("metrics", () => {
  it("gives small renders a heavier ring and shorter hands", () => {
    const small = metrics(16);
    const large = metrics(128);
    expect(small.ring).toBeGreaterThan(large.ring);
    expect(small.hand).toBeGreaterThan(large.hand);
    expect(small.minute).toBeLessThan(large.minute);
  });

  it("holds the hands clear of the inside of the ring at every size", () => {
    for (const size of [16, 32, 48, 96, 128]) {
      const m = metrics(size);
      const ringInnerEdge = m.radius - m.ring / 2;
      const handReach = m.minute + m.hand / 2;
      // At least a device pixel of daylight, or the hand welds to the ring.
      expect((ringInnerEdge - handReach) * (size / GRID)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("dialShapes", () => {
  it("draws the full track plus the remaining arc", () => {
    const [track, remaining] = arcs(dialShapes({ progress: 0.25 }));
    expect(track.from).toBe(0);
    expect(track.to).toBe(1);
    expect(track.alpha).toBeLessThan(1);
    expect(remaining.from).toBe(0);
    expect(remaining.to).toBeCloseTo(0.75);
    expect(remaining.alpha).toBeUndefined();
  });

  it("drains the ring as progress rises, and keeps both hands", () => {
    // The legacy direction every user has: the remaining arc starts at twelve
    // and its end creeps back anticlockwise.
    let previous = Infinity;
    for (const progress of [0, 0.2, 0.5, 0.8, 0.99]) {
      const shapes = dialShapes({ progress });
      const [, remaining] = arcs(shapes);
      expect(remaining.from).toBe(0);
      expect(remaining.to).toBeLessThan(previous);
      previous = remaining.to;
      expect(hands(shapes)).toHaveLength(2);
    }
  });

  it("drains clockwise when asked, the spent part opening at twelve", () => {
    let previous = -Infinity;
    for (const progress of [0, 0.2, 0.5, 0.8, 0.99]) {
      const [, remaining] = arcs(dialShapes({ progress, clockwise: true }));
      expect(remaining.from).toBeGreaterThan(previous);
      expect(remaining.to).toBe(1);
      previous = remaining.from;
    }
    // Full and empty look the same either way round.
    expect(arcs(dialShapes({ progress: 0, clockwise: true }))[1]).toEqual(arcs(dialShapes({ progress: 0 }))[1]);
    expect(arcs(dialShapes({ progress: 1, clockwise: true }))).toEqual(arcs(dialShapes({ progress: 1 })));
  });

  it("leaves the ring bare when asked for no hands", () => {
    const shapes = dialShapes({ progress: 0.4, hands: false, clockwise: true });
    expect(hands(shapes)).toHaveLength(0);
    const [track, remaining] = arcs(shapes);
    expect(track.to - track.from).toBe(1);
    expect(remaining.from).toBeCloseTo(0.4);
    expect(remaining.to).toBe(1);
  });

  it("paints muted hands the way it paints the track", () => {
    const faint = hands(dialShapes({ progress: 1, mutedHands: true }));
    expect(faint).toHaveLength(2);
    for (const hand of faint) expect(hand.alpha).toBe(arcs(dialShapes({ progress: 1 }))[0].alpha);
    const tinted = hands(dialShapes({ progress: 1, mutedHands: true, trackColor: "#445566" }));
    for (const hand of tinted) {
      expect(hand.color).toBe("#445566");
      expect(hand.alpha).toBeUndefined();
    }
  });

  it("gives the track its own colour, solid, when one is passed", () => {
    const [track, remaining] = arcs(dialShapes({ progress: 0.4, trackColor: "#445566" }));
    expect(track.color).toBe("#445566");
    expect(track.alpha).toBeUndefined();
    expect(remaining.color).toBeUndefined();
  });

  it("rests on a full ring", () => {
    const [, remaining] = arcs(dialShapes({ progress: IDENTITY_PROGRESS }));
    expect(remaining.from).toBe(0);
    expect(remaining.to).toBe(1);
  });

  it("leaves no arc at all once the ring is empty", () => {
    expect(arcs(dialShapes({ progress: 1 })).filter((a) => a.alpha === undefined)).toHaveLength(0);
  });

  it("swaps the ring for a solid disc when flashing or expired", () => {
    expect(dialShapes({ state: "flash" })).toEqual([expect.objectContaining({ kind: "disc" })]);
    const expired = dialShapes({ state: "expired" });
    expect(expired[0].kind).toBe("disc");
    expect(expired[1].kind).toBe("erase");
    expect(expired[1].shapes.length).toBeGreaterThan(0);
  });

  it("stays inside the grid", () => {
    for (const size of [16, 128]) {
      for (const state of ["running", "flash", "expired"]) {
        for (const shape of dialShapes({ progress: 0.4, size, state })) {
          const edges = [];
          if (shape.kind === "disc") edges.push(shape.cx - shape.r, shape.cx + shape.r, shape.cy - shape.r, shape.cy + shape.r);
          if (shape.kind === "arc") {
            const outer = shape.r + shape.width / 2;
            edges.push(shape.cx - outer, shape.cx + outer, shape.cy - outer, shape.cy + outer);
          }
          for (const edge of edges) {
            expect(edge).toBeGreaterThanOrEqual(0);
            expect(edge).toBeLessThanOrEqual(GRID);
          }
        }
      }
    }
  });
});

const wedges = (shapes) => shapes.filter((s) => s.kind === "wedge");
const cutOut = (shapes) => shapes.find((s) => s.kind === "erase")?.shapes ?? [];

describe("faceShapes", () => {
  it("empties the face clockwise from twelve, keeping the rim and the track", () => {
    // The same orientation as the ring: what is left ends at twelve, so the
    // bite opens at twelve and sweeps right as the tab runs down.
    let previous = -Infinity;
    for (const progress of [0, 0.2, 0.5, 0.8, 0.99]) {
      const shapes = faceShapes({ progress });
      const [track, remaining] = wedges(shapes);
      expect(track.to - track.from).toBe(1);
      expect(track.alpha).toBeLessThan(1);
      expect(remaining.to).toBe(1);
      expect(remaining.from).toBeGreaterThan(previous);
      previous = remaining.from;
      expect(arcs(shapes)).toHaveLength(1);
    }
  });

  it("cuts the hands out of the face rather than painting them over it", () => {
    const shapes = faceShapes({ progress: 0.2 });
    expect(cutOut(shapes)).toHaveLength(2);
    expect(shapes.filter((s) => s.kind === "capsule")).toHaveLength(0);
  });

  it("draws a stopped clock exactly as a running one at the same fill", () => {
    // A stopped clock needs no artwork of its own: the face is drawn from
    // `progress`, which is the thing that stops advancing, so it freezes where
    // it stood. Only the colour says stopped, and that is `specFor`'s job.
    // The hands used to give way to a pause bar, which the drain ate: the bar
    // is punched out of the face, so past halfway there was no face to punch.
    for (const progress of [0, 0.4, 0.75, 0.9]) {
      expect(faceShapes({ progress, state: "paused" })).toEqual(faceShapes({ progress }));
    }
  });

  it("keeps the hands legible however far the face has drained", () => {
    // The regression the pause bar had: whatever the fill, the cut-out is the
    // two hands, and they reach beyond the wedge that is left rather than
    // living inside it.
    for (const progress of [0.5, 0.9]) {
      expect(cutOut(faceShapes({ progress }))).toHaveLength(2);
    }
  });

  it("draws a tab that never expires hollow, with nothing draining", () => {
    const shapes = faceShapes({ state: "exempt" });
    expect(wedges(shapes)).toHaveLength(0);
    expect(shapes.filter((s) => s.kind === "capsule")).toHaveLength(2);
  });

  it("blinks and expires the same way the ring does", () => {
    expect(faceShapes({ state: "flash" })).toEqual([expect.objectContaining({ kind: "disc" })]);
    const expired = faceShapes({ state: "expired" });
    expect(expired[0].kind).toBe("disc");
    expect(expired[1].kind).toBe("erase");
  });

  it("holds the hands inside the face at every size, and the face inside the grid", () => {
    for (const size of [16, 32, 48, 96, 128]) {
      const m = faceMetrics(size);
      expect(m.minute + m.hand / 2).toBeLessThan(m.face);
      expect(m.face).toBeLessThan(m.rim - m.rimWidth / 2);
      expect(m.rim + m.rimWidth / 2).toBeLessThanOrEqual(GRID / 2);
    }
  });
});

describe("paintShapes", () => {
  /** Records what the dial asks a canvas to do, without a canvas. */
  function recorder() {
    const calls = [];
    const log = (name) => (...args) => calls.push([name, ...args]);
    return {
      calls,
      ctx: {
        save: log("save"),
        restore: log("restore"),
        scale: log("scale"),
        beginPath: log("beginPath"),
        arc: log("arc"),
        moveTo: log("moveTo"),
        lineTo: log("lineTo"),
        fill: log("fill"),
        stroke: log("stroke"),
      },
    };
  }

  it("scales the 32-unit grid to the requested size", () => {
    const { ctx, calls } = recorder();
    paintShapes(ctx, dialShapes({ progress: 0.5, size: 16 }), 16, "#2ecc71");
    expect(calls.find((c) => c[0] === "scale")).toEqual(["scale", 0.5, 0.5]);
  });

  it("punches the exclamation out instead of painting it another colour", () => {
    const { ctx } = recorder();
    let composite = null;
    ctx.globalCompositeOperation = null;
    Object.defineProperty(ctx, "globalCompositeOperation", {
      set(value) {
        if (value) composite = value;
      },
      get: () => composite,
    });
    paintShapes(ctx, dialShapes({ state: "expired" }), 32, "#e74c3c");
    expect(composite).toBe("destination-out");
  });

  it("restores the context it was handed", () => {
    const { ctx, calls } = recorder();
    paintShapes(ctx, dialShapes({ progress: 0.3 }), 32, "#2ecc71");
    const saves = calls.filter((c) => c[0] === "save").length;
    const restores = calls.filter((c) => c[0] === "restore").length;
    expect(saves).toBe(restores);
  });
});

describe("the generated icon set", () => {
  const green = [0x2e, 0xcc, 0x71];

  it("reads back the pixels it wrote, at every shipped size", () => {
    for (const size of [16, 32, 48, 96, 128]) {
      const pixels = rasterise(dialShapes({ progress: 0.25, size }), size, green);
      const decoded = decodePng(encodePng(pixels, size));
      expect(decoded).not.toBeNull();
      expect([decoded.width, decoded.height]).toEqual([size, size]);
      // Decoding is what lets `npm run icons:check` compare art rather than
      // compressed bytes, which are not stable across zlib builds.
      expect(decoded.pixels.equals(pixels)).toBe(true);
    }
  });

  it("draws something, rather than an empty square", () => {
    const pixels = rasterise(dialShapes({ progress: 0.25, size: 32 }), 32, green);
    const opaque = pixels.filter((_, i) => i % 4 === 3 && pixels[i] > 0);
    expect(opaque.length).toBeGreaterThan(0);
  });

  it("treats a file it did not write as no icon at all", () => {
    expect(decodePng(Buffer.from("not a png"))).toBeNull();
    expect(decodePng(Buffer.alloc(0))).toBeNull();
  });
});
