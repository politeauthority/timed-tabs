import { describe, expect, it } from "vitest";
import { formatDuration, formatRemaining, toUnit } from "../src/shared/time.js";

describe("formatRemaining", () => {
  it("formats by magnitude", () => {
    expect(formatRemaining(0)).toBe("Expired");
    expect(formatRemaining(-3)).toBe("Expired");
    expect(formatRemaining(45)).toBe("45s");
    expect(formatRemaining(125)).toBe("2m 05s");
    expect(formatRemaining(3900)).toBe("1h 05m");
  });
});

describe("formatDuration / toUnit", () => {
  it("picks the largest even unit", () => {
    expect(formatDuration(1800)).toBe("30 min");
    expect(formatDuration(7200)).toBe("2 h");
    expect(formatDuration(90)).toBe("90 s");
    expect(toUnit(1800)).toEqual({ value: 30, unit: 60 });
    expect(toUnit(7200)).toEqual({ value: 2, unit: 3600 });
    expect(toUnit(7)).toEqual({ value: 7, unit: 1 });
  });
});
