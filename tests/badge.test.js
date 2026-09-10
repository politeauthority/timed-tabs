import { describe, expect, it } from "vitest";

globalThis.browser ??= { action: { setBadgeText() {} } };
const { badgeText } = await import("../src/background/indicators/badge.js");

describe("badgeText", () => {
  it("rounds to the coarsest useful unit", () => {
    expect(badgeText({ remainingSeconds: 0 })).toBe("!");
    expect(badgeText({ remainingSeconds: 45 })).toBe("45s");
    expect(badgeText({ remainingSeconds: 61 })).toBe("2m");
    expect(badgeText({ remainingSeconds: 1800 })).toBe("30m");
    expect(badgeText({ remainingSeconds: 7300 })).toBe("2h");
  });
  it("is blank for exempt tabs", () => {
    expect(badgeText({ exempt: true, remainingSeconds: 10 })).toBe("");
  });
});

describe("badgeText quiet", () => {
  it("is blank while the user wants fresh tabs left alone", async () => {
    const { badgeText } = await import("../src/background/indicators/badge.js");
    expect(badgeText({ quiet: true, remainingSeconds: 10 })).toBe("");
  });
});
