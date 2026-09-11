import { beforeEach, describe, expect, it } from "vitest";

/**
 * What the indicator pushes to the browser, rather than what it draws: which
 * tabs get an icon, which get theirs taken off, and which are left alone.
 * The artwork itself is icon-art.test.js's business.
 */

/** A canvas that answers every call and keeps nothing. */
class FakeCanvas {
  getContext() {
    const target = { getImageData: (x, y, w, h) => ({ width: w, height: h }) };
    return new Proxy(target, {
      get: (t, k) => t[k] ?? (() => {}),
      set: () => true,
    });
  }
}
globalThis.OffscreenCanvas = FakeCanvas;

let calls = [];
let openTabs = [];
globalThis.browser ??= {
  action: {
    setIcon: async (options) => {
      calls.push(options);
    },
  },
  tabs: { query: async () => openTabs },
};

const icon = await import("../src/background/indicators/action-icon.js");

const ON = { featureFlags: { "beta-features": true, "primary-icon-interactive": true } };
const OFF = { featureFlags: {} };

const tab = (tabId, extra = {}) => ({ tabId, progress: 0.5, active: false, ...extra });
const painted = () => calls.filter((c) => c.imageData !== null).map((c) => c.tabId).sort();
const cleared = () => calls.filter((c) => c.imageData === null).map((c) => c.tabId).sort();

beforeEach(async () => {
  calls = [];
  openTabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
  await icon.stop();
  calls = [];
});

describe("the ring", () => {
  it("paints every tab, active or not", async () => {
    await icon.start({ settings: OFF });
    await icon.update([tab(1, { active: true }), tab(2), tab(3)]);
    expect(painted()).toEqual([1, 2, 3]);
  });

  it("leaves a tab alone until its state changes", async () => {
    await icon.start({ settings: OFF });
    await icon.update([tab(1), tab(2)]);
    calls = [];
    await icon.update([tab(1), tab(2)]);
    expect(calls).toEqual([]);
    await icon.update([tab(1, { progress: 0.9 }), tab(2)]);
    expect(painted()).toEqual([1]);
  });
});

describe("the interactive clock", () => {
  it("paints the active tab of each window and nothing else", async () => {
    await icon.start({ settings: ON });
    await icon.update([tab(1, { active: true }), tab(2), tab(3, { active: true })]);
    expect(painted()).toEqual([1, 3]);
  });

  it("takes the icon off a tab that stops being the active one", async () => {
    await icon.start({ settings: ON });
    await icon.update([tab(1, { active: true }), tab(2)]);
    calls = [];
    await icon.update([tab(1), tab(2, { active: true })]);
    expect(painted()).toEqual([2]);
    expect(cleared()).toEqual([1]);
  });

  it("says nothing about a tab that has closed", async () => {
    await icon.start({ settings: ON });
    await icon.update([tab(1, { active: true })]);
    calls = [];
    await icon.update([tab(2, { active: true })]);
    expect(cleared()).toEqual([]);
  });
});

describe("turning the flag over", () => {
  it("puts back every icon the other mark painted, before painting its own", async () => {
    await icon.start({ settings: OFF });
    await icon.update([tab(1, { active: true }), tab(2), tab(3)]);
    calls = [];

    icon.configure(ON);
    await icon.update([tab(1, { active: true }), tab(2), tab(3)]);
    expect(cleared()).toEqual([1, 2, 3]);
    expect(painted()).toEqual([1]);
    // The clearing comes first, or it would wipe the icon just painted.
    expect(calls.findIndex((c) => c.imageData === null)).toBeLessThan(
      calls.findIndex((c) => c.imageData !== null),
    );
  });

  it("does nothing when the flag has not actually changed", async () => {
    await icon.start({ settings: ON });
    await icon.update([tab(1, { active: true })]);
    calls = [];
    icon.configure(ON);
    await icon.update([tab(1, { active: true })]);
    expect(calls).toEqual([]);
  });
});
