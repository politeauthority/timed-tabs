/**
 * Per-URL rules. Pure functions; storage lives in settings.js.
 *
 * A rule: {
 *   id: string,
 *   name: string,                     // short label the rule goes by; empty means "use the pattern"
 *   description: string,              // free text: what the rule is for
 *   pattern: string,                  // "github.com/*", "https://mail.google.com/"
 *   match: "wildcard" | "prefix",
 *   priority: 0..10,                  // 0 = disabled; higher wins
 *   set: { [key]: value }             // only the settings this rule overrides
 * }
 *
 * Matching: a pattern containing "://" is matched against the full URL;
 * otherwise the URL's scheme is stripped first, so "github.com/*" works.
 * Wildcard "*" matches any run of characters; matching is case-insensitive.
 *
 * A pattern of "@<name>" targets a site group (see groups.js): the rule
 * matches when any pattern in that group matches. Callers pass the groups in
 * force; with none, a group rule matches nothing, which is how the
 * site-groups feature flag switches such rules off.
 */
import { groupForRule, isGroupRef } from "./groups.js";
import { featureOn } from "./flags.js";

/**
 * Whether Timed Tabs acts on matching tabs at all. A rule setting this off
 * leaves them alone exactly as the global "Manage tabs" switch off would:
 * no timer, nothing closed, no colours, an empty clock on the toolbar.
 * Rule-only, like `neverExpire` was; the global answer is `tabManagement`.
 */
export const RULE_MANAGE_FIELD = "manageTabs";

/** Timer settings a rule may override, in display order. */
export const RULE_TIMING_FIELDS = ["tabLifetimeSeconds", "onExpire", "resetOnActivate", "pauseWhileActive"];

/** Appearance settings a rule may override, in display order. */
export const RULE_VISUAL_FIELDS = [
  "indicators",
  "faviconStyle",
  "hideWhileGreen",
  "quietStart",
  "flashBeforeExpiry",
  "flashLead",
];

/**
 * Everything a rule may override. `neverExpire` stays for the tab's own
 * "Never expire" switch, which the popup explains through the same table;
 * rules no longer set it (an old rule's `neverExpire` reads as `manageTabs`
 * off, see settings.js migrateSettingKeys).
 */
export const RULE_FIELDS = [RULE_MANAGE_FIELD, ...RULE_TIMING_FIELDS, ...RULE_VISUAL_FIELDS, "neverExpire"];

/**
 * The fields a rule may set right now: everything, or with the
 * "rules-appearance" flag off, everything but the appearance fields. A rule's
 * appearance overrides are kept in storage either way; they are simply not
 * read while the flag is off, the way a group rule matches nothing while
 * site groups are off. Per-tab overrides are not gated by this.
 */
export function ruleFieldsInForce(settings) {
  return featureOn(settings, "rules-appearance") ? RULE_FIELDS : RULE_FIELDS.filter((k) => !RULE_VISUAL_FIELDS.includes(k));
}

/** A field's global value: the two rule-only switches have no setting of their own. */
export function baseValue(settings, key) {
  if (key === "neverExpire") return false;
  if (key === RULE_MANAGE_FIELD) return settings?.tabManagement !== false;
  return settings?.[key];
}

/**
 * How one overriding value combines with the value underneath it.
 * Every field replaces outright, including `indicators`: a rule's list is the
 * whole list for matching tabs, not a subtraction from the global one. This
 * is the single place to change if `indicators` should ever narrow instead.
 */
export function overrideValue(_key, _base, value) {
  return value;
}

function isSet(v) {
  return v !== undefined && v !== null;
}

/** `eff` with the defined entries of `overrides` layered on top, restricted to RULE_FIELDS. */
export function applyOverrides(eff, overrides, keys = RULE_FIELDS) {
  if (!overrides) return eff;
  for (const key of keys) {
    if (key in overrides && isSet(overrides[key])) eff[key] = overrideValue(key, eff[key], overrides[key]);
  }
  return eff;
}

/**
 * Where each of RULE_FIELDS gets its value for one tab: the globals
 * underneath, then every matching rule in priority order, then whatever the
 * tab itself overrides. Pure, so the popup can explain a page's settings
 * without asking the background a second time.
 *
 * `matched` is highest priority last, the order effectiveSettings applies;
 * rules flagged `ignored` are skipped, exactly as the background skips them.
 * Returns { [key]: { value, from: "global" | "rule" | "tab", rule } }.
 */
export function explainSettings(settings, matched = [], overrides = {}) {
  const out = {};
  for (const key of RULE_FIELDS) {
    out[key] = { value: baseValue(settings, key), from: "global", rule: null };
  }
  const ruleKeys = ruleFieldsInForce(settings);
  for (const rule of matched) {
    if (rule?.ignored) continue;
    for (const key of ruleKeys) {
      const set = rule?.set ?? {};
      if (key in set && isSet(set[key])) {
        out[key] = { value: overrideValue(key, out[key].value, set[key]), from: "rule", rule };
      }
    }
  }
  for (const key of RULE_FIELDS) {
    if (key in (overrides ?? {}) && isSet(overrides[key])) {
      out[key] = { value: overrideValue(key, out[key].value, overrides[key]), from: "tab", rule: null };
    }
  }
  return out;
}

export const MAX_PRIORITY = 10;

