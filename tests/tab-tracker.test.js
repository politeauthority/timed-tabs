import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory stand-in for the WebExtension API the tracker touches.
const values = new Map();
globalThis.browser = {
  tabs: { query: vi.fn(async () => [{ id: 1 }, { id: 2 }]) },
  sessions: {
    getTabValue: vi.fn(async (id, key) => values.get(`${id}:${key}`)),
    setTabValue: vi.fn(async (id, key, v) => values.set(`${id}:${key}`, structuredClone(v))),
    removeTabValue: vi.fn(async (id, key) => values.delete(`${id}:${key}`)),
  },
};

const { createTabTracker } = await import("../src/background/tab-tracker.js");

describe("tab tracker", () => {
  let tracker;
  beforeEach(() => {
    values.clear();
    tracker = createTabTracker();
  });

  it("counts elapsed time from first sight", async () => {
    await tracker.track(1, 1000);
    expect(tracker.elapsedSeconds(1, 11_000)).toBe(10);
    expect(tracker.progressFor(1, 20, 11_000)).toBe(0.5);
    expect(tracker.progressFor(1, 20, 999_000)).toBe(1);
  });

  it("restores persisted state on a fresh instance", async () => {
    await tracker.track(1, 1000);
    const again = createTabTracker();
    await again.track(1, 50_000);
    expect(again.elapsedSeconds(1, 51_000)).toBe(50);
  });

  it("pauses and resumes without losing or gaining time", async () => {
    await tracker.track(1, 0);
    await tracker.pause(1, 10_000);
    expect(tracker.elapsedSeconds(1, 60_000)).toBe(10);
    await tracker.resume(1, 60_000);
    expect(tracker.elapsedSeconds(1, 65_000)).toBe(15);
  });

  it("reset restarts the clock and clears snooze, keeping pause state", async () => {
    await tracker.track(1, 0);
    await tracker.snooze(1, 60, 5000);
    await tracker.pause(1, 10_000);
    await tracker.reset(1, 20_000);
    expect(tracker.elapsedSeconds(1, 99_000)).toBe(0);
    expect(tracker.get(1).extraSeconds).toBe(0);
    expect(tracker.get(1).pausedAt).toBe(20_000);
  });

  it("snooze extends the lifetime for that tab only", async () => {
    await tracker.track(1, 0);
    await tracker.track(2, 0);
    await tracker.snooze(1, 100);
    expect(tracker.lifetimeFor(1, 100)).toBe(200);
    expect(tracker.lifetimeFor(2, 100)).toBe(100);
    expect(tracker.progressFor(1, 100, 100_000)).toBe(0.5);
  });

  it("forget drops memory and storage", async () => {
    await tracker.track(1, 0);
    await tracker.forget(1);
    expect(tracker.get(1)).toBeNull();
    expect(values.size).toBe(0);
  });
});
