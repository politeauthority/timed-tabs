import { describe, expect, it } from "vitest";

globalThis.browser ??= { storage: { sync: {}, local: {}, onChanged: { addListener() {} } } };
const { DEFAULTS, FIELDS, coerceSetting } = await import("../src/shared/settings.js");
const { RULE_FIELDS } = await import("../src/shared/rules.js");

describe("settings declarations agree with each other", () => {
  it("every field has a default", () => {
    for (const f of FIELDS) expect(Object.keys(DEFAULTS)).toContain(f.key);
  });
  it("every choice default is one of its options", () => {
    for (const f of FIELDS.filter((f) => f.type === "choice")) {
      expect(f.options.map((o) => o.value)).toContain(DEFAULTS[f.key]);
    }
  });
  it("every rule field is a declared field, except the rule-only timer switch", () => {
    const keys = new Set(FIELDS.map((f) => f.key));
    for (const k of RULE_FIELDS) if (k !== "neverExpire") expect(keys.has(k)).toBe(true);
  });
  it("every numeric default sits inside its own range", () => {
    for (const f of FIELDS.filter((f) => f.type === "percent" || f.type === "duration")) {
      expect(coerceSetting(f.key, DEFAULTS[f.key])).toBe(DEFAULTS[f.key]);
    }
  });
});

describe("coerceSetting", () => {
  it("rejects a choice that is not an option, and a number outside the range", () => {
    expect(coerceSetting("onExpire", "nuke")).toBeUndefined();
    expect(coerceSetting("onExpire", "close")).toBe("close");
    expect(coerceSetting("tabSort", "x")).toBeUndefined();
    expect(coerceSetting("quietStart", "500%")).toBeUndefined();
    expect(coerceSetting("quietStart", "40%")).toBe("40%");
    expect(coerceSetting("quietStart", " 600s ")).toBe("600s");
    expect(coerceSetting("quietStart", 40)).toBeUndefined();
    expect(coerceSetting("tickSeconds", 0.001)).toBeUndefined();
    expect(coerceSetting("tabLifetimeSeconds", -5)).toBeUndefined();
  });
  it("rejects the wrong type and keeps the right one", () => {
    expect(coerceSetting("indicators", "favicon")).toBeUndefined();
    expect(coerceSetting("indicators", ["favicon"])).toEqual(["favicon"]);
    expect(coerceSetting("resetOnActivate", "yes")).toBeUndefined();
    expect(coerceSetting("resetOnActivate", true)).toBe(true);
    expect(coerceSetting("nonsense", 1)).toBeUndefined();
  });
});
