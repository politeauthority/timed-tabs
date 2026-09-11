import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNotifier, describe as describeBatch } from "../src/background/notify.js";

/** Minimal stand-in for the slice of the WebExtension API the notifier touches. */
function fakeApi({ notifications = true } = {}) {
  const created = [];
  const listeners = { clicked: [], closed: [] };
  return {
    created,
    listeners,
    tabs: { create: vi.fn(async () => ({ id: 1 })) },
    runtime: { getURL: (p) => `moz-extension://x/${p}` },
    notifications: notifications
      ? {
          create: vi.fn(async (id, opts) => created.push({ id, ...opts })),
          clear: vi.fn(async () => true),
          onClicked: { addListener: (f) => listeners.clicked.push(f), removeListener: () => {} },
          onClosed: { addListener: (f) => listeners.closed.push(f), removeListener: () => {} },
        }
      : undefined,
  };
}

const closed = (title, url) => ({ id: 1, title, url });

describe("notifier", () => {
  let api;
  let notifier;
  beforeEach(() => {
    vi.useFakeTimers();
    api = fakeApi();
    notifier = createNotifier({ api, flushMs: 500 });
    notifier.start();
    notifier.configure({ notifyOnExpire: true });
  });

  it("says nothing while the setting is off", async () => {
    notifier.configure({ notifyOnExpire: false });
    notifier.tabClosed(closed("Reddit", "https://reddit.com/"));
    await vi.runAllTimersAsync();
    expect(api.created).toHaveLength(0);
  });

  it("sends one notification naming the tab", async () => {
    notifier.tabClosed(closed("Reddit", "https://reddit.com/"));
    await vi.runAllTimersAsync();
    expect(api.created).toHaveLength(1);
    expect(api.created[0]).toMatchObject({ title: "Tab closed", message: "Reddit" });
  });

  it("coalesces a batch of closures into one notification", async () => {
    notifier.tabClosed(closed("One", "https://one.test/"));
    notifier.tabClosed(closed("Two", "https://two.test/"));
    notifier.tabClosed(closed("Three", "https://three.test/"));
    await vi.runAllTimersAsync();
    expect(api.created).toHaveLength(1);
    expect(api.created[0].title).toBe("3 tabs closed");
    expect(api.created[0].message).toBe("One, Two, Three");
  });

  it("starts a new batch once the first has gone out", async () => {
    notifier.tabClosed(closed("One", "https://one.test/"));
    await vi.runAllTimersAsync();
    notifier.tabClosed(closed("Two", "https://two.test/"));
    await vi.runAllTimersAsync();
    expect(api.created.map((n) => n.message)).toEqual(["One", "Two"]);
  });

  it("drops a pending batch when the setting is switched off", async () => {
    notifier.tabClosed(closed("One", "https://one.test/"));
    notifier.configure({ notifyOnExpire: false });
    await vi.runAllTimersAsync();
    expect(api.created).toHaveLength(0);
  });

  it("does nothing when the permission has not been granted", async () => {
    const bare = fakeApi({ notifications: false });
    const n = createNotifier({ api: bare, flushMs: 500 });
    n.start();
    n.configure({ notifyOnExpire: true });
    n.tabClosed(closed("Reddit", "https://reddit.com/"));
    await vi.runAllTimersAsync();
    expect(bare.tabs.create).not.toHaveBeenCalled();
  });

  it("reopens the tab when a single-tab notification is clicked", async () => {
    notifier.tabClosed(closed("Reddit", "https://reddit.com/"));
    await vi.runAllTimersAsync();
    api.listeners.clicked[0](api.created[0].id);
    await vi.runAllTimersAsync();
    expect(api.tabs.create).toHaveBeenCalledWith({ url: "https://reddit.com/" });
  });

  it("opens the Tabs page when a batch notification is clicked", async () => {
    notifier.tabClosed(closed("One", "https://one.test/"));
    notifier.tabClosed(closed("Two", "https://two.test/"));
    await vi.runAllTimersAsync();
    api.listeners.clicked[0](api.created[0].id);
    await vi.runAllTimersAsync();
    expect(api.tabs.create).toHaveBeenCalledWith({
      url: "moz-extension://x/ui/panel.html?view=page#tabs",
    });
  });

  it("falls back to the Tabs page when the url cannot be reopened", async () => {
    api.tabs.create.mockRejectedValueOnce(new Error("privileged url"));
    notifier.tabClosed(closed("New tab", "about:newtab"));
    await vi.runAllTimersAsync();
    api.listeners.clicked[0](api.created[0].id);
    await vi.runAllTimersAsync();
    expect(api.tabs.create).toHaveBeenLastCalledWith({
      url: "moz-extension://x/ui/panel.html?view=page#tabs",
    });
  });

  it("names a titleless tab by its url, and an unknown one by a placeholder", async () => {
    notifier.tabClosed({ id: 1, title: "", url: "https://x.test/" });
    await vi.runAllTimersAsync();
    notifier.tabClosed({ id: 2 });
    await vi.runAllTimersAsync();
    expect(api.created.map((n) => n.message)).toEqual(["https://x.test/", "Untitled tab"]);
  });

  it("ignores a click on a notification it no longer knows about", async () => {
    api.listeners.clicked[0]("timed-tabs:closed:999");
    await vi.runAllTimersAsync();
    expect(api.tabs.create).not.toHaveBeenCalled();
  });
});

describe("batch wording", () => {
  it("names the first few tabs and counts the rest", () => {
    const batch = ["a", "b", "c", "d", "e", "f"].map((t) => ({ title: t, url: "" }));
    expect(describeBatch(batch)).toEqual({
      title: "6 tabs closed",
      message: "a, b, c, d, and 2 more",
    });
  });

  it("shortens a long title", () => {
    const { message } = describeBatch([{ title: "x".repeat(80), url: "" }]);
    expect(message).toHaveLength(60);
    expect(message.endsWith("…")).toBe(true);
  });
});
