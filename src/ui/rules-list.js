/**
 * The Rules page: the list of rules and their rows, the filter, Add rule, delete, the site groups, and the drafts the editor keeps.
 */
import { $, makeSwitch, markSaved, snippet, svgIcon, wildcardSpans } from "./dom.js";
import { cleanName, cleanPatterns, findGroup, groupNameOf, isGroupRef, nameTaken, newGroup, renameGroup, rulesUsingGroup } from "../shared/groups.js";
import { featureOn } from "../shared/flags.js";
import { fieldEmoji, ruleChipText } from "./rule-text.js";
import { getGroups, getRules, saveGroups, saveRules } from "../shared/settings.js";
import { hooks } from "./hooks.js";
import { isRuleableUrl, matchesRule, patternForUrl, ruleChanges, ruleFieldsInForce, ruleMentions, ruleName } from "../shared/rules.js";
import { state } from "./state.js";
import { write } from "./feedback.js";

export const groupsOn = () => featureOn(state.settings, "site-groups");

/** Whether rules may change how tabs look (flag "rules-appearance"). */
export const rulesAppearanceOn = () => featureOn(state.settings, "rules-appearance");

/** The rule overrides worth showing: all, or with appearance off, the rest. */
export const shownOverrides = (set) => Object.entries(set ?? {}).filter(([k]) => ruleFieldsInForce(state.settings).includes(k));

export const activeGroups = () => (groupsOn() ? state.groups : []);

/** Rule ids the user has expanded this session (cards start collapsed). */
/**
 * Edits in progress, by rule id ("new" for a rule not yet stored). A draft
 * outlives leaving the editor: the list marks the rule, and coming back finds
 * the edits where they were. Only Save writes any of it.
 */
export const ruleDrafts = new Map();



export function openRuleEditor(id, focus = null) {
  state.editorFocus = focus;
  location.hash = `#rule-${id}`;
}

/** Whether a draft differs from what is stored (a new rule always does). */
export function draftDirty(id) {
  const draft = ruleDrafts.get(id);
  if (!draft) return false;
  const saved = state.rules.find((r) => r.id === id);
  return !saved || ruleChanges(saved, draft).length > 0;
}

/**
 * The priority a rule had before its on/off switch zeroed it, so switching it
 * back on restores what the user chose rather than a default. Only for this
 * session: a rule left off is off, and its old priority is not worth storing.
 */
export const offPriorities = new Map();

/** What a rule starts at, and what an off rule returns to with nothing remembered. */
export const DEFAULT_RULE_PRIORITY = 5;

/** The rule "Add rule" just set up; its card flashes until this is cleared. */
export let justAddedRuleId = null;

export let justAddedTimer = null;

export function markJustAdded(id) {
  clearTimeout(justAddedTimer);
  justAddedRuleId = id;
  justAddedTimer = setTimeout(() => {
    justAddedRuleId = null;
    document.querySelector(".rule.is-just-added")?.classList.remove("is-just-added");
  }, 2600);
}

/** What a brand-new rule starts with, so the scheme is explicit from the first keystroke. */
export const NEW_RULE_PATTERN = "https://";

/** A rule with no usable pattern: blank, the untouched new-rule stub, or a host-less "/*" left over from a bad add. */
export function isEmptyRule(r) {
  const p = (r.pattern ?? "").trim();
  return p === "" || p === "/*" || p === "@" || p === NEW_RULE_PATTERN;
}

/** Rules in display order: alphabetical by pattern, with the ones still being typed first. */
export function sortedRules() {
  return [...state.rules].sort((a, b) => {
    const ea = isEmptyRule(a);
    const eb = isEmptyRule(b);
    if (ea !== eb) return ea ? -1 : 1;
    return a.pattern.localeCompare(b.pattern, undefined, { sensitivity: "base" });
  });
}

