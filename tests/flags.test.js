import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, FLAGS, activeFeatures, featureOn, flagOn, flagRequires, isGate, mergeFlags } from "../src/shared/flags.js";

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

  it("holds every beta feature behind the master switch", () => {
    // Anything that is not the master switch itself must hang off it, or it
    // would be reachable with "Beta features" turned off.
    for (const f of FLAGS) {
      if (f.id === "beta-features") continue;
      expect(f.requires).toBe("beta-features");
    }
  });

  it("only requires flags that exist", () => {
    const ids = new Set(FLAGS.map((f) => f.id));
    for (const f of FLAGS) if (f.requires) expect(ids.has(f.requires)).toBe(true);
    expect(flagRequires("mini-ui-page-settings")).toBe("beta-features");
    expect(flagRequires("beta-features")).toBeNull();
  });
});

describe("featureOn", () => {
  const on = (...ids) => ({ featureFlags: Object.fromEntries(ids.map((i) => [i, true])) });
  it("needs both the feature's flag and the master switch", () => {
    expect(featureOn(on("beta-features", "mini-ui-page-settings"), "mini-ui-page-settings")).toBe(true);
    expect(featureOn(on("mini-ui-page-settings"), "mini-ui-page-settings")).toBe(false);
    expect(featureOn(on("beta-features"), "mini-ui-page-settings")).toBe(false);
    expect(featureOn(on(), "mini-ui-page-settings")).toBe(false);
  });
  it("is plain flagOn for a flag with no parent", () => {
    // beta-features is the only flag without one; it is the master switch.
    expect(featureOn(on("beta-features"), "beta-features")).toBe(true);
    expect(featureOn(on(), "beta-features")).toBe(false);
  });

  it("holds site groups behind beta features as well as its own switch", () => {
    expect(featureOn(on("beta-features", "site-groups"), "site-groups")).toBe(true);
    // Its own switch alone is not enough: this is the case that used to slip through.
    expect(featureOn(on("site-groups"), "site-groups")).toBe(false);
    expect(featureOn(on("beta-features"), "site-groups")).toBe(false);
    expect(featureOn(on(), "site-groups")).toBe(false);
  });
  it("is off for an unknown id and never loops", () => {
    // An id this build does not declare has no parent, so its raw switch decides.
    expect(featureOn(on("nope"), "nope")).toBe(false);
    expect(featureOn(on(), "nope")).toBe(false);
    expect(featureOn(undefined, "mini-ui-page-settings")).toBe(false);
  });
});

describe("mergeFlags", () => {
  it("starts from the defaults when nothing is stored", () => {
    expect(mergeFlags(undefined)).toEqual(DEFAULT_FLAGS);
    expect(mergeFlags(null)).toEqual(DEFAULT_FLAGS);
    expect(mergeFlags({})).toEqual(DEFAULT_FLAGS);
  });

  it("keeps a stored value", () => {
    expect(mergeFlags({ "beta-features": true })).toEqual({ ...DEFAULT_FLAGS, "beta-features": true });
  });

  it("drops a flag this build no longer declares", () => {
    const merged = mergeFlags({ "beta-features": true, "flag-that-was-retired": true });
    expect(merged).toEqual({ ...DEFAULT_FLAGS, "beta-features": true });
    expect("flag-that-was-retired" in merged).toBe(false);
  });

  it("falls back to the default for a value that is not a switch", () => {
    expect(mergeFlags({ "beta-features": "yes" })).toEqual(DEFAULT_FLAGS);
    expect(mergeFlags({ "beta-features": 1 })).toEqual(DEFAULT_FLAGS);
    expect(mergeFlags({ "beta-features": null })).toEqual(DEFAULT_FLAGS);
  });

  it("survives junk where the flags should be, rather than throwing", () => {
    for (const junk of ["", 0, [], "beta-features", true]) {
      expect(() => mergeFlags(junk)).not.toThrow();
      expect(mergeFlags(junk)).toEqual(DEFAULT_FLAGS);
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

describe("isGate", () => {
  it("calls beta-features a gate, because everything else needs it", () => {
    expect(isGate("beta-features")).toBe(true);
  });

  it("calls a flag nothing depends on a feature", () => {
    for (const f of FLAGS) {
      if (f.id === "beta-features") continue;
      expect(isGate(f.id)).toBe(false);
    }
  });

  it("answers for an id this build never declared", () => {
    expect(isGate("retired-long-ago")).toBe(false);
  });
});

describe("activeFeatures", () => {
  const on = (...ids) => ({ featureFlags: Object.fromEntries(ids.map((id) => [id, true])) });

  it("says nothing is on for a fresh profile", () => {
    expect(activeFeatures({ featureFlags: DEFAULT_FLAGS })).toEqual([]);
  });

  // The case the note exists to get right: the master switch on its own
  // changes nothing anyone can see, so there is nothing to announce.
  it("stays empty when only the master switch is on", () => {
    expect(activeFeatures(on("beta-features"))).toEqual([]);
  });

  it("stays empty when a feature is on but its gate is not", () => {
    expect(activeFeatures(on("site-groups"))).toEqual([]);
  });

  it("names a feature once both switches are on", () => {
    expect(activeFeatures(on("beta-features", "site-groups")).map((f) => f.id)).toEqual(["site-groups"]);
  });

  it("lists several in the order the settings page does", () => {
    const ids = activeFeatures(on("beta-features", "settings-toasts", "mini-ui-page-settings")).map((f) => f.id);
    expect(ids).toEqual(["mini-ui-page-settings", "settings-toasts"]);
    const declared = FLAGS.map((f) => f.id);
    expect(ids).toEqual([...ids].sort((a, b) => declared.indexOf(a) - declared.indexOf(b)));
  });

  it("carries the label the note needs to name it", () => {
    const [only] = activeFeatures(on("beta-features", "site-groups"));
    expect(only.label).toBe(FLAGS.find((f) => f.id === "site-groups").label);
  });

  it("survives settings that have no flags at all", () => {
    expect(activeFeatures({})).toEqual([]);
    expect(activeFeatures(undefined)).toEqual([]);
  });
});
