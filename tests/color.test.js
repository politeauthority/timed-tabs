import { describe, expect, it } from "vitest";
import { clamp01, dim, fromHex, rampColor, toHex, RAMPS } from "../src/shared/color.js";

describe("clamp01", () => {
  it("clamps into 0..1", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });
});

describe("rampColor", () => {
  it("hits the stops exactly", () => {
    for (const scheme of ["light", "dark"]) {
      const [g, y, r] = RAMPS[scheme].map((s) => s[1]);
      expect(rampColor(0, scheme)).toEqual(g);
      expect(rampColor(0.5, scheme)).toEqual(y);
      expect(rampColor(1, scheme)).toEqual(r);
    }
  });

  it("interpolates between stops and clamps outside 0..1", () => {
    const mid = rampColor(0.25, "light");
    const [g, y] = RAMPS.light.map((s) => s[1]);
    mid.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(Math.min(g[i], y[i]));
      expect(v).toBeLessThanOrEqual(Math.max(g[i], y[i]));
    });
    expect(rampColor(-5)).toEqual(rampColor(0));
    expect(rampColor(9)).toEqual(rampColor(1));
  });

  it("falls back to light for unknown schemes", () => {
    expect(rampColor(0, "sepia")).toEqual(rampColor(0, "light"));
  });
});

describe("hex helpers", () => {
  it("round-trips", () => {
    expect(toHex([0, 128, 255])).toBe("#0080ff");
    expect(fromHex("#0080ff")).toEqual([0, 128, 255]);
    expect(fromHex("0080FF")).toEqual([0, 128, 255]);
    expect(fromHex("nope")).toBeNull();
  });
});

describe("dim", () => {
  it("blends towards the background", () => {
    expect(dim([0, 0, 0], [100, 100, 100], 0)).toEqual([0, 0, 0]);
    expect(dim([0, 0, 0], [100, 100, 100], 0.5)).toEqual([50, 50, 50]);
    expect(dim([0, 0, 0], [100, 100, 100], 1)).toEqual([100, 100, 100]);
  });
});

describe("vivid ramp", () => {
  it("is selected with the 'vivid' scheme", () => {
    expect(rampColor(0, "vivid")).toEqual([0x2e, 0xcc, 0x71]);
    expect(rampColor(1, "vivid")).toEqual([0xe7, 0x4c, 0x3c]);
  });
});
