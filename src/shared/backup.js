/**
 * Export/import of every user setting as one JSON document.
 * Pure: storage is handled by the caller.
 *
 * { "timedTabs": 1, "settings": { ...DEFAULTS keys... }, "rules": [ ...rules ], "groups": [ ...site groups ] }
 * "groups" is optional: backups written before site groups existed load as before.
 */
import { DEFAULTS, coerceSetting } from "./settings.js";
import { RULE_FIELDS, clampPriority, newRule } from "./rules.js";
import { newGroup } from "./groups.js";

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
    const v = coerceSetting(key, value);
    if (v === undefined) {
      warnings.push(`Setting "${key}" had an unexpected value and was left at its default.`);
      continue;
    }
    settings[key] = v;
  }
  const rules = [];
  const ruleIds = new Set();
  if (data.rules !== undefined) {
    if (!Array.isArray(data.rules)) warnings.push("Rules were not a list and were ignored.");
    else {
      for (const r of data.rules) {
        if (!r || typeof r !== "object" || typeof r.pattern !== "string") {
          warnings.push("Skipped a malformed rule.");
          continue;
        }
        let rule = cleanRule(r);
        // The editor finds a rule by id; two with the same id would be edited as one.
        if (ruleIds.has(rule.id)) {
          rule = { ...rule, id: newRule().id };
          warnings.push(`Two rules shared the id "${r.id}"; one was given a new id.`);
        }
        ruleIds.add(rule.id);
        rules.push(rule);
      }
    }
  }
  const groups = [];
  if (data.groups !== undefined) {
    if (!Array.isArray(data.groups)) warnings.push("Site groups were not a list and were ignored.");
    else {
      for (const g of data.groups) {
        let clean = g && typeof g === "object" ? cleanGroup(g) : null;
        if (!clean?.name) {
          warnings.push("Skipped a site group without a name.");
          continue;
        }
        if (groups.some((x) => x.name.toLowerCase() === clean.name.toLowerCase())) {
          warnings.push(`Skipped a second site group named "${clean.name}".`);
          continue;
        }
        if (groups.some((x) => x.id === clean.id)) {
          clean = { ...clean, id: newGroup().id };
          warnings.push(`Two site groups shared the id "${g.id}"; one was given a new id.`);
        }
        groups.push(clean);
      }
    }
  }
  return { settings, rules, groups, warnings };
}


function cleanRule(r) {
  const rule = newRule({
    id: typeof r.id === "string" && r.id ? r.id : undefined,
    description: r.description,
    pattern: r.pattern,
    match: r.match,
    priority: clampPriority(r.priority ?? 5),
  });
  // Only what a rule can override; anything else would sit in storage
  // invisibly, re-exported for ever and never shown in the editor.
  const set = {};
  for (const [k, v] of Object.entries(r.set ?? {})) {
    if (!RULE_FIELDS.includes(k)) continue;
    if (k === "neverExpire") {
      if (typeof v === "boolean") set[k] = v;
      continue;
    }
    const c = coerceSetting(k, v);
    if (c !== undefined) set[k] = c;
  }
  rule.set = set;
  return rule;
}