/** "Site group “news”, 4 sites" or why the rule currently matches nothing. */
export function describeGroupTarget(rule) {
  const name = groupNameOf(rule.pattern);
  if (!groupsOn()) return `Targets site group “${name}”, but site groups are off in Settings → Feature flags, so this rule matches nothing`;
  const g = findGroup(state.groups, name);
  if (!g) return `Targets site group “${name}”, which does not exist, so this rule matches nothing`;
  const n = g.patterns.length;
  return `Site group “${g.name}”, ${n} site${n === 1 ? "" : "s"}`;
}

/** Why a group rule currently matches nothing, or null when it is fine. */
export function groupTargetProblem(rule) {
  const name = groupNameOf(rule.pattern);
  if (!groupsOn())
    return "Site groups are off in Settings \u2192 Feature flags, so this rule matches nothing";
  if (!findGroup(state.groups, name))
    return `There is no site group \u201c${name}\u201d, so this rule matches nothing`;
  return null;
}

/** Group ids expanded this session. New groups start open. */
export const expandedGroups = new Set();

export async function persistGroups() {
  state.groupsSaving = true;
  const ok = await write(() => saveGroups(state.groups), {
    what: "the site groups",
    key: "groups",
  });
  if (!ok) state.groups = await getGroups().catch(() => state.groups);
  state.groupsSaving = false;
  return ok;
}

