import { describe, expect, it } from "vitest";
import { iconKey, specFor } from "../src/background/indicators/action-icon.js";
import { STATE_COLORS, VIVID_RAMP, fromHex, toHex } from "../src/shared/color.js";
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

describe("iconKey, interactive", () => {
  const live = (tab, lit = true) => iconKey(tab, lit, true);

  it("keeps a tab that never expires apart from one that is merely quiet", () => {
    expect(live({ exempt: true, progress: 0.9 })).toBe("face-exempt");
    expect(live({ quiet: true, progress: 0.9 })).toBe(`face-idle:${Math.round(IDENTITY_PROGRESS * 60)}`);
  });

  it("says a stopped clock is stopped, at the fill it stopped at", () => {
    expect(live({ progress: 0.5, paused: true })).toBe("face-paused:30");
    expect(live({ progress: 0.5 })).toBe("face-running:30");
  });

  it("still blinks and still expires", () => {
    expect(live({ progress: 0.9, flashing: true }, false)).toBe("face-flash:54");
    expect(live({ progress: 1, paused: true })).toBe("face-expired");
  });

  it("never shares a key with the ring, so one mode cannot serve the other's art", () => {
    for (const tab of [{ progress: 0.5 }, { progress: 1 }, { quiet: true }, { exempt: true }]) {
      expect(live(tab)).not.toBe(iconKey(tab));
    }
  });
});

describe("specFor", () => {
  it("reads a key back as the picture it stands for", () => {
    expect(specFor("running:30")).toMatchObject({ live: false, state: "running", progress: 0.5 });
    expect(specFor("face-running:30")).toMatchObject({ live: true, state: "running", progress: 0.5 });
    expect(specFor("face-expired").progress).toBe(1);
  });

  it("takes the states that are not counting down off the ramp", () => {
    expect(specFor("face-paused:30").color).toBe(toHex(STATE_COLORS.paused));
    expect(specFor("face-exempt").color).toBe(toHex(STATE_COLORS.exempt));
  });

  it("keeps a resting tab green however full its face is", () => {
    expect(specFor("idle:15").color).toBe(specFor("running:0").color);
    expect(specFor("face-idle:15").color).toBe(specFor("running:0").color);
  });

  it("ramps a running tab from green to red", () => {
    const [green, mid, red] = ["face-running:0", "face-running:30", "face-running:59"].map((k) =>
      fromHex(specFor(k).color),
    );
    expect(green).toEqual(VIVID_RAMP[0][1]);
    // The green channel draining away is the ramp, whatever the stops become.
    expect(mid[1]).toBeLessThan(green[1]);
    expect(red[1]).toBeLessThan(mid[1]);
    expect(red[0]).toBeGreaterThan(green[0]);
  });
});
