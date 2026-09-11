import { describe, expect, it } from "vitest";
import {
  cleanPatterns,
  findGroup,
  groupNameOf,
  groupRef,
  isGroupRef,
  nameTaken,
  newGroup,
  renameGroup,
  rulesUsingGroup,
} from "../src/shared/groups.js";
import { applicableRules, effectiveSettings, matchesRule, newRule } from "../src/shared/rules.js";

const news = newGroup({ id: "g1", name: "News", patterns: ["*.nytimes.com/*", "bbc.co.uk/*", "news.ycombinator.com/*"] });
const rule = (pattern, extra = {}) => newRule({ pattern, priority: 5, ...extra });

describe("group references", () => {
  it("builds and reads @name references", () => {
    expect(groupRef(" news ")).toBe("@news");
    expect(isGroupRef("@news")).toBe(true);
    expect(isGroupRef("news.ycombinator.com/*")).toBe(false);
    expect(groupNameOf("@News")).toBe("News");
    expect(groupNameOf("https://a/")).toBe("");
  });
  it("finds groups case-insensitively and reports taken names", () => {
    expect(findGroup([news], "news")).toBe(news);
    expect(findGroup([news], "@NEWS")).toBe(news);
    expect(findGroup([news], "docs")).toBeUndefined();
    expect(nameTaken([news], "news")).toBe(true);
    expect(nameTaken([news], "news", "g1")).toBe(false);
  });
  it("cleans pattern lists from text", () => {
    expect(cleanPatterns(" a.com/* \n\n A.COM/* \nb.com/*\r\n")).toEqual(["a.com/*", "b.com/*"]);
    expect(newGroup({ name: "@@ x  y ", patterns: "one\ntwo" })).toMatchObject({ name: "x y", patterns: ["one", "two"] });
  });
});

describe("matching through a group", () => {
  it("matches when any pattern in the group matches, else nothing", () => {
    const r = rule("@news");
    expect(matchesRule(r, "https://www.nytimes.com/2026/story", [news])).toBe(true);
    expect(matchesRule(r, "https://news.ycombinator.com/item?id=1", [news])).toBe(true);
    expect(matchesRule(r, "https://github.com/", [news])).toBe(false);
  });
  it("matches nothing when the group is missing or no groups are passed", () => {
    expect(matchesRule(rule("@news"), "https://bbc.co.uk/", [])).toBe(false);
    expect(matchesRule(rule("@sports"), "https://bbc.co.uk/", [news])).toBe(false);
    expect(matchesRule(rule("@news"), "https://bbc.co.uk/")).toBe(false);
  });
  it("layers group rules with ordinary rules by priority", () => {
    const rules = [rule("@news", { priority: 3, set: { tabLifetimeSeconds: 900 } }), rule("bbc.co.uk/*", { priority: 7, set: { tabLifetimeSeconds: 60 } })];
    const base = { tabLifetimeSeconds: 1800 };
    expect(effectiveSettings(base, rules, "https://bbc.co.uk/x", [news]).tabLifetimeSeconds).toBe(60);
    expect(effectiveSettings(base, rules, "https://www.nytimes.com/", [news]).tabLifetimeSeconds).toBe(900);
    expect(applicableRules(rules, "https://www.nytimes.com/", []).length).toBe(0);
  });
});

describe("rename and usage", () => {
  const rules = [rule("@news"), rule("@News", { priority: 2 }), rule("bbc.co.uk/*")];
  it("counts the rules that use a group", () => {
    expect(rulesUsingGroup(rules, news).length).toBe(2);
  });
  it("renames the group and repoints its rules without touching the inputs", () => {
    const out = renameGroup([news], rules, "g1", " Press ");
    expect(out.groups[0].name).toBe("Press");
    expect(out.rules.map((r) => r.pattern)).toEqual(["@Press", "@Press", "bbc.co.uk/*"]);
    expect(rules[0].pattern).toBe("@news");
    expect(news.name).toBe("News");
  });
  it("refuses a blank or taken name", () => {
    const other = newGroup({ id: "g2", name: "docs", patterns: [] });
    expect(renameGroup([news, other], rules, "g1", "DOCS").groups[0].name).toBe("News");
    expect(renameGroup([news], rules, "g1", "  ").groups[0].name).toBe("News");
  });
});
