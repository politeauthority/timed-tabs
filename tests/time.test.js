import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatRemaining,
  snoozeSeconds,
  toUnit,
} from "../src/shared/time.js";

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

describe("snoozeSeconds", () => {
  it("grants a share of the tab's own lifetime", () => {
    expect(snoozeSeconds(1800, 10)).toBe(180);
    expect(snoozeSeconds(300, 10)).toBe(30);
    expect(snoozeSeconds(1800, 100)).toBe(1800);
    expect(snoozeSeconds(1800, 1)).toBe(18);
  });

  it("rounds to whole seconds", () => {
    expect(snoozeSeconds(25, 10)).toBe(3);
    expect(snoozeSeconds(45, 7)).toBe(3);
  });

  it("never grants nothing, however short the tab or small the share", () => {
    expect(snoozeSeconds(5, 1)).toBe(1);
    expect(snoozeSeconds(0, 50)).toBe(1);
  });

  it("clamps a percentage outside 1..100", () => {
    expect(snoozeSeconds(1800, 0)).toBe(18);
    expect(snoozeSeconds(1800, -5)).toBe(18);
    expect(snoozeSeconds(1800, 400)).toBe(1800);
    expect(snoozeSeconds(1800, undefined)).toBe(18);
  });
});
