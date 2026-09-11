/**
 * Per-URL rules. Pure functions; storage lives in settings.js.
 *
 * A rule: {
 *   id: string,
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
 */

/** Timer settings a rule may override, in display order. */
export const RULE_TIMING_FIELDS = ["tabLifetimeSeconds", "onExpire", "resetOnActivate", "pauseWhileActive", "neverExpire"];

/** Appearance settings a rule may override, in display order. */
export const RULE_VISUAL_FIELDS = [
  "indicators",
  "faviconStyle",
  "hideWhileGreen",
  "quietUntilPercent",
  "flashBeforeExpiry",
  "flashLeadSeconds",
];

/** Everything a rule may override. */
export const RULE_FIELDS = [...RULE_TIMING_FIELDS, ...RULE_VISUAL_FIELDS];

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
export function applyOverrides(eff, overrides) {
  if (!overrides) return eff;
  for (const key of RULE_FIELDS) {
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
    const base = settings?.[key] ?? (key === "neverExpire" ? false : undefined);
    out[key] = { value: base, from: "global", rule: null };
  }
  for (const rule of matched) {
    if (rule?.ignored) continue;
    for (const key of RULE_FIELDS) {
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
    description: typeof partial.description === "string" ? partial.description : "",
    pattern: partial.pattern ?? "",
    match: partial.match === "prefix" ? "prefix" : "wildcard",
    priority: clampPriority(partial.priority ?? 5),
    set: { ...(partial.set ?? {}) },
  };
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

export function matchesRule(rule, url) {
  if (!rule?.pattern || typeof url !== "string") return false;
  const pattern = rule.pattern.trim().toLowerCase();
  if (!pattern) return false;
  const target = subject(pattern, url).toLowerCase();
  if (rule.match === "prefix") return target.startsWith(pattern);
  return wildcardToRegExp(pattern).test(target);
}

const regexpCache = new Map();
export function wildcardToRegExp(pattern) {
  let re = regexpCache.get(pattern);
  if (!re) {
    const escaped = pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    re = new RegExp(`^${escaped}$`, "s");
    regexpCache.set(pattern, re);
  }
  return re;
}

/** Enabled rules that match, lowest priority first (later wins on ties). */
export function applicableRules(rules, url) {
  return (rules ?? [])
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.priority > 0 && matchesRule(rule, url))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index)
    .map(({ rule }) => rule);
}

/**
 * Indicator ids any tab could need: the global list plus every enabled rule's.
 * Indicators are started from this union so a rule can turn one on for a
 * single site.
 */
export function wantedIndicatorIds(settings, rules) {
  const ids = new Set(settings?.indicators ?? []);
  for (const rule of rules ?? []) {
    if (rule.priority > 0) for (const id of rule.set?.indicators ?? []) ids.add(id);
  }
  return [...ids];
}

/**
 * Global settings with matching rules layered on top, per field.
 * Returns { ...values, matched: [rule, ...] } where matched is highest priority last.
 */
export function effectiveSettings(settings, rules, url) {
  const matched = applicableRules(rules, url);
  const out = {};
  for (const key of RULE_FIELDS) out[key] = settings[key] ?? (key === "neverExpire" ? false : undefined);
  for (const rule of matched) applyOverrides(out, rule.set);
  out.matched = matched;
  return out;
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
