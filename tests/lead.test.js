import { describe, expect, it } from "vitest";
import { formatLead, leadFromElapsedPercent, leadReached, leadSeconds, parseLead } from "../src/shared/lead.js";
import { migrateSettingKeys } from "../src/shared/settings.js";
import { parseBundle } from "../src/shared/backup.js";

describe("parseLead", () => {
  it("reads a share and an amount, and nothing else", () => {
    expect(parseLead("40%")).toEqual({ percent: 40 });
    expect(parseLead("600s")).toEqual({ seconds: 600 });
    expect(parseLead(" 5s ")).toEqual({ seconds: 5 });
    for (const bad of ["0%", "100%", "0s", "40", "%", "", 40, null, "10m"]) expect(parseLead(bad)).toBeNull();
  });
  it("round-trips through formatLead", () => {
    expect(formatLead(parseLead("40%"))).toBe("40%");
    expect(formatLead(parseLead("90s"))).toBe("90s");
  });
});

describe("leadReached", () => {
  it("a share is measured against progress, from the far end", () => {
    expect(leadReached("40%", 0.59, 999)).toBe(false);
    expect(leadReached("40%", 0.6, 999)).toBe(true);
  });
  it("an amount is measured against the seconds left, whatever the lifetime", () => {
    expect(leadReached("600s", 0.1, 601)).toBe(false);
    expect(leadReached("600s", 0.1, 600)).toBe(true);
  });
  it("an amount longer than the lifetime shows from the start", () => {
    expect(leadReached("7200s", 0, 1800)).toBe(true);
    expect(leadSeconds("7200s", 1800)).toBe(1800);
    expect(leadSeconds("25%", 1800)).toBe(450);
  });
  it("an unreadable lead never hides anything", () => {
    expect(leadReached(undefined, 0, 1800)).toBe(true);
  });
});

describe("migration from quietUntilPercent", () => {
  it("turns the share that had to pass into the share that must be left", () => {
    expect(leadFromElapsedPercent(40)).toBe("60%");
    expect(leadFromElapsedPercent(0)).toBe("99%");
    expect(leadFromElapsedPercent(100)).toBe("1%");
    expect(leadFromElapsedPercent(500)).toBeNull();
  });
  it("turns flashLeadSeconds into an amount lead", () => {
    expect(migrateSettingKeys({ flashLeadSeconds: 45 })).toEqual({ flashLead: "45s" });
    expect(migrateSettingKeys({ flashLeadSeconds: 45, flashLead: "10%" })).toEqual({ flashLead: "10%" });
    expect(migrateSettingKeys({ flashLeadSeconds: "x" })).toEqual({});
  });
  it("migrates a settings object and drops the old key, keeping a new one already there", () => {
    expect(migrateSettingKeys({ quietUntilPercent: 40, x: 1 })).toEqual({ quietStart: "60%", x: 1 });
    expect(migrateSettingKeys({ quietUntilPercent: 40, quietStart: "10s" })).toEqual({ quietStart: "10s" });
    expect(migrateSettingKeys({ quietUntilPercent: 500 })).toEqual({});
  });
  it("applies to a backup's settings and to each rule's overrides", () => {
    const { settings, rules, warnings } = parseBundle(
      JSON.stringify({
        timedTabs: 1,
        settings: { quietUntilPercent: 25 },
        rules: [{ id: "a", pattern: "x.com/*", match: "wildcard", priority: 5, set: { quietUntilPercent: 50 } }],
      }),
    );
    expect(settings.quietStart).toBe("75%");
    expect(rules[0].set.quietStart).toBe("50%");
    expect(warnings).toEqual([]);
  });
});
