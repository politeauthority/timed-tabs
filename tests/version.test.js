import { describe, expect, it } from "vitest";

globalThis.browser ??= { runtime: { getManifest: () => ({ version: "0.0.0" }), getURL: (p) => p } };
const { describeBuild, formatVersion } = await import("../src/shared/version.js");

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
