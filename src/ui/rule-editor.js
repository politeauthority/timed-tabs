/**
 * One rule on a page of its own: the draft, its rows and their unsaved marks, the open tabs it catches, and the bar that saves or discards.
 */
import { $, makeSwitch, mirrorWildcards, setRevealed, settingRow, svgIcon, withKey } from "./dom.js";
import { DEFAULT_RULE_PRIORITY, NEW_RULE_PATTERN, activeGroups, describeGroupTarget, groupsOn, markJustAdded, offPriorities, persistRules, ruleDeleteButton, ruleDrafts, rulesAppearanceOn } from "./rules-list.js";
import { MAX_PRIORITY, RULE_MANAGE_FIELD, RULE_TIMING_FIELDS, RULE_VISUAL_FIELDS, baseValue, clampPriority, matchesRule, newRule, ruleChanges, ruleName } from "../shared/rules.js";
import { api } from "../shared/browser.js";
import { defsFor } from "./rule-text.js";
import { findGroup, groupNameOf, groupRef, isGroupRef } from "../shared/groups.js";
import { hooks } from "./hooks.js";
import { renderOverride, renderOverrideGroup, setRowChanged } from "./overrides.js";
import { state } from "./state.js";
import { toasts } from "./feedback.js";

/** The rule the editor is showing: its id ("new" until stored) and a redraw. */
export let editorState = null;

/**
 * Draw one rule, full width. Every control writes to a draft; nothing reaches
 * storage until Save. Rows whose value differs from the stored rule are
 * marked, and the bar at the foot counts them.
 */
