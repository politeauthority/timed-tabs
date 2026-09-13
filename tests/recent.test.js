import { describe, expect, it } from "vitest";
import { EXPIRED_GRACE_SECONDS, groupRecent, iconForRecord, isPrivateTab, recordFor, recordsExpiry, withinExpiredGrace } from "../src/shared/recent.js";

describe("iconForRecord", () => {
  it("prefers the page's own icon over the browser's and never a painted data: URL", () => {
    expect(iconForRecord({ url: "https://a.b/x", favIconUrl: "data:image/png;base64,AAA", originalIcon: "https://a.b/i.png" })).toBe("https://a.b/i.png");
    expect(iconForRecord({ url: "https://a.b/x", favIconUrl: "https://a.b/f.ico", originalIcon: "data:image/png;base64,AAA" })).toBe("https://a.b/f.ico");
  });
  it("falls back to /favicon.ico for web pages and nothing otherwise", () => {
    expect(iconForRecord({ url: "https://a.b/deep/page?q=1", favIconUrl: "data:image/png;base64,AAA" })).toBe("https://a.b/favicon.ico");
    expect(iconForRecord({ url: "about:blank" })).toBe("");
    expect(iconForRecord({})).toBe("");
  });
});

describe("groupRecent", () => {
  const e = (id, url, expiredAt, extra = {}) => ({ id, url, title: url, expiredAt, favIconUrl: "", ...extra });
  it("collapses repeats, keeps the newest first and counts them", () => {
    const list = [e("3", "https://a/", 30), e("2", "https://b/", 20), e("1", "https://a/", 10, { favIconUrl: "https://a/i.png" })];
    const g = groupRecent(list);
    expect(g.map((x) => x.url)).toEqual(["https://a/", "https://b/"]);
    expect(g[0]).toMatchObject({ id: "3", count: 2, ids: ["3", "1"], expiredAt: 30, favIconUrl: "https://a/i.png" });
    expect(g[1]).toMatchObject({ count: 1, ids: ["2"] });
  });
  it("handles an empty list", () => {
    expect(groupRecent([])).toEqual([]);
    expect(groupRecent(undefined)).toEqual([]);
  });
});

describe("isPrivateTab", () => {
  it("is true only for a tab the browser marks incognito", () => {
    expect(isPrivateTab({ incognito: true })).toBe(true);
    expect(isPrivateTab({ incognito: false })).toBe(false);
  });

  it("treats a tab that says nothing as ordinary", () => {
    // tabs.query fills `incognito` in, but a tab rebuilt from stored state or
    // handed in by a test may not have it. Guessing "private" there would
    // silently stop recording every tab.
    expect(isPrivateTab({})).toBe(false);
    expect(isPrivateTab(undefined)).toBe(false);
    expect(isPrivateTab(null)).toBe(false);
  });

  it("does not take a truthy value for the flag", () => {
    expect(isPrivateTab({ incognito: "yes" })).toBe(false);
    expect(isPrivateTab({ incognito: 1 })).toBe(false);
  });
});

describe("recordFor", () => {
  const tab = {
    id: 7,
    title: "Reddit",
    url: "https://reddit.com/r/all",
    favIconUrl: "https://reddit.com/favicon.ico",
  };

  it("remembers enough to put an ordinary tab back", () => {
    expect(recordFor(tab, "close", 1000)).toEqual({
      id: "7-1000",
      tabId: 7,
      title: "Reddit",
      url: "https://reddit.com/r/all",
      favIconUrl: "https://reddit.com/favicon.ico",
      expiredAt: 1000,
      action: "close",
    });
  });

  it("writes nothing down for a tab from a private window", () => {
    expect(recordFor({ ...tab, incognito: true }, "close", 1000)).toBeNull();
  });

  it("falls back to the address when a tab has no title", () => {
    expect(recordFor({ ...tab, title: "" }, "close", 1000).title).toBe("https://reddit.com/r/all");
  });

  it("stamps the id and the time from the same clock reading", () => {
    const row = recordFor(tab, "close", 4242);
    expect(row.id.endsWith(String(row.expiredAt))).toBe(true);
  });
});

describe("withinExpiredGrace", () => {
  const now = 1_000_000_000;
  const grace = EXPIRED_GRACE_SECONDS * 1000;

  it("keeps a tab that has not expired at all", () => {
    expect(withinExpiredGrace(null, now)).toBe(true);
    expect(withinExpiredGrace(undefined, now)).toBe(true);
    expect(withinExpiredGrace(0, now)).toBe(true);
  });

  it("keeps a tab that expired inside the grace and drops one past it", () => {
    expect(withinExpiredGrace(now, now)).toBe(true);
    expect(withinExpiredGrace(now - grace + 1000, now)).toBe(true);
    expect(withinExpiredGrace(now - grace, now)).toBe(false);
    expect(withinExpiredGrace(now - grace - 1000, now)).toBe(false);
  });

  it("takes a grace of its own, so the rule can be tested without waiting five minutes", () => {
    expect(withinExpiredGrace(now - 5000, now, 10)).toBe(true);
    expect(withinExpiredGrace(now - 5000, now, 1)).toBe(false);
  });

  it("is five minutes", () => {
    expect(EXPIRED_GRACE_SECONDS).toBe(300);
  });
});

describe("recordsExpiry", () => {
  it("writes down every expiry but a reload", () => {
    expect(recordsExpiry("close")).toBe(true);
    expect(recordsExpiry("none")).toBe(true);
    expect(recordsExpiry("discard")).toBe(true);
    // A reloaded tab goes on running, so a row once a lifetime would say nothing.
    expect(recordsExpiry("reload")).toBe(false);
  });
});
