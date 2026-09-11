import { describe, expect, it } from "vitest";

globalThis.browser ??= { runtime: { getManifest: () => ({ version: "0.0.0" }), getURL: (p) => p } };
const { compareVersions, describeBuild, formatVersion } = await import("../src/shared/version.js");

describe("formatVersion", () => {
  it("appends a build tag with a hyphen", () => {
    expect(formatVersion("0.4.4", "something")).toBe("0.4.4-something");
    expect(formatVersion("0.4.4", "-rc1")).toBe("0.4.4-rc1");
  });
  it("leaves a plain version alone", () => {
    expect(formatVersion("0.4.4", "")).toBe("0.4.4");
    expect(formatVersion("0.4.4", undefined)).toBe("0.4.4");
    expect(formatVersion(" 0.4.4 ", "  ")).toBe("0.4.4");
  });
});

describe("describeBuild", () => {
  it("marks a source checkout as dev, since nothing can stamp one", () => {
    // No build.json at all: loaded straight from src/.
    expect(describeBuild("0.8.0")).toMatchObject({ display: "0.8.0-dev", channel: "dev", tag: "dev" });
    expect(describeBuild("0.8.0", null)).toMatchObject({ display: "0.8.0-dev", channel: "dev" });
  });

  it("leaves a built release plain, even though its build.json has no tag", () => {
    // This is the line between the two: a release target still writes build.json.
    const b = describeBuild("0.8.0", { tag: "", channel: "", commit: "abc1234" });
    expect(b.display).toBe("0.8.0");
    expect(b.channel).toBe("");
    expect(b.commit).toBe("abc1234");
  });
  it("names a beta after its semver, not its manifest alias", () => {
    const b = describeBuild("0.7.0.14", { semver: "0.8.0", tag: "beta.14", channel: "beta", commit: "abc1234" });
    expect(b.display).toBe("0.8.0-beta.14");
    expect(b.version).toBe("0.7.0.14");
    expect(b.channel).toBe("beta");
    expect(b.commit).toBe("abc1234");
  });
  it("tags a dev build from the manifest version", () => {
    expect(describeBuild("0.8.0", { tag: "dev", channel: "dev" }).display).toBe("0.8.0-dev");
  });
  it("ignores junk in build.json", () => {
    expect(describeBuild("0.8.0", { semver: 3, tag: null, channel: {} }).display).toBe("0.8.0");
  });

  it("keeps the manifest version digits-only whatever it displays", () => {
    // release-please owns manifest.version and Firefox rejects a suffix there,
    // so the -dev only ever exists for display.
    for (const b of [undefined, null, { tag: "dev", channel: "dev" }]) {
      expect(describeBuild("0.8.0", b).version).toBe("0.8.0");
    }
  });
});

describe("compareVersions", () => {
  it("orders by the dotted numbers first", () => {
    expect(compareVersions("0.8.0", "0.9.0")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("treats a missing part as a zero, so 0.8 and 0.8.0 are the same build", () => {
    expect(compareVersions("0.8", "0.8.0")).toBe(0);
    expect(compareVersions("0.8", "0.8.1")).toBeLessThan(0);
  });

  it("puts a release after its own pre-releases", () => {
    expect(compareVersions("0.8.0-beta.14", "0.8.0")).toBeLessThan(0);
    expect(compareVersions("0.8.0", "0.8.0-dev")).toBeGreaterThan(0);
    // A dev checkout of 0.8.0 is still ahead of the 0.7.9 that shipped.
    expect(compareVersions("0.8.0-dev", "0.7.9")).toBeGreaterThan(0);
  });

  it("orders two pre-releases dot by dot, numbers before words", () => {
    expect(compareVersions("0.8.0-beta.3", "0.8.0-beta.14")).toBeLessThan(0);
    expect(compareVersions("0.8.0-beta.2", "0.8.0-beta.2")).toBe(0);
    expect(compareVersions("0.8.0-beta", "0.8.0-beta.1")).toBeLessThan(0);
    expect(compareVersions("0.8.0-1", "0.8.0-rc")).toBeLessThan(0);
  });

  it("ignores a leading v", () => {
    expect(compareVersions("v0.8.0", "0.8.0")).toBe(0);
  });

  it("answers null rather than guessing at something that is not a version", () => {
    // The caller has to be able to tell "older" from "no idea", or a bundle
    // with a mangled stamp would be reported as if it were older.
    for (const bad of ["", "   ", undefined, null, "next", "0.8.0.x", 8]) {
      expect(compareVersions(bad, "0.8.0")).toBeNull();
      expect(compareVersions("0.8.0", bad)).toBeNull();
    }
  });
});
