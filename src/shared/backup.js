/**
 * Export/import of every user setting as one JSON document.
 * Pure: storage is handled by the caller.
 *
 * { "timedTabs": 1, "version": "0.8.0", "settings": { ...DEFAULTS keys... },
 *   "rules": [ ...rules ], "groups": [ ...site groups ] }
 *
 * The two numbers say different things. `timedTabs` is the shape of the file,
 * which changes only when the shape does; `version` is the Timed Tabs that
 * wrote it, which is there to be read by a person and to catch a bundle
 * arriving from a build newer than the one loading it. Neither is required:
 * "groups" is missing from backups written before site groups existed, and
 * "version" from any written before this stamp, and both load as before.
 *
 * Nothing is ever loaded *from* `version` — it is a note about where the file
 * came from, not a setting. A bundle exported again carries whichever build
 * wrote it out that time, so importing one into this build and copying it back
 * out restamps it with this build.
 */
import { DEFAULTS, coerceSetting } from "./settings.js";
import { RULE_FIELDS, clampPriority, newRule } from "./rules.js";
import { newGroup } from "./groups.js";
import { compareVersions } from "./version.js";

export const FORMAT_VERSION = 1;

/** `version` is the build writing the file; leave it out and the stamp is too. */
export function exportBundle(settings, rules, groups = [], version = "") {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = settings[key] ?? DEFAULTS[key];
  const stamp = typeof version === "string" ? version.trim() : "";
  return {
    timedTabs: FORMAT_VERSION,
    ...(stamp ? { version: stamp } : {}),
    settings: out,
    rules: (rules ?? []).map(cleanRule),
    groups: (groups ?? []).map(cleanGroup),
  };
}

export function exportText(settings, rules, groups = [], version = "") {
  return JSON.stringify(exportBundle(settings, rules, groups, version), null, 2) + "\n";
}

function cleanGroup(g) {
  const { id, name, patterns } = newGroup(g);
  return { id, name, patterns };
}

/**
 * Parse and validate a backup. Returns
 * { version, settings, rules, groups, warnings }, where `version` is the build
 * that wrote the file, or "" for one written before the stamp existed.
 *
 * Unknown settings are dropped with a warning; wrong types fall back to the
 * default with a warning. Throws only when the text is not a backup at all.
 *
 * `currentVersion` is the build doing the loading. Given one, a bundle from a
 * later build is called out: that is exactly when the settings it carries are
 * dropped one by one as unknown, and the reason is worth saying once rather
 * than leaving to be inferred from the list.
 */
export function parseBundle(text, currentVersion = "") {
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
  const version = typeof data.version === "string" ? data.version.trim() : "";
  // Only ever a note, never a comparison we act on: an unreadable version on
  // either side answers null, and then nothing is said.
  if (compareVersions(version, currentVersion) > 0) {
    warnings.push(`Written by Timed Tabs ${version}, which is newer than this ${currentVersion}.`);
  }
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
  return { version, settings, rules, groups, warnings };
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