export function newRule(partial = {}) {
  return {
    id: partial.id ?? `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: typeof partial.name === "string" ? partial.name.trim() : "",
    description: typeof partial.description === "string" ? partial.description : "",
    pattern: partial.pattern ?? "",
    match: partial.match === "prefix" ? "prefix" : "wildcard",
    priority: clampPriority(partial.priority ?? 5),
    set: { ...(partial.set ?? {}) },
  };
}

/**
 * What a rule is called wherever one is named: its name, else its description
 * from before rules had names, else the pattern itself.
 */
export function ruleName(rule) {
  return rule?.name || rule?.description || rule?.pattern || "a rule";
}

/** The fields of a rule an editor can change, compared one by one by ruleChanges. */
const RULE_TOP_FIELDS = ["name", "description", "pattern", "match", "priority"];

/**
 * What differs between two rules, as row keys: a top-level field's name, or
 * `set:<key>` for an override added, removed or changed. Pure; the editor uses
 * it to say which rows are unsaved and whether there is anything to save.
 */
export function ruleChanges(before, after) {
  const out = [];
  for (const k of RULE_TOP_FIELDS) {
    if ((before?.[k] ?? "") !== (after?.[k] ?? "")) out.push(k);
  }
  const a = before?.set ?? {};
  const b = after?.set ?? {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`set:${k}`);
  }
  return out;
}

export function clampPriority(n) {
  const p = Math.round(Number(n));
  if (!Number.isFinite(p)) return 5;
  return Math.min(MAX_PRIORITY, Math.max(0, p));
}

function subject(pattern, url) {
  if (pattern.includes("://")) return url;
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

export function matchesRule(rule, url, groups = []) {
  if (!rule?.pattern || typeof url !== "string") return false;
  if (isGroupRef(rule.pattern)) {
    const group = groupForRule(rule, groups);
    return Boolean(group) && group.patterns.some((p) => matchesPattern(p, "wildcard", url));
  }
  return matchesPattern(rule.pattern, rule.match, url);
}

function matchesPattern(rawPattern, match, url) {
  const pattern = String(rawPattern ?? "").trim().toLowerCase();
  if (!pattern) return false;
  const target = subject(pattern, url).toLowerCase();
  if (match === "prefix") return target.startsWith(pattern);
  return wildcardMatch(pattern, target);
}

/**
 * Does `text` fit `pattern`, where "*" matches any run of characters? A
 * two-pointer walk that backtracks to the most recent star only, so it is
 * linear in practice. The regex this replaced ("^a.*a.*a…$") backtracked
 * exponentially: one such rule stalled the background for good.
 */
export function wildcardMatch(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      mark = t;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

/** Enabled rules that match, lowest priority first (later wins on ties). */
export function applicableRules(rules, url, groups = []) {
  return (rules ?? [])
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.priority > 0 && matchesRule(rule, url, groups))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index)
    .map(({ rule }) => rule);
}

/**
 * Indicator ids any tab could need: the global list, every enabled rule's,
 * and every per-tab override's. Indicators are started from this union so a
 * rule or a single tab can turn one on.
 */
export function wantedIndicatorIds(settings, rules, tabOverrides = [], groups = []) {
  const ids = new Set(settings?.indicators ?? []);
  // A rule's indicator list is only read while rules may set appearance.
  const rulesMaySet = ruleFieldsInForce(settings).includes("indicators");
  for (const rule of rulesMaySet ? (rules ?? []) : []) {
    if (!(rule.priority > 0)) continue;
    // A group rule whose group is not in force can never match, so it
    // should not start an indicator either.
    if (isGroupRef(rule.pattern) && !groupForRule(rule, groups)) continue;
    for (const id of rule.set?.indicators ?? []) ids.add(id);
  }
  for (const o of tabOverrides ?? []) for (const id of o?.indicators ?? []) ids.add(id);
  return [...ids];
}

/**
 * Global settings with matching rules layered on top, per field.
 * Returns { ...values, matched: [rule, ...] } where matched is highest priority last.
 */
export function effectiveSettings(settings, rules, url, groups = []) {
  const matched = applicableRules(rules, url, groups);
  const out = {};
  for (const key of RULE_FIELDS) out[key] = baseValue(settings, key);
  const keys = ruleFieldsInForce(settings);
  for (const rule of matched) applyOverrides(out, rule.set, keys);
  out.matched = matched;
  return out;
}

/**
 * Is a tab one Timed Tabs acts on at all?
 *
 * With `requireRuleMatch` off, every tab is: the globals are the whole answer
 * and a rule only refines them. With it on, the rules are the guest list, and
 * a tab no rule speaks for is left alone as completely as the master switch
 * leaves everything -- no clock, no expiry, no marks.
 *
 * `inForce` is the rules actually applying to the tab, not merely the ones
 * that match its address: a page whose only rule the tab has switched off has
 * switched itself out along with it, which is the same sentence read twice.
 *
 * Pure and settings-shaped, so the background and the UI can agree on the
 * answer without either asking the other.
 */
export function managesTab(settings, inForce) {
  return settings?.requireRuleMatch !== true || (inForce?.length ?? 0) > 0;
}

/**
 * Whether typed text finds a rule by what it is called: its name, its
 * description or its pattern, case-insensitively. The Rules page filter uses
 * this beside address matching, so "docs" finds the rule named Docs as well
 * as every rule that catches https://docs.example.com/.
 */
export function ruleMentions(rule, text) {
  const q = String(text ?? "").trim().toLowerCase();
  if (!q) return false;
  return [rule?.name, rule?.description, rule?.pattern].some((v) => typeof v === "string" && v.toLowerCase().includes(q));
}

/** Suggested pattern for "this site": every page on the host. Empty for addresses without a host. */
export function patternForUrl(url) {
  try {
    const u = new URL(url);
    if (!/^(https?|ftp):$/.test(u.protocol) || !u.hostname) return "";
    return `${u.hostname}/*`;
  } catch {
    return "";
  }
}

/** True for addresses rules can sensibly target (web pages, not about:/moz-extension:). */
export function isRuleableUrl(url) {
  return patternForUrl(url) !== "";
}
