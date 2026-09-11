import { describe, expect, it } from "vitest";
import { GRID, dialShapes, metrics, paintShapes } from "../src/shared/icon-art.js";

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
    expect(remaining.to).toBeCloseTo(0.75);
    expect(remaining.alpha).toBeUndefined();
  });

  it("drains the ring as progress rises, and keeps both hands", () => {
    let previous = Infinity;
    for (const progress of [0, 0.2, 0.5, 0.8, 0.99]) {
      const shapes = dialShapes({ progress });
      const [, remaining] = arcs(shapes);
      expect(remaining.to).toBeLessThan(previous);
      previous = remaining.to;
      expect(hands(shapes)).toHaveLength(2);
    }
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
