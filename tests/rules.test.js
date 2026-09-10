import { describe, expect, it } from "vitest";
import { applicableRules, effectiveSettings, matchesRule, newRule, patternForUrl } from "../src/shared/rules.js";

const r = (p, extra = {}) => newRule({ pattern: p, priority: 5, ...extra });

describe("matchesRule", () => {
  it("wildcard matches with scheme stripped when the pattern has none", () => {
    expect(matchesRule(r("github.com/*"), "https://github.com/foo/bar")).toBe(true);
    expect(matchesRule(r("github.com/*"), "http://github.com/")).toBe(true);
    expect(matchesRule(r("github.com/*"), "https://gist.github.com/")).toBe(false);
    expect(matchesRule(r("*.github.com/*"), "https://gist.github.com/x")).toBe(true);
  });
  it("respects the scheme when given", () => {
    expect(matchesRule(r("https://github.com/*"), "https://github.com/a")).toBe(true);
    expect(matchesRule(r("https://github.com/*"), "http://github.com/a")).toBe(false);
  });
  it("prefix mode is a plain starts-with", () => {
    expect(matchesRule(r("mail.google.com/mail", { match: "prefix" }), "https://mail.google.com/mail/u/0/")).toBe(true);
    expect(matchesRule(r("mail.google.com/mail", { match: "prefix" }), "https://mail.google.com/calendar")).toBe(false);
  });
  it("is case-insensitive and ignores empty or disabled rules", () => {
    expect(matchesRule(r("GitHub.com/*"), "https://github.com/")).toBe(true);
    expect(matchesRule(r(""), "https://github.com/")).toBe(false);
    expect(applicableRules([r("github.com/*", { priority: 0 })], "https://github.com/")).toEqual([]);
  });
  it("escapes regex characters in patterns", () => {
    expect(matchesRule(r("example.com/a+b?c=*"), "https://example.com/a+b?c=1")).toBe(true);
    expect(matchesRule(r("example.com/a+b?c=*"), "https://example.com/aab?c=1")).toBe(false);
  });
});

describe("effectiveSettings", () => {
  const base = { tabLifetimeSeconds: 1800, onExpire: "none", resetOnActivate: false, pauseWhileActive: false };
  it("layers rules per field, higher priority winning", () => {
    const rules = [
      r("github.com/*", { priority: 3, set: { tabLifetimeSeconds: 60, onExpire: "close" } }),
      r("*", { priority: 7, set: { tabLifetimeSeconds: 600 } }),
    ];
    const eff = effectiveSettings(base, rules, "https://github.com/x");
    expect(eff.tabLifetimeSeconds).toBe(600);
    expect(eff.onExpire).toBe("close");
    expect(eff.resetOnActivate).toBe(false);
    expect(eff.matched.map((m) => m.priority)).toEqual([3, 7]);
  });
  it("breaks priority ties by list order, later wins", () => {
    const rules = [r("*", { set: { onExpire: "close" } }), r("*", { set: { onExpire: "reload" } })];
    expect(effectiveSettings(base, rules, "https://a.b/").onExpire).toBe("reload");
  });
  it("falls back to globals with no matches", () => {
    const eff = effectiveSettings(base, [r("x.com/*", { set: { tabLifetimeSeconds: 1 } })], "https://y.com/");
    expect(eff.tabLifetimeSeconds).toBe(1800);
    expect(eff.matched).toEqual([]);
    expect(eff.neverExpire).toBe(false);
  });
});

describe("patternForUrl", () => {
  it("suggests the whole host", () => {
    expect(patternForUrl("https://mail.google.com/mail/u/0/")).toBe("mail.google.com/*");
    expect(patternForUrl("nope")).toBe("");
  });
});

describe("description", () => {
  it("is kept on new rules and defaults to empty", () => {
    expect(newRule({ description: "Docs I read slowly" }).description).toBe("Docs I read slowly");
    expect(newRule({}).description).toBe("");
    expect(newRule({ description: 5 }).description).toBe("");
  });
});

describe("patternForUrl on non-web addresses", () => {
  it("returns empty rather than a host-less pattern", () => {
    expect(patternForUrl("about:newtab")).toBe("");
    expect(patternForUrl("moz-extension://abc/ui/panel.html")).toBe("");
    expect(patternForUrl("file:///Users/x/a.html")).toBe("");
    expect(patternForUrl("https://github.com/foo")).toBe("github.com/*");
  });
});

describe("re-evaluation on navigation", () => {
  it("gives a different effective lifetime for a different address", () => {
    const base = { tabLifetimeSeconds: 1800, onExpire: "none", resetOnActivate: false, pauseWhileActive: false };
    const rules = [newRule({ pattern: "docs.example.com/*", priority: 5, set: { tabLifetimeSeconds: 60 } })];
    expect(effectiveSettings(base, rules, "https://docs.example.com/a").tabLifetimeSeconds).toBe(60);
    expect(effectiveSettings(base, rules, "https://www.example.com/a").tabLifetimeSeconds).toBe(1800);
  });
});