export function renderRuleEditor(id) {
  const isNew = id === "new";
  const saved = isNew ? null : state.rules.find((r) => r.id === id);
  if (!isNew && !saved) {
    // A link to a rule that is gone lands on the list rather than a blank page.
    history.replaceState(null, "", "#rules");
    hooks.route();
    return;
  }
  let draft = ruleDrafts.get(id);
  if (!draft) {
    draft = isNew
      ? newRule({ pattern: state.newRuleSeed || NEW_RULE_PATTERN, priority: DEFAULT_RULE_PRIORITY })
      : structuredClone(saved);
    ruleDrafts.set(id, draft);
  }
  // What "changed" is measured against: the stored rule, or for a new one the
  // blank it started from, so only what was typed lights up.
  const baseline = saved ?? newRule({ id: draft.id, pattern: state.newRuleSeed || NEW_RULE_PATTERN, priority: DEFAULT_RULE_PRIORITY });
  editorState = { id, isNew, draft, baseline };

  const form = $("rule-editor-form");
  const rows = [];
  const row = (key, r) => {
    withKey(key, r);
    rows.push(r);
    return r;
  };
  const textField = (key, label, help, placeholder, maxLength) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = draft[key] ?? "";
    input.placeholder = placeholder;
    if (maxLength) input.maxLength = maxLength;
    input.className = "rule-editor-text";
    input.addEventListener("input", () => {
      draft[key] = input.value;
      refreshEditorDirty();
    });
    input.addEventListener("change", () => {
      draft[key] = input.value.trim();
      input.value = draft[key];
      refreshEditorDirty();
    });
    return row(key, settingRow(label, help, input));
  };

  form.replaceChildren();

  // On or off, first: the same switch as the list row, but staged like the
  // rest. Off is priority 0; on brings back the priority the rule had.
  const enableHelp = () =>
    draft.priority > 0
      ? "On. Switch off to park the rule without deleting it."
      : "Off. The rule is kept but changes nothing; switch on to use it again.";
  const enable = makeSwitch(draft.priority > 0, (on) => {
    if (!on && draft.priority > 0) offPriorities.set(id, draft.priority);
    draft.priority = on ? (offPriorities.get(id) || DEFAULT_RULE_PRIORITY) : 0;
    prioInput.value = String(draft.priority);
    prioRow.querySelector(".field-help").textContent = prioHelp();
    enableRow.querySelector(".field-help").textContent = enableHelp();
    refreshEditorDirty();
  });
  enable.input.setAttribute("aria-label", "Rule on");
  const enableRow = row("enabled", settingRow("Rule on", enableHelp(), enable.el));
  form.append(enableRow);

  form.append(
    textField("name", "Name", "What the rule is called in the list and the popup. Empty, the pattern stands in.", "e.g. Slow docs", 60),
    textField("description", "Description", "A note to yourself about what the rule is for.", "optional", 200),
  );

  // The target: an address pattern, or with site groups on, one of the groups.
  const targetsGroup = () => isGroupRef(draft.pattern);
  let targetSelect = null;
  if (groupsOn()) {
    targetSelect = document.createElement("select");
    targetSelect.className = "rule-target";
    targetSelect.add(new Option("🔗 Address", ""));
    for (const g of state.groups) targetSelect.add(new Option(`🗂️ ${g.name}`, groupRef(g.name)));
    const current = targetsGroup() ? groupRef(groupNameOf(draft.pattern)) : "";
    if (targetsGroup() && !findGroup(state.groups, groupNameOf(draft.pattern))) {
      targetSelect.add(new Option(`🗂️ ${groupNameOf(draft.pattern)} (missing)`, current));
    }
    targetSelect.value = current;
    targetSelect.addEventListener("change", () => {
      draft.pattern = targetSelect.value || (lastAddress || NEW_RULE_PATTERN);
      draft.match = "wildcard";
      syncTarget();
      refreshEditorDirty();
      refreshEditorMatches();
    });
    form.append(row("target", settingRow("Applies to", "An address pattern, or every site in a group.", targetSelect)));
  }
  // Under a group target, how big the group is and whether it exists.
  const groupNote = document.createElement("p");
  groupNote.className = "rule-group-note";
  form.append(groupNote);

  const pattern = document.createElement("input");
  pattern.className = "rule-pattern";
  pattern.placeholder = "Type an address pattern, e.g. example.com/*";
  pattern.setAttribute("aria-label", "Address pattern");
  let lastAddress = targetsGroup() ? "" : draft.pattern;
  pattern.value = lastAddress;
  pattern.addEventListener("input", () => {
    draft.pattern = pattern.value;
    lastAddress = pattern.value;
    refreshEditorDirty();
    refreshEditorMatches();
  });
  pattern.addEventListener("change", () => {
    draft.pattern = pattern.value.trim();
    pattern.value = draft.pattern;
    lastAddress = draft.pattern;
    refreshEditorDirty();
  });
  const patternRow = row(
    "pattern",
    settingRow("Address pattern", "Use * as a wildcard; a pattern without https:// matches any scheme.", mirrorWildcards(pattern)),
  );
  patternRow.classList.add("rule-editor-pattern-row");
  form.append(patternRow);

  const match = document.createElement("select");
  match.add(new Option("Wildcard", "wildcard"));
  match.add(new Option("Starts with", "prefix"));
  match.value = draft.match;
  match.addEventListener("change", () => {
    draft.match = match.value;
    matchRow.querySelector(".field-help").textContent = matchHelp();
    refreshEditorDirty();
    refreshEditorMatches();
  });
  const matchHelp = () =>
    draft.match === "prefix"
      ? "The address must begin with the pattern."
      : "The whole address must fit the pattern. * stands for anything.";
  const matchRow = row("match", settingRow("Match", matchHelp(), match));
  form.append(matchRow);

  const syncTarget = () => {
    const g = targetsGroup();
    patternRow.hidden = g;
    matchRow.hidden = g;
    groupNote.hidden = !g;
    if (g) groupNote.textContent = describeGroupTarget(draft) + ".";
    if (!g) {
      pattern.value = draft.pattern;
      pattern.dispatchEvent(new Event("input", { bubbles: false }));
    }
  };

  const prioInput = document.createElement("input");
  prioInput.type = "number";
  prioInput.min = "0";
  prioInput.max = String(MAX_PRIORITY);
  prioInput.step = "1";
  prioInput.value = String(draft.priority);
  const prioHelp = () =>
    draft.priority === 0
      ? "0: this rule is switched off."
      : "When two rules disagree, the higher number wins. 0 switches a rule off.";
  prioInput.addEventListener("change", () => {
    draft.priority = clampPriority(prioInput.value);
    prioInput.value = String(draft.priority);
    prioRow.querySelector(".field-help").textContent = prioHelp();
    enable.input.checked = draft.priority > 0;
    enableRow.querySelector(".field-help").textContent = enableHelp();
    refreshEditorDirty();
  });
  const prioRow = row("priority", settingRow("Priority", prioHelp(), prioInput));
  form.append(prioRow);

  // Which open tabs the pattern catches, as it is typed: the quickest way to
  // see whether "*" landed where it was meant to.
  const matches = document.createElement("div");
  matches.className = "rule-matches";
  const matchesTitle = document.createElement("p");
  matchesTitle.className = "rule-overrides-title";
  const matchesList = document.createElement("div");
  matchesList.className = "rule-matches-list";
  matches.append(matchesTitle, matchesList);
  form.append(matches);
  editorMatches = { draft, title: matchesTitle, list: matchesList };
  refreshEditorMatches();

  const store = {
    get set() {
      return draft.set;
    },
    base: (key) => baseValue(state.settings, key),
    commit: (set) => {
      draft.set = set;
      refreshEditorDirty();
      foldForManage();
    },
  };
  // "Manage tabs" first, on its own: switched off by the rule, nothing under
  // it applies, so the groups fold away behind a line saying so.
  const manageBlock = document.createElement("div");
  manageBlock.className = "rule-overrides rule-manage";
  manageBlock.append(renderOverride(defsFor([RULE_MANAGE_FIELD])[0], store));
  const leftAlone = document.createElement("p");
  leftAlone.className = "rule-group-note rule-left-alone";
  leftAlone.textContent = "Matching tabs are left alone, so nothing below applies while this is off.";
  const timing = renderOverrideGroup("⏳ Timer settings this rule changes", defsFor(RULE_TIMING_FIELDS), store);
  // Appearance is behind the "rules-appearance" flag: without it the section
  // is not drawn, and whatever the rule holds there stays put, unread.
  const visual = rulesAppearanceOn() ? renderOverrideGroup("🎨 How matching tabs look", defsFor(RULE_VISUAL_FIELDS), store) : null;
  const foldForManage = (animate = true) => {
    const off = draft.set[RULE_MANAGE_FIELD] === false;
    setRevealed(leftAlone, off, animate);
    setRevealed(timing, !off, animate);
    if (visual) setRevealed(visual, !off, animate);
  };
  form.append(manageBlock, leftAlone, timing, ...(visual ? [visual] : []));
  foldForManage(false);

  if (!isNew) {
    const danger = document.createElement("div");
    danger.className = "rule-editor-danger";
    const del = ruleDeleteButton(saved, () => {
      ruleDrafts.delete(id);
      location.hash = "#rules";
    });
    del.classList.remove("icon-btn");
    del.replaceChildren(svgIcon("trash"), document.createTextNode("Delete rule"));
    danger.append(del);
    form.append(danger);
  }

  // Draw the unsaved state, then put the caret where the list sent it.
  syncTarget();
  refreshEditorDirty();
  const focusKey = state.editorFocus ?? (isNew ? "pattern" : null);
  state.editorFocus = null;
  if (focusKey) {
    const rowEl = form.querySelector(`[data-row-key="${focusKey}"], .override[data-key="${focusKey}"]`);
    const target = rowEl?.querySelector("input, select");
    rowEl?.scrollIntoView({ block: "center" });
    target?.focus();
    if (focusKey === "pattern" && target && !state.newRuleSeed) target.setSelectionRange(target.value.length, target.value.length);
  }
  state.newRuleSeed = "";
}

