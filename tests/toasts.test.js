import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LEVEL,
  MAX_TOASTS,
  TOAST_LIFETIMES,
  createToastStore,
  isSticky,
  lifetimeOf,
  normaliseLevel,
} from "../src/shared/toasts.js";

/** A store on a clock the test drives, so nothing here waits on real time. */
function storeAt(start = 1000, options = {}) {
  let clock = start;
  const store = createToastStore({ now: () => clock, ...options });
  return {
    store,
    tick(ms) {
      clock += ms;
      return clock;
    },
    get clock() {
      return clock;
    },
  };
}

describe("levels", () => {
  it("keeps a level it knows and falls back for one it does not", () => {
    expect(normaliseLevel("error")).toBe("error");
    expect(normaliseLevel("catastrophe")).toBe(DEFAULT_LEVEL);
    expect(normaliseLevel(undefined)).toBe(DEFAULT_LEVEL);
  });

  it("only makes errors wait to be dismissed", () => {
    expect(isSticky("error")).toBe(true);
    for (const level of Object.keys(TOAST_LIFETIMES)) {
      if (level === "error") continue;
      expect(isSticky(level)).toBe(false);
      expect(lifetimeOf(level)).toBeGreaterThan(0);
    }
  });
});

describe("add", () => {
  it("puts a message on the pile and hands back its id", () => {
    const { store } = storeAt();
    const id = store.add({ level: "success", message: "Saved", detail: "Tab lifetime" });
    expect(id).toBeTruthy();
    expect(store.list()).toEqual([
      expect.objectContaining({
        id,
        level: "success",
        message: "Saved",
        detail: "Tab lifetime",
      }),
    ]);
  });

  it("ignores a message with nothing in it", () => {
    const { store } = storeAt();
    expect(store.add({ message: "   " })).toBeNull();
    expect(store.add({})).toBeNull();
    expect(store.size).toBe(0);
  });

  it("dates a toast that times out and leaves an error undated", () => {
    const { store } = storeAt(1000);
    store.add({ level: "success", message: "Saved" });
    store.add({ level: "error", message: "Could not save" });
    const [ok, bad] = store.list();
    expect(ok.expiresAt).toBe(1000 + TOAST_LIFETIMES.success);
    expect(bad.expiresAt).toBeNull();
  });

  it("tells anyone watching, with the new pile", () => {
    const onChange = vi.fn();
    const { store } = storeAt(1000, { onChange });
    store.add({ message: "Hello" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });
});

describe("keys", () => {
  it("takes over the toast already showing rather than stacking another", () => {
    const { store, tick } = storeAt(1000);
    const first = store.add({ level: "success", message: "Saved", detail: "40%", key: "snooze" });
    tick(500);
    const second = store.add({ level: "success", message: "Saved", detail: "45%", key: "snooze" });
    expect(second).toBe(first);
    expect(store.size).toBe(1);
    expect(store.list()[0].detail).toBe("45%");
  });

  it("gives the toast it took over its full life back", () => {
    const { store, tick } = storeAt(1000);
    store.add({ level: "success", message: "Saved", key: "snooze" });
    tick(3000);
    store.add({ level: "success", message: "Saved", key: "snooze" });
    expect(store.list()[0].expiresAt).toBe(4000 + TOAST_LIFETIMES.success);
  });

  it("keeps its place in the pile", () => {
    const { store } = storeAt();
    store.add({ message: "first", key: "a" });
    store.add({ message: "second", key: "b" });
    store.add({ message: "first again", key: "a" });
    expect(store.list().map((t) => t.message)).toEqual(["first again", "second"]);
  });

  it("stacks toasts that carry no key", () => {
    const { store } = storeAt();
    store.add({ message: "one" });
    store.add({ message: "one" });
    expect(store.size).toBe(2);
  });
});

describe("the cap", () => {
  it("drops the oldest toast that would have gone by itself", () => {
    const { store } = storeAt(1000, { max: 3 });
    store.add({ level: "success", message: "1" });
    store.add({ level: "success", message: "2" });
    store.add({ level: "success", message: "3" });
    store.add({ level: "success", message: "4" });
    expect(store.list().map((t) => t.message)).toEqual(["2", "3", "4"]);
  });

  it("never lets a run of successes push an error off the pile", () => {
    const { store } = storeAt(1000, { max: 2 });
    store.add({ level: "error", message: "Could not save" });
    store.add({ level: "success", message: "1" });
    store.add({ level: "success", message: "2" });
    store.add({ level: "success", message: "3" });
    expect(store.list().map((t) => t.message)).toEqual(["Could not save", "3"]);
  });

  it("drops the oldest error when errors are all there is", () => {
    const { store } = storeAt(1000, { max: 2 });
    store.add({ level: "error", message: "1" });
    store.add({ level: "error", message: "2" });
    store.add({ level: "error", message: "3" });
    expect(store.list().map((t) => t.message)).toEqual(["2", "3"]);
  });

  it("holds MAX_TOASTS by default", () => {
    const { store } = storeAt();
    for (let i = 0; i < MAX_TOASTS + 3; i++) store.add({ message: `m${i}` });
    expect(store.size).toBe(MAX_TOASTS);
  });
});

describe("expiry", () => {
  it("drops what is due and keeps what is not", () => {
    const { store, tick } = storeAt(1000);
    store.add({ level: "success", message: "goes" });
    store.add({ level: "warning", message: "stays a while" });
    store.add({ level: "error", message: "stays" });
    expect(store.expire(tick(TOAST_LIFETIMES.success))).toBe(true);
    expect(store.list().map((t) => t.message)).toEqual(["stays a while", "stays"]);
  });

  it("says nothing changed when nothing was due", () => {
    const { store } = storeAt(1000);
    store.add({ level: "success", message: "goes" });
    expect(store.expire(1001)).toBe(false);
  });

  it("reports when the next one falls due, and null once none do", () => {
    const { store } = storeAt(1000);
    store.add({ level: "info", message: "later" });
    store.add({ level: "success", message: "sooner" });
    expect(store.nextExpiryAt()).toBe(1000 + TOAST_LIFETIMES.success);
    store.clear();
    store.add({ level: "error", message: "never" });
    expect(store.nextExpiryAt()).toBeNull();
  });
});

describe("pause", () => {
  it("holds a countdown where it is and starts it again from there", () => {
    const { store, tick } = storeAt(1000);
    store.add({ level: "success", message: "Saved" });
    tick(1000);
    store.pause();
    expect(store.paused).toBe(true);
    expect(store.nextExpiryAt()).toBeNull();

    tick(60_000); // a pointer resting on the pile for a minute
    expect(store.expire()).toBe(false);
    expect(store.size).toBe(1);

    // A second of its life had gone by when it was held, so a second less of
    // it is left when the pointer moves away at 62,000.
    store.resume();
    expect(store.nextExpiryAt()).toBe(62_000 + TOAST_LIFETIMES.success - 1000);
  });

  it("does not start a toast raised while paused counting down", () => {
    const { store, tick } = storeAt(1000);
    store.pause();
    store.add({ level: "success", message: "Saved" });
    tick(10_000);
    expect(store.expire()).toBe(false);
    store.resume();
    expect(store.nextExpiryAt()).toBe(11_000 + TOAST_LIFETIMES.success);
  });

  it("leaves an error alone either way", () => {
    const { store } = storeAt(1000);
    store.add({ level: "error", message: "Could not save" });
    store.pause();
    store.resume();
    expect(store.list()[0].expiresAt).toBeNull();
  });

  it("ignores a second pause or a resume that was not paused", () => {
    const { store, tick } = storeAt(1000);
    store.add({ level: "success", message: "Saved" });
    store.pause();
    tick(5000);
    store.pause();
    store.resume();
    expect(store.nextExpiryAt()).toBe(6000 + TOAST_LIFETIMES.success);
    store.resume();
    expect(store.nextExpiryAt()).toBe(6000 + TOAST_LIFETIMES.success);
  });
});

describe("dismiss and clear", () => {
  it("takes one off and says whether it was there", () => {
    const { store } = storeAt();
    const id = store.add({ message: "Saved" });
    expect(store.dismiss(id)).toBe(true);
    expect(store.dismiss(id)).toBe(false);
    expect(store.size).toBe(0);
  });

  it("takes everything off, errors included", () => {
    const { store } = storeAt();
    store.add({ level: "error", message: "Could not save" });
    store.add({ level: "success", message: "Saved" });
    expect(store.clear()).toBe(true);
    expect(store.size).toBe(0);
    expect(store.clear()).toBe(false);
  });

  it("hands out copies, so the pile cannot be edited from outside", () => {
    const { store } = storeAt();
    store.add({ message: "Saved" });
    const list = store.list();
    list[0].message = "tampered";
    list.pop();
    expect(store.list()[0].message).toBe("Saved");
  });
});
