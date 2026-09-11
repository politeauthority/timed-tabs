import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHANNEL_NAMES, DEV_GECKO_ID, TARGET_NAMES, adaptManifest } from "../scripts/manifest.js";

const base = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));

/**
 * What each build target asks the browser for. The Chrome half of this is a
 * promise made in docs/developer/security-notes.md: `theme` and `sessions` are
 * Firefox-only and are not to be requested from a browser that would grant them
 * and get nothing back. Nothing but this test holds the build to it.
 */
describe("adaptManifest", () => {
  it("leaves the Firefox release build as src/manifest.json wrote it", () => {
    expect(adaptManifest(base, "firefox")).toEqual(base);
  });

  it("does not mutate what it is given", () => {
    const before = structuredClone(base);
    adaptManifest(base, "chrome");
    expect(base).toEqual(before);
  });

  it("rejects a target it does not know", () => {
    expect(() => adaptManifest(base, "safari")).toThrow(/Unknown target/);
  });

  it("rejects a channel it does not know", () => {
    expect(() => adaptManifest(base, "firefox", "nightly")).toThrow(/Unknown channel/);
  });

  describe.each(["chrome", "chrome-dev"])("%s", (target) => {
    const m = adaptManifest(base, target, target === "chrome-dev" ? "dev" : "");

    it("runs the background as a service worker", () => {
      expect(m.background).toEqual({ service_worker: "background/index.js", type: "module" });
      expect(m.background.scripts).toBeUndefined();
    });

    it("asks for neither theme nor sessions", () => {
      expect(m.permissions).not.toContain("theme");
      expect(m.permissions).not.toContain("sessions");
    });

    it("keeps every permission that is not Firefox-only", () => {
      const dropped = base.permissions.filter((p) => !m.permissions.includes(p));
      expect(dropped.sort()).toEqual(["sessions", "theme"]);
    });

    it("carries no Firefox-specific settings", () => {
      expect(m.browser_specific_settings).toBeUndefined();
    });

    it("keeps the icons raster, which is all Chrome will render", () => {
      for (const file of Object.values(m.icons)) expect(file).toMatch(/\.png$/);
      for (const file of Object.values(m.action.default_icon)) expect(file).toMatch(/\.png$/);
    });
  });

  describe("dev targets", () => {
    it("installs the Firefox dev build under an id of its own", () => {
      expect(adaptManifest(base, "dev").browser_specific_settings.gecko.id).toBe(DEV_GECKO_ID);
      expect(adaptManifest(base, "firefox").browser_specific_settings.gecko.id).not.toBe(DEV_GECKO_ID);
    });

    // Chrome hands out an opaque id, so the name is the only mark the dev hook
    // in src/background/index.js can recognise there. Both dev builds carry it,
    // and neither release build does.
    it.each(["dev", "chrome-dev"])("names %s so the dev hook can recognise it", (target) => {
      expect(adaptManifest(base, target, "dev").name.endsWith("(dev)")).toBe(true);
    });

    it.each(["firefox", "chrome"])("leaves %s unrecognisable as a dev build", (target) => {
      const m = adaptManifest(base, target);
      expect(m.name.endsWith("(dev)")).toBe(false);
      expect(m.name).toBe(base.name);
    });
  });

  describe("channels", () => {
    it("renames a beta wherever the browser shows it, keeping the stable id", () => {
      const m = adaptManifest(base, "firefox", "beta");
      expect(m.name).toBe(CHANNEL_NAMES.beta);
      expect(m.action.default_title).toBe(CHANNEL_NAMES.beta);
      expect(m.browser_specific_settings.gecko.id).toBe(base.browser_specific_settings.gecko.id);
    });

    it("leaves a plain release unbadged", () => {
      const m = adaptManifest(base, "chrome");
      expect(m.name).toBe(base.name);
      expect(m.action.default_title).toBe(base.action.default_title);
    });
  });

  it("keeps the version digits-only for every target", () => {
    for (const target of TARGET_NAMES) {
      expect(adaptManifest(base, target).version).toMatch(/^\d+(\.\d+){0,3}$/);
    }
  });
});
