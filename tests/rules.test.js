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
  ruleName,
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

describe("name", () => {
  it("is kept on new rules, trimmed, and defaults to empty", () => {
    expect(newRule({ name: "  Slow docs " }).name).toBe("Slow docs");
    expect(newRule({}).name).toBe("");
    expect(newRule({ name: 5 }).name).toBe("");
  });
  it("names a rule by name, then description, then pattern", () => {
    expect(ruleName({ name: "Docs", description: "d", pattern: "a.b/*" })).toBe("Docs");
    expect(ruleName({ name: "", description: "d", pattern: "a.b/*" })).toBe("d");
    expect(ruleName({ pattern: "a.b/*" })).toBe("a.b/*");
    expect(ruleName(null)).toBe("a rule");
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
    featureFlags: { "beta-features": true, "rules-appearance": true },
    tabLifetimeSeconds: 1800,
    onExpire: "none",
    resetOnActivate: false,
    pauseWhileActive: false,
    indicators: ["favicon", "theme-tint"],
    faviconStyle: "square",
    hideWhileGreen: false,
    quietStart: "60%",
    flashBeforeExpiry: true,
    flashLead: "60s",
  };
  it("rules override appearance fields per field", () => {
    const rules = [r("github.com/*", { set: { indicators: ["title-prefix"], faviconStyle: "dot", flashBeforeExpiry: false } })];
    const eff = effectiveSettings(base, rules, "https://github.com/x");
    expect(eff.indicators).toEqual(["title-prefix"]);
    expect(eff.faviconStyle).toBe("dot");
    expect(eff.flashBeforeExpiry).toBe(false);
    expect(eff.hideWhileGreen).toBe(false);
    expect(eff.quietStart).toBe("60%");
  });
  it("a rule's indicator list replaces the global one outright", () => {
    const eff = effectiveSettings(base, [r("*", { set: { indicators: [] } })], "https://a.b/");
    expect(eff.indicators).toEqual([]);
  });
  it("higher priority wins over lower for appearance, globals underneath", () => {
    const rules = [
      r("*", { priority: 8, set: { faviconStyle: "ring" } }),
      r("*", { priority: 3, set: { faviconStyle: "dot", flashLead: "5s" } }),
    ];
    const eff = effectiveSettings(base, rules, "https://a.b/");
    expect(eff.faviconStyle).toBe("ring");
    expect(eff.flashLead).toBe("5s");
    expect(eff.quietStart).toBe("60%");
  });
  it("applyOverrides ignores unknown and unset keys", () => {
    const eff = { ...base };
    applyOverrides(eff, { faviconStyle: "dot", bogus: 1, flashLead: null });
    expect(eff.faviconStyle).toBe("dot");
    expect(eff.flashLead).toBe("60s");
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
    // Rules may set appearance here; the flag's own tests cover it off.
    featureFlags: { "beta-features": true, "rules-appearance": true },
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
  const base = { indicators: ["favicon"], featureFlags: { "beta-features": true, "rules-appearance": true } };
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

describe("ruleChanges", () => {
  const base = newRule({ id: "x", name: "A", pattern: "a.b/*", priority: 5, set: { tabLifetimeSeconds: 60, flashBeforeExpiry: false } });
  it("is empty for an identical copy", () => {
    expect(rulesModule.ruleChanges(base, structuredClone(base))).toEqual([]);
  });
  it("names each top-level field that differs", () => {
    const after = { ...base, name: "B", priority: 0 };
    expect(rulesModule.ruleChanges(base, after)).toEqual(["name", "priority"]);
  });
  it("names an override added, removed or changed", () => {
    const after = { ...base, set: { tabLifetimeSeconds: 120, indicators: ["favicon"] } };
    expect(rulesModule.ruleChanges(base, after).sort()).toEqual(["set:flashBeforeExpiry", "set:indicators", "set:tabLifetimeSeconds"]);
  });
  it("treats a missing field and an empty one alike", () => {
    expect(rulesModule.ruleChanges({ pattern: "a" }, { pattern: "a", name: "" })).toEqual([]);
  });
});

describe("manageTabs", () => {
  const globals = { tabManagement: true, tabLifetimeSeconds: 1800 };
  it("reads as the global master switch until a rule says otherwise", () => {
    expect(effectiveSettings(globals, [], "https://a.b/").manageTabs).toBe(true);
    expect(effectiveSettings({ ...globals, tabManagement: false }, [], "https://a.b/").manageTabs).toBe(false);
    expect(rulesModule.baseValue(globals, "manageTabs")).toBe(true);
  });
  it("a rule switches it off for the pages it matches", () => {
    const rules = [r("a.b/*", { set: { manageTabs: false } })];
    expect(effectiveSettings(globals, rules, "https://a.b/x").manageTabs).toBe(false);
    expect(effectiveSettings(globals, rules, "https://c.d/").manageTabs).toBe(true);
    expect(explainSettings(globals, rules).manageTabs.from).toBe("rule");
  });
});

describe("ruleMentions", () => {
  const rule = newRule({ name: "Slow docs", description: "Reference pages", pattern: "docs.example.com/*" });
  it("finds a rule by name, description or pattern, ignoring case", () => {
    expect(rulesModule.ruleMentions(rule, "slow")).toBe(true);
    expect(rulesModule.ruleMentions(rule, "REFERENCE")).toBe(true);
    expect(rulesModule.ruleMentions(rule, "example.com")).toBe(true);
    expect(rulesModule.ruleMentions(rule, "mail")).toBe(false);
  });
  it("finds nothing for blank text", () => {
    expect(rulesModule.ruleMentions(rule, "  ")).toBe(false);
    expect(rulesModule.ruleMentions(rule, undefined)).toBe(false);
  });
});

describe("the rules-appearance flag", () => {
  const globals = { tabLifetimeSeconds: 1800, indicators: ["favicon"], faviconStyle: "square", flashBeforeExpiry: true };
  const rules = [r("a.b/*", { set: { tabLifetimeSeconds: 60, faviconStyle: "ring", indicators: ["badge"] } })];
  it("off, a rule's appearance overrides are kept but not read", () => {
    const eff = effectiveSettings(globals, rules, "https://a.b/x");
    expect(eff.tabLifetimeSeconds).toBe(60);
    expect(eff.faviconStyle).toBe("square");
    expect(explainSettings(globals, rules).faviconStyle.from).toBe("global");
    expect(rulesModule.wantedIndicatorIds(globals, rules)).toEqual(["favicon"]);
    expect(rulesModule.ruleFieldsInForce(globals)).not.toContain("faviconStyle");
  });
  it("on, they apply like any other override", () => {
    const on = { ...globals, featureFlags: { "beta-features": true, "rules-appearance": true } };
    expect(effectiveSettings(on, rules, "https://a.b/x").faviconStyle).toBe("ring");
    expect(explainSettings(on, rules).faviconStyle.from).toBe("rule");
    expect(rulesModule.wantedIndicatorIds(on, rules).sort()).toEqual(["badge", "favicon"]);
  });
  it("does not gate a tab's own overrides", () => {
    expect(explainSettings(globals, [], { faviconStyle: "dot" }).faviconStyle.from).toBe("tab");
  });
});