/**
 * Mark the rows that differ from the stored rule and show or hide the bar.
 * The stored rule is compared afresh each time, so an edit that goes back to
 * the stored value stops counting.
 */
export function refreshEditorDirty() {
  if (!editorState) return;
  const { id, isNew, draft, baseline } = editorState;
  const saved = isNew ? baseline : (state.rules.find((r) => r.id === id) ?? baseline);
  const changed = new Set(ruleChanges(saved, draft));
  const form = $("rule-editor-form");
  for (const r of form.querySelectorAll("[data-row-key]")) {
    const key = r.dataset.rowKey;
    // The target picker changes the pattern; it lights up with it. The on/off
    // switch is the priority crossing zero.
    const on =
      key === "target"
        ? changed.has("pattern")
        : key === "enabled"
          ? (saved.priority > 0) !== (draft.priority > 0)
          : changed.has(key);
    setRowChanged(r, on);
  }
  for (const r of form.querySelectorAll(".override[data-key]")) {
    setRowChanged(r, changed.has(`set:${r.dataset.key}`));
  }
  const dirty = isNew || changed.size > 0;
  const bar = $("rule-editor-bar");
  bar.hidden = !dirty;
  const n = changed.size;
  $("rule-editor-bar-text").textContent = isNew
    ? "New rule, not saved yet"
    : `${n} unsaved change${n === 1 ? "" : "s"}`;
  const usable = isGroupRef(draft.pattern) || draft.pattern.trim().length > 0;
  $("rule-editor-save").disabled = !usable;
  $("rule-editor-save").title = usable ? "" : "Give the rule an address pattern first.";
  $("rule-editor-title").textContent = isNew ? "📋 New rule" : `📋 Edit rule · ${ruleName(draft)}`;
}

