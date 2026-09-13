import { describe, expect, it } from "vitest";
import {
  RULE_VISUAL_FIELDS,
  applicableRules,
  applyOverrides,
  effectiveSettings,
  explainSettings,
  managesTab,
  matchesRule,
  newRule,
  patternForUrl,
  wantedIndicatorIds,
} from "../src/shared/rules.js";
import * as rulesModule from "../src/shared/rules.js";

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

describe("visual overrides", () => {
  const base = {
    tabLifetimeSeconds: 1800,
    onExpire: "none",
    resetOnActivate: false,
    pauseWhileActive: false,
    indicators: ["favicon", "theme-tint"],
    faviconStyle: "square",
    hideWhileGreen: false,
    quietUntilPercent: 40,
    flashBeforeExpiry: true,
    flashLeadSeconds: 60,
  };
  it("rules override appearance fields per field", () => {
    const rules = [r("github.com/*", { set: { indicators: ["title-prefix"], faviconStyle: "dot", flashBeforeExpiry: false } })];
    const eff = effectiveSettings(base, rules, "https://github.com/x");
    expect(eff.indicators).toEqual(["title-prefix"]);
    expect(eff.faviconStyle).toBe("dot");
    expect(eff.flashBeforeExpiry).toBe(false);
    expect(eff.hideWhileGreen).toBe(false);
    expect(eff.quietUntilPercent).toBe(40);
  });
  it("a rule's indicator list replaces the global one outright", () => {
    const eff = effectiveSettings(base, [r("*", { set: { indicators: [] } })], "https://a.b/");
    expect(eff.indicators).toEqual([]);
  });
  it("higher priority wins over lower for appearance, globals underneath", () => {
    const rules = [
      r("*", { priority: 8, set: { faviconStyle: "ring" } }),
      r("*", { priority: 3, set: { faviconStyle: "dot", flashLeadSeconds: 5 } }),
    ];
    const eff = effectiveSettings(base, rules, "https://a.b/");
    expect(eff.faviconStyle).toBe("ring");
    expect(eff.flashLeadSeconds).toBe(5);
    expect(eff.quietUntilPercent).toBe(40);
  });
  it("applyOverrides ignores unknown and unset keys", () => {
    const eff = { ...base };
    applyOverrides(eff, { faviconStyle: "dot", bogus: 1, flashLeadSeconds: null });
    expect(eff.faviconStyle).toBe("dot");
    expect(eff.flashLeadSeconds).toBe(60);
    expect(eff.bogus).toBeUndefined();
  });
  it("wantedIndicatorIds unions globals and enabled rules", () => {
    const rules = [
      r("*", { set: { indicators: ["badge"] } }),
      r("*", { priority: 0, set: { indicators: ["title-prefix"] } }),
    ];
    expect(wantedIndicatorIds(base, rules).sort()).toEqual(["badge", "favicon", "theme-tint"]);
    expect(RULE_VISUAL_FIELDS).toContain("indicators");
  });
});

describe("explainSettings", () => {
  const globals = {
    tabLifetimeSeconds: 1800,
    onExpire: "none",
    resetOnActivate: false,
    pauseWhileActive: false,
    indicators: ["favicon"],
  };
  const rule = (id, priority, set) => ({ id, priority, set, pattern: `${id}/*` });

  it("falls back to the globals", () => {
    const out = explainSettings(globals);
    expect(out.tabLifetimeSeconds).toEqual({ value: 1800, from: "global", rule: null });
    expect(out.onExpire.from).toBe("global");
  });

  it("defaults neverExpire to false rather than undefined", () => {
    expect(explainSettings(globals).neverExpire).toEqual({
      value: false,
      from: "global",
      rule: null,
    });
  });

  it("names the rule a value came from", () => {
    const r = rule("short", 5, { tabLifetimeSeconds: 300 });
    const out = explainSettings(globals, [r]);
    expect(out.tabLifetimeSeconds.value).toBe(300);
    expect(out.tabLifetimeSeconds.from).toBe("rule");
    expect(out.tabLifetimeSeconds.rule).toBe(r);
    // Untouched keys still come from the globals.
    expect(out.onExpire.from).toBe("global");
  });

  it("lets the last rule win, matching effectiveSettings' order", () => {
    const low = rule("low", 5, { tabLifetimeSeconds: 300 });
    const high = rule("high", 10, { tabLifetimeSeconds: 60 });
    const out = explainSettings(globals, [low, high]);
    expect(out.tabLifetimeSeconds.value).toBe(60);
    expect(out.tabLifetimeSeconds.rule).toBe(high);
  });

  it("skips a rule the tab is ignoring", () => {
    const ignored = { ...rule("short", 5, { tabLifetimeSeconds: 300 }), ignored: true };
    const out = explainSettings(globals, [ignored]);
    expect(out.tabLifetimeSeconds).toEqual({ value: 1800, from: "global", rule: null });
  });

  it("puts the tab's own override on top of everything", () => {
    const r = rule("short", 5, { tabLifetimeSeconds: 300 });
    const out = explainSettings(globals, [r], { tabLifetimeSeconds: 45 });
    expect(out.tabLifetimeSeconds.value).toBe(45);
    expect(out.tabLifetimeSeconds.from).toBe("tab");
    expect(out.tabLifetimeSeconds.rule).toBe(null);
  });

  it("ignores an override that is not set, rather than blanking the value", () => {
    const out = explainSettings(globals, [], { tabLifetimeSeconds: null, onExpire: undefined });
    expect(out.tabLifetimeSeconds).toEqual({ value: 1800, from: "global", rule: null });
    expect(out.onExpire.from).toBe("global");
  });

  it("replaces the indicator list outright rather than merging it", () => {
    const r = rule("vis", 5, { indicators: ["badge"] });
    expect(explainSettings(globals, [r]).indicators.value).toEqual(["badge"]);
  });
});

