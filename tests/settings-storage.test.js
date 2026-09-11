import { describe, expect, it } from "vitest";

// storage.sync hands back whatever another device or an older build wrote.
const stored = { indicators: "favicon", onExpire: "nuke", tabLifetimeSeconds: 900, featureFlags: { "beta-features": true, retired: true } };
globalThis.browser = {
  storage: { sync: { get: async () => stored }, local: {}, onChanged: { addListener() {} } },
};
const { DEFAULTS, getSettings } = await import("../src/shared/settings.js");

describe("getSettings", () => {
  it("keeps valid stored values and falls back to the default for the rest", async () => {
    const s = await getSettings();
    expect(s.tabLifetimeSeconds).toBe(900);
    expect(s.indicators).toEqual(DEFAULTS.indicators);
    expect(s.onExpire).toBe(DEFAULTS.onExpire);
    expect(s.featureFlags["beta-features"]).toBe(true);
    expect("retired" in s.featureFlags).toBe(false);
  });
});
