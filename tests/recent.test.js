import { describe, expect, it } from "vitest";
import { groupRecent, iconForRecord } from "../src/shared/recent.js";

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
