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
  it("shows the manifest version alone without build.json", () => {
    expect(describeBuild("0.8.0")).toMatchObject({ display: "0.8.0", channel: "", tag: "" });
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
});
