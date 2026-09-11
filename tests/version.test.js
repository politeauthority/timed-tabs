import { describe, expect, it } from "vitest";

globalThis.browser ??= { runtime: { getManifest: () => ({ version: "0.0.0" }), getURL: (p) => p } };
const { formatVersion } = await import("../src/shared/version.js");

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
