import { describe, expect, it } from "vitest";

globalThis.browser ??= { storage: { sync: {}, local: {}, onChanged: { addListener() {} } } };
const { exportBundle, exportText, parseBundle } = await import("../src/shared/backup.js");
const { DEFAULTS } = await import("../src/shared/settings.js");

describe("backup round trip", () => {
  it("exports every setting and survives a parse", () => {
    const rules = [{ id: "a", description: "", pattern: "x.com/*", match: "prefix", priority: 3, set: { tabLifetimeSeconds: 5, neverExpire: true } }];
    const text = exportText({ ...DEFAULTS, tabLifetimeSeconds: 42 }, rules);
    const parsed = parseBundle(text);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.settings.tabLifetimeSeconds).toBe(42);
    expect(Object.keys(parsed.settings).sort()).toEqual(Object.keys(DEFAULTS).sort());
    expect(parsed.rules).toEqual(rules);
    expect(exportBundle(DEFAULTS, []).timedTabs).toBe(1);
  });

  it("rejects non-backups and tolerates bad values", () => {
    expect(() => parseBundle("nope")).toThrow(/valid JSON/);
    expect(() => parseBundle("[1]")).toThrow(/object/);
    expect(() => parseBundle('{"foo":1}')).toThrow(/backup/);
    const p = parseBundle(JSON.stringify({ settings: { tabLifetimeSeconds: -1, bogus: 2, onExpire: "close" }, rules: [1, { pattern: "a", priority: 99, set: { junk: 1 } }] }));
    expect(p.settings).toEqual({ onExpire: "close" });
    expect(p.warnings.length).toBe(3);
    expect(p.rules).toHaveLength(1);
    expect(p.rules[0].priority).toBe(10);
    expect(p.rules[0].set).toEqual({});
  });
});

describe("backup keeps rule descriptions", () => {
  it("round-trips the description", () => {
    const text = exportText(DEFAULTS, [{ id: "a", description: "Why", pattern: "x/*", match: "wildcard", priority: 5, set: {} }]);
    expect(parseBundle(text).rules[0].description).toBe("Why");
  });
});

describe("feature flags in a backup", () => {
  it("exports the flags", () => {
    const bundle = exportBundle({ ...DEFAULTS, featureFlags: { "beta-features": true } }, []);
    expect(bundle.settings.featureFlags).toEqual({ "beta-features": true });
  });

  it("round-trips a flag that is on", () => {
    const text = exportText({ ...DEFAULTS, featureFlags: { "beta-features": true } }, []);
    const { settings, warnings } = parseBundle(text);
    expect(settings.featureFlags).toEqual({ "beta-features": true });
    expect(warnings).toEqual([]);
  });

  it("drops a retired flag on import without complaining", () => {
    const text = JSON.stringify({
      timedTabs: 1,
      settings: { featureFlags: { "beta-features": true, "flag-that-was-retired": true } },
      rules: [],
    });
    const { settings, warnings } = parseBundle(text);
    expect(settings.featureFlags).toEqual({ "beta-features": true });
    expect(warnings).toEqual([]);
  });

  it("takes a backup written before flags existed", () => {
    const text = JSON.stringify({ timedTabs: 1, settings: { tabLifetimeSeconds: 600 }, rules: [] });
    const { settings, warnings } = parseBundle(text);
    expect(settings.tabLifetimeSeconds).toBe(600);
    expect("featureFlags" in settings).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("falls back to the defaults when the flags are not an object", () => {
    for (const junk of ["on", 3, ["beta-features"]]) {
      const text = JSON.stringify({ timedTabs: 1, settings: { featureFlags: junk }, rules: [] });
      const { settings, warnings } = parseBundle(text);
      expect(settings.featureFlags).toBeUndefined();
      expect(warnings.length).toBe(1);
    }
  });
});
