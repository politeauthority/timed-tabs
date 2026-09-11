/**
 * Export/import of every user setting as one JSON document.
 * Pure: storage is handled by the caller.
 *
 * { "timedTabs": 1, "settings": { ...DEFAULTS keys... }, "rules": [ ...rules ], "groups": [ ...site groups ] }
 * "groups" is optional: backups written before site groups existed load as before.
 */
import { DEFAULTS } from "./settings.js";
import { clampPriority, newRule } from "./rules.js";
import { newGroup } from "./groups.js";
import { mergeFlags } from "./flags.js";

export const FORMAT_VERSION = 1;

export function exportBundle(settings, rules, groups = []) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = settings[key] ?? DEFAULTS[key];
  return {
    timedTabs: FORMAT_VERSION,
    settings: out,
    rules: (rules ?? []).map(cleanRule),
    groups: (groups ?? []).map(cleanGroup),
  };
}

export function exportText(settings, rules, groups = []) {
  return JSON.stringify(exportBundle(settings, rules, groups), null, 2) + "\n";
}

function cleanGroup(g) {
  const { id, name, patterns } = newGroup(g);
  return { id, name, patterns };
}

/**
 * Parse and validate a backup. Returns { settings, rules, groups, warnings }.
 * Unknown settings are dropped with a warning; wrong types fall back to the
 * default with a warning. Throws only when the text is not a backup at all.
 */
export function parseBundle(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Expected a JSON object.");
  if (data.timedTabs !== FORMAT_VERSION && !("settings" in data) && !("rules" in data)) {
    throw new Error("This does not look like a Timed Tabs backup.");
  }
  const warnings = [];
  const settings = {};
  const src = data.settings && typeof data.settings === "object" ? data.settings : {};
  for (const [key, value] of Object.entries(src)) {
    if (!(key in DEFAULTS)) {
      warnings.push(`Ignored unknown setting "${key}".`);
      continue;
    }
    const v = coerce(key, value);
    if (v === undefined) {
      warnings.push(`Setting "${key}" had an unexpected value and was left at its default.`);
      continue;
    }
    settings[key] = v;
  }
  const rules = [];
  if (data.rules !== undefined) {
    if (!Array.isArray(data.rules)) warnings.push("Rules were not a list and were ignored.");
    else {
      for (const r of data.rules) {
        if (!r || typeof r !== "object" || typeof r.pattern !== "string") {
          warnings.push("Skipped a malformed rule.");
          continue;
        }
        rules.push(cleanRule(r));
      }
    }
  }
  const groups = [];
  if (data.groups !== undefined) {
    if (!Array.isArray(data.groups)) warnings.push("Site groups were not a list and were ignored.");
    else {
      for (const g of data.groups) {
        const clean = g && typeof g === "object" ? cleanGroup(g) : null;
        if (!clean?.name) {
          warnings.push("Skipped a site group without a name.");
          continue;
        }
        if (groups.some((x) => x.name.toLowerCase() === clean.name.toLowerCase())) {
          warnings.push(`Skipped a second site group named "${clean.name}".`);
          continue;
        }
        groups.push(clean);
      }
    }
  }
  return { settings, rules, groups, warnings };
}

function coerce(key, value) {
  const def = DEFAULTS[key];
  if (Array.isArray(def)) return Array.isArray(value) && value.every((x) => typeof x === "string") ? value : undefined;
  // Feature flags: keep the ones this build still declares and drop the rest,
  // so a backup written either side of a flag being added or retired loads
  // without a warning and without turning anything unexpected on.
  if (key === "featureFlags") {
    return value && typeof value === "object" && !Array.isArray(value) ? mergeFlags(value) : undefined;
  }
  if (typeof def === "boolean") return typeof value === "boolean" ? value : undefined;
  if (typeof def === "number") return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof def === "string") return typeof value === "string" ? value : undefined;
  return undefined;
}

function cleanRule(r) {
  const rule = newRule({
    id: typeof r.id === "string" && r.id ? r.id : undefined,
    description: r.description,
    pattern: r.pattern,
    match: r.match,
    priority: clampPriority(r.priority ?? 5),
  });
  const set = {};
  for (const [k, v] of Object.entries(r.set ?? {})) {
    if (k in DEFAULTS) {
      const c = coerce(k, v);
      if (c !== undefined) set[k] = c;
    } else if (k === "neverExpire" && typeof v === "boolean") set[k] = v;
  }
  rule.set = set;
  return rule;
}