/** The editor's open-tabs block, and the draft it matches against. */
export let editorMatches = null;

export let editorMatchSeq = 0;

export const MATCHES_SHOWN = 12;

export async function refreshEditorMatches() {
  if (!editorMatches) return;
  const { draft, title, list } = editorMatches;
  const seq = ++editorMatchSeq;
  const tabs = await api.tabs.query({}).catch(() => []);
  // A slower earlier query must not paint over a newer one.
  if (seq !== editorMatchSeq || editorMatches?.draft !== draft) return;
  const usable = isGroupRef(draft.pattern) || draft.pattern.trim().length > 0;
  const hits = usable ? tabs.filter((t) => t.url && matchesRule(draft, t.url, activeGroups())) : [];
  title.textContent = `🪟 Open tabs this rule matches (${hits.length})`;
  list.replaceChildren();
  if (!hits.length) {
    const p = document.createElement("p");
    p.className = "rule-matches-empty";
    p.textContent = usable ? "None right now. The rule still applies to tabs opened later." : "Type an address pattern to see which open tabs it catches.";
    list.append(p);
    return;
  }
  for (const t of hits.slice(0, MATCHES_SHOWN)) {
    const row = document.createElement("div");
    row.className = "rule-match";
    const icon = document.createElement("img");
    icon.className = "rule-match-icon";
    icon.alt = "";
    if (t.favIconUrl) icon.src = t.favIconUrl;
    const name = document.createElement("span");
    name.className = "rule-match-title";
    name.textContent = t.title || t.url;
    const url = document.createElement("span");
    url.className = "rule-match-url";
    url.textContent = t.url;
    row.title = t.url;
    row.append(icon, name, url);
    list.append(row);
  }
  if (hits.length > MATCHES_SHOWN) {
    const more = document.createElement("p");
    more.className = "rule-matches-empty";
    more.textContent = `and ${hits.length - MATCHES_SHOWN} more`;
    list.append(more);
  }
}

export let matchesTimer = null;

$("rule-editor-save").addEventListener("click", async () => {
  if (!editorState) return;
  const { id, isNew, draft } = editorState;
  const clean = newRule({ ...draft, set: { ...draft.set } });
  const before = state.rules;
  state.rules = state.rules.some((r) => r.id === clean.id) ? state.rules.map((r) => (r.id === clean.id ? clean : r)) : [...state.rules, clean];
  const ok = await persistRules(false);
  if (!ok) {
    state.rules = before;
    return;
  }
  ruleDrafts.delete(id);
  editorState = null;
  toasts.success("Saved", `“${ruleName(clean)}”`, "rules");
  markJustAdded(clean.id);
  location.hash = "#rules";
  void isNew;
});

$("rule-editor-discard").addEventListener("click", () => {
  if (!editorState) return;
  const { id, isNew } = editorState;
  ruleDrafts.delete(id);
  editorState = null;
  if (isNew) location.hash = "#rules";
  else renderRuleEditor(id);
});

/** The editor is on screen: draw the rule and keep its match list following the open tabs. */
export function startEditorPage(id) {
  renderRuleEditor(id);
  matchesTimer = setInterval(refreshEditorMatches, 5000);
}

/** Leaving the editor: the match list stops, and forgets its draft unless the editor is what is shown. */
export function stopEditorPage(stillOnEditor) {
  clearInterval(matchesTimer);
  matchesTimer = null;
  if (!stillOnEditor) editorMatches = null;
}
