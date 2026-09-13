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

  it("gives a tab nothing is watching the empty clock, not a reading", () => {
    // "Only manage tabs a rule matches", on a page no rule matches: there is
    // no timer here, so any fill at all would be a number made up.
    expect(iconKey({ unmanaged: true, progress: 0.9 })).toBe("inactive");
    expect(iconKey({ unmanaged: true, progress: 0.1 })).toBe("inactive");
    expect(iconKey({ unmanaged: true, progress: 1, flashing: true }, false)).toBe("inactive");
    // Held back beats every other reason a tab shows nothing.
    expect(iconKey({ unmanaged: true, quiet: true, exempt: true })).toBe("inactive");
  });

  it("leaves the button alone for a tab this indicator is not used for", () => {
    // `hidden` is the tick saying the tab's own settings do not name this
    // indicator. Marking it would paint a button the user has switched off.
    expect(iconKey({ unmanaged: true, hidden: true, quiet: true, progress: 0.9 })).not.toBe("inactive");
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
    // A quiet tab carries no mark at all, rather than the resting one: that is
    // a face filled to 75%, and on a tab with a tenth of its life left it is
    // not a resting look but a false reading. Null takes the icon off and lets
    // the packaged one show through.
    expect(live({ quiet: true, progress: 0.9 })).toBeNull();
  });

  it("withholds the mark whatever the fill, so none of it can be misread", () => {
    for (const progress of [0, 0.02, 0.5, 0.95, 1]) {
      expect(live({ quiet: true, progress })).toBeNull();
    }
  });

  it("leaves the ring's resting mark alone, where it is the packaged icon", () => {
    // Only the face is withheld. The ring draws `idle` as the mark it ships
    // with, which reads as a resting button rather than as a measurement.
    expect(iconKey({ quiet: true, progress: 0.9 }, true, false)).toBe(
      `idle:${Math.round(IDENTITY_PROGRESS * 60)}`,
    );
  });

  it("says a stopped clock is stopped, at the fill it stopped at", () => {
    expect(live({ progress: 0.5, paused: true })).toBe("face-paused:30");
    expect(live({ progress: 0.5 })).toBe("face-running:30");
  });

  it("still blinks and still expires", () => {
    expect(live({ progress: 0.9, flashing: true }, false)).toBe("face-flash:54");
    expect(live({ progress: 1, paused: true })).toBe("face-expired");
  });

  it("says an untimed tab is untimed, in its own artwork", () => {
    expect(live({ unmanaged: true, progress: 0.9 })).toBe("face-inactive");
    expect(live({ unmanaged: true, hidden: true, quiet: true })).toBeNull();
  });

  it("never shares a key with the ring, so one mode cannot serve the other's art", () => {
    for (const tab of [{ progress: 0.5 }, { progress: 1 }, { quiet: true }, { exempt: true }, { unmanaged: true }]) {
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
    // Grey, and the same grey either way round: an empty clock is an empty
    // clock whichever mark the flag has the button drawing.
    expect(specFor("inactive").color).toBe(toHex(STATE_COLORS.inactive));
    expect(specFor("face-inactive").color).toBe(toHex(STATE_COLORS.inactive));
    // Off the ramp, and off the other two, so it cannot be read as either.
    const [r, g, b] = fromHex(specFor("inactive").color);
    expect([g, b]).toEqual([r, r]);
    for (const other of ["face-paused:30", "face-exempt"]) {
      expect(specFor("inactive").color).not.toBe(specFor(other).color);
    }
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
