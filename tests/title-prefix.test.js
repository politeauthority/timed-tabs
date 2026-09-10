import { describe, expect, it } from "vitest";

globalThis.browser ??= { tabs: {}, scripting: {} };
const { emojiFor } = await import("../src/background/indicators/title-prefix.js");

describe("emojiFor", () => {
  it("steps green, yellow, orange, red", () => {
    expect(emojiFor(0)).toBe("🟢");
    expect(emojiFor(0.39)).toBe("🟢");
    expect(emojiFor(0.4)).toBe("🟡");
    expect(emojiFor(0.75)).toBe("🟠");
    expect(emojiFor(1)).toBe("🔴");
  });
});
