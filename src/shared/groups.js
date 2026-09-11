/**
 * Site groups: a named list of address patterns that a rule can target as a
 * whole. A rule targets a group by putting "@<name>" in its pattern field, so
 * everything keyed off `rule.pattern` (sorting, summaries, backups, the popup)
 * keeps working; only matching has to resolve the name.
 *
 * A group: { id: string, name: string, patterns: string[] }. Names are unique
 * case-insensitively. Entries are wildcard patterns with the same scheme-
 * optional behaviour as a rule's own pattern.
 *
 * Pure; storage lives in settings.js.
 */

export const GROUP_PREFIX = "@";

export function newGroup(partial = {}) {
  return {
    id: typeof partial.id === "string" && partial.id ? partial.id : `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName(partial.name),
    patterns: cleanPatterns(partial.patterns),
  };
}

/** A name with the reference prefix and surrounding space removed, collapsed to one line. */
export function cleanName(name) {
  return String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^@+/, "")
    .trim();
}

/** Patterns from a list or a newline-separated text: trimmed, non-empty, no duplicates. */
export function cleanPatterns(input) {
  const list = Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const p = raw.trim();
    const key = p.toLowerCase();
    if (!p || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** "@news" for a group named "news". */
export function groupRef(name) {
  return GROUP_PREFIX + cleanName(name);
}

/** True when a rule's pattern points at a group rather than an address. */
export function isGroupRef(pattern) {
  return typeof pattern === "string" && pattern.trim().startsWith(GROUP_PREFIX);
}

/** The group name a pattern refers to, or "" for an ordinary pattern. */
export function groupNameOf(pattern) {
  return isGroupRef(pattern) ? cleanName(pattern) : "";
}

const sameName = (a, b) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

/** The group with this name, matched case-insensitively, or undefined. */
export function findGroup(groups, name) {
  const want = cleanName(name);
  if (!want) return undefined;
  return (groups ?? []).find((g) => sameName(g.name, want));
}

/** The group a rule targets, or undefined when it targets an address or the group is missing. */
export function groupForRule(rule, groups) {
  return isGroupRef(rule?.pattern) ? findGroup(groups, groupNameOf(rule.pattern)) : undefined;
}

/** Rules whose pattern points at this group. */
export function rulesUsingGroup(rules, group) {
  return (rules ?? []).filter((r) => isGroupRef(r.pattern) && sameName(groupNameOf(r.pattern), group?.name));
}

/** True when another group already has this name. */
export function nameTaken(groups, name, exceptId = null) {
  const g = findGroup(groups, name);
  return Boolean(g && g.id !== exceptId);
}

/**
 * Rename a group and repoint every rule that referenced it. Returns the new
 * { groups, rules }; the inputs are not mutated. A blank or taken name leaves
 * everything unchanged.
 */
export function renameGroup(groups, rules, id, newName) {
  const name = cleanName(newName);
  const group = (groups ?? []).find((g) => g.id === id);
  if (!group || !name || nameTaken(groups, name, id)) return { groups, rules };
  const ref = groupRef(name);
  return {
    groups: groups.map((g) => (g.id === id ? { ...g, name } : g)),
    rules: (rules ?? []).map((r) =>
      isGroupRef(r.pattern) && sameName(groupNameOf(r.pattern), group.name) ? { ...r, pattern: ref } : r,
    ),
  };
}