export function renderGroups() {
  const section = $("site-groups");
  if (!section) return;
  section.hidden = !groupsOn();
  if (section.hidden) return;
  const list = $("groups-list");
  if (!state.groups.length) {
    const p = document.createElement("p");
    p.className = "rules-empty";
    p.textContent = "No groups yet. Add one, list the sites it covers, then point a rule at it.";
    list.replaceChildren(p);
    return;
  }
  const sorted = [...state.groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  list.replaceChildren(...sorted.map(renderGroup));
}

export function renderGroup(group) {
  const el = document.createElement("div");
  el.className = "rule group";
  el.dataset.groupId = group.id;
  const open = expandedGroups.has(group.id);
  el.classList.toggle("is-collapsed", !open);
  const users = rulesUsingGroup(state.rules, group);

  const head = document.createElement("div");
  head.className = "rule-head";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rule-toggle chev";
  toggle.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Collapse group" : "Expand group");
  toggle.addEventListener("click", () => {
    if (expandedGroups.has(group.id)) expandedGroups.delete(group.id);
    else expandedGroups.add(group.id);
    renderGroups();
  });
  const name = document.createElement("input");
  name.className = "group-name";
  name.value = group.name;
  name.placeholder = "Group name, e.g. news";
  name.setAttribute("aria-label", "Group name");
  name.addEventListener("change", async () => {
    const next = cleanName(name.value);
    if (!next || next === group.name) {
      name.value = group.name;
      return;
    }
    if (nameTaken(state.groups, next, group.id)) {
      name.value = group.name;
      name.title = `There is already a group called “${next}”`;
      return;
    }
    // Renaming repoints every rule that used the old name.
    const out = renameGroup(state.groups, state.rules, group.id, next);
    state.groups = out.groups;
    state.rules = out.rules;
    await persistGroups();
    await persistRules(false);
    renderGroups();
    renderRules();
    markSaved(head, head);
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "rule-delete quiet";
  del.replaceChildren(svgIcon("trash"), document.createTextNode("Delete group"));
  if (users.length) {
    del.disabled = true;
    del.title = `Used by ${users.length} rule${users.length === 1 ? "" : "s"}. Point them elsewhere first.`;
  }
  let armed = null;
  del.addEventListener("click", async () => {
    if (!armed) {
      del.replaceChildren(svgIcon("trash"), document.createTextNode("Click again to delete"));
      del.classList.add("is-armed");
      armed = setTimeout(() => {
        armed = null;
        del.replaceChildren(svgIcon("trash"), document.createTextNode("Delete group"));
        del.classList.remove("is-armed");
      }, 4000);
      return;
    }
    clearTimeout(armed);
    state.groups = state.groups.filter((g) => g.id !== group.id);
    await persistGroups();
    renderGroups();
    renderRules();
  });
  head.append(toggle, name, del);
  el.append(head);

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "rule-summary";
  const n = group.patterns.length;
  summary.textContent = `${n} site${n === 1 ? "" : "s"} — ${users.length ? `used by ${users.length} rule${users.length === 1 ? "" : "s"}` : "not used by any rule yet"}`;
  summary.title = "Expand group";
  summary.addEventListener("click", () => {
    expandedGroups.add(group.id);
    renderGroups();
  });
  el.append(summary);

  const body = document.createElement("div");
  body.className = "rule-body";
  const patterns = document.createElement("textarea");
  patterns.className = "group-patterns";
  patterns.rows = Math.max(4, group.patterns.length + 1);
  patterns.value = group.patterns.join("\n");
  patterns.placeholder = "One address pattern per line, e.g.\n*.nytimes.com/*\nbbc.co.uk/*";
  patterns.setAttribute("aria-label", `Sites in group ${group.name}`);
  patterns.spellcheck = false;
  patterns.addEventListener("change", async () => {
    const next = cleanPatterns(patterns.value);
    state.groups = state.groups.map((g) => (g.id === group.id ? { ...g, patterns: next } : g));
    await persistGroups();
    renderGroups();
    renderRules();
    markSaved(head, head);
  });
  const meta = document.createElement("p");
  meta.className = "group-meta";
  meta.textContent = users.length
    ? `Rules that use this group: ${users.map((r) => ruleName(r)).join(", ")}. Point a rule at “Group: ${group.name}” in its target picker.`
    : `No rule uses this group yet. Pick “Group: ${group.name}” as a rule's target to apply it.`;
  body.append(patterns, meta);
  el.append(body);
  return el;
}

$("group-add")?.addEventListener("click", async () => {
  let name = "New group";
  for (let i = 2; nameTaken(state.groups, name); i++) name = `New group ${i}`;
  const g = newGroup({ name, patterns: [] });
  state.groups = [...state.groups, g];
  expandedGroups.add(g.id);
  await persistGroups();
  renderGroups();
  const card = $("groups-list").querySelector(`[data-group-id="${CSS.escape(g.id)}"]`);
  card?.scrollIntoView({ block: "start", behavior: "smooth" });
  const input = card?.querySelector(".group-name");
  if (input) {
    input.focus();
    input.select();
  }
});

export function renderRules() {
  const list = $("rules-list");
  const empties = state.rules.filter(isEmptyRule).length;
  const removeBtn = $("rules-remove-empty");
  removeBtn.hidden = empties === 0;
  if (empties)
    removeBtn.textContent = `Remove ${empties} empty rule${empties === 1 ? "" : "s"}`;
  if (!state.rules.length) {
    const p = document.createElement("p");
    p.className = "rules-empty";
    p.textContent =
      "No rules yet. Add one here, or open “Make / edit rules for this page” from the popup.";
    list.replaceChildren(p);
    if (ruleDrafts.has("new")) list.prepend(renderNewDraftRow(ruleDrafts.get("new")));
    return;
  }
  list.replaceChildren(...sortedRules().map(renderRule));
  if ($("rules-filter").value.trim()) applyRulesFilter();
  // A rule begun but not saved is not in the list yet; say so at the top.
  if (ruleDrafts.has("new")) list.prepend(renderNewDraftRow(ruleDrafts.get("new")));
}

export function renderNewDraftRow(draft) {
  const el = document.createElement("div");
  el.className = "rule is-collapsed";
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "rule-summary";
  summary.style.paddingLeft = "var(--sp-2)";
  const chip = document.createElement("span");
  chip.className = "rule-chip is-draft";
  chip.textContent = "✎ new rule, not saved";
  const meta = document.createElement("span");
  meta.className = "rule-meta";
  meta.textContent = ruleName(draft);
  summary.append(chip, meta);
  summary.title = "Continue the new rule";
  summary.addEventListener("click", () => openRuleEditor("new"));
  el.append(summary);
  return el;
}

/**
 * Delete, armed by the first click and fired by the second. The head row has
 * no room for a worded button, so it is an icon that grows the word only once
 * armed; an icon on its own cannot say "armed".
 */
export function ruleDeleteButton(rule, after = null) {
  const del = document.createElement("button");
  del.type = "button";
  del.className = "rule-delete quiet icon-btn";
  const rest = () => {
    del.replaceChildren(svgIcon("trash"));
    del.title = "Delete rule";
    del.setAttribute("aria-label", "Delete rule");
    del.classList.remove("is-armed");
  };
  rest();
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    rest();
  };
  del.addEventListener("click", () => {
    if (!armed) {
      del.replaceChildren(svgIcon("trash"), document.createTextNode("Click again"));
      del.title = "Click again to delete this rule";
      del.setAttribute("aria-label", "Click again to delete this rule");
      del.classList.add("is-armed");
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    state.rules = state.rules.filter((r) => r.id !== rule.id);
    ruleDrafts.delete(rule.id);
    persistRules().then((ok) => {
      if (ok) after?.();
    });
  });
  del.addEventListener("blur", () => {
    if (armed) setTimeout(disarm, 200);
  });
  return del;
}

/**
 * The head of a rule card. Both displays carry the expand toggle, the target
 * picker and the pattern; the new one adds the priority badge, the group size
 * and the on/off switch, which is what turns the card into a row that can be
 * read without opening it.
 */
export function ruleHead(rule, targetsGroup) {
  const head = document.createElement("div");
  head.className = "rule-head";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "rule-toggle icon-btn";
  toggle.replaceChildren(svgIcon("edit"));
  toggle.setAttribute("aria-label", "Edit rule");
  toggle.title = "Edit";
  toggle.addEventListener("click", () => openRuleEditor(rule.id));

  // The row is read-only: the pattern (or the group it targets) is text that
  // opens the editor, where the rule is actually changed.
  const patternWrap = document.createElement("button");
  patternWrap.type = "button";
  patternWrap.className = "rule-pattern-static";
  patternWrap.title = "Edit rule";
  // A named rule leads with its name; the pattern follows, smaller. Without
  // a name the pattern is the headline, as it always was.
  const patternText = document.createElement("span");
  patternText.className = "rule-head-pattern";
  if (targetsGroup) patternText.textContent = `🗂️ ${groupNameOf(rule.pattern)}`;
  else if (!rule.pattern.trim()) patternText.textContent = "(no pattern yet)";
  else patternText.append(...wildcardSpans(rule.pattern));
  if (rule.name) {
    const nameText = document.createElement("span");
    nameText.className = "rule-head-name";
    nameText.textContent = rule.name;
    patternWrap.classList.add("has-name");
    patternWrap.append(nameText, patternText);
  } else patternWrap.append(patternText);
  patternWrap.addEventListener("click", () => openRuleEditor(rule.id));
  const target = null;

  // Priority decides which rule wins, and the list is ordered by pattern
  // rather than by it, so it has to be readable without opening a card.
  const prio = document.createElement("button");
  prio.type = "button";
  prio.className = "rule-priority";
  prio.textContent = rule.priority === 0 ? "off" : String(rule.priority);
  prio.title =
    rule.priority === 0
      ? "Priority 0: this rule is switched off. Click to change it."
      : `Priority ${rule.priority}: when two rules disagree, the higher number wins. Click to change it.`;
  prio.setAttribute("aria-label", prio.title);
  prio.addEventListener("click", () => openRuleEditor(rule.id, "priority"));

  // A group rule hides the pattern box, so the head says how big the group is
  // in its place; without it the row would be a bare picker.
  let groupCount = null;
  if (targetsGroup) {
    groupCount = document.createElement("span");
    groupCount.className = "rule-group-count";
    const g = groupsOn() ? findGroup(state.groups, groupNameOf(rule.pattern)) : null;
    const n = g?.patterns.length ?? 0;
    groupCount.textContent = g ? `${n} site${n === 1 ? "" : "s"}` : "matches nothing";
    groupCount.classList.toggle("is-problem", !g);
  }

  // Switching a rule off is zeroing its priority; the switch says so without
  // making the user find the number field first.
  const enabled = rule.priority > 0;
  const enable = makeSwitch(enabled, (on) => {
    if (!on) offPriorities.set(rule.id, rule.priority);
    const next = on ? (offPriorities.get(rule.id) || DEFAULT_RULE_PRIORITY) : 0;
    updateRule(rule.id, { priority: next }, true, "head");
  });
  enable.el.classList.add("rule-enable");
  enable.el.title = enabled
    ? "On. Switch off to park the rule without deleting it."
    : "Off (priority 0). Switch on to use it again.";
  enable.input.setAttribute("aria-label", "Rule on");

  head.append(
    toggle,
    prio,
    ...(target ? [target] : []),
    patternWrap,
    ...(groupCount ? [groupCount] : []),
    enable.el,
    ruleDeleteButton(rule),
  );
  return head;
}

/**
 * What a collapsed card says: what the rule is for, then a chip per setting it
 * changes, which is what makes a page of rules readable at a glance.
 */
export function ruleSummary(rule, targetsGroup) {
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "rule-summary";
  summary.title = "Edit rule";
  summary.addEventListener("click", () => openRuleEditor(rule.id));

  const meta = document.createElement("span");
  meta.className = "rule-meta";
  const metaParts = [];
  if (isEmptyRule(rule)) metaParts.push("No pattern yet, so this rule matches nothing");
  const problem = targetsGroup ? groupTargetProblem(rule) : null;
  if (problem) metaParts.push(problem);
  // A bit of the description, the rest on the rule's page.
  if (rule.description) metaParts.push(snippet(rule.description, 90));
  if (!targetsGroup) metaParts.push(rule.match === "prefix" ? "starts with" : "wildcard");
  meta.textContent = metaParts.join(" \u00b7 ");
  meta.hidden = !metaParts.length;
  summary.append(meta);

  const chips = document.createElement("span");
  chips.className = "rule-chips";
  const sets = shownOverrides(rule.set);
  if (draftDirty(rule.id)) {
    const draft = document.createElement("span");
    draft.className = "rule-chip is-draft";
    draft.textContent = "✎ unsaved edits";
    draft.title = "This rule has edits that are not saved yet. Open it to save or discard them.";
    chips.append(draft);
  }
  if (!sets.length) {
    const none = document.createElement("span");
    none.className = "rule-chip is-empty";
    none.textContent = "changes nothing yet";
    chips.append(none);
  }
  for (const [k, v] of sets) {
    const chip = document.createElement("span");
    chip.className = "rule-chip";
    const emoji = fieldEmoji(k);
    chip.textContent = emoji ? `${emoji} ${ruleChipText(k, v)}` : ruleChipText(k, v);
    chips.append(chip);
  }
  summary.append(chips);
  return summary;
}

export function renderRule(rule) {
  const el = document.createElement("div");
  el.className = "rule is-collapsed";
  el.dataset.ruleId = rule.id;
  el.classList.toggle("is-disabled", rule.priority === 0);
  el.classList.toggle("is-just-added", rule.id === justAddedRuleId);
  const targetsGroup = isGroupRef(rule.pattern);
  el.append(ruleHead(rule, targetsGroup));
  el.append(ruleSummary(rule, targetsGroup));
  return el;
}

export function updateRule(id, patch, rerender = true, part = null) {
  state.rules = state.rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
  return persistRules(rerender, part ? { id, part } : null);
}

/** Save all rules; optionally show "Saved" on one part ("head", "match", "priority") of one rule. */
export async function persistRules(rerender = true, saved = null) {
  state.rulesSaving = true;
  const ok = await write(() => saveRules(state.rules), {
    what: "the rules",
    key: "rules",
  });
  // Nothing was stored, so what is in memory is an edit that never happened.
  // Redrawing it would leave the page claiming a rule it does not have.
  if (!ok) state.rules = await getRules().catch(() => state.rules);
  state.rulesSaving = false;
  if (rerender || !ok) renderRules();
  if (ok && saved) {
    const card = $("rules-list").querySelector(
      `[data-rule-id="${CSS.escape(saved.id)}"]`,
    );
    if (card) {
      if (saved.part === "head")
        markSaved(card, card.querySelector(".rule-head"));
      else markSaved(card.querySelector(`[data-row-key="${saved.part}"]`));
    }
  }
  if ($("overview").open) hooks.refreshOverview();
  return ok;
}

// Two clicks, like delete. Removes every rule that has no usable pattern.
export let removeEmptyArmed = null;

$("rules-remove-empty").addEventListener("click", async () => {
  const b = $("rules-remove-empty");
  if (!removeEmptyArmed) {
    b.replaceChildren(
      svgIcon("trash"),
      document.createTextNode("Click again to remove them"),
    );
    b.classList.add("is-armed");
    removeEmptyArmed = setTimeout(() => {
      removeEmptyArmed = null;
      b.classList.remove("is-armed");
      renderRules();
    }, 4000);
    return;
  }
  clearTimeout(removeEmptyArmed);
  removeEmptyArmed = null;
  b.classList.remove("is-armed");
  state.rules = state.rules.filter((r) => !isEmptyRule(r));
  await persistRules();
});

$("rule-add").addEventListener("click", () => {
  // With an address filter active, start the new rule from that site.
  const site = $("rules-filter").value.trim();
  const pattern = site ? patternForUrl(site) : "";
  // Don't pile up blank rules: open one that is still empty, or one with the same pattern.
  const existing = state.rules.find((r) => (pattern ? r.pattern === pattern : isEmptyRule(r)));
  if (existing) return openRuleEditor(existing.id);
  // A new rule already on the go keeps its edits; a fresh one starts from the filter.
  if (!ruleDrafts.has("new")) state.newRuleSeed = pattern;
  openRuleEditor("new", "pattern");
});

/** Show only rules that match the address typed in the filter box. */
export function applyRulesFilter() {
  const url = $("rules-filter").value.trim();
  const note = $("rules-filter-note");
  $("rules-filter-clear").hidden = !url;
  const rows = [...$("rules-list").querySelectorAll(".rule")];
  if (!url) {
    for (const el of rows) el.classList.remove("is-filtered-out");
    note.hidden = true;
    return;
  }
  // An address finds the rules that catch it; any other text finds rules by
  // name, description or pattern. Both, when the text could be either.
  let shown = 0;
  for (const el of rows) {
    const rule = state.rules.find((r) => r.id === el.dataset.ruleId);
    const hit = rule ? matchesRule(rule, url, activeGroups()) || ruleMentions(rule, url) || !rule.pattern.trim() : false;
    el.classList.toggle("is-filtered-out", !hit);
    if (hit) shown += 1;
  }
  const isAddress = isRuleableUrl(url);
  note.hidden = false;
  note.textContent = shown
    ? `${shown} of ${state.rules.length} rule${state.rules.length === 1 ? "" : "s"} ${isAddress ? "catch this address or are named like it" : "are named or patterned like this"}. Disabled rules (priority 0) are included.`
    : isAddress
      ? `No rules catch this address. Add rule starts one for ${patternForUrl(url) || "it"}.`
      : "No rule is named or patterned like this.";
}

$("rules-filter").addEventListener("input", applyRulesFilter);

$("rules-filter-clear").addEventListener("click", () => {
  $("rules-filter").value = "";
  applyRulesFilter();
});
