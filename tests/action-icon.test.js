import { describe, expect, it } from "vitest";
import { iconKey } from "../src/background/indicators/action-icon.js";
import { IDENTITY_PROGRESS } from "../src/shared/icon-art.js";

describe("iconKey", () => {
  it("gives tabs at the same point in their life the same icon", () => {
    expect(iconKey({ progress: 0.5 })).toBe(iconKey({ progress: 0.5001 }));
    expect(iconKey({ progress: 0.5 })).not.toBe(iconKey({ progress: 0.6 }));
  });

  it("parks exempt and quiet tabs on the resting mark", () => {
    const resting = `idle:${Math.round(IDENTITY_PROGRESS * 60)}`;
    expect(iconKey({ exempt: true, progress: 0.9 })).toBe(resting);
    expect(iconKey({ quiet: true, progress: 0.9 })).toBe(resting);
  });

  it("has one key for expired, whatever else the tab is doing", () => {
    expect(iconKey({ progress: 1 })).toBe("expired");
    expect(iconKey({ progress: 2, flashing: true }, false)).toBe("expired");
  });

  it("alternates between the ring and the solid disc while flashing", () => {
    const tab = { progress: 0.9, flashing: true };
    expect(iconKey(tab, true)).toBe("running:54");
    expect(iconKey(tab, false)).toBe("flash:54");
  });
});
