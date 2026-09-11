import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, FLAGS, flagOn, mergeFlags } from "../src/shared/flags.js";

describe("FLAGS", () => {
  it("declares beta-features, off by default", () => {
    expect(FLAGS.map((f) => f.id)).toContain("beta-features");
    expect(DEFAULT_FLAGS["beta-features"]).toBe(false);
  });

  it("gives every flag an id, a label and a boolean default", () => {
    for (const f of FLAGS) {
      expect(typeof f.id).toBe("string");
      expect(f.id).not.toBe("");
      expect(typeof f.label).toBe("string");
      expect(typeof f.default).toBe("boolean");
    }
  });

  it("has no duplicate ids", () => {
    expect(new Set(FLAGS.map((f) => f.id)).size).toBe(FLAGS.length);
  });
});

describe("mergeFlags", () => {
  it("starts from the defaults when nothing is stored", () => {
    expect(mergeFlags(undefined)).toEqual({ "beta-features": false, "site-groups": false });
    expect(mergeFlags(null)).toEqual({ "beta-features": false, "site-groups": false });
    expect(mergeFlags({})).toEqual({ "beta-features": false, "site-groups": false });
  });

  it("keeps a stored value", () => {
    expect(mergeFlags({ "beta-features": true })).toEqual({ "beta-features": true, "site-groups": false });
  });

  it("drops a flag this build no longer declares", () => {
    const merged = mergeFlags({ "beta-features": true, "flag-that-was-retired": true });
    expect(merged).toEqual({ "beta-features": true, "site-groups": false });
    expect("flag-that-was-retired" in merged).toBe(false);
  });

  it("falls back to the default for a value that is not a switch", () => {
    expect(mergeFlags({ "beta-features": "yes" })).toEqual({ "beta-features": false, "site-groups": false });
    expect(mergeFlags({ "beta-features": 1 })).toEqual({ "beta-features": false, "site-groups": false });
    expect(mergeFlags({ "beta-features": null })).toEqual({ "beta-features": false, "site-groups": false });
  });

  it("survives junk where the flags should be, rather than throwing", () => {
    for (const junk of ["", 0, [], "beta-features", true]) {
      expect(() => mergeFlags(junk)).not.toThrow();
      expect(mergeFlags(junk)).toEqual({ "beta-features": false, "site-groups": false });
    }
  });
});

describe("flagOn", () => {
  it("reads a flag that is on", () => {
    expect(flagOn({ featureFlags: { "beta-features": true } }, "beta-features")).toBe(true);
  });

  it("is off for a flag that is off, missing, or never existed", () => {
    expect(flagOn({ featureFlags: { "beta-features": false } }, "beta-features")).toBe(false);
    expect(flagOn({ featureFlags: {} }, "beta-features")).toBe(false);
    expect(flagOn({ featureFlags: {} }, "flag-that-was-retired")).toBe(false);
  });

  it("is off rather than an error when there are no settings at all", () => {
    expect(flagOn(undefined, "beta-features")).toBe(false);
    expect(flagOn({}, "beta-features")).toBe(false);
    expect(flagOn({ featureFlags: null }, "beta-features")).toBe(false);
  });

  it("only counts a real true, not anything truthy", () => {
    expect(flagOn({ featureFlags: { "beta-features": "true" } }, "beta-features")).toBe(false);
    expect(flagOn({ featureFlags: { "beta-features": 1 } }, "beta-features")).toBe(false);
  });
});
