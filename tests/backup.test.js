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