describe("wildcardMatch", () => {
  const { wildcardMatch } = rulesModule;
  it("matches like a shell glob, star for any run", () => {
    expect(wildcardMatch("github.com/*", "github.com/foo/bar")).toBe(true);
    expect(wildcardMatch("*.github.com/*", "gist.github.com/x")).toBe(true);
    expect(wildcardMatch("github.com/*", "gist.github.com/x")).toBe(false);
    expect(wildcardMatch("a*b*c", "abc")).toBe(true);
    expect(wildcardMatch("a*b*c", "axxbyyc")).toBe(true);
    expect(wildcardMatch("a*b*c", "axxbyy")).toBe(false);
    expect(wildcardMatch("", "")).toBe(true);
    expect(wildcardMatch("*", "")).toBe(true);
    expect(wildcardMatch("**", "anything")).toBe(true);
    expect(wildcardMatch("exact", "exact")).toBe(true);
    expect(wildcardMatch("exact", "exactly")).toBe(false);
  });
  it("treats regex characters literally", () => {
    expect(wildcardMatch("example.com/a+b?c=*", "example.com/a+b?c=1")).toBe(true);
    expect(wildcardMatch("example.com/a+b?c=*", "example.com/aab?c=1")).toBe(false);
  });
  it("stays fast on the pattern that stalled the regex", () => {
    const t = Date.now();
    expect(wildcardMatch("*a*a*a*a*a*a*a*a*a*a*a*b", "a".repeat(2000))).toBe(false);
    expect(Date.now() - t).toBeLessThan(200);
  });
});

describe("wantedIndicatorIds with overrides and inert groups", () => {
  const { wantedIndicatorIds } = rulesModule;
  const base = { indicators: ["favicon"] };
  it("unions per-tab overrides", () => {
    expect(wantedIndicatorIds(base, [], [{ indicators: ["badge"] }, {}]).sort()).toEqual(["badge", "favicon"]);
  });
  it("skips a group rule whose group is not in force", () => {
    const rules = [r("@news", { set: { indicators: ["title-prefix"] } })];
    expect(wantedIndicatorIds(base, rules, [], [])).toEqual(["favicon"]);
    const news = { id: "g", name: "news", patterns: ["a.com/*"] };
    expect(wantedIndicatorIds(base, rules, [], [news]).sort()).toEqual(["favicon", "title-prefix"]);
  });
});

describe("managesTab", () => {
  const rule = r("github.com/*");

  it("manages every tab while the setting is off", () => {
    for (const inForce of [[], [rule]]) {
      expect(managesTab({}, inForce)).toBe(true);
      expect(managesTab({ requireRuleMatch: false }, inForce)).toBe(true);
    }
  });

  it("manages only the tabs a rule speaks for once it is on", () => {
    const on = { requireRuleMatch: true };
    expect(managesTab(on, [rule])).toBe(true);
    expect(managesTab(on, [])).toBe(false);
    // Rules the tab has switched off are not in force, so they do not count:
    // ignoring a page's only rule ignores the page.
    expect(managesTab(on, undefined)).toBe(false);
  });

  it("takes anything but a true as off, the way an older profile stores it", () => {
    expect(managesTab({ requireRuleMatch: undefined }, [])).toBe(true);
    expect(managesTab(null, [])).toBe(true);
  });
});
